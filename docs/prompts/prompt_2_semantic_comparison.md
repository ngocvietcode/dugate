# PROMPT 2: ENTERPRISE SEMANTIC DOCUMENT COMPARISON

## SYSTEM PROMPT

```
You are a senior legal and compliance document analyst with expertise in Vietnamese law, 
corporate governance, and regulatory frameworks. You specialize in identifying semantic 
changes between document versions with audit-grade precision.

Your analysis must be:
- EXHAUSTIVE: Every article, clause, table, and diagram must be compared
- PRECISE: Distinguish between cosmetic edits and substantive changes
- NEUTRAL: Report facts, do not provide legal opinions
- TRACEABLE: Every finding must reference exact locations in both documents
- STRUCTURED: Output must be machine-parseable and human-readable

You are producing an official Change Analysis Report suitable for legal review, 
compliance audit, and regulatory submission.
```

---

## USER PROMPT

```
## TASK
Perform a comprehensive semantic comparison between VERSION 1 (old) and VERSION 2 (new) 
of the provided documents. Produce a full Change Analysis Report following ALL 
specifications below.

---

## PHASE 1: PRE-COMPARISON ANALYSIS

Before comparing, perform the following analysis on each document independently.

### 1.1 Document Identity Verification

Extract and display side-by-side:

| Field | Version 1 | Version 2 |
|-------|-----------|-----------|
| doc_id | | |
| title | | |
| version | | |
| issued_date | | |
| effective_date | | |
| issuer | | |
| document_type | | |
| total_chapters | | |
| total_articles | | |

[WARNING] If titles do not match, flag: `DOCUMENT IDENTITY MISMATCH — confirm these are the same document`

### 1.2 Structural Inventory

Build a complete inventory of both documents:

**Version 1 Structure Map:**
```
[List every Chapter → Section → Article with title]
Example:
Chương I (3 điều: Điều 1-3)
  └─ Điều 1: Phạm vi điều chỉnh
  └─ Điều 2: Đối tượng áp dụng  
  └─ Điều 3: Giải thích từ ngữ
Chương II (5 điều: Điều 4-8)
  ...
```

**Version 2 Structure Map:**
```
[Same format]
```

### 1.3 Article Alignment Map

This is the MOST CRITICAL step. Before comparing content, establish which articles 
correspond to each other across versions.

Use semantic matching (content similarity), NOT positional matching (same number).

Output the alignment as:

| V1 Article | V1 Title | V2 Article | V2 Title | Alignment Confidence | Alignment Basis |
|------------|----------|------------|----------|----------------------|-----------------|
| Điều 1 | Phạm vi... | Điều 1 | Phạm vi... | HIGH | Same number + same title |
| Điều 3 | Giải thích... | Điều 4 | Giải thích... | HIGH | Same title, renumbered |
| Điều 5 | Trách nhiệm A | Điều 5 | Trách nhiệm A | MEDIUM | Similar title, content changed |
| Điều 7 | Xử lý vi phạm | — | — | N/A | DELETED |
| — | — | Điều 3 | Quy định mới | N/A | NEW |

Alignment Confidence levels:
- `HIGH`: Unambiguous match (same title + similar content)
- `MEDIUM`: Probable match (similar content, different title or number)  
- `LOW`: Uncertain match — flag for human review
- `N/A`: No counterpart (new or deleted)

---

## PHASE 2: CHANGE CLASSIFICATION SYSTEM

Classify every change using the following taxonomy:

### 2.1 Structural Change Types

| Code | Type | Definition |
|------|------|------------|
| `STR-ADD` | Article Added | New article inserted, may cause renumbering |
| `STR-DEL` | Article Deleted | Article removed from document |
| `STR-REN` | Article Renumbered | Same content, different number due to insertions/deletions |
| `STR-MOV` | Article Moved | Article relocated to different chapter/section |
| `STR-SPL` | Article Split | One article divided into multiple articles |
| `STR-MRG` | Article Merged | Multiple articles combined into one |
| `STR-CHG` | Chapter/Section Changed | Chapter or section added, removed, or renamed |

### 2.2 Content Change Types

| Code | Type | Definition |
|------|------|------------|
| `CNT-SUB` | Substantive Change | Meaning, obligation, right, or condition changed |
| `CNT-EXP` | Expansion | Content added to existing article (new clauses/points) |
| `CNT-RED` | Reduction | Content removed from existing article |
| `CNT-CLA` | Clarification | Rewording that clarifies without changing meaning |
| `CNT-COS` | Cosmetic | Formatting, punctuation, or typographical fix only |
| `CNT-REF` | Reference Update | Cross-references updated due to renumbering |
| `CNT-TBL` | Table Changed | Table content modified |
| `CNT-VIS` | Visual Element Changed | Diagram, chart, or image changed |

### 2.3 Severity Levels

| Level | Symbol | Definition | Examples |
|-------|--------|------------|---------|
| CRITICAL | [CRITICAL] | Changes obligations, rights, penalties, deadlines, or scope | New prohibition, changed fine amount, new mandatory requirement |
| MAJOR | [MAJOR] | Significant content change affecting interpretation | New definitions, changed procedures, new exceptions |
| MODERATE | [MODERATE] | Meaningful change but limited impact | Clarifications that affect edge cases, minor scope adjustments |
| MINOR | [MINOR] | Cosmetic or administrative change | Typo fixes, punctuation, reference number updates |
| STRUCTURAL | [STRUCTURAL] | Renumbering only, no content change | Article 3 -> Article 4 due to insertion |

---

## PHASE 3: DETAILED CHANGE ANALYSIS

For EACH change identified, produce a Change Record in the following format:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHANGE RECORD #<sequential number>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Severity    : [CRITICAL] / [MAJOR] / [MODERATE] / [MINOR] / [STRUCTURAL]
Change Type : <code from taxonomy above>
Location V1 : <e.g. "Chương II, Điều 5, Khoản 3, Điểm b" or "N/A">
Location V2 : <e.g. "Chương II, Điều 6, Khoản 3, Điểm b" or "N/A">

ORIGINAL TEXT (V1):
┌─────────────────────────────────────────────────────────────
│ <Exact verbatim text from V1. If deleted, show full content.>
│ <If new, write "— NOT PRESENT IN V1 —">
└─────────────────────────────────────────────────────────────

NEW TEXT (V2):
┌─────────────────────────────────────────────────────────────
│ <Exact verbatim text from V2. If added, show full content.>
│ <If deleted, write "— NOT PRESENT IN V2 —">
└─────────────────────────────────────────────────────────────

SEMANTIC ANALYSIS:
  What changed   : <Describe precisely what was added, removed, or modified>
  Why it matters : <Explain the practical/legal significance of this change>
  Affected scope : <Who or what is affected by this change>
  Dependencies   : <Other articles/clauses that may be affected by this change>

INLINE DIFF (key phrases):
  REMOVED: ~~<removed text>~~
  ADDED  : **<added text>**
  
  Example: "Thời hạn ~~30~~ **45** ngày kể từ ngày ~~nhận được~~ **ký kết** hợp đồng"

REVIEWER FLAG: <NONE / NEEDS_LEGAL_REVIEW / NEEDS_COMPLIANCE_REVIEW / NEEDS_MANAGEMENT_APPROVAL>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## PHASE 4: VISUAL ELEMENT COMPARISON

For each pair of visual elements (matched by location and caption):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VISUAL CHANGE RECORD #<number>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Element ID V1 : <IMG-XXX>
Element ID V2 : <IMG-XXX>
Element Type  : <type>
Caption       : <caption>
Location      : <location in document>
Severity      : [CRITICAL] / [MAJOR] / [MODERATE] / [MINOR] / [STRUCTURAL]

COMPONENT CHANGES:
| Component | V1 | V2 | Change |
|-----------|----|----|--------|
| <name> | <description> | <description> | ADDED/REMOVED/MODIFIED/UNCHANGED |

FLOW/STEP CHANGES:
| Step | V1 | V2 | Change |
|------|----|----|--------|
| <step> | <description> | <description> | ADDED/REMOVED/MODIFIED/UNCHANGED |

DECISION POINT CHANGES:
| Branch | V1 Condition | V2 Condition | Change |
|--------|-------------|-------------|--------|

SUMMARY OF VISUAL CHANGE:
<Narrative description of what changed in this diagram and its significance>

CONFIDENCE IN COMPARISON: HIGH / MEDIUM / LOW
LOW CONFIDENCE REASON: <if applicable>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If a visual element exists in V1 but not V2 (or vice versa):

```
> [CRITICAL] VISUAL ELEMENT REMOVED/ADDED
> - Element: <ID and caption>
> - Location: <where it was/is>
> - Content summary: <what the element showed>
> - Impact: <what information is now missing or newly added>
```

---

## PHASE 5: TABLE COMPARISON

For each table that has changed:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TABLE CHANGE RECORD #<number>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Table Title   : <title>
Location V1   : <location>
Location V2   : <location>
Severity      : [CRITICAL] / [MAJOR] / [MODERATE] / [MINOR]

STRUCTURAL CHANGES:
- Columns added: <list or NONE>
- Columns removed: <list or NONE>
- Rows added: <count and description>
- Rows removed: <count and description>

CELL-LEVEL CHANGES:
| Row | Column | V1 Value | V2 Value | Change Type |
|-----|--------|----------|----------|-------------|
| <row identifier> | <col name> | <old value> | <new value> | MODIFIED/ADDED/REMOVED |

IMPACT ASSESSMENT:
<Describe what the table change means in context>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## PHASE 6: UNCHANGED CONTENT VERIFICATION

List all articles confirmed as UNCHANGED (content identical, renumbering only or no change):

```
## CONFIRMED UNCHANGED ARTICLES

| V1 Article | V2 Article | Title | Status |
|------------|------------|-------|--------|
| Dieu X | Dieu X | ... | [STRUCTURAL] RENUMBERED ONLY |
| Dieu Y | Dieu Y | ... | [OK] IDENTICAL |
```

This section provides positive confirmation that unchanged content was reviewed, 
not just skipped.

---

## PHASE 7: EXECUTIVE SUMMARY REPORT

Produce a structured summary at the TOP of the report (before all detail sections):

```
╔══════════════════════════════════════════════════════════════╗
║           DOCUMENT CHANGE ANALYSIS REPORT                    ║
╠══════════════════════════════════════════════════════════════╣
║ Document  : <title>                                          ║
║ V1        : <version> — <date>                               ║
║ V2        : <version> — <date>                               ║
║ Analysis  : <date of this analysis>                          ║
╚══════════════════════════════════════════════════════════════╝

## CHANGE STATISTICS

| Category | Count |
|----------|-------|
| [CRITICAL] CRITICAL changes | X |
| [MAJOR] MAJOR changes | X |
| [MODERATE] MODERATE changes | X |
| [MINOR] MINOR changes | X |
| [STRUCTURAL] STRUCTURAL only (renumbering) | X |
| **Total change records** | **X** |

| Structural Changes | V1 | V2 | Delta |
|-------------------|----|----|-------|
| Total chapters | X | X | +/-X |
| Total articles | X | X | +/-X |
| Articles added | — | X | +X |
| Articles deleted | X | — | -X |
| Articles renumbered | X | X | — |
| Articles with content changes | X | X | — |
| Tables changed | X | X | — |
| Visual elements changed | X | X | — |

## KEY CHANGES REQUIRING ATTENTION

List top 5-10 most significant changes with one-line description:

1. [CRITICAL] [CR-001] Dieu X -> Dieu Y: <one-line description>
2. [MAJOR] [CR-002] Dieu X: <one-line description>
...

## RENUMBERING MAP

Articles that changed number due to insertions/deletions:

| Original Number (V1) | New Number (V2) | Reason |
|----------------------|-----------------|--------|
| Điều 3 | Điều 4 | New Điều 3 inserted before |
| Điều 4 | Điều 5 | Cascading renumber |

## ITEMS REQUIRING HUMAN REVIEW

| Item | Reason | Priority |
|------|--------|----------|
| <description> | <why human review needed> | HIGH/MEDIUM/LOW |

## ANALYSIS CONFIDENCE

- Overall confidence: HIGH / MEDIUM / LOW
- Sections with uncertainty: <list or NONE>
- Recommended follow-up actions: <list>
```

---

## PHASE 8: APPENDIX

### Appendix A: Full Article-by-Article Comparison Matrix

| V1 # | V1 Title | V2 # | V2 Title | Change Type | Severity | Record # |
|------|----------|------|----------|-------------|----------|----------|
| Dieu 1 | ... | Dieu 1 | ... | CNT-COS | [MINOR] | CR-001 |
| Dieu 2 | ... | Dieu 3 | ... | STR-REN | [STRUCTURAL] | — |
| Dieu 3 | ... | — | — | STR-DEL | [CRITICAL] | CR-002 |
| — | — | Dieu 2 | ... | STR-ADD | [MAJOR] | CR-003 |

### Appendix B: Glossary of Changed Terms

If specific terms were added, removed, or redefined:

| Term | V1 Definition | V2 Definition | Change |
|------|--------------|--------------|--------|

### Appendix C: Cross-Reference Impact Analysis

When an article is renumbered or deleted, list all articles that reference it 
and whether those references were updated:

| Changed Article | Referenced In | Reference Updated? | Risk |
|----------------|---------------|-------------------|------|
| Dieu 5 -> Dieu 6 | Dieu 12, Dieu 18 | YES / NO | LOW/HIGH |

---

## PROCESSING INSTRUCTIONS

1. Execute all 8 phases in order
2. Do NOT skip any phase, even if a phase yields no results (write "No changes found")
3. Number all Change Records sequentially: CR-001, CR-002, ...
4. Number all Visual Change Records: VCR-001, VCR-002, ...
5. Number all Table Change Records: TCR-001, TCR-002, ...
6. When uncertain about a match or change, default to flagging for human review
7. Verbatim quotes must be exact — do not paraphrase source text in diff sections
8. If documents are in Vietnamese, all analysis text may be in Vietnamese
9. The Executive Summary (Phase 7) must appear FIRST in the output, 
   followed by Phases 1-6 in order, then Appendices

---

## INPUT DOCUMENTS

### VERSION 1 (CŨ / OLD):
```
[PASTE V1 MARKDOWN CONTENT HERE]
```

### VERSION 2 (MỚI / NEW):
```
[PASTE V2 MARKDOWN CONTENT HERE]
```
```
