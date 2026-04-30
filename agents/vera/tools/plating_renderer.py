#!/usr/bin/env python3
"""
Vera — Plating Renderer
FAL.AI plating diagram generator for approved menu items.
Budget-gated: $20/month FAL.AI allocation. Skips if budget ratchet ≥80%.
"""
import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

import httpx

FAL_API_KEY = os.getenv("FAL_AI_API_KEY", "")
FAL_ENDPOINT = "https://fal.run/fal-ai/flux/dev"

BUDGET_FILE = Path(__file__).parent.parent / "budgets_current.json"
FAL_MONTHLY_BUDGET = 20.00
COST_PER_IMAGE = 0.04
HARD_CAP = 150.00


# ── Budget tracking ───────────────────────────────────────────────

def _load_budget() -> dict:
    if BUDGET_FILE.exists():
        data = json.loads(BUDGET_FILE.read_text())
        current_month = datetime.now().strftime("%Y-%m")
        if data.get("month") == current_month:
            return data
    return {
        "month": datetime.now().strftime("%Y-%m"),
        "fal_ai": 0.0,
        "anthropic": 0.0,
        "elevenlabs": 0.0,
        "voyage_ai": 0.0,
        "other": 0.0,
        "total": 0.0,
    }


def _save_budget(data: dict) -> None:
    BUDGET_FILE.write_text(json.dumps(data, indent=2))


def _check_render_allowed() -> tuple[bool, str]:
    """Return (allowed, reason). Blocked if FAL budget exhausted or global ratchet ≥80%."""
    budget = _load_budget()
    fal_spent = budget.get("fal_ai", 0.0)
    total_spent = budget.get("total", 0.0)

    if fal_spent + COST_PER_IMAGE > FAL_MONTHLY_BUDGET:
        return False, f"FAL.AI budget exhausted (${fal_spent:.2f}/${FAL_MONTHLY_BUDGET:.2f})"
    if total_spent / HARD_CAP >= 0.80:
        pct = total_spent / HARD_CAP * 100
        return False, f"Global ratchet ≥80% (${total_spent:.2f} = {pct:.0f}% of cap). FAL renders paused."
    return True, "ok"


def _record_spend(amount: float) -> None:
    budget = _load_budget()
    budget["fal_ai"] = round(budget.get("fal_ai", 0.0) + amount, 4)
    budget["total"] = round(budget.get("total", 0.0) + amount, 4)
    _save_budget(budget)


# ── Prompt building ───────────────────────────────────────────────

def _build_plating_prompt(
    meal_name: str,
    components: list[str],
    style: str,
    format_type: str,
) -> str:
    style_map = {
        "modern": "modern fine dining, negative space, precise sauce placement",
        "aviation": "individual aviation tray, clean portioned sections, professional catering",
        "rustic": "rustic bistro, warm plating, generous portions",
    }
    style_desc = style_map.get(style, style_map["modern"])
    components_str = ", ".join(components[:5])
    return (
        f"Professional food photography, overhead shot, {style_desc}. "
        f"Dish name: {meal_name}. "
        f"Components: {components_str}. "
        f"White ceramic plate, precise placement, restaurant-grade presentation. "
        f"No text, no labels, no watermarks. Photorealistic, sharp focus, clean background."
    )


# ── Render ────────────────────────────────────────────────────────

async def render_plating(
    meal_name: str,
    components: list[str],
    style: str = "modern",
    format_type: str = "consumer",
    output_dir: Path | None = None,
) -> dict:
    """Generate plating diagram. Budget-gated. Returns status + image URL/path."""
    allowed, reason = _check_render_allowed()
    if not allowed:
        return {"status": "skipped", "reason": reason, "meal": meal_name}

    if not FAL_API_KEY:
        return {"status": "error", "reason": "FAL_AI_API_KEY not set", "meal": meal_name}

    prompt = _build_plating_prompt(meal_name, components, style, format_type)
    payload = {
        "prompt": prompt,
        "image_size": "square_hd",
        "num_inference_steps": 28,
        "num_images": 1,
        "guidance_scale": 3.5,
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            resp = await client.post(
                FAL_ENDPOINT,
                json=payload,
                headers={
                    "Authorization": f"Key {FAL_API_KEY}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            result = resp.json()
        except httpx.HTTPError as e:
            return {"status": "error", "reason": str(e), "meal": meal_name}

    image_url = result.get("images", [{}])[0].get("url")
    if not image_url:
        return {"status": "error", "reason": "No image URL in FAL response", "meal": meal_name}

    _record_spend(COST_PER_IMAGE)

    local_path: str | None = None
    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        safe = meal_name.lower().replace(" ", "_")[:40]
        ts = datetime.now().strftime("%Y%m%d_%H%M")
        img_path = output_dir / f"{safe}_{ts}.jpg"
        async with httpx.AsyncClient(timeout=30.0) as client:
            img_resp = await client.get(image_url)
            img_path.write_bytes(img_resp.content)
        local_path = str(img_path)

    return {
        "status": "ok",
        "meal": meal_name,
        "image_url": image_url,
        "local_path": local_path,
        "cost_usd": COST_PER_IMAGE,
        "rendered_at": datetime.now().isoformat(),
    }


async def render_menu_batch(
    menu: dict,
    format_type: str = "consumer",
    output_dir: Path | None = None,
) -> list[dict]:
    """Render plating diagrams for all meals in a generated menu."""
    items = menu.get("meals", menu.get("courses", []))
    results = []
    for item in items:
        name = item.get("name", item.get("course_name", "?"))
        # Build component list from menu structure
        components: list[str] = []
        if "protein" in item:
            components.append(item["protein"].get("item", ""))
        if "starch" in item:
            components.append(item["starch"].get("item", ""))
        for veg in item.get("vegetables", []):
            components.append(veg.get("item", ""))
        if "sauce" in item:
            components.append(item["sauce"].get("name", ""))
        # Aviation format
        for comp in item.get("components", []):
            components.append(comp.get("item", ""))

        style = "aviation" if format_type == "aviation" else "modern"
        result = await render_plating(
            meal_name=name,
            components=[c for c in components if c],
            style=style,
            format_type=format_type,
            output_dir=output_dir,
        )
        results.append(result)

        # Pause between renders to avoid FAL rate limits
        await asyncio.sleep(2.0)

    return results


if __name__ == "__main__":
    result = asyncio.run(render_plating(
        "Braised Chicken Thigh",
        ["chicken thigh", "arborio risotto", "broccolini", "cream mushroom sauce"],
        style="modern",
    ))
    print(json.dumps(result, indent=2))
