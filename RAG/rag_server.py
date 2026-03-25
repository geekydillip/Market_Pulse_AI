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

print("Loading RAG model: BAAI/bge-m3 ...")
embed_model_rag = SentenceTransformer("BAAI/bge-m3")

print("Loading AI Insight model: all-MiniLM-L6-v2 ...")
embed_model_insight = SentenceTransformer("all-MiniLM-L6-v2")

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

    embeddings = embed_model_rag.encode(
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


# ─── /ai-insight endpoint ─────────────────────────────────────────────────────

import os
from pathlib import Path

AI_INSIGHT_THRESHOLD = 0.78   # cosine similarity threshold for MiniLM

_ai_insight_cache = None
_ai_insight_mtime = 0

@app.get("/ai-insight")
async def ai_insight():
    global _ai_insight_cache, _ai_insight_mtime
    """
    Runs BERT semantic similarity on analytics.json using the
    already-loaded BAAI/bge-m3 model.

    For each unique (Model No. + Module) group:
      - Picks the most-reported issue title as the representative VOC
      - Computes cosine similarity between that VOC and every other title
      - Counts how many exceed AI_INSIGHT_THRESHOLD => Similar VOC (Count)

    Returns a JSON list sorted by count descending.
    """
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    analytics_path = Path(BASE_DIR) / "downloads" / "samsung_members_voc" / "analytics.json"

    # 1. Load analytics data
    try:
        mtime = os.path.getmtime(analytics_path)
        if _ai_insight_cache is not None and mtime == _ai_insight_mtime:
            return JSONResponse(content=_ai_insight_cache)
            
        with open(analytics_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"error": f"analytics.json not found at {analytics_path}"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

    rows = []
    for r in data.get("rows", []):
        title = r.get("Title") or r.get("content") or r.get("Content") or ""
        model = r.get("Model No.") or r.get("model") or ""
        module = r.get("Module") or r.get("module") or ""
        
        if title and model and module:
            mapped_row = r.copy()
            mapped_row["Title"] = title
            mapped_row["Model No."] = model
            mapped_row["Module"] = module
            rows.append(mapped_row)

    if not rows:
        return JSONResponse(status_code=400, content={"error": "No valid rows found in analytics.json"})

    titles = [r["Title"] for r in rows]

    # 2. Encode all titles using the in-RAM MiniLM model
    # Offload encoding to a thread so we don't block the async loop
    embeddings = await asyncio.to_thread(
        embed_model_insight.encode,
        titles,
        normalize_embeddings=True,
        show_progress_bar=False,
        batch_size=32
    )
    embeddings = np.array(embeddings, dtype="float32")

    # 3. Group by Model No. + Module
    groups: dict[str, dict] = {}
    for idx, row in enumerate(rows):
        key = f"{row['Model No.']}|||{row['Module']}"
        if key not in groups:
            groups[key] = {
                "model":      row["Model No."],
                "module":     row["Module"],
                "title_freq": {},
                "title_idx":  {},
            }
        t = row["Title"].strip().lower()
        groups[key]["title_freq"][t] = groups[key]["title_freq"].get(t, 0) + 1
        groups[key]["title_idx"].setdefault(t, idx)

    # 4. For each group pick rep VOC and count similarities
    results = []

    for g in groups.values():
        # Representative VOC = most frequent title in the group
        rep_title = max(g["title_freq"], key=g["title_freq"].get)
        rep_idx   = g["title_idx"][rep_title]
        rep_vec   = embeddings[rep_idx]                        # shape (1024,)

        # Cosine similarity against all titles (embeddings already normalised)
        scores = embeddings @ rep_vec                          # shape (n,)

        # Find similar titles (excluding self)
        similar_indices = np.where(scores >= AI_INSIGHT_THRESHOLD)[0]
        similar_items = []
        for i in similar_indices:
            if i != rep_idx:
                m = rows[i]["Model No."].strip()
                mod = rows[i]["Module"].strip()
                # Restrict matches to ONLY the exact same Model and Module
                if m == g["model"] and mod == g["module"]:
                    similar_items.append((m, rows[i]["Title"].strip()))

        similar_count = len(similar_items)

        # Deduplicate and count occurrences of each (model, title) pair
        item_counts = {}
        for m, t in similar_items:
            key = f"{m.lower()}|||{t.lower()}"
            if key not in item_counts:
                item_counts[key] = {"model": m, "display": t, "count": 1}
            else:
                item_counts[key]["count"] += 1

        # Format as list of objects for the table modal
        unique_similar_titles = []
        for t_info in sorted(item_counts.values(), key=lambda x: x["count"], reverse=True):
            unique_similar_titles.append({
                "model": t_info['model'],
                "voc": t_info['display'],
                "count": t_info['count']
            })

        voc_display = rep_title.capitalize()

        results.append({
            "model":  g["model"],
            "module": g["module"],
            "voc":    voc_display,
            "count":  similar_count,
            "similar_titles": unique_similar_titles
        })

    results.sort(key=lambda x: x["count"], reverse=True)

    return {
        "total_issues": len(rows),
        "total_groups": len(results),
        "threshold":    AI_INSIGHT_THRESHOLD,
        "model_name":   "BAAI/bge-m3",
        "results":      results,
    }


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=5000,
        log_level="warning",   # change to "info" to see per-request logs
    )