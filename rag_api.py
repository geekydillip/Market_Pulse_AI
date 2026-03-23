# rag_api.py
# FastAPI-based persistent RAG server.
# Loads the embedding model + FAISS index ONCE into RAM,
# then handles batch queries via POST /retrieve.
#
# Start with:  python rag_api.py
# Or via run_server.py which launches this automatically.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import faiss
import json
import numpy as np
import os
from pathlib import Path
from sentence_transformers import SentenceTransformer

app = FastAPI(title="MarketPulse RAG API", version="1.0.0")

# Allow browser requests from the Node.js frontend (port 3001)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Configuration ────────────────────────────────────────────────────────────
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
INDEX_FILE = os.path.join(BASE_DIR, "RAG", "vector_db", "index.faiss")
META_FILE  = os.path.join(BASE_DIR, "RAG", "vector_db", "metadata.json")

TOP_K               = 3
SIMILARITY_THRESHOLD = 0.60

# ─── Startup: load everything ONCE ────────────────────────────────────────────
print("[RAG API] Loading embedding model (all-MiniLM-L6-v2) ...")
_model = SentenceTransformer("all-MiniLM-L6-v2")

print("[RAG API] Loading FAISS index ...")
_index = faiss.read_index(INDEX_FILE)

print("[RAG API] Loading metadata ...")
with open(META_FILE, "r", encoding="utf-8") as f:
    _metadata = json.load(f)

print(f"[RAG API] Ready — {len(_metadata):,} records loaded into RAM.")

# ─── Request schema ───────────────────────────────────────────────────────────
class QueryBatch(BaseModel):
    queries: list[str]

# ─── Endpoint ─────────────────────────────────────────────────────────────────
@app.post("/retrieve")
def retrieve_batch(req: QueryBatch):
    """
    Accept a list of query strings and return a list of match-lists.
    Response shape:
        { "results": [ [matches_for_row_0], [matches_for_row_1], ... ] }
    """
    if not req.queries:
        return {"results": []}

    # 1. Encode ALL queries in one vectorised call
    embeddings = _model.encode(req.queries, normalize_embeddings=True)
    embeddings = np.array(embeddings, dtype="float32")

    # 2. Search FAISS for all queries simultaneously
    D, I = _index.search(embeddings, TOP_K)

    batch_results = []

    # 3. Map raw indices back to metadata for each query
    for q_idx in range(len(req.queries)):
        matches = []
        for pos, idx in enumerate(I[q_idx]):
            score = float(D[q_idx][pos])

            # Filter by similarity threshold
            if score < SIMILARITY_THRESHOLD:
                continue
            if idx < 0 or idx >= len(_metadata):
                continue

            meta = _metadata[idx]
            matches.append({
                "Title":          meta.get("Title", ""),
                "Module":         meta.get("Module", ""),
                "Sub Module":     meta.get("Sub Module", ""),
                "Issue Type":     meta.get("Issue Type", ""),
                "Sub Issue Type": meta.get("Sub Issue Type", ""),
                "Severity":       meta.get("Severity", ""),
                # Use "similarity_score" key so existing server.js threshold
                # logic (bestMatch.similarity_score) continues to work unchanged.
                "similarity_score": score,
            })

        batch_results.append(matches)

    return {"results": batch_results}


@app.get("/health")
def health():
    return {"status": "ok", "records": len(_metadata)}

@app.post("/reload")
def reload_index():
    global _index, _metadata
    try:
        _index = faiss.read_index(INDEX_FILE)
        with open(META_FILE, "r", encoding="utf-8") as f:
            _metadata = json.load(f)
        return {"status": "ok", "message": "Index and metadata reloaded successfully", "records": len(_metadata)}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ─── /ai-insight endpoint ─────────────────────────────────────────────────────
# Reuses the already-loaded _model (all-MiniLM-L6-v2) to compute BERT cosine
# similarity across global_voc_plm/analytics.json — fully offline, no CDN.

AI_INSIGHT_THRESHOLD = 0.70   # cosine similarity threshold for BERT

@app.get("/ai-insight")
def ai_insight():
    """
    Runs BERT semantic similarity on global_voc_plm/analytics.json using the
    already-loaded all-MiniLM-L6-v2 model.

    For each unique (Model No. + Module) group:
      - Picks the most-reported issue title as the representative VOC
      - Computes cosine similarity between that VOC and every other title
      - Counts how many exceed AI_INSIGHT_THRESHOLD => Similar VOC (Count)

    Returns a JSON list sorted by count descending.
    """
    analytics_path = Path(BASE_DIR) / "downloads" / "global_voc_plm" / "analytics.json"

    # 1. Load analytics data
    try:
        with open(analytics_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {"error": f"analytics.json not found at {analytics_path}"}
    except Exception as e:
        return {"error": str(e)}

    rows = [
        r for r in data.get("rows", [])
        if r.get("Title") and r.get("Model No.") and r.get("Module")
    ]

    if not rows:
        return {"error": "No valid rows found in analytics.json"}

    titles = [r["Title"] for r in rows]

    # 2. Encode all titles using the in-RAM BERT model
    embeddings = _model.encode(titles, normalize_embeddings=True, show_progress_bar=False)
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
    n = len(titles)

    for g in groups.values():
        # Representative VOC = most frequent title in the group
        rep_title = max(g["title_freq"], key=g["title_freq"].get)
        rep_idx   = g["title_idx"][rep_title]
        rep_vec   = embeddings[rep_idx]                        # shape (384,)

        # Cosine similarity against all titles (embeddings already normalised)
        # dot product of normalised vectors == cosine similarity
        scores = embeddings @ rep_vec                          # shape (n,)

        # Count similar (exclude self)
        similar_count = int(
            np.sum(scores >= AI_INSIGHT_THRESHOLD) - 1        # -1 for self
        )
        if similar_count < 0:
            similar_count = 0

        voc_display = rep_title.capitalize()

        results.append({
            "model":  g["model"],
            "module": g["module"],
            "voc":    voc_display,
            "count":  similar_count,
        })

    results.sort(key=lambda x: x["count"], reverse=True)

    return {
        "total_issues": len(rows),
        "total_groups": len(results),
        "threshold":    AI_INSIGHT_THRESHOLD,
        "model_name":   "all-MiniLM-L6-v2",
        "results":      results,
    }


# ─── Direct execution ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
