# Document Comparison Prompt Suite

Enterprise-grade prompts for semantic comparison of legal and regulatory documents.

## Workflow

```
[Source Document V1]  ──► Prompt 1 ──► [Structured MD V1] ──┐
                                                              ├──► Prompt 2 ──► [Change Analysis Report]
[Source Document V2]  ──► Prompt 1 ──► [Structured MD V2] ──┘
```

## Files

| File | Purpose |
|------|---------|
| `prompt_1_document_to_markdown.md` | Convert source document (PDF/DOCX/image) to structured Markdown |
| `prompt_2_semantic_comparison.md` | Compare two Markdown documents and produce audit-grade change report |

## Usage Notes

- Always run Prompt 1 on BOTH documents before running Prompt 2
- For documents > 50 pages, split by chapter and run Prompt 2 per chapter
- Prompt 2 output is structured for both human review and machine parsing
- Change Record IDs (CR-XXX) can be used as references in audit trails
