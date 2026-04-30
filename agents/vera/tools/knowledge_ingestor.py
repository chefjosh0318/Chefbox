#!/usr/bin/env python3
"""
Vera — Knowledge Ingestor
Chunks documents, embeds via Voyage AI, stores in pgvector.
Namespaces: food_science, refrigerated_storage, reheat_engineering,
            aviation_catering, chefbox_constraints.

Embedding: voyageai (voyage-3-lite) — Anthropic's recommended partner for RAG.
Fallback: hash-based stub if VOYAGE_API_KEY not set (dev only).
"""
import hashlib
import json
import os
import struct
from datetime import datetime
from pathlib import Path

import psycopg2
from psycopg2.extras import Json

DB_URL = os.getenv("VERA_DB_URL", "postgresql://localhost/vera_knowledge")
VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY", "")
EMBEDDING_DIM = 1024  # voyage-3-lite output dimension

VALID_NAMESPACES = {
    "food_science",
    "refrigerated_storage",
    "reheat_engineering",
    "aviation_catering",
    "chefbox_constraints",
}

CHUNK_WORDS = 300
CHUNK_OVERLAP = 50


# ── Embedding ─────────────────────────────────────────────────────

def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Embed texts via Voyage AI. Stub fallback if key absent (dev only)."""
    if not VOYAGE_API_KEY:
        return [_stub_embedding(t) for t in texts]
    import voyageai  # pip install voyageai
    client = voyageai.Client(api_key=VOYAGE_API_KEY)
    result = client.embed(texts, model="voyage-3-lite", input_type="document")
    return result.embeddings


def _stub_embedding(text: str) -> list[float]:
    """Hash-based stub. Replace with real embeddings in production."""
    h = hashlib.sha256(text.encode()).digest()
    floats = [struct.unpack("f", h[i:i+4])[0] for i in range(0, 32, 4)]
    # Pad / truncate to EMBEDDING_DIM
    floats = floats * (EMBEDDING_DIM // len(floats) + 1)
    return floats[:EMBEDDING_DIM]


# ── Chunking ──────────────────────────────────────────────────────

def chunk_text(text: str) -> list[str]:
    words = text.split()
    chunks: list[str] = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + CHUNK_WORDS])
        if len(chunk.split()) >= 20:  # discard micro-chunks
            chunks.append(chunk)
        i += CHUNK_WORDS - CHUNK_OVERLAP
    return chunks


# ── Database ──────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(DB_URL)


def ensure_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS vera_knowledge (
                id           SERIAL PRIMARY KEY,
                namespace    TEXT NOT NULL,
                source_url   TEXT,
                source_name  TEXT,
                content_hash TEXT UNIQUE NOT NULL,
                chunk_index  INTEGER,
                content      TEXT NOT NULL,
                embedding    vector({EMBEDDING_DIM}),
                metadata     JSONB,
                ingested_at  TIMESTAMP DEFAULT NOW()
            );
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_vera_ns ON vera_knowledge(namespace);"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_vera_emb ON vera_knowledge "
            "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);"
        )
    conn.commit()


# ── Ingest ────────────────────────────────────────────────────────

def ingest_document(
    namespace: str,
    content: str,
    source_url: str,
    source_name: str,
    metadata: dict | None = None,
) -> int:
    """Chunk, embed, and upsert a document. Returns number of chunks stored."""
    if namespace not in VALID_NAMESPACES:
        raise ValueError(f"Unknown namespace '{namespace}'. Valid: {VALID_NAMESPACES}")

    chunks = chunk_text(content)
    if not chunks:
        return 0

    embeddings = get_embeddings(chunks)
    conn = get_conn()
    ensure_schema(conn)
    stored = 0

    with conn.cursor() as cur:
        for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            content_hash = hashlib.sha256(
                f"{source_url}:{idx}:{chunk}".encode()
            ).hexdigest()
            try:
                cur.execute(
                    """
                    INSERT INTO vera_knowledge
                        (namespace, source_url, source_name, content_hash,
                         chunk_index, content, embedding, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::vector, %s)
                    ON CONFLICT (content_hash) DO NOTHING
                    """,
                    (
                        namespace,
                        source_url,
                        source_name,
                        content_hash,
                        idx,
                        chunk,
                        embedding,
                        Json(metadata or {}),
                    ),
                )
                stored += cur.rowcount
            except Exception as e:
                print(f"Chunk {idx} insert error: {e}")

    conn.commit()
    conn.close()
    print(f"Ingested {stored}/{len(chunks)} chunks → {namespace} ({source_name})")
    return stored


def search_knowledge(
    query: str,
    namespace: str | None = None,
    limit: int = 5,
) -> list[dict]:
    """Vector similarity search across knowledge base."""
    (query_embedding,) = get_embeddings([query])
    conn = get_conn()
    with conn.cursor() as cur:
        if namespace:
            cur.execute(
                """
                SELECT namespace, source_name, content, metadata,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM vera_knowledge
                WHERE namespace = %s
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (query_embedding, namespace, query_embedding, limit),
            )
        else:
            cur.execute(
                """
                SELECT namespace, source_name, content, metadata,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM vera_knowledge
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (query_embedding, query_embedding, limit),
            )
        rows = cur.fetchall()
    conn.close()
    return [
        {
            "namespace": r[0],
            "source": r[1],
            "content": r[2],
            "metadata": r[3],
            "similarity": round(float(r[4]), 4),
        }
        for r in rows
    ]


def ingest_from_json(json_path: Path, namespace: str) -> int:
    """Batch ingest from a research scan or scrape output JSON."""
    data = json.loads(json_path.read_text())
    total = 0

    # research_fetcher output format
    for article in data.get("articles", []):
        content = f"{article.get('title', '')}\n{article.get('journal', '')}\n{article.get('query', '')}"
        total += ingest_document(
            namespace=namespace,
            content=content,
            source_url=article.get("url", ""),
            source_name=article.get("journal", "PubMed"),
            metadata={
                "pmcid": article.get("pmcid"),
                "pub_date": article.get("pub_date"),
                "license": "Open Access",
            },
        )

    # aviation_scraper output format
    for site in data.get("sites", []):
        for page in site.get("pages", []):
            items = page.get("content_items", [])
            if not items:
                continue
            content = "\n".join(items)
            total += ingest_document(
                namespace=namespace,
                content=content,
                source_url=page.get("url", site.get("url", "")),
                source_name=site.get("name", ""),
                metadata={"category": site.get("category"), "fetched_at": page.get("fetched_at")},
            )

    return total


if __name__ == "__main__":
    test = "Refrigerated RTE meals at 34-38°F maintain protein integrity for 5-7 days. Starch retrogradation begins within 24h at 4°C. Sous vide cook-chill extends shelf life to 7 days when sealed under vacuum."
    ingest_document("refrigerated_storage", test, "internal/test", "Vera R&D", {"test": True})
