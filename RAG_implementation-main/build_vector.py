import os
import re
import json
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer

# ==============================
# CONFIG
# ==============================
KNOWLEDGE_BASE_FOLDER = "RAG_implementation-main\\knowledge_base"
VECTOR_DB_FOLDER = "RAG_implementation-main\\vector_db"
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"

BATCH_SIZE = 64
CHUNK_SIZE = 200
CHUNK_OVERLAP = 50

os.makedirs(VECTOR_DB_FOLDER, exist_ok=True)
INDEX_FILE = os.path.join(VECTOR_DB_FOLDER, "index.faiss")
METADATA_FILE = os.path.join(VECTOR_DB_FOLDER, "metadata.json")


# ==============================
# TEXT CLEANING
# ==============================
def clean_title(title: str) -> str:
    cleaned = re.sub(r"(\[[^\]]*\]\s*)+", "", str(title))
    return cleaned.strip()

def clean_problem(problem: str) -> str:
    problem = str(problem).replace("\n", " ")
    problem = re.sub(r"\s+", " ", problem)
    return problem.strip()

def normalize_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def chunk_text(text: str, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    words = text.split()

    if len(words) <= chunk_size:
        return [text]

    chunks = []

    for i in range(0, len(words), chunk_size - overlap):
        chunk_words = words[i:i + chunk_size]
        chunk = " ".join(chunk_words)
        chunks.append(chunk)

        if i + chunk_size >= len(words):
            break

    return chunks

# ==============================
# LOAD ALL JSON FILES (FLAT FOLDER)
# ==============================
def load_all_json_files(folder):
    all_records = []

    json_files = [
        os.path.join(folder, f)
        for f in os.listdir(folder)
        if f.endswith(".json")
    ]

    print(f"📂 Found {len(json_files)} JSON files")

    for file_path in json_files:
        print(f"🔹 Loading: {file_path}")
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

                # if isinstance(data, list):
                #     all_records.extend(data)
                # else:
                #     print(f"⚠ Skipped (not list format): {file_path}")

                if isinstance(data, list):
                    all_records.extend(data)

                elif isinstance(data, dict):

                    if "data" in data and isinstance(data["data"], list):
                        all_records.extend(data["data"])

                    elif "rows" in data and isinstance(data["rows"], list):
                         all_records.extend(data["rows"])

                    else:
                        print(f"⚠ Unknown JSON structure: {file_path}")    

        except Exception as e:
            print(f"❌ Error reading {file_path}: {e}")

    print(f"✅ Total records loaded: {len(all_records)}")
    return all_records

# ==============================
# LOAD DATA
# ==============================
data = load_all_json_files(KNOWLEDGE_BASE_FOLDER)

documents = []
metadata = []

for item in data:

    # title = clean_title(item.get("Title", ""))
    title = (
    item.get("Title")
    or item.get("title")
    or ""
)

    problem = item.get("Problem", "")
    # content = item.get("content", "")
    content = (
    item.get("content")
    or item.get("Content")
    or item.get("description")
    or item.get("Description")
    or ""
)

    # Clean text
    if problem:
        problem = clean_problem(problem)
    if content:
        content = clean_problem(content)

    # module = item.get("Module", "").strip()
    # module = str(item.get("Module") or "").strip()
    # sub_module = item.get("Sub Module", "").strip() 
    # issue_type = item.get("Issue Type", "").strip()
    module = str(item.get("Module") or "").strip()
    # sub_module = str(item.get("Sub Module") or "").strip()
    sub_module = (
    item.get("Sub Module")
    or item.get("Sub-Module")
    or ""
)
    issue_type = str(item.get("Issue Type") or "").strip()

    # If problem empty use content
    text_body = problem if problem else content

    combined_text = (
        f"Title: {title} "
        f"Module: {module} "
        f"Sub Module: {sub_module} "
        f"Issue Type: {issue_type} "
        f"{text_body}"
    )

    combined_text = normalize_text(combined_text)

    if not combined_text.strip():
        continue

    text_chunks = chunk_text(combined_text)

    for chunk in text_chunks:

        documents.append(chunk)

        metadata.append({
            "Title": title,
            "Problem": problem,
            "Content": content,
            "Module": module,
            "Sub Module": sub_module,
            "Issue Type": issue_type
        })

print(f"✅ Total chunks to embed: {len(documents)}")

# ==============================
# LOAD EMBEDDING MODEL
# ==============================
print("🔹 Loading embedding model...")
model = SentenceTransformer(EMBED_MODEL_NAME)

# ==============================
# GENERATE EMBEDDINGS (BATCHED)
# ==============================
embeddings = []

print("🔹 Generating embeddings in batches...")
for i in range(0, len(documents), BATCH_SIZE):
    batch = documents[i:i+BATCH_SIZE]
    batch_emb = model.encode(batch)
    embeddings.extend(batch_emb)

embeddings = np.array(embeddings, dtype="float32")

# ==============================
# NORMALIZE FOR COSINE SIMILARITY
# ==============================
if len(embeddings) == 0:
    print("❌ No embeddings generated. Check input data.")
    exit()

faiss.normalize_L2(embeddings)

# ==============================
# CREATE FAISS INDEX
# ==============================
dimension = embeddings.shape[1]
index = faiss.IndexFlatIP(dimension)
index.add(embeddings)

# ==============================
# SAVE VECTOR DB
# ==============================
faiss.write_index(index, INDEX_FILE)

with open(METADATA_FILE, "w", encoding="utf-8") as f:
    json.dump(metadata, f, indent=2)

print("\n✅ Vector DB created successfully!")
print(f"FAISS index saved at: {INDEX_FILE}")
print(f"Metadata saved at: {METADATA_FILE}")