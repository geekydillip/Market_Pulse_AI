import sys
import json
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
import os

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VECTOR_DB = os.path.join(BASE_DIR, "vector_db")
INDEX_PATH = os.path.join(VECTOR_DB, "index.faiss")
META_PATH = os.path.join(VECTOR_DB, "metadata.json")

TOP_K = 1

def load_resources():
    index = faiss.read_index(INDEX_PATH)
    with open(META_PATH, "r", encoding="utf-8") as f:
        metadata = json.load(f)
    model = SentenceTransformer("all-MiniLM-L6-v2")
    return index, metadata, model

def retrieve(query):
    index, metadata, model = load_resources()

    embedding = model.encode([query], normalize_embeddings=True)
    D, I = index.search(np.array(embedding), TOP_K)

    results = []
    for idx in I[0]:
        if idx < len(metadata):
            results.append(metadata[idx])

    return results

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps([]))
        sys.exit(0)

    query_text = sys.argv[1]
    matches = retrieve(query_text)

    print(json.dumps(matches, ensure_ascii=False))