# Payment Account Management — Test UI (Design / Control Doc)

> **Status:** Design only. No code yet.
> **Scope:** `open` mode, all stages. `close` / `freeze` shown disabled ("sắp có").
> **Invocation:** payroll-style `POST /api/v1/docs/workflows` + `metadata`.
> **Files:** local upload (CSP lives in another system — we upload from local to test).

This document is the source of truth that "controls" the later build. Update it
first, then implement to match.

---

## 1. Why this differs from payroll-verify

| | payroll-verify | payment-account-management (open) |
|---|---|---|
| Shape | 3 fixed sequential steps | **fan-out over N documents** |
| Files | exactly 1 PDF + 1 Excel | many PDF / image docs (a dossier) |
| Per file | — | **classification + extraction happen per file** |
| Result | one comparison verdict | **one card per document** |
| Modes | single | 3 (open / close / freeze); only `open` implemented |
| Stages | — | `classification` / `extraction` / `e2e` |

**Core decision:** replace payroll's vertical stepper with a **per-file card
grid**. Each card is one document (keyed by `file_id`) walking its own
classify → extract → validate lifecycle. This is what makes a 5–15 document
dossier readable.

---

## 2. Request shape

Same transport as `usePayrollPolling.submitWorkflow`, with these differences:

```
POST /api/v1/docs/workflows          (multipart/form-data)
  process             = "payment-account-management"
  allowed_extensions  = ".pdf,.jpg,.jpeg,.png"
  files[]             = <local uploaded files>        ← local upload, no CSP
  metadata            = JSON.stringify({ mode: "open", extra: { stage } })
  headers:  X-API-Key = <key>
```

- `stage ∈ { classification, extraction, e2e }` (from the Stage toggle).
- `verification` stage is intentionally **excluded** from this UI — it consumes
  `metadata.data`, not files, so it does not belong in a file-upload screen.

### ⚠ Build-time check (do this FIRST)

`runPaymentAccountManagement` reads `ctx.pipelineVars.metadata`. Payroll passes a
different form field (`compare_config`). Before wiring submit, confirm in
`app/api/v1/docs/workflows/route.ts` that the `metadata` form field lands in
`ctx.pipelineVars.metadata`. If the field name differs, adjust here + in code.

---

## 3. Folder structure

Lives under `app/` so it is a live Next.js route at **`/payment-account-management`**:

```
app/payment-account-management/
  DESIGN.md                   # this design/control doc
  page.tsx                    # mode/stage state, upload, submit, orchestration
  types.ts                    # UI types (DocCard, DocStatus, Stage, Mode)
  hooks/usePamPolling.ts      # fork of usePayrollPolling; result → per-file cards
  components/
    ModeStageBar.tsx          # mode tabs + stage toggle
    SummaryStrip.tsx          # counts + overall decision
    DocumentCard.tsx          # ONE file's classify→extract→validate lifecycle
    ExtractedFields.tsx       # expandable key→value table + copy JSON
```

---

## 4. Page layout

```
Header + API Key input
ModeStageBar     ● Mở   ○ Đóng (sắp có)   ○ Phong tỏa (sắp có)
                 Stage: ● E2E  ○ Chỉ phân loại  ○ Phân loại + Trích xuất
UploadZone       (multi PDF/image, local drag-drop)
Overall bar      ▓▓▓▓▓▓▓░░░ 70%   [▶ Bắt đầu]  [↻ Reset]
SummaryStrip     N docs · X classified · Y extracted · Z unknown · APPROVED/REVIEW_REQUIRED
DocumentCard[]   fan-out grid, 1–2 cols responsive
[📥 Tải HTML]
```

---

## 5. DocumentCard — the value-add

Each card walks its own mini-lifecycle, seeded as "pending" from the uploaded
file list and filled in as sub-results stream via polling.

```
┌─ don_mo_tk.pdf ─────────────── 📄 ─┐
│  ● classify ✓   ● extract ⟳        │   per-file step dots
│  🏷 MB02                     96% ██ │   code + confidence bar
│  GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ...  │   filled title
│  ▸ 12 trường trích xuất  ✓ hợp lệ   │   expand → ExtractedFields + checks
└────────────────────────────────────┘
```

- **Confidence color:** `≥0.8` green · `0.5–0.8` amber · `<0.5` red.
- **`code === "unknown"`:** distinct grey "⚠ chưa nhận diện" style.
- **Stage-aware rendering:**
  - `classification` → stop after code / title / confidence / reason.
  - `extraction` → also show extracted fields table (or error).
  - `e2e` → also show validation pass/fail badge + checks list.
- **Match on `file_id`** (the workflow's unique per-document key) — never by
  index or filename.

---

## 6. Result → card mapping

All three stages return the SAME per-file shape under `result.documents[]`
(keyed by `file_id`); later stages just add more fields. `usePamPolling`
normalizes into `DocCard[]`:

| Stage | Runner returns (each item in `documents[]`) | Card shows |
|---|---|---|
| classification | `{file_id, name, classification{code,title,confidence,reason}}` (+ `summary` counts) | code, title, confidence, reason |
| extraction | `+ extracted\|null, error?` | + fields table / error |
| e2e | `+ extracted, validation, error?` | + validation badge + checks |

---

## 7. Reuse vs. new

- **Reuse from payroll:** dropzone, `formData` POST, polling loop skeleton,
  API-key input, "Tải HTML" export, `modern-card` / `glow` / `text-gradient`
  styling.
- **New:** ModeStageBar, the fan-out DocumentCard grid, per-file status mapping,
  SummaryStrip.

---

## 8. Build order (when approved)

1. ✅ Verified: `metadata` is a declared parameter in the `payment-account-management`
   registry entry, so it flows request → `pipeline[0].variables` → `pipelineVars.metadata`
   → `parseMetadata`. Poll result lands at `opData.result.extracted_data`
   (envelope `{request_id, skill_code, status, metadata, result}`); mode payload at
   `.result` inside that. State enum is `SUCCEEDED` / `FAILED`.
2. `types.ts` — Mode, Stage, DocStatus, DocCard.
3. `usePamPolling.ts` — submit + poll + normalize result → `DocCard[]`.
4. `DocumentCard.tsx` + `ExtractedFields.tsx`.
5. `ModeStageBar.tsx`, `SummaryStrip.tsx`.
6. `page.tsx` — wire it together.
7. Manual test: upload a mixed dossier, run each stage, verify per-file cards.
