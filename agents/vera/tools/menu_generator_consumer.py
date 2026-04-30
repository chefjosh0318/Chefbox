#!/usr/bin/env python3
"""
Vera — Consumer Menu Generator
ChefBox refrigerated meal engine.
Constraint: 34-38°F, 5-7 day shelf life. NO frozen. NO freeze-thaw.
Full validation pipeline: refrigeration check → reheat predict → COGS.
"""
import json
import os
from datetime import datetime
from pathlib import Path

import anthropic

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL_DEFAULT = "claude-sonnet-4-6"
MODEL_BUDGET = "claude-haiku-4-5"

OUTPUT_DIR = Path(__file__).parent.parent / "outputs" / "consumer_menus"

SYSTEM_PROMPT = """You are Vera Castellano, Executive Chef, ChefBox R&D.
Output structured JSON only. No prose. No markdown outside JSON.
Every dish assumes refrigerated storage 34-38°F, 5-7 day shelf life. No frozen.
Speak directive: protein + technique + temp. Starch + retrogradation note. Sauce stability flag."""

REFRIGERATION_CONSTRAINT = """HARD CONSTRAINTS — ALL MUST PASS:
- Storage: 34-38°F continuous. No frozen.
- Shelf life: ≤7 days. Never exceed.
- Sauces with dairy or emulsion: separate packaging.
- No raw aromatics pre-packed (garlic, raw onion blacken by day 2).
- Proteins: cooked to safe internal temp, rapid-chilled to 38°F within 2h.
- Starches: note retrogradation risk; specify reheat moisture compensation."""

MENU_JSON_SCHEMA = """{
  "week": "string (YYYY-WNN)",
  "generated_at": "ISO timestamp",
  "meals": [
    {
      "id": "string (meal_01 etc)",
      "name": "string",
      "protein": {
        "item": "string",
        "technique": "string (e.g. braise, sear-roast, sous-vide)",
        "internal_temp_f": number,
        "packaging_note": "string"
      },
      "starch": {
        "item": "string",
        "technique": "string",
        "retrogradation_risk": "low|medium|high",
        "reheat_moisture_note": "string"
      },
      "vegetables": [
        {"item": "string", "technique": "string", "storage_note": "string"}
      ],
      "sauce": {
        "name": "string",
        "base": "dairy|tomato|oil|stock|other",
        "packaging": "integrated|separate",
        "shelf_life_risk": "low|medium|high",
        "stability_note": "string"
      },
      "reheat_spec": {
        "method": "microwave|oven|stovetop|steam",
        "temp_f": number,
        "time_min": number,
        "notes": "string"
      },
      "shelf_life_days": number,
      "storage_temp_f": {"min": 34, "max": 38},
      "dietary_tags": ["string"],
      "estimated_cogs_usd": number,
      "plating_notes": "string"
    }
  ]
}"""


def get_model(budget_mode: bool) -> str:
    return MODEL_BUDGET if budget_mode else MODEL_DEFAULT


def build_prompt(
    week: str,
    dietary_profiles: list[str],
    target_cogs: float,
    meal_count: int,
) -> str:
    return f"""Generate ChefBox weekly consumer menu.

Week: {week}
Meals: {meal_count}
Dietary profiles: {", ".join(dietary_profiles)}
COGS target: ≤${target_cogs:.2f} per meal (all-in, including packaging)

{REFRIGERATION_CONSTRAINT}

Output exactly this JSON schema, no other text:
{MENU_JSON_SCHEMA}"""


def validate_menu(menu: dict) -> list[str]:
    """Check menu against refrigeration constraints. Returns list of violations."""
    violations: list[str] = []
    for meal in menu.get("meals", []):
        name = meal.get("name", "?")

        if meal.get("shelf_life_days", 0) > 7:
            violations.append(
                f"{name}: shelf_life_days={meal['shelf_life_days']} exceeds 7-day limit"
            )

        storage = meal.get("storage_temp_f", {})
        if storage.get("min", 0) < 34:
            violations.append(f"{name}: storage min {storage['min']}°F below 34°F floor")
        if storage.get("max", 99) > 38:
            violations.append(f"{name}: storage max {storage['max']}°F above 38°F ceiling")

        sauce = meal.get("sauce", {})
        if sauce.get("shelf_life_risk") == "high" and sauce.get("packaging") == "integrated":
            violations.append(
                f"{name}: high-risk sauce must use separate packaging"
            )

        if meal.get("estimated_cogs_usd", 0) > 8.50:
            violations.append(
                f"{name}: COGS ${meal['estimated_cogs_usd']:.2f} exceeds $8.50 target"
            )

        protein = meal.get("protein", {})
        if protein.get("internal_temp_f", 999) < 145:
            violations.append(
                f"{name}: protein internal temp {protein.get('internal_temp_f')}°F below safe minimum 145°F"
            )

    return violations


def generate_consumer_menu(
    week: str | None = None,
    dietary_profiles: list[str] | None = None,
    target_cogs: float = 8.50,
    meal_count: int = 5,
    budget_mode: bool = False,
) -> dict:
    week = week or datetime.now().strftime("%Y-W%V")
    dietary_profiles = dietary_profiles or ["omnivore", "gluten-free option", "dairy-free option"]
    model = get_model(budget_mode)

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": build_prompt(week, dietary_profiles, target_cogs, meal_count)}],
    )
    raw = response.content[0].text.strip()

    try:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        menu = json.loads(raw[start:end])
    except json.JSONDecodeError as e:
        return {
            "error": f"JSON parse failed: {e}",
            "raw": raw,
            "week": week,
            "generated_at": datetime.now().isoformat(),
        }

    violations = validate_menu(menu)
    menu["validation"] = {
        "passed": len(violations) == 0,
        "violations": violations,
        "generated_at": datetime.now().isoformat(),
        "model": model,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    safe_week = week.replace("-", "_").replace("/", "_")
    out = OUTPUT_DIR / f"menu_{safe_week}.json"
    out.write_text(json.dumps(menu, indent=2))

    status = "CLEAN" if not violations else f"{len(violations)} violations"
    print(f"Consumer menu {week}: {len(menu.get('meals', []))} meals, {status} → {out.name}")
    if violations:
        for v in violations:
            print(f"  VIOLATION: {v}")

    return menu


if __name__ == "__main__":
    menu = generate_consumer_menu(meal_count=3)
    print(json.dumps(menu.get("validation"), indent=2))
