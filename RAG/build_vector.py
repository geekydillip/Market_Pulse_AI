import os
import re
import json
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer

# ==============================
# CONFIG
# ==============================
KNOWLEDGE_BASE_FOLDER = "RAG/knowledge_base"
VECTOR_DB_FOLDER      = "RAG/vector_db"

# BGE-M3: multilingual (100+ languages incl. Korean, Hindi, Hinglish),
# 1024-dim embeddings, significantly better retrieval than all-MiniLM-L6-v2.
# Supports dense retrieval out of the box with sentence-transformers.
EMBED_MODEL_NAME = "BAAI/bge-m3"

os.makedirs(VECTOR_DB_FOLDER, exist_ok=True)

INDEX_FILE    = os.path.join(VECTOR_DB_FOLDER, "index.faiss")
METADATA_FILE = os.path.join(VECTOR_DB_FOLDER, "metadata.json")

# ==============================
# MODULE NAME NORMALISATION
# Inconsistent casing splits identical modules into separate vector clusters,
# reducing retrieval accuracy. Define canonical names here.
# ==============================
MODULE_NORMALISE = {
    "lock screen":        "Lock Screen",
    "Lock screen":        "Lock Screen",
    "Notification Panel": "Notification",
    "Sound":              "Audio",
    "Quick  Panel":       "Quick Panel",   # double-space variant
    "3rd party app":      "3rd Party App",
    "Heat":               "Heating",
    "Touch":              "Display",
}

def normalise_module(raw):
    m = str(raw or "").strip()
    return MODULE_NORMALISE.get(m, m)

# ==============================
# TEXT CLEANING
# DO NOT lowercase — rag_server applies identical cleaning without lowercasing,
# keeping query and document embeddings in the same space.
# BGE-M3 handles multilingual text natively — no special handling needed.
# ==============================
def clean_text(text):
    text = str(text)
    text = re.sub(r"\[.*?\]", " ", text)                            # remove [CS], [EWP] tags
    text = re.sub(r"membersid\s*:\s*\w+", " ", text, flags=re.I)   # remove member IDs
    text = re.sub(r"samsung members notice.*", " ", text, flags=re.I)
    text = re.sub(r"s\d{3}[a-z]*", " ", text, flags=re.I)          # remove S-series codes
    text = text.replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()   # NO .lower() — must match query encoding in rag_server.py

# ==============================
# LOAD ALL JSON FILES
# ==============================
def load_all_json(folder):
    all_records = []
    files = [os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".json")]
    print(f"Found {len(files)} JSON files")
    for file in files:
        print(f"Loading {file}")
        with open(file, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                all_records.extend(data)
            elif isinstance(data, dict):
                if "data" in data and isinstance(data["data"], list):
                    all_records.extend(data["data"])
                elif "rows" in data and isinstance(data["rows"], list):
                    all_records.extend(data["rows"])
    print("Total records:", len(all_records))
    return all_records


data = load_all_json(KNOWLEDGE_BASE_FOLDER)

documents         = []
metadata          = []
seen_texts        = set()
duplicates_skipped = 0

# ==============================
# BUILD DOCUMENTS
# ==============================
for item in data:

    title   = item.get("Title")   or item.get("title")       or ""
    problem = item.get("Problem") or ""
    content = (
        item.get("content") or item.get("Content")
        or item.get("description") or item.get("Description") or ""
    )

    module        = normalise_module(item.get("Module") or "")
    submodule     = str(item.get("Sub Module") or item.get("Sub-Module") or "").strip()
    issue_type    = str(item.get("Issue Type")  or "").strip()
    issue_subtype = str(item.get("Sub Issue Type") or item.get("Sub-Issue Type") or "").strip()
    severity      = str(item.get("Severity") or "").strip()

    title   = clean_text(title)
    problem = clean_text(problem)
    content = clean_text(content)

    # ── Detect data shape and build embedding text accordingly ──────────────
    #
    # Shape A: Title + Problem  (betaUT, EmployeeUT, globalvocplm)
    #   → embed "title. problem" (or just title if problem duplicates it)
    #
    # Shape B: content only  (BetaUTVoc, samsungMembersVoc)
    #   → embed content directly
    #
    # Shape C: Title only, no Problem and no content
    #   → embed title alone
    #
    # The key rule: embedding text must be plain natural language —
    # same format as the queries that will arrive from Node.js.
    # ────────────────────────────────────────────────────────────────────────

    has_title   = bool(title.strip())
    has_problem = bool(problem.strip())
    has_content = bool(content.strip())

    if has_title and has_problem and problem.lower() != title.lower():
        # Shape A — Title + Problem both present and different
        embedding_text  = f"{title}. {problem}"
        metadata_title  = title
        metadata_problem = problem

    elif has_title and has_problem:
        # Shape A — Title + Problem present but identical (duplicate)
        embedding_text  = title
        metadata_title  = title
        metadata_problem = problem

    elif has_title and has_content:
        # Shape B variant — Title present but content is the real body
        embedding_text  = f"{title}. {content}"
        metadata_title  = title
        metadata_problem = content

    elif has_content:
        # Shape B — content only (BetaUTVoc, samsungMembersVoc)
        embedding_text  = content
        metadata_title  = content[:120]   # use first 120 chars as title for display
        metadata_problem = content

    elif has_title:
        # Shape C — Title only
        embedding_text  = title
        metadata_title  = title
        metadata_problem = ""

    else:
        # Nothing meaningful — skip
        continue

    embedding_text = embedding_text.strip()
    if not embedding_text:
        continue

    if embedding_text in seen_texts:
        duplicates_skipped += 1
        continue
    seen_texts.add(embedding_text)

    documents.append(embedding_text)

    # Store all available text in metadata so LLM gets the richest possible context
    metadata.append({
        "Title":          metadata_title,
        "Problem":        metadata_problem,
        "Module":         module,
        "Sub Module":     submodule,
        "Issue Type":     issue_type,
        "Sub Issue Type": issue_subtype,
        "Severity":       severity,
    })

print("Total documents:", len(documents))

if len(documents) == 0:
    print("No documents found. Skipping index creation.")
    summary = {"added": 0, "duplicates": duplicates_skipped, "total": duplicates_skipped}
    print(f"___SUMMARY___{json.dumps(summary)}")
    exit(0)

# ==============================
# LOAD MODEL
# BGE-M3 outputs 1024-dim embeddings (vs 384 for MiniLM).
# The FAISS index dimension must match — this is handled automatically below.
# ==============================
print("Loading embedding model...")
model = SentenceTransformer(EMBED_MODEL_NAME)

# ==============================
# GENERATE EMBEDDINGS
# batch_size=32 is safe for BGE-M3 on most machines (uses more RAM than MiniLM).
# Reduce to 16 if you get OOM errors.
# ==============================
print(f"Encoding {len(documents)} documents with {EMBED_MODEL_NAME}...")
embeddings = model.encode(
    documents,
    normalize_embeddings=True,   # required for cosine similarity via IndexFlatIP
    show_progress_bar=True,
    batch_size=32,
)

embeddings = np.array(embeddings).astype("float32")
print(f"Embedding shape: {embeddings.shape}")  # should be (N, 1024) for BGE-M3

# ==============================
# SEMANTIC DEDUPLICATION
# ==============================
# Purpose: collapse contextually identical records (e.g. "screen turns black",
# "no display", "display turns black") into a single representative record
# with a frequency count. This:
#   1. Keeps the index compact — no benefit from 12 copies of "screen turns black"
#   2. Adds a meaningful frequency signal to metadata
#   3. Preserves variety — similar-but-distinct issues are kept separate
#
# Algorithm:
#   - For each record, search for others with cosine similarity > DEDUP_THRESHOLD
#   - Group them into clusters (greedy: first unseen record becomes cluster head)
#   - Keep the record with the longest/most descriptive title as representative
#   - Store frequency = cluster size in that record's metadata
#
# DEDUP_THRESHOLD = 0.92 — high enough to catch "fingerprint not working" vs
# "fingerprint sensor not working", but low enough to keep "no network" and
# "sim card not recognized" as separate records (they describe different failure modes).
# ==============================

DEDUP_THRESHOLD = 0.92

print(f"Running semantic dedup (threshold={DEDUP_THRESHOLD})...")

n = len(embeddings)
assigned = [False] * n
clusters = []   # list of lists of indices

# Use FAISS to find near-duplicates efficiently — search each record against all others
# TOP_K_DEDUP: how many neighbours to check per record
TOP_K_DEDUP = min(20, n)
temp_index = faiss.IndexFlatIP(embeddings.shape[1])
temp_index.add(embeddings)
D_dedup, I_dedup = temp_index.search(embeddings, TOP_K_DEDUP)

for i in range(n):
    if assigned[i]:
        continue
    # Start a new cluster with record i as head
    cluster = [i]
    assigned[i] = True
    # Find all unassigned records with similarity >= threshold
    for pos in range(1, TOP_K_DEDUP):
        j = int(I_dedup[i][pos])
        score = float(D_dedup[i][pos])
        if score < DEDUP_THRESHOLD:
            break   # scores are sorted descending — no point continuing
        if not assigned[j]:
            cluster.append(j)
            assigned[j] = True
    clusters.append(cluster)

# Build deduplicated documents and metadata
deduped_documents = []
deduped_metadata  = []
deduped_embeddings_list = []

exact_dupe_count    = 0
semantic_dupe_count = 0

for cluster in clusters:
    freq = len(cluster)

    if freq == 1:
        # No duplicates — keep as-is
        idx = cluster[0]
        meta = dict(metadata[idx])
        meta["frequency"] = 1
        deduped_documents.append(documents[idx])
        deduped_metadata.append(meta)
        deduped_embeddings_list.append(embeddings[idx])
    else:
        semantic_dupe_count += freq - 1
        # Pick the record with the longest title as the representative
        # (longer title = more descriptive = better for LLM context)
        best_idx = max(cluster, key=lambda i: len(documents[i]))
        meta = dict(metadata[best_idx])
        meta["frequency"] = freq
        # Optionally store all variant titles for debugging
        # meta["_variants"] = [documents[i] for i in cluster if i != best_idx]
        deduped_documents.append(documents[best_idx])
        deduped_metadata.append(meta)
        deduped_embeddings_list.append(embeddings[best_idx])

deduped_embeddings = np.array(deduped_embeddings_list).astype("float32")

print(f"Deduplication complete:")
print(f"  Before : {n} records")
print(f"  After  : {len(deduped_documents)} records")
print(f"  Removed: {semantic_dupe_count} semantic duplicates")
print(f"  Clusters with frequency > 1: {sum(1 for m in deduped_metadata if m['frequency'] > 1)}")

# Show top clusters for verification
top_clusters = sorted(
    [(m['frequency'], m['Title']) for m in deduped_metadata if m['frequency'] > 1],
    reverse=True
)[:10]
print("  Top merged clusters:")
for freq, title in top_clusters:
    print(f"    frequency={freq}: \"{title}\"")

# Replace originals with deduplicated versions
documents  = deduped_documents
metadata   = deduped_metadata
embeddings = deduped_embeddings

# ==============================
# CREATE FAISS INDEX
# IndexFlatIP = exact inner product search.
# With normalised vectors this equals cosine similarity — no approximation.
# ==============================
dimension = embeddings.shape[1]
index = faiss.IndexFlatIP(dimension)
index.add(embeddings)

# ==============================
# SAVE
# ==============================
faiss.write_index(index, INDEX_FILE)

with open(METADATA_FILE, "w", encoding="utf-8") as f:
    json.dump(metadata, f, indent=2, ensure_ascii=False)

print("Vector DB created successfully")
print(f"  Model    : {EMBED_MODEL_NAME}")
print(f"  Dimension: {dimension}")
print(f"  Vectors  : {index.ntotal}")

summary = {
    "added":            len(documents),
    "duplicates":       duplicates_skipped,
    "semantic_merged":  semantic_dupe_count,
    "total":            len(documents) + duplicates_skipped + semantic_dupe_count,
}
print(f"___SUMMARY___{json.dumps(summary)}")