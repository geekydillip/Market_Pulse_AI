# rag_api.py
# FastAPI-based persistent RAG server.
# Loads the embedding model + FAISS index ONCE into RAM,
# then handles batch queries via POST /retrieve.
#
# Start with:  python rag_api.py
# Or via run_server.py which launches this automatically.

from fastapi import FastAPI
from pydantic import BaseModel
import faiss
import json
import numpy as np
import os
from sentence_transformers import SentenceTransformer

app = FastAPI(title="MarketPulse RAG API", version="1.0.0")

# ─── Configuration ────────────────────────────────────────────────────────────
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
INDEX_FILE = os.path.join(BASE_DIR, "RAG_implementation-main", "vector_db", "index.faiss")
META_FILE  = os.path.join(BASE_DIR, "RAG_implementation-main", "vector_db", "metadata.json")

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


# ─── Direct execution ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
