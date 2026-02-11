import json
import os
import sys
import time
from pathlib import Path

# Configuration
SIMILARITY_THRESHOLD = 0.85
MODEL_NAME = 'all-MiniLM-L6-v2'

def load_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"⚠️ File not found: {path}")
        return None
    except Exception as e:
        print(f"❌ Error loading {path}: {e}")
        return None

def main():
    print("[INFO] Starting Semantic Matcher...")
    
    # Check for required libraries
    try:
        from sentence_transformers import SentenceTransformer, util
    except ImportError:
        print("❌ 'sentence-transformers' library not found.")
        print("   Please install it using: pip install sentence-transformers")
        # Exit gracefully so we don't crash the whole server startup, just skip this step
        return

    # Define paths
    base_dir = Path(__file__).parent.parent.parent
    smvoc_path = base_dir / "downloads" / "samsung_members_voc" / "analytics.json"
    global_path = base_dir / "downloads" / "global_voc_plm" / "analytics.json"
    output_path = base_dir / "downloads" / "samsung_members_voc" / "semantic_matches.json"

    # 1. Load Data
    smvoc_data = load_json(smvoc_path)
    global_data = load_json(global_path)

    if not smvoc_data or not global_data:
        print("⚠️ Missing analytics data. Skipping semantic matching.")
        return

    smvoc_rows = smvoc_data.get('rows', [])
    global_rows = global_data.get('rows', [])

    print(f"   Loaded {len(smvoc_rows)} SMVOC rows and {len(global_rows)} Global VOC rows.")

    # 2. Pre-process and Filter
    # Filter Global VOC for "Samsung Members" source only
    global_voc_targets = [row for row in global_rows if row.get('Source') == 'Samsung Members']
    
    if not global_voc_targets:
        print("   No Global VOC rows with Source='Samsung Members' found.")
        return

    # Extract texts for embedding
    # SMVOC: Use 'content' (note lowercase 'c' in source file based on previous analysis, but 'Content' might be used in some places. Check keys)
    # Based on view_file earlier, SMVOC uses "content" and Global VOC uses "Title"
    
    smvoc_texts = []
    smvoc_indices = [] # To map back to original row index or ID
    
    for idx, row in enumerate(smvoc_rows):
        text = row.get('content', '') or row.get('Content', '')
        if text and isinstance(text, str) and len(text.strip()) > 5:
            smvoc_texts.append(text.strip())
            smvoc_indices.append(idx)

    global_texts = []
    global_indices = []
    
    for idx, row in enumerate(global_voc_targets):
        text = row.get('Title', '')
        if text and isinstance(text, str) and len(text.strip()) > 5:
            global_texts.append(text.strip())
            # Store the index in the filtered list, but we need to map to something useful.
            # actually we just need the row data later.
            global_indices.append(idx) 

    print(f"   Embedding {len(smvoc_texts)} SMVOC items and {len(global_texts)} Global VOC items...")

    # 3. Load Model and Embed
    try:
        model = SentenceTransformer(MODEL_NAME)
        
        # Compute embeddings
        # This might take a moment
        start_time = time.time()
        smvoc_embeddings = model.encode(smvoc_texts, convert_to_tensor=True, show_progress_bar=False)
        global_embeddings = model.encode(global_texts, convert_to_tensor=True, show_progress_bar=False)
        duration = time.time() - start_time
        print(f"   Embeddings computed in {duration:.2f} seconds.")

        # 4. Compute Cosine Similarity
        # specific_row_embedding vs all_global_embeddings
        cosine_scores = util.cos_sim(smvoc_embeddings, global_embeddings)

    except Exception as e:
        print(f"❌ Error during embedding/similarity calculation: {e}")
        return

    # 5. Extract Matches
    # Structure: "FriendlyModel|Module|Content" -> [List of Global VOC Case Codes]
    # We use the same signature key as the frontend to make lookup easy.
    
    # 2b. Load Model Name Mapping (Frontend Logic)
    model_name_mapping = {}
    try:
        model_name_path = base_dir / "modelName.json"
        with open(model_name_path, 'r', encoding='utf-8') as f:
            model_name_mapping = json.load(f)
            print(f"   Loaded {len(model_name_mapping)} model mappings.")
    except Exception as e:
        print(f"   Warning: Could not load modelName.json: {e}")

    def frontend_map_model(model_number):
        """
        Replicates SMVOC_Dashboard.html applyModelNameMapping logic EXACTLY.
        """
        if not model_number or not isinstance(model_number, str):
            return model_number
        
        model_str = str(model_number).strip()

        # 1. Exact match
        if model_str in model_name_mapping:
            return model_name_mapping[model_str]
        
        # 2. Extract base model (SM-X123)
        # JS: const match = modelStr.match(/^(SM-[A-Z]\d{2,4})/);
        import re
        match = re.search(r'^(SM-[A-Z]\d{2,4})', model_str)
        if match:
             base_model = match.group(1)
             # Look for mapping keys starting with this base
             for map_key, friendly_name in model_name_mapping.items():
                 if map_key.startswith(base_model):
                     return friendly_name
        
        # 3. Fallback: prefix matching with full keys
        # JS: sortedKeys = Object.keys(modelNameMapping).sort((a, b) => b.length - a.length);
        sorted_keys = sorted(model_name_mapping.keys(), key=len, reverse=True)
        for key in sorted_keys:
            if model_str.startswith(key):
                return model_name_mapping[key]
                
        return model_number

    matches_map = {}
    count = 0

    # Helper: Normalize text for signature key
    def normalize_key_text(text):
        if not text: return ""
        # Remove literal _x000d_ which comes from Excel, and newlines
        t = text.replace('_x000d_', ' ').replace('\r', ' ').replace('\n', ' ')
        # Normalize whitespace (collapse multiple spaces to one)
        return ' '.join(t.split()).lower()

    # Iterate over SMVOC items
    for i in range(len(smvoc_texts)):
        sm_idx = smvoc_indices[i]
        sm_row = smvoc_rows[sm_idx]
        
        # Determine Model and Module for key generation
        model_no = sm_row.get('Model No.', '') or sm_row.get('model', '')
        if not isinstance(model_no, str): model_no = str(model_no) if model_no else ''
            
        module = sm_row.get('Module', '') or sm_row.get('module', '')
        
        # Original content for embedding (keep rich info)
        # But for KEY generation we need robust normalization
        raw_content = smvoc_texts[i]
        
        friendly_model = frontend_map_model(model_no)
        
        # Key used by frontend to lookup matches
        # Normalize: friendly_model + module + normalized_content
        norm_content = normalize_key_text(raw_content)
        key = f"{friendly_model}|{module}|{norm_content}"
        
        # Check scores for this item against all Global items
        # row i in cosine_scores
        scores = cosine_scores[i]
        
        # Find indices where score > threshold
        # We can use pytorch/numpy filtering
        high_score_indices = (scores > SIMILARITY_THRESHOLD).nonzero()
        
        current_matches = []
        
        for match_idx_tensor in high_score_indices:
            match_idx = match_idx_tensor.item()
            score = scores[match_idx].item()
            
            target_row = global_voc_targets[global_indices[match_idx]]
            
            # Check if Module matches
            target_module = target_row.get('Module', '')
            if target_module != module:
                continue

            # Model match check
            target_model = target_row.get('Model No.', '')
            target_friendly = frontend_map_model(target_model)
            
            if target_friendly != friendly_model:
                continue
            
            # If we are here, Model and Module match, and Text is semantically similar.
            current_matches.append({
                "code": target_row.get('Case Code'),
                "title": target_row.get('Title'),
                "subModule": target_row.get('Sub-Module', 'General'),
                "similarity": round(score, 4)
            })

        if current_matches:
            matches_map[key] = current_matches
            count += 1

    # 6. Save Matches
    print(f"   Found {count} semantic matches.")
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(matches_map, f, indent=2)
    
    print(f"[INFO] Semantic matches saved to {output_path}")

if __name__ == "__main__":
    main()
