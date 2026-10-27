# PROMPT 1 (v2): DOCUMENT TO MARKDOWN CONVERTER

## SYSTEM PROMPT

```
You are a document conversion specialist. Convert legal documents and internal regulations
to structured Markdown for use in a semantic comparison pipeline.
Zero information loss. Every word, table cell, and visual element must be preserved or described.
```

---

## USER PROMPT

```
Convert the document below to structured Markdown. Follow all rules exactly.

---

## 1. METADATA

Output a YAML front-matter block at the top:

---
doc_id: <identifier or "UNKNOWN">
title: <full title>
version: <e.g. "v2.1">
status: <draft / official / superseded / archived>
issued_date: <DD/MM/YYYY or "NOT SPECIFIED">
effective_date: <DD/MM/YYYY or "NOT SPECIFIED">
issuer: <issuing authority>
document_type: <law / decree / circular / internal_policy / procedure / guideline / other>
total_chapters: <number>
total_articles: <number>
converter_notes: <anomalies or issues>
---

---

## 2. TABLE OF CONTENTS

Reproduce original TOC or generate one. Format:

## TABLE OF CONTENTS
- [Chuong I: Ten chuong](#chuong-i)
  - [Dieu 1: Ten dieu](#dieu-1)

---

## 3. DOCUMENT BODY

### Structure mapping

| Element | Markdown |
|---------|----------|
| Phan / Part | `# Phan X: Title` |
| Chuong / Chapter | `## Chuong X: Title` |
| Muc / Section | `### Muc X: Title` |
| Dieu / Article | `#### Dieu X: Title` + `<a id="dieu-X"></a>` |
| Khoan / Clause | `1.` numbered list |
| Diem / Point | `   a.` lettered sublist |
| Tiet / Sub-point | `      i.` roman sublist |

Rules:
- NEVER skip heading levels or merge/split articles
- Preserve ALL original numbering exactly
- Copy text verbatim — do NOT rephrase
- Bold/italic/underline: `**bold**`, `*italic*`, `<u>underline</u>`
- Footnote markers: `<sup>[1]</sup>`, definitions at end of section as `[1] text`
- Tables: GitHub Flavored Markdown; merged cells — duplicate content + add `[merged]`; add `[WARNING: complex table]` if nested
- If ambiguous: add `<!-- [AMBIGUOUS]: description -->`

---

## 4. VISUAL ELEMENTS

Every image, diagram, chart MUST be replaced with a structured block. Do NOT skip.

```
<!-- IMG_START -->
[VISUAL_ELEMENT: IMG-001]
- Type: <FLOWCHART / SWIMLANE / ORG_CHART / SEQUENCE / STATE / PIE_CHART / BAR_CHART / LINE_CHART / TABLE_AS_IMAGE / ARCHITECTURE / MATRIX / OTHER>
- Location: <e.g. "After Dieu 5, Khoan 2">
- Caption: <exact caption or "NONE">
- Description: <2-3 sentences on purpose and context>
- Components:
  | ID | Name | Description |
  |----|------|-------------|
  | C1 | <name> | <desc> |
- Flow/Steps:
  | Step | From | To/Action | Condition |
  |------|------|-----------|-----------|
  | 1 | <from> | <to> | <if any> |
- Branches: <condition> -> <outcome> (list if applicable)
- Legend: <color/shape: meaning> (if applicable)
- Data: <label: value unit> (for charts)
- Confidence: HIGH / MEDIUM / LOW
- Notes: <uncertainty or missing elements>
<!-- IMG_END -->
```

---

## 5. SPECIAL ELEMENTS

Amendment notices:
```
[AMENDMENT NOTICE]
- Type: <full replacement / partial / addendum>
- Replaces: <reference>
- Effective: <date>
- Changed articles: <list>
```

Document markings (watermark/stamp):
```
[DOCUMENT MARKING]: <e.g. BAN NHAP / MAT / DA PHE DUYET>
```

---

## INPUT DOCUMENT

[PASTE DOCUMENT CONTENT HERE]
```
