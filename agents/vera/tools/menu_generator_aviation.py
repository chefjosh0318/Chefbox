#!/usr/bin/env python3
"""
Vera — Aviation Menu Generator
ChefBox Aviation: private jet catering.
Refrigerated (34-38°F). High-altitude flavor compensation. Galley constraints.
"""
import json
import os
from datetime import datetime
from pathlib import Path

import anthropic

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL_DEFAULT = "claude-sonnet-4-6"
MODEL_BUDGET = "claude-haiku-4-5"

OUTPUT_DIR = Path(__file__).parent.parent / "outputs" / "aviation_menus"

SYSTEM_PROMPT = """You are Vera Castellano, Executive Chef, ChefBox Aviation.
Output structured JSON only. No prose. No markdown outside JSON.
Aviation-specific: altitude compensation is mandatory on every savory component.
No exceptions on refrigeration: 34-38°F, 5-7 day shelf life."""

AVIATION_CONSTRAINTS = """AVIATION CATERING HARD CONSTRAINTS:
- Storage: 34-38°F, no frozen.
- High altitude: cabin pressure reduces taste sensitivity ~30%.
  Compensate: salt +15%, acid +10%, umami-forward. Sweet unchanged.
- Galley: convection oven or induction only. No open flame. No deep fryer.
- Turbulence safety: all proteins pre-sliced or fork-tender. No carving required.
- Strong aromatics prohibited in cabin: garlic-dominant, fishy, sulfurous (eggs, cruciferous).
- Individual portions only. No family-style bowls.
- Service window: hold 2h at service temp without degradation.
- Shelf life: ≤7 days from prep. Aviation clients book 24-72h ahead — plan accordingly."""

AVIATION_JSON_SCHEMA = """{
  "booking_ref": "string",
  "flight_type": "string",
  "tier": "first|private|charter",
  "pax": number,
  "duration_hours": number,
  "generated_at": "ISO timestamp",
  "courses": [
    {
      "course_order": number,
      "course_name": "amuse|first|second|entree|dessert|cheese|petit_four",
      "name": "string",
      "components": [
        {
          "item": "string",
          "technique": "string",
          "altitude_adjustment": "string (e.g. +15% salt, +10% acid, umami base added)",
          "storage_note": "string"
        }
      ],
      "galley_prep": {
        "equipment": "convection|induction|none (serve cold)",
        "hold_temp_f": number,
        "hold_time_max_min": number
      },
      "packaging": {
        "format": "plated_to_order|individual_sealed|cold_plate",
        "service_temp": "warm|ambient|chilled"
      },
      "turbulence_safe": true,
      "no_strong_aromatics": true,
      "storage_temp_f": {"min": 34, "max": 38},
      "shelf_life_days": number,
      "estimated_cogs_per_pax_usd": number
    }
  ],
  "beverage_pairings": ["string"],
  "special_equipment": ["string"],
  "prep_timeline": {
    "kitchen_board": "H-Xh before departure",
    "cold_load": "H-Xh before departure",
    "service_start": "H+0 (wheels up or per crew instruction)"
  },
  "validation": {
    "passed": true,
    "violations": [],
    "total_cogs_per_pax_usd": number
  }
}"""


COGS_TARGETS = {
    "first": 35.00,
    "private": 55.00,
    "charter": 25.00,
}


def build_prompt(
    flight_type: str,
    pax: int,
    duration_hours: float,
    dietary: list[str],
    tier: str,
    booking_ref: str,
) -> str:
    cogs_target = COGS_TARGETS.get(tier, 35.00)
    return f"""Generate ChefBox Aviation catering menu.

Booking: {booking_ref}
Flight type: {flight_type}
Passengers: {pax}
Duration: {duration_hours}h
Service tier: {tier}
Dietary: {", ".join(dietary)}
COGS target: ≤${cogs_target:.2f} per person all-in

{AVIATION_CONSTRAINTS}

Output exactly this JSON schema, no other text:
{AVIATION_JSON_SCHEMA}"""


def validate_aviation_menu(menu: dict) -> list[str]:
    violations: list[str] = []
    tier = menu.get("tier", "first")
    cogs_target = COGS_TARGETS.get(tier, 35.00)
    total_cogs = 0.0

    for course in menu.get("courses", []):
        name = course.get("name", "?")

        if course.get("shelf_life_days", 0) > 7:
            violations.append(f"{name}: shelf_life_days exceeds 7-day limit")

        storage = course.get("storage_temp_f", {})
        if storage.get("min", 0) < 34 or storage.get("max", 99) > 38:
            violations.append(f"{name}: storage temp out of 34-38°F range")

        if not course.get("turbulence_safe"):
            violations.append(f"{name}: turbulence_safe not confirmed — verify pre-sliced/fork-tender")

        if not course.get("no_strong_aromatics"):
            violations.append(f"{name}: no_strong_aromatics not confirmed — review components")

        for comp in course.get("components", []):
            if not comp.get("altitude_adjustment"):
                violations.append(f"{name} / {comp.get('item', '?')}: missing altitude_adjustment")

        cogs = course.get("estimated_cogs_per_pax_usd", 0)
        total_cogs += cogs

    if total_cogs > cogs_target:
        violations.append(
            f"Total COGS ${total_cogs:.2f} exceeds {tier} target ${cogs_target:.2f}"
        )

    return violations


def generate_aviation_menu(
    flight_type: str = "private_charter",
    pax: int = 4,
    duration_hours: float = 3.0,
    dietary: list[str] | None = None,
    tier: str = "first",
    booking_ref: str | None = None,
    budget_mode: bool = False,
) -> dict:
    dietary = dietary or ["omnivore"]
    booking_ref = booking_ref or f"AV-{datetime.now().strftime('%Y%m%d%H%M')}"
    model = MODEL_BUDGET if budget_mode else MODEL_DEFAULT

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": build_prompt(flight_type, pax, duration_hours, dietary, tier, booking_ref),
        }],
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
            "booking_ref": booking_ref,
            "generated_at": datetime.now().isoformat(),
        }

    violations = validate_aviation_menu(menu)
    menu.setdefault("validation", {})
    menu["validation"].update({
        "passed": len(violations) == 0,
        "violations": violations,
        "generated_at": datetime.now().isoformat(),
        "model": model,
    })

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    safe_ref = booking_ref.replace("/", "-")
    out = OUTPUT_DIR / f"aviation_{safe_ref}.json"
    out.write_text(json.dumps(menu, indent=2))

    status = "CLEAN" if not violations else f"{len(violations)} violations"
    print(f"Aviation menu {booking_ref}: {tier}, {pax}pax, {duration_hours}h — {status} → {out.name}")

    return menu


if __name__ == "__main__":
    menu = generate_aviation_menu(pax=2, duration_hours=2.5, tier="first")
    print(json.dumps(menu.get("validation"), indent=2))
