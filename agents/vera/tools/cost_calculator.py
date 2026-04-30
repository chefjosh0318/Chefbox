#!/usr/bin/env python3
"""
Vera — Cost Calculator
COGS calculation: USDA FoodData Central data + Sysco invoice overrides.
Targets: ≤$8.50/meal consumer, ≤$35/pax aviation first, ≤$55/pax aviation private.
"""
import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

import httpx

USDA_API_KEY = os.getenv("USDA_API_KEY", "DEMO_KEY")
USDA_BASE = "https://api.nal.usda.gov/fdc/v1"

CONSUMER_COGS_TARGET = 8.50
AVIATION_TARGETS = {
    "first": 35.00,
    "private": 55.00,
    "charter": 25.00,
}
PACKAGING_COST = {
    "consumer": 0.85,   # chilled container + sleeve + insert
    "aviation": 2.50,   # individual aviation-grade tray + lid
}

# Updated from Sysco invoices — refresh monthly
# Key format: keyword → price_per_lb
SYSCO_PRICE_OVERRIDES: dict[str, float] = {
    "chicken breast": 3.20,
    "chicken thigh": 2.40,
    "salmon": 8.50,
    "halibut": 14.00,
    "sea bass": 18.00,
    "shrimp": 9.50,
    "beef tenderloin": 28.00,
    "ground beef": 5.80,
    "pork tenderloin": 5.20,
    "lamb chop": 16.00,
    "jasmine rice": 1.20,
    "arborio rice": 2.40,
    "brown rice": 1.10,
    "farro": 3.00,
    "quinoa": 3.50,
    "pasta": 1.40,
    "potato": 0.80,
    "sweet potato": 1.20,
    "broccoli": 1.80,
    "broccolini": 3.20,
    "spinach": 2.40,
    "kale": 2.20,
    "asparagus": 4.50,
    "green bean": 2.60,
    "zucchini": 1.60,
    "carrot": 0.90,
    "leek": 2.80,
    "heavy cream": 4.20,
    "butter": 5.50,
    "olive oil": 5.00,
    "vegetable stock": 1.00,
    "chicken stock": 1.20,
    "tomato": 2.20,
    "lemon": 1.50,
    "garlic": 2.80,
    "shallot": 3.50,
    "parmesan": 9.00,
    "goat cheese": 12.00,
    "miso": 4.00,
    "soy sauce": 2.00,
    "kosher salt": 0.40,
    "black pepper": 8.00,
}

DEFAULT_PRICE_PER_LB = 4.50  # fallback for unrecognized ingredients


def lookup_sysco_price(ingredient_name: str) -> tuple[float, str]:
    """Return (price_per_lb, source). Match on longest substring."""
    name_lower = ingredient_name.lower()
    best_match = ""
    best_price = DEFAULT_PRICE_PER_LB
    for key, price in SYSCO_PRICE_OVERRIDES.items():
        if key in name_lower and len(key) > len(best_match):
            best_match = key
            best_price = price
    source = f"Sysco override ({best_match})" if best_match else "default estimate"
    return best_price, source


async def lookup_usda_nutrient_category(ingredient: str) -> str | None:
    """Optional: USDA lookup to confirm ingredient category (informational only)."""
    params = {
        "query": ingredient,
        "api_key": USDA_API_KEY,
        "pageSize": 1,
        "dataType": ["Foundation"],
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(f"{USDA_BASE}/foods/search", params=params)
            resp.raise_for_status()
            foods = resp.json().get("foods", [])
            if foods:
                return foods[0].get("foodCategory")
        except Exception:
            pass
    return None


def calculate_meal_cogs(
    components: list[dict],
    packaging_type: str = "consumer",
) -> dict:
    """
    Calculate COGS from component list.
    Each component: {"name": str, "amount_oz": float, "price_per_lb": float|None}
    Returns detailed breakdown + margin check.
    """
    line_items: list[dict] = []
    ingredient_total = 0.0

    for comp in components:
        name = comp.get("name", "")
        oz = float(comp.get("amount_oz", 4.0))
        price_lb = comp.get("price_per_lb")

        if price_lb is None:
            price_lb, source = lookup_sysco_price(name)
        else:
            source = "provided"

        cost = (oz / 16.0) * price_lb
        ingredient_total += cost

        line_items.append({
            "ingredient": name,
            "amount_oz": round(oz, 1),
            "price_per_lb": round(price_lb, 2),
            "cost_usd": round(cost, 3),
            "source": source,
        })

    pkg_cost = PACKAGING_COST.get(packaging_type, PACKAGING_COST["consumer"])
    total = round(ingredient_total + pkg_cost, 2)
    target = CONSUMER_COGS_TARGET if packaging_type == "consumer" else AVIATION_TARGETS.get("first", 35.00)

    return {
        "line_items": line_items,
        "ingredient_cost_usd": round(ingredient_total, 2),
        "packaging_cost_usd": pkg_cost,
        "total_cogs_usd": total,
        "target_usd": target,
        "margin_check": {
            "pass": total <= target,
            "headroom_usd": round(target - total, 2),
            "overage_usd": round(max(0.0, total - target), 2),
        },
        "calculated_at": datetime.now().isoformat(),
    }


def batch_validate_menu_costs(menu: dict, tier: str = "consumer") -> dict:
    """Cost-validate all meals/courses in a generated menu JSON."""
    target = CONSUMER_COGS_TARGET if tier == "consumer" else AVIATION_TARGETS.get(tier, 35.00)
    packaging_type = "consumer" if tier == "consumer" else "aviation"
    results: dict = {
        "tier": tier,
        "target_cogs_usd": target,
        "meals": [],
        "all_pass": True,
        "validated_at": datetime.now().isoformat(),
    }

    items = menu.get("meals", menu.get("courses", []))
    for item in items:
        components = item.get("components", [])
        name = item.get("name", item.get("course_name", "?"))

        # If no components list, fall back to estimated_cogs field
        if not components:
            estimated = item.get("estimated_cogs_usd", item.get("estimated_cogs_per_pax_usd", 0))
            meal_result = {
                "name": name,
                "total_cogs_usd": estimated,
                "pass": estimated <= target,
                "headroom_usd": round(target - estimated, 2),
                "source": "estimated (no component breakdown)",
            }
        else:
            costed = calculate_meal_cogs(components, packaging_type)
            meal_result = {
                "name": name,
                "total_cogs_usd": costed["total_cogs_usd"],
                "pass": costed["margin_check"]["pass"],
                "headroom_usd": costed["margin_check"]["headroom_usd"],
                "line_items": costed["line_items"],
                "source": "component breakdown",
            }

        results["meals"].append(meal_result)
        if not meal_result["pass"]:
            results["all_pass"] = False

    return results


def format_cost_report(costed: dict) -> str:
    """Return markdown cost report for Vera's briefings."""
    lines = [
        f"**COGS Report** — {costed['calculated_at'][:10]}",
        "",
        "| Ingredient | Oz | $/lb | Cost |",
        "|---|---|---|---|",
    ]
    for item in costed["line_items"]:
        lines.append(
            f"| {item['ingredient']} | {item['amount_oz']} | ${item['price_per_lb']:.2f} | ${item['cost_usd']:.3f} |"
        )
    lines += [
        f"| *Packaging* | — | — | ${costed['packaging_cost_usd']:.2f} |",
        f"| **TOTAL** | — | — | **${costed['total_cogs_usd']:.2f}** |",
        "",
        f"Target: ${costed['target_usd']:.2f} — "
        f"{'✅ PASS' if costed['margin_check']['pass'] else '❌ OVER by $' + str(costed['margin_check']['overage_usd'])}",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    test = [
        {"name": "chicken thigh", "amount_oz": 6},
        {"name": "jasmine rice", "amount_oz": 5},
        {"name": "broccolini", "amount_oz": 4},
        {"name": "cream sauce", "amount_oz": 2, "price_per_lb": 3.50},
    ]
    result = calculate_meal_cogs(test)
    print(format_cost_report(result))
