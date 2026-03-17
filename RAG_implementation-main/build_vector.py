import os
import re
import json
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer

# ==============================
# CONFIG
# ==============================
KNOWLEDGE_BASE_FOLDER = "RAG_implementation-main/knowledge_base"
VECTOR_DB_FOLDER = "RAG_implementation-main/vector_db"
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"

os.makedirs(VECTOR_DB_FOLDER, exist_ok=True)

INDEX_FILE = os.path.join(VECTOR_DB_FOLDER, "index.faiss")
METADATA_FILE = os.path.join(VECTOR_DB_FOLDER, "metadata.json")

# ==============================
# TEXT CLEANING
# ==============================

# def clean_text(text):
#     text = str(text)
#     text = text.replace("\n", " ")
#     text = re.sub(r"\s+", " ", text)
#     return text.strip().lower()

def clean_text(text):

    text = str(text)
    # remove [tags]
    text = re.sub(r"\[.*?\]", " ", text)
    # remove ids
    text = re.sub(r"membersid\s*:\s*\w+", " ", text, flags=re.I)
    # remove samsung notice
    text = re.sub(r"samsung members notice.*", " ", text, flags=re.I)
    text = re.sub(r"s\d{3}[a-z]*", " ", text, flags=re.I)
    # normalize
    text = text.replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    
    return text.strip().lower()

# ==============================
# LOAD ALL JSON FILES
# ==============================

def load_all_json(folder):

    all_records = []

    files = [
        os.path.join(folder, f)
        for f in os.listdir(folder)
        if f.endswith(".json")
    ]

    print(f"📂 Found {len(files)} JSON files")

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

documents = []
metadata = []

# ==============================
# BUILD DOCUMENTS
# ==============================

for item in data:

    title = item.get("Title") or item.get("title") or ""

    problem = item.get("Problem") or ""
    content = (
        item.get("content")
        or item.get("Content")
        or item.get("description")
        or item.get("Description")
        or ""
    )
    module = str(item.get("Module") or "").strip()

    submodule = (
        item.get("Sub Module")
        or item.get("Sub-Module")
        or ""
    )

    issue_type = str(item.get("Issue Type") or "").strip()

    issue_subtype = str(item.get("Sub-Issue Type") or "").strip()

    severity = str(item.get("Severity") or "").strip()

    problem = clean_text(problem)
    content = clean_text(content)
    title = clean_text(title)
    # If title missing → use content
    if not title:
        title = content[:200]

    text_body = problem if problem else content

    if not text_body and not title:
        continue

    # Vector embedding text
    combined_text = f"""
Module: {module}
Title: {title}
Problem: {problem} 
SubModule: {submodule}
IssueType: {issue_type}
""".strip()
    # combined_text = f"{title} {text_body}".strip()

    # modified by vandana 12.03.2026
    # title = clean_text(title)
    # if not title:
    #     title = clean_text(content)[:200]

    # combined_text = f"{module} {title}".strip()

    documents.append(combined_text)

    metadata.append({
    "Title": title,
    "Module": module,
    "Sub Module": submodule,
    "Issue Type": issue_type,
    "Sub Issue Type": issue_subtype,
    "Severity": severity
})

print("Total documents:", len(documents))

# ==============================
# LOAD MODEL
# ==============================

print("Loading embedding model...")

model = SentenceTransformer(EMBED_MODEL_NAME)

# ==============================
# GENERATE EMBEDDINGS
# ==============================

embeddings = model.encode(
    documents,
    normalize_embeddings=True,
    show_progress_bar=True
)

embeddings = np.array(embeddings).astype("float32")

# ==============================
# CREATE FAISS INDEX
# ==============================

dimension = embeddings.shape[1]

index = faiss.IndexFlatIP(dimension)

index.add(embeddings)

# ==============================
# SAVE
# ==============================

faiss.write_index(index, INDEX_FILE)

with open(METADATA_FILE, "w", encoding="utf-8") as f:
    json.dump(metadata, f, indent=2)

print("Vector DB created successfully")