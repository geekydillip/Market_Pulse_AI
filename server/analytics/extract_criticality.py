"""
extract_criticality.py
======================
Unified extraction for two file schemas.
Auto-detects which schema a file belongs to, then scores each issue
across its dimensions including the new 'similar_bug_count' parameter.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCHEMA DETECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    'Priority' + 'Occurr. Freq.' in columns  →  Schema 1
    'Resolve'  in columns (no Priority)      →  Schema 2

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCHEMA 1  (e.g. high_issues.xlsx)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Columns used  : Priority, Occurr. Freq., Issue Type, Progr.Stat.
    Dimensions    : priority (25%) + frequency (25%) + issue_type (20%)
                    + status (15%) + similar_bug_count (15%)

    Excluded rows (Progr.Stat.) :
        Resolve-Unnecessary, Resolve-Duplicated, Close, Closed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCHEMA 2  (e.g. high.xlsx, OneUI85.xlsx)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Columns used  : Severity, Issue Type, Sub-Issue Type, Resolve
    Dimensions    : severity (35%) + issue_type (25%) + sub_issue (15%)
                    + resolve (10%) + similar_bug_count (15%)

    ── CHANGE: severity_filter removed — ALL severities are processed ──

    Excluded rows (Progr.Stat.) :
        Resolve-Unnecessary, Maintain current status, Not problem,
        Close, Closed

    Excluded rows (Resolve) :
        Duplicated issue(Cause side), Maintain current status, Not problem

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SIMILAR BUG COUNT  (new dimension, applied to both schemas)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Two signals combined:

    1. combo_count — issues with identical (Issue Type + Sub-Issue Type).
    2. title_similar_count — TF-IDF cosine similarity on titles.

    similar_bug_count = max(combo_count, title_similar_count)
    Relative score = min(similar_bug_count, cap) / cap

    Falls back to combo_count only if sklearn is not installed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCORE  (0-100)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    score = sum(dimension_relative_score * weight) * 100
    Weights auto-normalise to 1.0.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIERS  (stable regardless of weight changes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Severe   >= 70
    Moderate >= 45
    Low       < 45
"""

import pandas as pd
import json
import numpy as np
from typing import Optional

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False


# ===========================================================================
#  SHARED CONFIG
# ===========================================================================

TIER_THRESHOLDS = {
    'Severe':   70,
    'Moderate': 45,
    # below 45 → Low
}

ISSUE_TYPE_RANK = {
    'System':        10,
    'Crash':         10,
    'App Crash':     10,
    'Security':       9,
    'Connectivity':   9,
    'Functional':     8,
    'Battery':        7,
    'Heat':           6,
    'Performance':    6,
    'Compatibility':  4,
    'UI/UX':          3,
    'Usability':      2,
    'UI':             2,
    'Other Issue':    1,
}

SUB_ISSUE_TYPE_RANK = {
    'App Crash':                  10,
    'CP Crash':                   10,
    'Power Off':                  10,
    'Restart':                     9,
    'No network':                  9,
    '5G Compatibility':            9,
    'Not Working':                 8,
    'Feature Missing':             7,
    'Battery Drain':               6,
    'Heating Issue':               6,
    'Weak Signal':                 5,
    'Compatibility Issue':         5,
    'Slow/Lag':                    4,
    'Slow/Lag Performance Issue':  4,
    'Performance':                 4,
    'Performance Issue':           4,
    'Poor Quality':                3,
    'UI Issue':                    2,
    'Display distortion':          2,
    'Other':                       1,
}

MAX_SIMILAR_BUGS = 20
TITLE_SIMILARITY_THRESHOLD = 0.25


# ===========================================================================
#  SCHEMA 1 CONFIG
# ===========================================================================

SCHEMA1_WEIGHTS = {
    'priority':   0.25,
    'frequency':  0.25,
    'issue_type': 0.20,
    'status':     0.15,
    'similar':    0.15,
}

SCHEMA1_PRIORITY_RANK = {
    'A': 3,
    'B': 2,
    'C': 1,
}

SCHEMA1_FREQUENCY_RANK = {
    'Always':    3,
    'Sometimes': 2,
    'Once':      1,
}

SCHEMA1_STATUS_RANK = {
    'Open':                    3,
    'Resolve - Not Released':  2,
    'Resolve - App Update':    1,
    'Resolve - Released':      1,
    'Close':                   0,
}

# ── UPDATED: added Close/Closed to Schema 1 exclusions ──────────────────────
SCHEMA1_EXCLUDED_STATUSES = {
    'Resolve - Unnecessary',
    'Resolve - Duplicated',
    'Close',
    'Closed',
}


# ===========================================================================
#  SCHEMA 2 CONFIG
# ===========================================================================

SCHEMA2_WEIGHTS = {
    'severity':   0.35,
    'issue_type': 0.25,
    'sub_issue':  0.15,
    'resolve':    0.10,
    'similar':    0.15,
}

SCHEMA2_SEVERITY_RANK = {
    'High':   3,
    'Medium': 2,
    'Low':    1,
}

SCHEMA2_RESOLVE_RANK = {
    'Issue Fixed(Source changes)':             4,
    'Issue Fixed(Except Source changes)':      4,
    'App Update via App Store':                3,
    'Not reproduced':                          1,
    'Insufficient Defect Info.':               1,
    'Request to 3rd Party(Non Samsung Issue)': 1,
    'Duplicated issue(Cause side)':            1,
}

# ── UPDATED: added Close/Closed to Progr.Stat. exclusions ───────────────────
SCHEMA2_EXCLUDED_STATUSES = {
    'Resolve - Unnecessary',
    'Maintain current status',
    'Not problem',
    'Close',
    'Closed',
}

# ── UPDATED: added Not problem + Maintain current status to Resolve exclusions
SCHEMA2_EXCLUDED_RESOLVE = {
    'Maintain current status',
    'Not problem',
    'Duplicated issue(Cause side)',
}


# ===========================================================================
#  INTERNAL HELPERS
# ===========================================================================

def _detect_schema(df: pd.DataFrame) -> str:
    cols = set(df.columns)
    if 'Priority' in cols and 'Occurr. Freq.' in cols:
        return 'schema1'
    elif 'Resolve' in cols:
        return 'schema2'
    else:
        raise ValueError(
            f"Cannot detect schema. Columns found: {sorted(cols)}\n"
            "Expected ['Priority','Occurr. Freq.'] for Schema 1, "
            "or ['Resolve'] for Schema 2."
        )


def _normalise_weights(w: dict) -> dict:
    total = sum(w.values())
    if total == 0:
        raise ValueError("All weights are zero.")
    return {k: v / total for k, v in w.items()}


def _rel(value, rank_map: dict, default_rank: int = 1) -> float:
    rank = rank_map.get(value, default_rank)
    max_rank = max(rank_map.values()) if rank_map else 1
    return rank / max_rank


def _assign_tier(score: float, thresholds: dict) -> str:
    if score >= thresholds['Severe']:
        return 'Severe'
    elif score >= thresholds['Moderate']:
        return 'Moderate'
    return 'Low'


def _normalize_status(val):
    """Normalize Progr.Stat. into Open / Resolve / Close"""
    val = str(val).lower()
    if 'open' in val:
        return 'Open'
    elif 'close' in val:
        return 'Close'
    elif 'resolve' in val:
        return 'Resolve'
    else:
        return 'Other'


# ===========================================================================
#  SIMILAR BUG COUNT
# ===========================================================================

def _compute_similar_bug_counts(
    df: pd.DataFrame,
    similarity_threshold: float = TITLE_SIMILARITY_THRESHOLD,
    max_similar_bugs: int = MAX_SIMILAR_BUGS,
) -> pd.Series:
    n = len(df)
    idx = df.index

    # Signal 1: combo count (Issue Type + Sub-Issue Type)
    combo_col = df['Issue Type'].astype(str) + '||' + df['Sub-Issue Type'].astype(str)
    combo_map = combo_col.value_counts().to_dict()
    combo_counts = combo_col.map(combo_map).fillna(1).astype(int)
    combo_counts = (combo_counts - 1).clip(lower=0)

    # Signal 2: TF-IDF title similarity
    if SKLEARN_AVAILABLE and n > 1:
        titles = df['Title'].fillna('').astype(str).tolist()
        try:
            tfidf = TfidfVectorizer(stop_words='english', ngram_range=(1, 2), min_df=1)
            mat = tfidf.fit_transform(titles)
            sim_matrix = cosine_similarity(mat)
            np.fill_diagonal(sim_matrix, 0)
            title_sim_counts = pd.Series(
                (sim_matrix >= similarity_threshold).sum(axis=1),
                index=idx, dtype=int
            )
        except Exception:
            title_sim_counts = pd.Series(0, index=idx, dtype=int)
    else:
        title_sim_counts = pd.Series(0, index=idx, dtype=int)

    combined = combo_counts.values + title_sim_counts.values
    capped = np.clip(combined, 0, max_similar_bugs)
    relative = capped / max_similar_bugs

    return pd.Series(relative, index=idx, name='_similar_rel')


# ===========================================================================
#  SCHEMA-SPECIFIC SCORERS
# ===========================================================================

def _score_schema1(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    w   = cfg['weights']
    pr  = cfg['priority_rank']
    fr  = cfg['frequency_rank']
    itr = cfg['issue_type_rank']
    sr  = cfg['status_rank']
    sim_cfg = cfg['similar_bug_config']

    df['_p']   = df['Priority'].apply(lambda v: _rel(v, pr))
    df['_f']   = df['Occurr. Freq.'].apply(lambda v: _rel(v, fr))
    df['_i']   = df['Issue Type'].apply(lambda v: _rel(v, itr))
    df['_s']   = df['Progr.Stat.'].apply(lambda v: _rel(v, sr, default_rank=0))
    df['_sim'] = _compute_similar_bug_counts(
        df,
        similarity_threshold=sim_cfg['title_similarity_threshold'],
        max_similar_bugs=sim_cfg['max_similar_bugs'],
    )

    df['criticality_score'] = (
        df['_p']   * w['priority']   +
        df['_f']   * w['frequency']  +
        df['_i']   * w['issue_type'] +
        df['_s']   * w['status']     +
        df['_sim'] * w['similar']
    ) * 100

    df['priority_contribution']   = (df['_p']   * w['priority']   * 100).round(1)
    df['frequency_contribution']  = (df['_f']   * w['frequency']  * 100).round(1)
    df['issue_type_contribution'] = (df['_i']   * w['issue_type'] * 100).round(1)
    df['status_contribution']     = (df['_s']   * w['status']     * 100).round(1)
    df['similar_contribution']    = (df['_sim'] * w['similar']    * 100).round(1)

    df.drop(columns=['_p', '_f', '_i', '_s', '_sim'], inplace=True)
    return df


def _score_schema2(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    w   = cfg['weights']
    svr = cfg['severity_rank']
    itr = cfg['issue_type_rank']
    sir = cfg['sub_issue_rank']
    rr  = cfg['resolve_rank']
    sim_cfg = cfg['similar_bug_config']

    df['_sv']  = df['Severity'].apply(lambda v: _rel(v, svr))
    df['_i']   = df['Issue Type'].apply(lambda v: _rel(v, itr))
    df['_si']  = df['Sub-Issue Type'].apply(lambda v: _rel(v, sir))
    df['_r']   = df['Resolve'].fillna('').apply(lambda v: _rel(v, rr, default_rank=1))
    df['_sim'] = _compute_similar_bug_counts(
        df,
        similarity_threshold=sim_cfg['title_similarity_threshold'],
        max_similar_bugs=sim_cfg['max_similar_bugs'],
    )

    df['criticality_score'] = (
        df['_sv']  * w['severity']   +
        df['_i']   * w['issue_type'] +
        df['_si']  * w['sub_issue']  +
        df['_r']   * w['resolve']    +
        df['_sim'] * w['similar']
    ) * 100

    df['severity_contribution']   = (df['_sv']  * w['severity']   * 100).round(1)
    df['issue_type_contribution'] = (df['_i']   * w['issue_type'] * 100).round(1)
    df['sub_issue_contribution']  = (df['_si']  * w['sub_issue']  * 100).round(1)
    df['resolve_contribution']    = (df['_r']   * w['resolve']    * 100).round(1)
    df['similar_contribution']    = (df['_sim'] * w['similar']    * 100).round(1)

    df.drop(columns=['_sv', '_i', '_si', '_r', '_sim'], inplace=True)
    return df


# ===========================================================================
#  CORE EXTRACTION FUNCTION
# ===========================================================================

def extract_criticality_data(
    filepath: str,
    # ── CHANGE: severity_filter removed — all severities are now processed ──
    # Similar bug config overrides
    max_similar_bugs: Optional[int] = None,
    title_similarity_threshold: Optional[float] = None,
    # Schema 1 overrides
    schema1_weights: Optional[dict] = None,
    schema1_priority_rank: Optional[dict] = None,
    schema1_frequency_rank: Optional[dict] = None,
    schema1_issue_type_rank: Optional[dict] = None,
    schema1_status_rank: Optional[dict] = None,
    # Schema 2 overrides
    schema2_weights: Optional[dict] = None,
    schema2_severity_rank: Optional[dict] = None,
    schema2_issue_type_rank: Optional[dict] = None,
    schema2_sub_issue_rank: Optional[dict] = None,
    schema2_resolve_rank: Optional[dict] = None,
    # Shared override
    tier_thresholds: Optional[dict] = None,
) -> dict:
    """
    Auto-detects file schema, excludes closed/unnecessary/duplicate rows,
    scores all remaining issues (all severities), and returns structured result.

    ── KEY CHANGE FROM PREVIOUS VERSION ────────────────────────────────────
    severity_filter parameter removed.
    All severities (High / Medium / Low) are now scored together.

    Exclusion rules (applied before scoring):
        Schema 1 Progr.Stat. :  Resolve-Unnecessary, Resolve-Duplicated,
                                 Close, Closed
        Schema 2 Progr.Stat. :  Resolve-Unnecessary, Maintain current status,
                                 Not problem, Close, Closed
        Schema 2 Resolve     :  Duplicated issue(Cause side),
                                 Maintain current status, Not problem
    ────────────────────────────────────────────────────────────────────────

    Returns
    -------
    dict:
        schema          → 'schema1' or 'schema2'
        issues          → list of scored dicts, sorted by score desc
        summary         → Severe/Moderate/Deferred counts + status breakdown
        total_input     → total rows in file
        excluded        → rows removed before scoring
        active          → rows that were scored
        config_used     → weights, thresholds, similar config applied
    """

    thr = tier_thresholds or TIER_THRESHOLDS

    sim_cfg = {
        'max_similar_bugs':           max_similar_bugs or MAX_SIMILAR_BUGS,
        'title_similarity_threshold': title_similarity_threshold or TITLE_SIMILARITY_THRESHOLD,
    }

    # ── 1. Load and detect schema ──────────────────────────────────────────
    df = pd.read_excel(filepath)
    total_input = len(df)
    schema = _detect_schema(df)

    # ── 2. Exclude non-actionable rows, build cfg, score ──────────────────
    if schema == 'schema1':

        excl_mask = df['Progr.Stat.'].isin(SCHEMA1_EXCLUDED_STATUSES)
        excluded_df = df[excl_mask].copy()
        excluded_count = len(excluded_df)
        df = df[~excl_mask].copy()

        # Normalize status for both sets
        df['status_group'] = df['Progr.Stat.'].apply(_normalize_status)
        excluded_df['status_group'] = excluded_df['Progr.Stat.'].apply(_normalize_status)

        cfg = {
            'weights':          _normalise_weights(schema1_weights or SCHEMA1_WEIGHTS),
            'priority_rank':    schema1_priority_rank   or SCHEMA1_PRIORITY_RANK,
            'frequency_rank':   schema1_frequency_rank  or SCHEMA1_FREQUENCY_RANK,
            'issue_type_rank':  schema1_issue_type_rank or ISSUE_TYPE_RANK,
            'status_rank':      schema1_status_rank     or SCHEMA1_STATUS_RANK,
            'similar_bug_config': sim_cfg,
        }

        df = _score_schema1(df, cfg)

        score_cols = [
            'criticality_score', 'tier',
            'priority_contribution', 'frequency_contribution',
            'issue_type_contribution', 'status_contribution',
            'similar_contribution',
        ]
        base_cols = [
            'Case Code', 'Source', 'Title', 'Priority', 'Occurr. Freq.',
            'Issue Type', 'Sub-Issue Type', 'Module', 'Progr.Stat.',
            'Ai Summary', 'Severity',
        ]

    else:  # schema2

        excl_mask = (
            df['Progr.Stat.'].isin(SCHEMA2_EXCLUDED_STATUSES) |
            df['Resolve'].isin(SCHEMA2_EXCLUDED_RESOLVE)
        )
        excluded_df = df[excl_mask].copy()
        excluded_count = len(excluded_df)
        df = df[~excl_mask].copy()

        # Normalize status for both sets
        df['status_group'] = df['Progr.Stat.'].apply(_normalize_status)
        excluded_df['status_group'] = excluded_df['Progr.Stat.'].apply(_normalize_status)

        cfg = {
            'weights':          _normalise_weights(schema2_weights or SCHEMA2_WEIGHTS),
            'severity_rank':    schema2_severity_rank   or SCHEMA2_SEVERITY_RANK,
            'issue_type_rank':  schema2_issue_type_rank or ISSUE_TYPE_RANK,
            'sub_issue_rank':   schema2_sub_issue_rank  or SUB_ISSUE_TYPE_RANK,
            'resolve_rank':     schema2_resolve_rank    or SCHEMA2_RESOLVE_RANK,
            'similar_bug_config': sim_cfg,
        }

        df = _score_schema2(df, cfg)

        score_cols = [
            'criticality_score', 'tier',
            'severity_contribution', 'issue_type_contribution',
            'sub_issue_contribution', 'resolve_contribution',
            'similar_contribution',
        ]
        base_cols = [
            'Case Code', 'Model No.', 'Title', 'Severity', 'Issue Type',
            'Sub-Issue Type', 'Module', 'Resolve', 'Progr.Stat.', 'Ai Summary',
        ]

    active_count = len(df)

    # ── 3. Round, assign tier, sort ────────────────────────────────────────
    df['criticality_score'] = df['criticality_score'].round(1)
    df['tier'] = df['criticality_score'].apply(lambda s: _assign_tier(s, thr))
    df['Ai Summary'] = df['Ai Summary'].fillna('')
    df = df.sort_values('criticality_score', ascending=False).reset_index(drop=True)

    # ── 4. Build output ────────────────────────────────────────────────────
    existing_base = [c for c in base_cols if c in df.columns]
    issues = df[existing_base + score_cols].to_dict(orient='records')

    low_df = df[df['tier'] == 'Low']
    summary = {}

    for tier_name in ['Severe', 'Moderate']:
        tier_df = df[df['tier'] == tier_name]
        summary[tier_name] = {
            'count': len(tier_df),
            'status': {
                'Open':    int((tier_df['status_group'] == 'Open').sum()),
                'Resolve': int((tier_df['status_group'] == 'Resolve').sum()),
                'Close':   int((tier_df['status_group'] == 'Close').sum()),
            }
        }

    # Deferred = Low (active but low score) + Excluded rows
    combined_deferred = pd.concat([low_df, excluded_df], ignore_index=True)
    summary['Deferred'] = {
        'count': len(combined_deferred),
        'status': {
            'Open':    int((combined_deferred['status_group'] == 'Open').sum()),
            'Resolve': int((combined_deferred['status_group'] == 'Resolve').sum()),
            'Close':   int((combined_deferred['status_group'] == 'Close').sum()),
        }
    }

    return {
        'schema':      schema,
        'issues':      issues,
        'summary':     summary,
        'total_input': total_input,
        'excluded':    excluded_count,
        'active':      active_count,
        'config_used': {
            'schema':             schema,
            'weights':            cfg['weights'],
            'tier_thresholds':    thr,
            'similar_bug_config': sim_cfg,
            'sklearn_available':  SKLEARN_AVAILABLE,
        },
    }


# ===========================================================================
#  HELPER FUNCTIONS
# ===========================================================================

def get_severe_issues(filepath: str, **kwargs) -> list:
    """Returns only Severe issues, sorted by score descending."""
    return [i for i in extract_criticality_data(filepath, **kwargs)['issues']
            if i['tier'] == 'Severe']


def get_issues_by_tier(filepath: str, tier: str, **kwargs) -> list:
    """Returns issues for a specific tier: 'Severe', 'Moderate', or 'Low'."""
    if tier not in ('Severe', 'Moderate', 'Low'):
        raise ValueError("tier must be 'Severe', 'Moderate', or 'Low'")
    return [i for i in extract_criticality_data(filepath, **kwargs)['issues']
            if i['tier'] == tier]


def get_summary(filepath: str, **kwargs) -> dict:
    """Returns tier counts with status breakdown."""
    return extract_criticality_data(filepath, **kwargs)['summary']


def export_to_json(filepath: str, output_path: str, **kwargs) -> None:
    """Extracts data and saves full result to a JSON file."""
    result = extract_criticality_data(filepath, **kwargs)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"Saved → {output_path}")


def export_to_excel(filepath: str, output_path: str, **kwargs) -> None:
    """Extracts data and saves scored issues to a new Excel file."""
    result = extract_criticality_data(filepath, **kwargs)
    pd.DataFrame(result['issues']).to_excel(output_path, index=False)
    print(f"Saved → {output_path}")


# ===========================================================================
#  EXAMPLE USAGE
# ===========================================================================
if __name__ == '__main__':

    files = ['D:\\Market_Pulse_AI\\downloads\\trend_off\\OneUI85.xlsx']

    for filepath in files:
        print("=" * 72)
        print(f"File   : {filepath.split('/')[-1].split(chr(92))[-1]}")

        # ── No severity_filter argument needed anymore ──
        result = extract_criticality_data(filepath)

        print(f"Schema : {result['schema']}")
        print(f"Rows   : {result['total_input']} total  |  "
              f"{result['excluded']} excluded (Close/Unnecessary/Not problem)  |  "
              f"{result['active']} scored (all severities)")
        print(f"Weights: {result['config_used']['weights']}")
        print(f"Similar: cap={result['config_used']['similar_bug_config']['max_similar_bugs']}, "
              f"threshold={result['config_used']['similar_bug_config']['title_similarity_threshold']}, "
              f"sklearn={'yes' if result['config_used']['sklearn_available'] else 'no (combo only)'}")
        print()

        for tier, stats in result['summary'].items():
            s = stats.get('status', {})
            print(
                f"  {tier:10s} {stats['count']:3d} issues "
                f"[Open:{s.get('Open', 0)}, "
                f"Resolve:{s.get('Resolve', 0)}, "
                f"Close:{s.get('Close', 0)}]"
            )

        print()
        print(f"  {'Sev':<6} {'Title':<50} {'Score':>6}  {'Sim':>5}  Tier")
        print("  " + "─" * 76)
        for issue in result['issues'][:10]:
            sev = issue.get('Severity', '?')
            print(
                f"  {sev:<6} {issue['Title'][:49]:<50} "
                f"{issue['criticality_score']:>6.1f}  "
                f"{issue['similar_contribution']:>5.1f}  "
                f"{issue['tier']}"
            )
        print()