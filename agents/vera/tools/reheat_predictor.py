#!/usr/bin/env python3
"""
Vera — Reheat Quality Predictor
Food science-based quality scoring for refrigerated meal reheating.
Models: protein texture, starch retrogradation, sauce emulsion, vegetable color.
All scoring based on published cook-chill-reheat research (see approved_research.yaml).
"""
import json
from dataclasses import asdict, dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path


class ReheatingMethod(Enum):
    MICROWAVE = "microwave"
    OVEN = "oven"
    STOVETOP = "stovetop"
    STEAM = "steam"
    AIR_FRYER = "air_fryer"


class ComponentType(Enum):
    PROTEIN = "protein"
    STARCH = "starch"
    VEGETABLE = "vegetable"
    SAUCE = "sauce"
    DAIRY = "dairy"
    FAT = "fat"


@dataclass
class IngredientProfile:
    name: str
    type: str                        # use ComponentType values
    water_activity: float            # 0.0–1.0
    protein_pct: float
    starch_pct: float
    fat_pct: float
    initial_cook_temp_f: float = 165.0
    is_emulsion: bool = False
    contains_dairy: bool = False
    notes: str = ""


@dataclass
class ComponentScore:
    ingredient: str
    component_type: str
    method: str
    storage_day: int
    quality_score: float    # 0.0–1.0 minimum of sub-scores
    texture_score: float
    flavor_score: float
    appearance_score: float
    safety_score: float
    issues: list[str]
    recommendation: str     # APPROVE | MODIFY | REJECT | SEPARATE_PACKAGING


# ── Scoring functions ─────────────────────────────────────────────

def _score_protein(p: IngredientProfile, method: ReheatingMethod, day: int) -> ComponentScore:
    issues: list[str] = []
    texture, flavor, appearance, safety = 1.0, 1.0, 1.0, 1.0

    # Second-heat protein tightening
    if method == ReheatingMethod.MICROWAVE:
        texture -= 0.20
        issues.append("Microwave: uneven heat → rubbery surface risk. Cover; use 70% power.")
    elif method == ReheatingMethod.OVEN and p.fat_pct < 6:
        texture -= 0.18
        issues.append("Lean protein in dry oven: drying risk. Add 2 tbsp liquid + cover tightly.")
    elif method == ReheatingMethod.STEAM:
        texture -= 0.05  # steam is gentlest

    # Day degradation — protein oxidation and moisture loss
    texture -= (day - 1) * 0.035
    flavor -= (day - 1) * 0.025
    if day >= 6:
        flavor -= 0.08
        issues.append(f"Day {day}: protein oxidation possible. Check for off-notes before service.")
    if day > 7:
        safety = 0.0
        issues.append("BEYOND 7-DAY SHELF LIFE LIMIT. Do not serve.")

    # High-fat proteins hold better
    if p.fat_pct >= 12:
        texture += 0.05

    q = min(texture, flavor, appearance, safety)
    if safety == 0.0:
        rec = "REJECT"
    elif q >= 0.72:
        rec = "APPROVE"
        if day == 7:
            rec = "APPROVE — final day. Serve today only."
    elif q >= 0.55:
        rec = "MODIFY"
    else:
        rec = "REJECT"

    return ComponentScore(
        ingredient=p.name, component_type="protein",
        method=method.value, storage_day=day,
        quality_score=round(max(0.0, q), 3),
        texture_score=round(max(0.0, texture), 3),
        flavor_score=round(max(0.0, flavor), 3),
        appearance_score=round(max(0.0, appearance), 3),
        safety_score=round(max(0.0, safety), 3),
        issues=issues, recommendation=rec,
    )


def _score_starch(p: IngredientProfile, method: ReheatingMethod, day: int) -> ComponentScore:
    """Key risk: retrogradation — amylopectin recrystallization → dry, crumbly texture."""
    issues: list[str] = []
    texture, flavor, appearance, safety = 1.0, 1.0, 1.0, 1.0

    if p.starch_pct > 18:
        # Retrogradation worsens daily; rice > pasta > potato
        retro = day * 0.07
        texture -= retro
        if retro > 0.14:
            issues.append(
                f"Retrogradation: starch crystallized after {day}d cold storage. "
                "Add 1–2 tbsp water at reheat to restore moisture."
            )

    if method == ReheatingMethod.MICROWAVE:
        # Steam in covered container partially reverses retrogradation
        texture += 0.08
        issues.append("Add 1 tbsp water, cover before microwaving. Steam reverses retrogradation.")
    elif method == ReheatingMethod.OVEN:
        texture -= 0.12
        issues.append("Oven dries starches. Cover with foil + add liquid, or use stovetop.")

    if day > 7:
        safety = 0.0
        issues.append("BEYOND 7-DAY LIMIT. Do not serve.")

    q = min(texture, flavor, appearance, safety)
    if safety == 0.0:
        rec = "REJECT"
    elif q >= 0.65:
        rec = "APPROVE"
    elif q >= 0.50:
        rec = "MODIFY"
        issues.append("Add moisture at reheat or substitute with day-stable starch (farro, barley).")
    else:
        rec = "REJECT"
        issues.append("Starch texture below threshold. Remove from menu or substitute.")

    return ComponentScore(
        ingredient=p.name, component_type="starch",
        method=method.value, storage_day=day,
        quality_score=round(max(0.0, q), 3),
        texture_score=round(max(0.0, texture), 3),
        flavor_score=round(max(0.0, flavor), 3),
        appearance_score=round(max(0.0, appearance), 3),
        safety_score=round(max(0.0, safety), 3),
        issues=issues, recommendation=rec,
    )


def _score_sauce(p: IngredientProfile, method: ReheatingMethod, day: int) -> ComponentScore:
    """Key risks: emulsion break, dairy curdling, oxidative rancidity in oil-based."""
    issues: list[str] = []
    texture, flavor, appearance, safety = 1.0, 1.0, 1.0, 1.0

    # Oil-based emulsions (vinaigrette, aioli, hollandaise) cannot be reheated
    if p.is_emulsion and p.fat_pct > 20:
        return ComponentScore(
            ingredient=p.name, component_type="sauce",
            method=method.value, storage_day=day,
            quality_score=0.0, texture_score=0.0, flavor_score=0.7,
            appearance_score=0.0, safety_score=1.0,
            issues=["Emulsion sauce: must be packaged separately. Cannot survive reheat."],
            recommendation="SEPARATE_PACKAGING",
        )

    # Dairy-based sauces
    if p.contains_dairy:
        if method == ReheatingMethod.MICROWAVE:
            texture -= 0.28
            issues.append("Dairy sauce: microwave causes rapid boiling → protein aggregation → grainy. Use stovetop + low heat.")
        if day >= 4:
            texture -= 0.12
            flavor -= 0.08
            issues.append(f"Dairy sauce day {day}: protein aggregation and sourness risk. Taste before service.")

    # Tomato and stock-based sauces are more stable
    if not p.contains_dairy and not p.is_emulsion:
        texture -= (day - 1) * 0.02
        flavor -= (day - 1) * 0.02

    if day > 7:
        safety = 0.0
        issues.append("BEYOND 7-DAY LIMIT. Do not serve.")

    q = min(texture, flavor, appearance, safety)
    if safety == 0.0:
        rec = "REJECT"
    elif q >= 0.62:
        rec = "APPROVE"
    elif q >= 0.45:
        rec = "MODIFY"
    else:
        rec = "REJECT"

    return ComponentScore(
        ingredient=p.name, component_type="sauce",
        method=method.value, storage_day=day,
        quality_score=round(max(0.0, q), 3),
        texture_score=round(max(0.0, texture), 3),
        flavor_score=round(max(0.0, flavor), 3),
        appearance_score=round(max(0.0, appearance), 3),
        safety_score=round(max(0.0, safety), 3),
        issues=issues, recommendation=rec,
    )


def _score_vegetable(p: IngredientProfile, method: ReheatingMethod, day: int) -> ComponentScore:
    """Key risks: chlorophyll degradation (green veg), cell wall collapse, oxidation."""
    issues: list[str] = []
    texture, flavor, appearance, safety = 1.0, 1.0, 1.0, 1.0

    # Green vegetables lose color by day 3-4 (chlorophyll → pheophytin)
    appearance -= (day - 1) * 0.07
    if day >= 3:
        issues.append(f"Green veg day {day}: chlorophyll degradation → olive/drab color. Blanch shock, or use roasted/caramelized veg.")
    texture -= (day - 1) * 0.05

    if method == ReheatingMethod.MICROWAVE:
        texture -= 0.08
        appearance -= 0.05

    if day > 7:
        safety = 0.0

    q = min(texture, flavor, appearance, safety)
    if safety == 0.0:
        rec = "REJECT"
    elif q >= 0.60:
        rec = "APPROVE"
    elif q >= 0.45:
        rec = "MODIFY"
        issues.append("Consider roasted, braised, or pickled veg for better day-5+ appearance.")
    else:
        rec = "REJECT"

    return ComponentScore(
        ingredient=p.name, component_type="vegetable",
        method=method.value, storage_day=day,
        quality_score=round(max(0.0, q), 3),
        texture_score=round(max(0.0, texture), 3),
        flavor_score=round(max(0.0, flavor), 3),
        appearance_score=round(max(0.0, appearance), 3),
        safety_score=round(max(0.0, safety), 3),
        issues=issues, recommendation=rec,
    )


# ── Main prediction entry point ───────────────────────────────────

def predict_meal_reheat_quality(
    ingredients: list[IngredientProfile],
    method: ReheatingMethod,
    storage_day: int,
) -> dict:
    """Score all components. Return overall pass/fail + per-component breakdown."""
    if storage_day < 1 or storage_day > 7:
        return {
            "error": f"storage_day must be 1–7 (got {storage_day}). Day 8+ is beyond shelf life.",
            "overall_verdict": "REJECT",
        }

    component_scores: list[dict] = []
    for ing in ingredients:
        ctype = ing.type.lower()
        if ctype == "protein":
            score = _score_protein(ing, method, storage_day)
        elif ctype == "starch":
            score = _score_starch(ing, method, storage_day)
        elif ctype in ("sauce", "dairy"):
            score = _score_sauce(ing, method, storage_day)
        elif ctype == "vegetable":
            score = _score_vegetable(ing, method, storage_day)
        else:
            score = ComponentScore(
                ingredient=ing.name, component_type=ctype,
                method=method.value, storage_day=storage_day,
                quality_score=0.85, texture_score=0.85, flavor_score=0.85,
                appearance_score=0.85, safety_score=1.0, issues=[],
                recommendation="APPROVE",
            )
        component_scores.append(asdict(score))

    if not component_scores:
        return {"error": "No ingredients provided", "overall_verdict": "REJECT"}

    overall_q = min(s["quality_score"] for s in component_scores)
    hard_fails = [s for s in component_scores if s["recommendation"] in ("REJECT", "SEPARATE_PACKAGING")]
    all_issues = [issue for s in component_scores for issue in s["issues"]]

    return {
        "method": method.value,
        "storage_day": storage_day,
        "overall_score": round(overall_q, 3),
        "overall_verdict": "PASS" if overall_q >= 0.65 and not hard_fails else "FAIL",
        "hard_failures": hard_fails,
        "all_issues": all_issues,
        "components": component_scores,
        "evaluated_at": datetime.now().isoformat(),
    }


def score_menu_item(meal_dict: dict, method: ReheatingMethod, days_to_check: list[int]) -> dict:
    """Helper: build IngredientProfiles from a menu JSON meal and score multiple days."""
    ingredients: list[IngredientProfile] = []

    protein = meal_dict.get("protein", {})
    if protein:
        ingredients.append(IngredientProfile(
            name=protein.get("item", "protein"),
            type="protein",
            water_activity=0.94,
            protein_pct=22.0,
            starch_pct=0.0,
            fat_pct=8.0,
            initial_cook_temp_f=protein.get("internal_temp_f", 165.0),
        ))

    starch = meal_dict.get("starch", {})
    if starch:
        ingredients.append(IngredientProfile(
            name=starch.get("item", "starch"),
            type="starch",
            water_activity=0.70,
            protein_pct=3.0,
            starch_pct=26.0,
            fat_pct=0.5,
        ))

    sauce = meal_dict.get("sauce", {})
    if sauce:
        base = sauce.get("base", "stock")
        ingredients.append(IngredientProfile(
            name=sauce.get("name", "sauce"),
            type="sauce",
            water_activity=0.96,
            protein_pct=3.0,
            starch_pct=2.0,
            fat_pct=12.0,
            is_emulsion=(base == "oil"),
            contains_dairy=(base == "dairy"),
        ))

    return {
        "meal": meal_dict.get("name", "?"),
        "day_scores": {
            day: predict_meal_reheat_quality(ingredients, method, day)
            for day in days_to_check
        },
    }


if __name__ == "__main__":
    # Example: braised chicken thigh + arborio risotto + cream mushroom sauce, day 3 and 5
    ings = [
        IngredientProfile("braised chicken thigh", "protein", 0.94, 25.0, 0.0, 9.0, 185.0),
        IngredientProfile("arborio risotto", "starch", 0.72, 4.0, 28.0, 3.0, 212.0),
        IngredientProfile("cream mushroom sauce", "sauce", 0.96, 4.0, 2.0, 16.0,
                          contains_dairy=True),
    ]
    for day in [1, 3, 5, 7]:
        result = predict_meal_reheat_quality(ings, ReheatingMethod.MICROWAVE, storage_day=day)
        print(f"Day {day}: {result['overall_verdict']} (score={result['overall_score']})")
        for issue in result["all_issues"]:
            print(f"  {issue}")
