# PROMPT 2 (v2): SEMANTIC DOCUMENT COMPARISON

## SYSTEM PROMPT

```
You are a legal and compliance document analyst. Compare two versions of a document
with audit-grade precision. Report facts only — no legal opinions.
Output must be exhaustive, traceable, and machine-parseable.
```

---

## USER PROMPT

```
Perform a full semantic comparison of VERSION 1 (old) vs VERSION 2 (new).
Produce a Change Analysis Report following all phases below.
Output Phase 4 (Summary) FIRST, then Phases 1-3, then Appendix.

---

## PHASE 1: PRE-COMPARISON

### 1.1 Document Identity

| Field | V1 | V2 |
|-------|----|----|
| title | | |
| version | | |
| issued_date | | |
| effective_date | | |
| issuer | | |
| total_chapters | | |
| total_articles | | |

If titles differ: flag `DOCUMENT IDENTITY MISMATCH`

### 1.2 Structure Map

List every Chapter > Article for both versions:
```
Chuong I (X dieu: Dieu 1-X)
  - Dieu 1: Title
  - Dieu 2: Title
```

### 1.3 Article Alignment Map

Match articles by CONTENT SIMILARITY, not by number.

| V1 # | V1 Title | V2 # | V2 Title | Confidence | Basis |
|------|----------|------|----------|------------|-------|
| Dieu 1 | ... | Dieu 1 | ... | HIGH | Same title + content |
| Dieu 3 | ... | Dieu 4 | ... | HIGH | Renumbered |
| Dieu 7 | ... | — | — | N/A | DELETED |
| — | — | Dieu 3 | ... | N/A | NEW |

Confidence: HIGH (unambiguous) / MEDIUM (probable) / LOW (uncertain, flag for review) / N/A

---

## PHASE 2: CHANGE TAXONOMY

### Structural change codes
| Code | Meaning |
|------|---------|
| STR-ADD | Article added |
| STR-DEL | Article deleted |
| STR-REN | Renumbered, same content |
| STR-MOV | Moved to different chapter |
| STR-SPL | Split into multiple articles |
| STR-MRG | Merged from multiple articles |

### Content change codes
| Code | Meaning |
|------|---------|
| CNT-SUB | Substantive: obligation/right/condition changed |
| CNT-EXP | Expansion: new clauses added |
| CNT-RED | Reduction: clauses removed |
| CNT-CLA | Clarification: rewording, same meaning |
| CNT-COS | Cosmetic: formatting/punctuation only |
| CNT-REF | Reference update due to renumbering |
| CNT-TBL | Table content changed |
| CNT-VIS | Visual element changed |

### Severity
| Level | Definition |
|-------|------------|
| [CRITICAL] | Obligation, right, penalty, deadline, or scope changed |
| [MAJOR] | Significant change affecting interpretation |
| [MODERATE] | Meaningful but limited impact |
| [MINOR] | Cosmetic or administrative only |
| [STRUCTURAL] | Renumbering only, no content change |

---

## PHASE 3: CHANGE RECORDS

For EACH change, output one record:

```
--- CR-001 ---
Severity    : [CRITICAL/MAJOR/MODERATE/MINOR/STRUCTURAL]
Type        : <code>
Location V1 : <Chuong X, Dieu Y, Khoan Z> or N/A
Location V2 : <Chuong X, Dieu Y, Khoan Z> or N/A
V1 text     : <exact verbatim quote, or "NOT PRESENT">
V2 text     : <exact verbatim quote, or "NOT PRESENT">
Diff        : <key changed phrases: REMOVED:~~old~~ ADDED:**new**>
Analysis    : <what changed, why it matters, who is affected>
Review flag : NONE / NEEDS_LEGAL_REVIEW / NEEDS_COMPLIANCE_REVIEW / NEEDS_MANAGEMENT_APPROVAL
```

For visual element changes:
```
--- VCR-001 ---
Severity    : <level>
Type        : CNT-VIS
Element V1  : <IMG-ID, caption, location>
Element V2  : <IMG-ID, caption, location>
Components  : <table: name | V1 desc | V2 desc | ADDED/REMOVED/MODIFIED/UNCHANGED>
Flow/Steps  : <table: step | V1 | V2 | change>
Branches    : <V1 condition -> outcome vs V2 condition -> outcome>
Analysis    : <what changed and significance>
Confidence  : HIGH / MEDIUM / LOW
```

For table changes:
```
--- TCR-001 ---
Severity    : <level>
Type        : CNT-TBL
Table       : <title, location V1, location V2>
Structure   : <columns added/removed, rows added/removed>
Cell changes: <table: row | column | V1 value | V2 value>
Analysis    : <impact>
```

---

## PHASE 4: EXECUTIVE SUMMARY (output this FIRST)

```
DOCUMENT CHANGE ANALYSIS REPORT
Document : <title>
V1       : <version> - <date>
V2       : <version> - <date>

CHANGE COUNTS
| Severity | Count |
|----------|-------|
| [CRITICAL] | X |
| [MAJOR] | X |
| [MODERATE] | X |
| [MINOR] | X |
| [STRUCTURAL] | X |
| Total | X |

STRUCTURAL DELTA
| Item | V1 | V2 | Delta |
|------|----|----|-------|
| Chapters | X | X | +/-X |
| Articles | X | X | +/-X |
| Added | - | X | +X |
| Deleted | X | - | -X |
| Renumbered | X | X | - |
| Content changed | X | X | - |
| Tables changed | X | X | - |
| Visuals changed | X | X | - |

TOP CHANGES
1. [CRITICAL] CR-001: <one-line description>
2. [MAJOR] CR-002: <one-line description>

RENUMBERING MAP
| V1 # | V2 # | Reason |
|------|------|--------|
| Dieu 3 | Dieu 4 | New Dieu 3 inserted |

HUMAN REVIEW REQUIRED
| Item | Reason | Priority |
|------|--------|----------|

CONFIDENCE: HIGH / MEDIUM / LOW
```

---

## APPENDIX: FULL COMPARISON MATRIX

| V1 # | V1 Title | V2 # | V2 Title | Type | Severity | Record |
|------|----------|------|----------|------|----------|--------|
| Dieu 1 | ... | Dieu 1 | ... | CNT-COS | [MINOR] | CR-001 |
| Dieu 3 | ... | Dieu 4 | ... | STR-REN | [STRUCTURAL] | - |
| Dieu 5 | ... | - | - | STR-DEL | [CRITICAL] | CR-002 |
| - | - | Dieu 3 | ... | STR-ADD | [MAJOR] | CR-003 |

---

## PROCESSING RULES

1. Output Phase 4 first, then Phases 1-3, then Appendix
2. Never skip a phase — write "No changes found" if empty
3. Number records: CR-001, VCR-001, TCR-001 sequentially
4. Verbatim quotes must be exact — never paraphrase in diff sections
5. When uncertain, flag for human review rather than guess

---

## INPUT DOCUMENTS

VERSION 1 (OLD):
[PASTE V1 MARKDOWN HERE]

VERSION 2 (NEW):
[PASTE V2 MARKDOWN HERE]
```
