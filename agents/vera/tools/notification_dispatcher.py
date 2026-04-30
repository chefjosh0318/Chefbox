#!/usr/bin/env python3
"""
Vera — Notification Dispatcher
Routes Summit Brands alerts to Telegram (primary).
Matches existing agent pattern from voice.js relayToTelegram().
All Vera alerts → Joshua, chat_id 8718538131.
"""
import asyncio
import json
import os
from datetime import datetime
from enum import Enum
from pathlib import Path

import httpx

TELEGRAM_BOT_TOKEN = os.getenv(
    "TELEGRAM_BOT_TOKEN",
    "8696126538:AAHf4r5wIw33qo9I4nKhCZvVbBz8lYzBAfs",
)
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "8718538131")
TELEGRAM_API = "https://api.telegram.org"

BUDGET_FILE = Path(__file__).parent.parent / "budgets_current.json"
HARD_CAP = 150.00


class Priority(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


_EMOJI = {
    Priority.LOW: "📋",
    Priority.MEDIUM: "📊",
    Priority.HIGH: "🔔",
    Priority.CRITICAL: "🚨",
}


# ── Core send ─────────────────────────────────────────────────────

async def send_telegram(
    message: str,
    priority: Priority = Priority.MEDIUM,
    parse_mode: str = "Markdown",
) -> bool:
    emoji = _EMOJI[priority]
    full = f"{emoji} *Vera* | {priority.value.upper()}\n{message}"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": full,
        "parse_mode": parse_mode,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(
                f"{TELEGRAM_API}/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json=payload,
            )
            return resp.status_code == 200
        except Exception as e:
            print(f"Telegram send failed: {e}")
            return False


# ── Typed notification helpers ────────────────────────────────────

async def notify_menu_ready(menu: dict, tier: str = "consumer") -> bool:
    week = menu.get("week", menu.get("booking_ref", "?"))
    items = menu.get("meals", menu.get("courses", []))
    count = len(items)
    validation = menu.get("validation", {})
    violations = validation.get("violations", [])
    status = "✅ CLEAN" if not violations else f"⚠️ {len(violations)} violation(s)"

    msg = (
        f"*{tier.upper()} MENU READY*\n"
        f"Ref: `{week}`\n"
        f"Items: {count}\n"
        f"Validation: {status}\n"
    )
    if violations:
        msg += "*Violations:*\n" + "\n".join(f"• {v}" for v in violations[:5])
        msg += "\n_Action: resolve violations before production approval_"
    else:
        msg += "_Action: approve for production_"

    p = Priority.HIGH if violations else Priority.MEDIUM
    return await send_telegram(msg, p)


async def notify_budget_alert(
    current_spend: float,
    threshold_pct: float,
) -> bool:
    pct = (current_spend / HARD_CAP) * 100
    actions = {
        0.50: "Model downgrade → all calls forced to claude-haiku-4-5",
        0.80: "Pausing aviation scraping + plating renders",
        0.95: "EMERGENCY STOP — all autonomous operations halted. Manual reset required.",
        1.00: "HARD CAP HIT. Card blocked.",
    }
    action = actions.get(threshold_pct, "Monitor")

    msg = (
        f"*BUDGET THRESHOLD: {threshold_pct*100:.0f}%*\n"
        f"Spent: `${current_spend:.2f}` / `${HARD_CAP:.2f}`\n"
        f"Utilization: `{pct:.1f}%`\n"
        f"Action: {action}"
    )
    p = Priority.CRITICAL if threshold_pct >= 0.95 else Priority.HIGH
    return await send_telegram(msg, p)


async def notify_research_scan_complete(
    article_count: int,
    error_count: int,
    output_file: str = "",
) -> bool:
    msg = (
        f"*RESEARCH SCAN COMPLETE*\n"
        f"Articles: {article_count}\n"
        f"Errors: {error_count}\n"
        f"Namespaces: food\\_science, refrigerated\\_storage"
    )
    if output_file:
        msg += f"\nFile: `{Path(output_file).name}`"
    return await send_telegram(msg, Priority.LOW)


async def notify_aviation_booking(booking_ref: str, pax: int, duration_h: float) -> bool:
    msg = (
        f"*AVIATION BOOKING — MENU NEEDED*\n"
        f"Ref: `{booking_ref}`\n"
        f"PAX: {pax} | Duration: {duration_h}h\n"
        f"SLA: 4h — generating menu now"
    )
    return await send_telegram(msg, Priority.HIGH)


async def notify_ingredient_flagged(item_name: str, issue: str) -> bool:
    msg = (
        f"*INGREDIENT FLAG*\n"
        f"Item: `{item_name}`\n"
        f"Issue: {issue}\n"
        f"Action: remove from active menu or substitute"
    )
    return await send_telegram(msg, Priority.HIGH)


async def send_daily_briefing(summary: dict) -> bool:
    date_str = datetime.now().strftime("%A, %B %-d")
    lines = [f"*VERA DAILY BRIEFING — {date_str}*", ""]

    if summary.get("menus_generated"):
        lines.append(f"Menus generated: {summary['menus_generated']}")
    if summary.get("aviation_menus"):
        lines.append(f"Aviation menus: {summary['aviation_menus']}")
    if summary.get("research_articles"):
        lines.append(f"Research articles: {summary['research_articles']}")
    if summary.get("aviation_sites"):
        lines.append(f"Aviation intel sites: {summary['aviation_sites']}")
    if summary.get("reheat_validations"):
        lines.append(f"Reheat validations run: {summary['reheat_validations']}")

    budget = summary.get("budget", {})
    if budget:
        spent = budget.get("total", 0.0)
        pct = spent / HARD_CAP * 100
        lines.append(f"Budget: `${spent:.2f}` / `${HARD_CAP:.2f}` ({pct:.0f}%)")

    flags = summary.get("flags", [])
    if flags:
        lines.append("\n*FLAGS:*")
        for flag in flags:
            lines.append(f"• {flag}")

    return await send_telegram("\n".join(lines), Priority.MEDIUM)


async def send_weekly_report(report: dict) -> bool:
    week = report.get("week", "?")
    lines = [f"*VERA WEEKLY REPORT — {week}*", ""]

    for k, v in report.items():
        if k in ("week", "flags"):
            continue
        label = k.replace("_", " ").title()
        lines.append(f"{label}: {v}")

    flags = report.get("flags", [])
    if flags:
        lines.append("\n*FLAGS:*")
        for flag in flags:
            lines.append(f"• {flag}")

    return await send_telegram("\n".join(lines), Priority.MEDIUM)


async def send_error_alert(tool: str, error: str, context: str = "") -> bool:
    msg = (
        f"*TOOL ERROR*\n"
        f"Tool: `{tool}`\n"
        f"Error: {error[:200]}"
    )
    if context:
        msg += f"\nContext: {context[:100]}"
    return await send_telegram(msg, Priority.HIGH)


if __name__ == "__main__":
    asyncio.run(send_telegram("Vera online. Systems nominal.", Priority.MEDIUM))
