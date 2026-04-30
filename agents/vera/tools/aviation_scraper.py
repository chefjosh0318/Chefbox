#!/usr/bin/env python3
"""
Vera — Aviation Scraper
Public-facing aviation caterer menu page scraping.
Approved sites only (sources/approved_scraping.yaml).
Respects robots.txt. No login-gated content. No paywalls.
"""
import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
import yaml
from bs4 import BeautifulSoup

SOURCES_FILE = Path(__file__).parent.parent / "sources" / "approved_scraping.yaml"
OUTPUT_DIR = Path(__file__).parent.parent / "outputs" / "aviation_menus"

BOT_AGENT = "ChefBoxResearchBot/1.0 (aviation menu research; contact@summit-brands.com)"
HEADERS = {
    "User-Agent": BOT_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
}


def load_approved_sources() -> tuple[list[dict], float]:
    data = yaml.safe_load(SOURCES_FILE.read_text())
    delay = data.get("defaults", {}).get("request_delay_seconds", 3.0)
    return data.get("approved_sites", []), delay


def check_robots_allowed(url: str) -> bool:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    rp = RobotFileParser()
    rp.set_url(robots_url)
    try:
        rp.read()
        return rp.can_fetch(BOT_AGENT, url)
    except Exception:
        return False  # fail closed: unknown robots.txt → do not scrape


async def scrape_page(
    client: httpx.AsyncClient,
    url: str,
    selectors: list[str],
    max_items: int = 50,
) -> dict:
    if not check_robots_allowed(url):
        return {"url": url, "error": "robots.txt disallows", "content_items": []}
    try:
        resp = await client.get(url, headers=HEADERS, follow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        content_items: list[str] = []
        for selector in selectors:
            for el in soup.select(selector):
                text = el.get_text(separator=" ", strip=True)
                if len(text) > 25 and text not in content_items:
                    content_items.append(text)
                if len(content_items) >= max_items:
                    break
            if len(content_items) >= max_items:
                break
        return {
            "url": url,
            "fetched_at": datetime.now().isoformat(),
            "content_items": content_items[:max_items],
            "error": None,
        }
    except httpx.HTTPStatusError as e:
        return {"url": url, "error": f"HTTP {e.response.status_code}", "content_items": []}
    except httpx.RequestError as e:
        return {"url": url, "error": str(e), "content_items": []}


async def run_aviation_scrape() -> dict:
    """Scrape all approved aviation caterer public pages."""
    sources, delay = load_approved_sources()
    results: dict = {
        "timestamp": datetime.now().isoformat(),
        "sites": [],
        "total_items": 0,
        "errors": [],
    }
    domain_last_hit: dict[str, float] = {}

    async with httpx.AsyncClient(timeout=20.0) as client:
        for source in sources:
            domain = urlparse(source["url"]).netloc
            site_data = {
                "name": source["name"],
                "url": source["url"],
                "category": source.get("category", "aviation_catering"),
                "pages": [],
            }
            pages = source.get("pages", [source["url"]])
            selectors = source.get("selectors", ["p", "li", "h2", "h3"])

            for page_url in pages:
                since_last = time.monotonic() - domain_last_hit.get(domain, 0)
                if since_last < delay:
                    await asyncio.sleep(delay - since_last)

                page_result = await scrape_page(client, page_url, selectors)
                site_data["pages"].append(page_result)
                domain_last_hit[domain] = time.monotonic()

                if page_result.get("error"):
                    results["errors"].append({
                        "site": source["name"],
                        "url": page_url,
                        "error": page_result["error"],
                    })
                else:
                    results["total_items"] += len(page_result["content_items"])

                await asyncio.sleep(delay)

            results["sites"].append(site_data)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUTPUT_DIR / f"aviation_intel_{datetime.now().strftime('%Y%m%d')}.json"
    out.write_text(json.dumps(results, indent=2))
    print(
        f"Aviation scrape: {len(results['sites'])} sites, "
        f"{results['total_items']} items, {len(results['errors'])} errors → {out.name}"
    )
    return results


if __name__ == "__main__":
    asyncio.run(run_aviation_scrape())
