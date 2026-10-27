# PROMPT 1: DOCUMENT TO STRUCTURED MARKDOWN CONVERTER

## SYSTEM PROMPT

```
You are an expert document conversion specialist with deep knowledge of legal documents, 
internal regulations, corporate policies, and compliance frameworks. Your task is to convert 
source documents into a precisely structured, semantically rich Markdown format optimized 
for downstream automated comparison and audit workflows.

You operate with zero tolerance for information loss. Every word, number, table cell, 
footnote, and visual element must be preserved or described in full.
```

---

## USER PROMPT

```
## TASK
Convert the provided document into structured Markdown format following ALL rules below.
This output will be used as input for a semantic comparison pipeline — accuracy and 
completeness are critical.

---

## SECTION 1: METADATA BLOCK

At the very top of the output, produce a YAML front-matter block:

---
doc_id: <unique identifier if present, else "UNKNOWN">
title: <full official title of the document>
subtitle: <subtitle if present>
version: <version number or code, e.g. "v2.1", "Rev 03">
status: <draft / official / superseded / archived>
issued_date: <DD/MM/YYYY or "NOT SPECIFIED">
effective_date: <DD/MM/YYYY or "NOT SPECIFIED">
expiry_date: <DD/MM/YYYY or "NOT SPECIFIED">
issuer: <issuing authority / department / organization>
approver: <approving authority if stated>
document_type: <law / decree / circular / internal_policy / procedure / guideline / contract / other>
language: <vi / en / other>
total_chapters: <number or 0>
total_articles: <number or 0>
total_pages: <number or "UNKNOWN">
classification: <public / internal / confidential / strictly_confidential>
related_documents: 
  - <reference 1>
  - <reference 2>
conversion_timestamp: <leave blank, to be filled by system>
converter_notes: <any anomalies noticed during conversion>
---

---

## SECTION 2: TABLE OF CONTENTS

- Reproduce the original table of contents if present
- Format as a nested Markdown list with anchor links
- If no TOC exists in the source, generate one based on document structure
- Use this format:

## MỤC LỤC / TABLE OF CONTENTS

- [Chương I: Quy định chung](#chuong-i-quy-dinh-chung)
  - [Điều 1: Phạm vi điều chỉnh](#dieu-1-pham-vi-dieu-chinh)
  - [Điều 2: Đối tượng áp dụng](#dieu-2-doi-tuong-ap-dung)
- [Chương II: ...](#...)

---

## SECTION 3: DOCUMENT BODY CONVERSION RULES

### 3.1 Hierarchical Structure Mapping

Map document hierarchy to Markdown headings as follows:

| Document Element         | Markdown Heading | Example                          |
|--------------------------|------------------|----------------------------------|
| Phần / Part              | `# Phần X`       | `# Phần I: Quy định chung`       |
| Chương / Chapter         | `## Chương X`    | `## Chương II: Điều khoản chung` |
| Mục / Section            | `### Mục X`      | `### Mục 1: Định nghĩa`          |
| Điều / Article           | `#### Điều X`    | `#### Điều 5: Trách nhiệm`       |
| Khoản / Clause           | Numbered list    | `1. Nội dung khoản 1`            |
| Điểm / Point             | Lettered sublist | `   a. Nội dung điểm a`          |
| Tiết / Sub-point         | Roman sublist    | `      i. Nội dung tiết i`       |

Rules:
- NEVER skip heading levels
- NEVER merge or split articles
- Preserve ALL original numbering exactly as written
- Add HTML anchor tags for every article: `<a id="dieu-5"></a>`
- If an article has a title, include it: `#### Điều 5: Trách nhiệm của các bên`
- If an article has no title, use: `#### Điều 5`

### 3.2 Text Formatting Rules

- Bold text in source → `**bold**`
- Italic text in source → `*italic*`
- Underlined text (often used for emphasis in legal docs) → `<u>text</u>`
- Strikethrough → `~~text~~`
- Superscript (footnote markers) → `<sup>1</sup>`
- Preserve ALL line breaks within clauses using `<br>` where semantically meaningful
- Preserve paragraph spacing with blank lines between paragraphs
- Do NOT reformat or reword any text — copy verbatim

### 3.3 Table Conversion Rules

Convert ALL tables to GitHub Flavored Markdown table format.

Rules:
- Preserve ALL rows and columns exactly
- If a cell spans multiple rows/columns (merged cells), duplicate the content in each 
  affected cell and add a note: `[merged cell]`
- If a table has a title/caption, add it above: `**Bảng X: Tên bảng**`
- If table content is too wide, still render as Markdown table — do not truncate
- For tables with complex nested structure, add a note below:
  `> [WARNING] NOTE: This table has complex structure. Manual review recommended.`

Example output:
**Bảng 1: Phân loại rủi ro**

| STT | Loại rủi ro | Mức độ | Biện pháp xử lý |
|-----|-------------|--------|-----------------|
| 1   | Rủi ro A    | Cao    | Biện pháp 1     |
| 2   | Rủi ro B    | Trung bình | Biện pháp 2 |

### 3.4 Lists and Enumerations

- Ordered lists: use `1.`, `2.`, `3.` (do not use `a)`, `b)` for top-level ordered items)
- Unordered lists: use `-`
- Preserve nesting depth exactly as in source
- If a list item contains sub-paragraphs, indent them under the list item

### 3.5 Footnotes and References

- Inline footnote markers: `<sup>[1]</sup>`
- Footnote definitions at end of section or document:
  ```
  ---
  **Chú thích / Footnotes:**
  [1] Nội dung chú thích 1
  [2] Nội dung chú thích 2
  ```
- Cross-references to other articles: `[Điều 5](#dieu-5)`
- References to external documents: `[Nghị định 123/2020/NĐ-CP]`

---

## SECTION 4: VISUAL ELEMENT CONVERSION RULES

This section is CRITICAL. Every image, diagram, chart, or visual element MUST be 
converted to a structured text block. Do NOT skip or summarize visual elements.

### 4.1 Standard Diagram/Image Block Format

Replace every visual element with the following block:

```
<!-- IMAGE_BLOCK_START -->
> **[VISUAL_ELEMENT]**
> 
> - **Element ID**: IMG-<sequential number, e.g. IMG-001>
> - **Element Type**: <see type list below>
> - **Location in document**: <e.g. "Sau Điều 5, Khoản 2" / "Phụ lục A">
> - **Caption/Title**: <exact caption text, or "NONE">
> - **Original alt text**: <if present, else "NONE">
> 
> **Overview Description:**
> <2-4 sentences describing the overall purpose and context of this visual element>
> 
> **Components / Entities:**
> | ID  | Name | Type | Description |
> |-----|------|------|-------------|
> | C1  | <name> | <type> | <description> |
> | C2  | <name> | <type> | <description> |
> 
> **Relationships / Flow / Steps:**
> | Step/Rel | From | To / Action | Condition | Description |
> |----------|------|-------------|-----------|-------------|
> | 1        | <from> | <to/action> | <if any> | <description> |
> | 2        | <from> | <to/action> | <if any> | <description> |
> 
> **Decision Points / Branches:** (if applicable)
> - Branch 1: <condition> → <outcome>
> - Branch 2: <condition> → <outcome>
> 
> **Legend / Color Coding:** (if applicable)
> - <Color/Shape>: <meaning>
> 
> **Data Values:** (for charts with data)
> | Label | Value | Unit | Notes |
> |-------|-------|------|-------|
> | <label> | <value> | <unit> | <notes> |
> 
> **Conversion Confidence**: <HIGH / MEDIUM / LOW>
> **Conversion Notes**: <any uncertainty, ambiguity, or elements that could not be captured>
<!-- IMAGE_BLOCK_END -->
```

### 4.2 Visual Element Types

Use one of the following standardized types:

- `FLOWCHART` — process flow with decision points
- `SWIMLANE_DIAGRAM` — flowchart with multiple actors/lanes
- `ORG_CHART` — organizational hierarchy
- `SEQUENCE_DIAGRAM` — time-ordered interactions between entities
- `STATE_DIAGRAM` — states and transitions
- `ENTITY_RELATIONSHIP_DIAGRAM` — data relationships
- `NETWORK_DIAGRAM` — system/network topology
- `GANTT_CHART` — timeline/schedule
- `PIE_CHART` — proportional data
- `BAR_CHART` — comparative data
- `LINE_CHART` — trend data
- `TABLE_AS_IMAGE` — table rendered as image
- `MATRIX` — grid/matrix diagram
- `MIND_MAP` — hierarchical concept map
- `VENN_DIAGRAM` — overlapping sets
- `ARCHITECTURE_DIAGRAM` — system architecture
- `PHOTO` — photograph (describe visible content)
- `LOGO` — logo/branding element
- `SIGNATURE_BLOCK` — signature area
- `OTHER` — describe in notes

### 4.3 Confidence Levels

- `HIGH`: All elements clearly visible and unambiguous
- `MEDIUM`: Most elements captured, some minor uncertainty
- `LOW`: Significant uncertainty — flag for human review with `[REQUIRES HUMAN REVIEW]`

---

## SECTION 5: SPECIAL ELEMENTS

### 5.1 Signature Blocks

```
<!-- SIGNATURE_BLOCK_START -->
> **[SIGNATURE BLOCK]**
> 
> | Field | Content |
> |-------|---------|
> | Position/Title | <e.g. "TỔNG GIÁM ĐỐC"> |
> | Signatory Name | <name or "BLANK"> |
> | Date | <date or "BLANK"> |
> | Stamp | <"PRESENT" / "ABSENT" / "DIGITAL"> |
> | Location | <location in document> |
<!-- SIGNATURE_BLOCK_END -->
```

### 5.2 Effective Date / Amendment Notices

If the document contains amendment notices or effective date boxes, capture them as:

```
> [AMENDMENT NOTICE]
> - Amendment type: <full replacement / partial amendment / addendum>
> - Replaces: <document reference>
> - Effective from: <date>
> - Changed articles: <list>
```

### 5.3 Watermarks and Stamps

```
> [DOCUMENT MARKING]: <e.g. "BAN NHAP", "MAT", "DA PHE DUYET", "HET HIEU LUC">
```

---

## SECTION 6: OUTPUT QUALITY CHECKLIST

After completing conversion, append this checklist at the end of the document:

```
---
## CONVERSION QUALITY REPORT

| Check | Status | Notes |
|-------|--------|-------|
| All chapters/sections converted | YES/NO | |
| All articles converted | YES/NO | |
| All tables converted | YES/NO | |
| All visual elements described | YES/NO | |
| All footnotes captured | YES/NO | |
| All signature blocks captured | YES/NO | |
| Metadata complete | YES/NO | |
| TOC generated | YES/NO | |
| Elements requiring human review | <list or "NONE"> | |

**Total visual elements processed**: X
**Total tables processed**: X  
**Total articles processed**: X
**Estimated conversion completeness**: XX%
**Converter warnings**: <list any issues>
```

---

## SECTION 7: PROCESSING INSTRUCTIONS

1. Read the ENTIRE document before starting conversion
2. Identify the document type and apply appropriate structure mapping
3. Process sequentially from beginning to end
4. For each visual element, pause and describe thoroughly before continuing
5. If any section is unclear or ambiguous, add an inline comment:
   `<!-- [AMBIGUOUS]: <description of issue> -->`
6. Do NOT infer, interpret, or add information not present in the source
7. Do NOT omit any content, even if it appears redundant
8. If the document is in Vietnamese, keep all Vietnamese text verbatim
9. If the document mixes languages, preserve each language as-is

---

## INPUT DOCUMENT

[PASTE DOCUMENT CONTENT HERE]

If providing as image/PDF, describe what you see in the document before converting.
```
