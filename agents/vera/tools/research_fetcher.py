#!/usr/bin/env python3
"""
Vera — Research Fetcher
PubMed Central (open access only) + USDA FoodData Central.
Focus: refrigerated storage, 34-38°F, 5-7 day shelf life, reheat science.
"""
import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

import httpx
import yaml

PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
USDA_BASE = "https://api.nal.usda.gov/fdc/v1"
USDA_API_KEY = os.getenv("USDA_API_KEY", "DEMO_KEY")
PUBMED_API_KEY = os.getenv("PUBMED_API_KEY", "")

SOURCES_FILE = Path(__file__).parent.parent / "sources" / "approved_research.yaml"
OUTPUT_DIR = Path(__file__).parent.parent / "outputs" / "research_summaries"


def load_queries() -> list[str]:
    data = yaml.safe_load(SOURCES_FILE.read_text())
    return data.get("pubmed", {}).get("queries", [])


async def search_pubmed_ids(
    client: httpx.AsyncClient,
    query: str,
    max_results: int = 10,
    days_back: int = 90,
) -> list[str]:
    cutoff = (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")
    params = {
        "db": "pmc",
        "term": f"{query} AND pmc open access[filter]",
        "retmax": max_results,
        "retmode": "json",
        "sort": "relevance",
        "mindate": cutoff,
        "datetype": "pdat",
    }
    if PUBMED_API_KEY:
        params["api_key"] = PUBMED_API_KEY
    resp = await client.get(f"{PUBMED_BASE}/esearch.fcgi", params=params)
    resp.raise_for_status()
    return resp.json().get("esearchresult", {}).get("idlist", [])


async def fetch_pubmed_summaries(
    client: httpx.AsyncClient,
    ids: list[str],
) -> list[dict]:
    if not ids:
        return []
    params = {"db": "pmc", "id": ",".join(ids), "retmode": "json"}
    if PUBMED_API_KEY:
        params["api_key"] = PUBMED_API_KEY
    resp = await client.get(f"{PUBMED_BASE}/esummary.fcgi", params=params)
    resp.raise_for_status()
    result = resp.json().get("result", {})
    articles = []
    for uid in ids:
        item = result.get(uid, {})
        if not item or item.get("uid") is None:
            continue
        articles.append({
            "pmcid": f"PMC{uid}",
            "title": item.get("title", ""),
            "authors": [a.get("name", "") for a in item.get("authors", [])[:3]],
            "journal": item.get("fulljournalname", ""),
            "pub_date": item.get("pubdate", ""),
            "url": f"https://www.ncbi.nlm.nih.gov/pmc/articles/PMC{uid}/",
            "source": "PubMed Central",
            "license": "Open Access",
        })
    return articles


async def fetch_usda_ingredient(ingredient_name: str) -> dict | None:
    """Look up ingredient in USDA FoodData Central."""
    params = {
        "query": ingredient_name,
        "api_key": USDA_API_KEY,
        "pageSize": 3,
        "dataType": ["Foundation", "SR Legacy"],
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{USDA_BASE}/foods/search", params=params)
        resp.raise_for_status()
    foods = resp.json().get("foods", [])
    if not foods:
        return None
    food = foods[0]
    nutrients = {
        n["nutrientName"]: round(n.get("value", 0), 2)
        for n in food.get("foodNutrients", [])
        if n.get("value") is not None
    }
    return {
        "fdc_id": food.get("fdcId"),
        "description": food.get("description"),
        "category": food.get("foodCategory"),
        "nutrients_per_100g": nutrients,
        "source": "USDA FoodData Central",
        "license": "Public domain",
    }


async def run_daily_scan(days_back: int = 90, max_per_query: int = 5) -> dict:
    """Morning research scan: all refrigeration queries → PubMed OA."""
    queries = load_queries()
    results: dict = {
        "timestamp": datetime.now().isoformat(),
        "articles": [],
        "errors": [],
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        for query in queries:
            try:
                ids = await search_pubmed_ids(client, query, max_per_query, days_back)
                articles = await fetch_pubmed_summaries(client, ids)
                for a in articles:
                    a["query"] = query
                results["articles"].extend(articles)
                await asyncio.sleep(0.4)  # respect NCBI rate limit
            except Exception as e:
                results["errors"].append({"query": query, "error": str(e)})

    # Deduplicate by pmcid
    seen: set[str] = set()
    unique = []
    for a in results["articles"]:
        if a["pmcid"] not in seen:
            seen.add(a["pmcid"])
            unique.append(a)
    results["articles"] = unique
    results["total"] = len(unique)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUTPUT_DIR / f"research_{datetime.now().strftime('%Y%m%d')}.json"
    out.write_text(json.dumps(results, indent=2))
    print(f"Research scan: {len(unique)} articles, {len(results['errors'])} errors → {out.name}")
    return results


if __name__ == "__main__":
    asyncio.run(run_daily_scan())
