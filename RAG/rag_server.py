"""
rag_server.py
FastAPI async RAG server using BAAI/bge-m3 for multilingual retrieval.

BGE-M3 advantages over all-MiniLM-L6-v2:
  - Supports 100+ languages including Korean, Hindi, Hinglish
  - 1024-dim embeddings (vs 384) — richer semantic representation
  - Significantly better retrieval accuracy on mixed-language Samsung VOC data
  - Same sentence-transformers API — drop-in replacement

Endpoints:
  POST /search   { "queries": ["text1", "text2", ...] }
                 returns a bare JSON array-of-arrays

  POST /reload   hot-reloads the FAISS index and metadata from disk

  GET  /health   returns status and record count

Start:
  pip install fastapi uvicorn sentence-transformers faiss-cpu
  python rag_server.py
"""

import asyncio
import json
import re
import numpy as np
import faiss
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import uvicorn

# ── Config ────────────────────────────────────────────────────────────────────

INDEX_FILE    = "RAG/vector_db/index.faiss"
METADATA_FILE = "RAG/vector_db/metadata.json"

# TOP_K=3: retrieve 3 candidates per query.
# More candidates = lower miss rate on borderline matches with minimal overhead.
TOP_K = 3

# Threshold raised from 0.35 → 0.38 because BGE-M3 produces higher similarity
# scores than MiniLM, so genuinely irrelevant matches score lower.
# Raise further (0.40–0.45) after observing your score distribution in logs.
SIMILARITY_THRESHOLD = 0.38

# ── Load model and index once at startup ──────────────────────────────────────

print("Loading embedding model: BAAI/bge-m3 ...")
embed_model = SentenceTransformer("BAAI/bge-m3")

print("Loading FAISS index...")
faiss_index = faiss.read_index(INDEX_FILE)

with open(METADATA_FILE, "r", encoding="utf-8") as f:
    metadata = json.load(f)
    print(f"Metadata size: {len(metadata)}")

print("RAG server ready")

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI()


class SearchRequest(BaseModel):
    queries: list[str]


def _normalise_query(text: str) -> str:
    """
    Apply the same text cleaning used in build_vector.py so that query
    embeddings and document embeddings live in the same semantic space.
    Must stay in sync with build_vector.clean_text() — any change there
    must be mirrored here.
    Note: NO .lower() — build_vector also does not lowercase documents.
    """
    text = re.sub(r"\[.*?\]", " ", text)
    text = re.sub(r"membersid\s*:\s*\w+", " ", text, flags=re.I)
    text = re.sub(r"samsung members notice.*", " ", text, flags=re.I)
    text = re.sub(r"s\d{3}[a-z]*", " ", text, flags=re.I)
    text = text.replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _run_search(queries: list[str]) -> list[list[dict]]:
    """
    Blocking function: normalise queries, encode with BGE-M3, search FAISS.
    Called via asyncio.to_thread() so it doesn't block the event loop.
    """
    if not queries:
        return []

    # Normalise queries to match document encoding in build_vector.py
    normalised = [_normalise_query(q) for q in queries]

    embeddings = embed_model.encode(
        normalised,
        normalize_embeddings=True,   # cosine similarity via IndexFlatIP
        convert_to_numpy=True,
        batch_size=32,
    ).astype("float32")

    D, I = faiss_index.search(embeddings, TOP_K)

    all_results = []

    for q_idx in range(len(queries)):
        results = []

        for pos, idx in enumerate(I[q_idx]):
            score = float(D[q_idx][pos])

            if score < SIMILARITY_THRESHOLD:
                continue

            if idx >= len(metadata):
                continue

            meta = metadata[idx]
            problem_text = meta.get("Problem", "")
            results.append({
                "Title":            meta.get("Title", ""),
                "Problem":          problem_text,
                "Content":          problem_text,
                "Module":           meta.get("Module", ""),
                "Sub Module":       meta.get("Sub-Module", ""),
                "Issue Type":       meta.get("Issue Type", ""),
                "Sub Issue Type":   meta.get("Sub-Issue Type", ""),
                "Severity":         meta.get("Severity", ""),
                "frequency":        meta.get("frequency", 1),   # how many similar issues this represents
                "similarity_score": score,
            })

        all_results.append(results)

    return all_results


@app.post("/search")
async def search(req: SearchRequest):
    """
    Accepts { queries: [...] }, returns a bare array-of-arrays.
    Offloads blocking FAISS+BGE-M3 work to a thread.
    """
    results = await asyncio.to_thread(_run_search, req.queries)
    return JSONResponse(content=results)


@app.post("/reload")
async def reload_index():
    """
    Hot-reload the FAISS index and metadata from disk.
    Called by server.js after build_vector.py completes a KB update.
    """
    global faiss_index, metadata

    try:
        new_index = await asyncio.to_thread(faiss.read_index, INDEX_FILE)
        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            new_metadata = json.load(f)

        faiss_index = new_index
        metadata    = new_metadata

        print(f"[reload] Index reloaded — {len(metadata)} entries")
        return {"success": True, "entries": len(metadata)}

    except Exception as e:
        print(f"[reload] Failed: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.get("/health")
async def health():
    return {"status": "ok", "entries": len(metadata)}


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=5000,
        log_level="warning",   # change to "info" to see per-request logs
    )