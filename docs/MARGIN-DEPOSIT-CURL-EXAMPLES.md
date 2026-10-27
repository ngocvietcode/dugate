# Margin Deposit Profile â€” cURL máº«u (import Postman)

Endpoint chung cho cáº£ 4 mode: `POST /api/v1/docs/workflows` (hoáº·c `/api/v2/docs/workflows`), `process=margin-deposit`. Mode chá»n qua `metadata.mode` â€” khÃ´ng cÃ³ mode `e2e`, `mode` lÃ  **báº¯t buá»™c**.

**CÃ¡ch import Postman:** má»Ÿ Postman â†’ File â†’ Import â†’ Raw text â†’ dÃ¡n tá»«ng block `curl` dÆ°á»›i Ä‘Ã¢y. Äá»•i `YOUR_API_KEY` vÃ  Ä‘Æ°á»ng dáº«n file máº«u (`@./sample1.pdf`...) cho Ä‘Ãºng mÃ¡y báº¡n trÆ°á»›c khi gá»­i.

**Header dÃ¹ng chung:**
- `x-api-key`: API key cá»§a Profile Ä‘Ã£ Ä‘Æ°á»£c cáº¥p quyá»n endpoint `workflows:margin-deposit`.
- `x-correlation-id` (khuyáº¿n nghá»‹): Ä‘á»ƒ tra váº¿t log/Operation.

Response luÃ´n lÃ  `202` kÃ¨m `X-Operation-ID` â€” poll káº¿t quáº£ qua `GET /api/v1/operations/{id}`.

---

## 1. Mode `classify`

KhÃ´ng cáº§n `doc_type`. Cho phÃ©p 1 file chá»©a nhiá»u chá»©ng tá»« (multi-doc-per-file) â€” output tráº£ `page_range` Ä‘á»ƒ báº¡n tá»± cáº¯t file trÆ°á»›c khi gá»i cÃ¡c mode khÃ¡c.

```bash
curl -X POST http://localhost:2023/api/v1/docs/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -H "x-correlation-id: margin-classify-001" \
  -F "process=margin-deposit" \
  -F 'metadata={"mode":"classify"}' \
  -F "files[]=@./sample-ho-so-1.pdf" \
  -F "files[]=@./sample-ho-so-2.pdf" \
  -F "webhook_url=https://your-app.example.com/callbacks/margin-classify"
```

**Response (poll `GET /operations/{id}`) â€” rÃºt gá»n:**

```jsonc
{
  "extracted_data": {
    "mode": "classify",
    "result": {
      "documents": [
        { "file_id": "input-001::sample-ho-so-1.pdf", "name": "sample-ho-so-1.pdf", "code": "thoa_thuan_ky_quy", "title": "Thá»a thuáº­n kÃ½ quá»¹", "confidence": 0.98, "page_range": "1-5", "document_id": "input-001::sample-ho-so-1.pdf::doc-001" },
        { "file_id": "input-001::sample-ho-so-1.pdf", "name": "sample-ho-so-1.pdf", "code": "cccd", "title": "CÄƒn cÆ°á»›c", "confidence": 0.97, "page_range": "6", "document_id": "input-001::sample-ho-so-1.pdf::doc-002" }
      ],
      "errors": []
    }
  }
}
```

---

## 2. Mode `extraction`

Má»—i file = 1 chá»©ng tá»« Ä‘Æ¡n láº», client Ä‘Ã£ tá»± cáº¯t vÃ  biáº¿t `doc_type`. `files[]` vÃ  `metadata.file_meta[]` pháº£i cÃ¹ng Ä‘á»™ dÃ i, khá»›p theo Ä‘Ãºng thá»© tá»± (index).

```bash
curl -X POST http://localhost:2023/api/v1/docs/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -H "x-correlation-id: margin-extraction-001" \
  -F "process=margin-deposit" \
  -F 'metadata={"mode":"extraction","file_meta":[{"doc_type":"thoa_thuan_ky_quy"},{"doc_type":"cccd"}]}' \
  -F "files[]=@./ttkq-ban-1.pdf" \
  -F "files[]=@./cccd-nguoi-1.pdf" \
  -F "webhook_url=https://your-app.example.com/callbacks/margin-extraction"
```

**Response â€” rÃºt gá»n:**

```jsonc
{
  "extracted_data": {
    "mode": "extraction",
    "result": {
      "documents": [
        {
          "file_id": "input-001::ttkq-ban-1.pdf",
          "name": "ttkq-ban-1.pdf",
          "doc_type": "thoa_thuan_ky_quy",
          "extracted": { "fields": { "unit_code": { "value": "A4-35-09", "confidence": 0.98 }, "escrow_parties": [ { "escrow_full_name": { "value": "NGUYá»„N VÄ‚N AN", "confidence": 0.99 } } ] }, "status": "success" },
          "present_checks": { "pages": [ { "page_id": "1", "main_signature": { "value": "present", "confidence": 0.95, "bbox": [700, 100, 900, 400] } } ], "status": "success" },
          "warning": null,
          "error": null
        }
      ]
    }
  }
}
```

---

## 3. Mode `framework`

Chá»©ng tá»« khÃ¡ch hÃ ng vÃ  chá»©ng tá»« khung náº±m **chung trong `files[]`**, phÃ¢n biá»‡t báº±ng `role` (`customer` máº·c Ä‘á»‹nh, hoáº·c `template`). DUGate tá»± ghÃ©p cáº·p theo `doc_type` trÃ¹ng nhau.

```bash
curl -X POST http://localhost:2023/api/v1/docs/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -H "x-correlation-id: margin-framework-001" \
  -F "process=margin-deposit" \
  -F 'metadata={"mode":"framework","file_meta":[{"doc_type":"thoa_thuan_ky_quy","role":"customer"},{"doc_type":"thoa_thuan_ky_quy","role":"template"}]}' \
  -F "files[]=@./ttkq-khach-hang.pdf" \
  -F "files[]=@./ttkq-khung-mau.pdf" \
  -F "webhook_url=https://your-app.example.com/callbacks/margin-framework"
```

**Response â€” rÃºt gá»n:**

```jsonc
{
  "extracted_data": {
    "mode": "framework",
    "result": {
      "documents": [
        {
          "file_id": "input-001::ttkq-khach-hang.pdf",
          "name": "ttkq-khach-hang.pdf",
          "doc_type": "thoa_thuan_ky_quy",
          "template_check": {
            "clauses_modified": [
              { "clause_id": "Äiá»u 3 - Sá»‘ tiá»n kÃ½ quá»¹", "action": "missing", "template": "Sá»‘ tiá»n kÃ½ quá»¹: 478.000.000 VND", "detail": "KhÃ¡ch hÃ ng thiáº¿u hoÃ n toÃ n má»¥c \"Äiá»u 3 - Sá»‘ tiá»n kÃ½ quá»¹\" cÃ³ trong khung.", "severity": "critical" },
              { "clause_id": "CÄƒn cá»©", "action": "modified", "template": "Bá»™ luáº­t DÃ¢n sá»± 2015", "customer": "Bá»™ luáº­t DÃ¢n sá»± 2005", "detail": "NÄƒm bá»™ luáº­t lá»‡ch: khung ghi 2015, khÃ¡ch hÃ ng ghi 2005.", "severity": "warning" }
            ],
            "verdict": "FAIL",
            "status": "success"
          }
        }
      ]
    }
  }
}
```

> Náº¿u khÃ´ng cÃ³ file `role: template` cÃ¹ng `doc_type`, `template_check.verdict = "WARNING"` vá»›i `error: "FRAMEWORK_MISSING"` â€” khÃ´ng lÃ m fail cáº£ request.
>
> Náº¿u file `role: template` Ä‘Æ°á»£c ghÃ©p cáº·p NHÆ¯NG thá»±c táº¿ KHÃC LOáº I vá»›i chá»©ng tá»« khÃ¡ch hÃ ng (khÃ¡c tiÃªu Ä‘á»/cÄƒn cá»©, vÃ­ dá»¥ khÃ¡ch hÃ ng lÃ  "Thá»a thuáº­n kÃ½ quá»¹" cÃ²n khung lÃ  "BiÃªn báº£n thanh lÃ½"), comparator sáº½ tráº£ `template_check.verdict = "FAIL"` vá»›i `error` báº¯t Ä‘áº§u báº±ng `"DOC_TYPE_MISMATCH:"` vÃ  `clauses_modified: []` â€” khÃ´ng cá»‘ Ä‘á»‘i chiáº¿u tá»«ng Ä‘iá»u khoáº£n. Äiá»u nÃ y cÅ©ng Ã¡p dá»¥ng cho `template_check` trong mode `validation`, vÃ  khiáº¿n `summary.overall_verdict = "FAIL"`.
>
> **NguyÃªn táº¯c placeholder:** khung lÃ  biá»ƒu máº«u trá»‘ng chá»©a cÃ¡c Ã´ Ä‘iá»n (vÃ­ dá»¥ Â«Há»_vÃ _tÃªn_khÃ¡ch_hÃ ngÂ», Â«Sá»‘Â», Â«NgÃ y_cáº¥pÂ», cÃ¡c Ä‘oáº¡n "â€¦â€¦"). Comparator CHá»ˆ so sÃ¡nh pháº§n Cá» Äá»ŠNH (tiÃªu Ä‘á», tÃªn má»¥c/Ä‘iá»u khoáº£n, nhÃ£n trÆ°á»ng, cÃ¢u chá»¯ phÃ¡p lÃ½ in sáºµn) vÃ  Bá»Ž QUA dá»¯ liá»‡u khÃ¡ch hÃ ng Ä‘iá»n vÃ o placeholder. Viá»‡c khÃ¡ch hÃ ng Ä‘iá»n giÃ¡ trá»‹ tháº­t (há» tÃªn, CCCD, ngÃ y, sá»‘ tiá»n...) hay Ä‘á»ƒ trá»‘ng má»™t Ã´ Ä‘iá»n KHÃ”NG bá»‹ coi lÃ  lá»‡ch.
>
> **Chuá»—i máº«u / cÃ´ng thá»©c ghÃ©p giÃ¡ trá»‹:** khi khung mÃ´ táº£ má»™t chuá»—i báº±ng token Ä‘Ã¡nh sá»‘ + kÃ½ tá»± ná»‘i/tá»« khÃ³a (vÃ­ dá»¥ khung: `Ná»™i dung ná»™p tiá»n: [1]_[2]_ky quy_[3]_ALM`), thÃ¬ `[1] [2] [3]`, dáº¥u `_`, vÃ  cÃ¡c máº£nh nhÆ° `ky quy`, `ALM` chá»‰ lÃ  HÆ¯á»šNG DáºªN CÃCH GHÃ‰P giÃ¡ trá»‹ Ä‘iá»n, KHÃ”NG pháº£i ná»™i dung cá»‘ Ä‘á»‹nh. KhÃ¡ch hÃ ng Ä‘iá»n giÃ¡ trá»‹ tháº­t khiáº¿n chuá»—i khÃ¡c hÃ¬nh dáº¡ng máº«u â†’ KHÃ”NG bá»‹ coi lÃ  lá»‡ch. Chá»‰ bÃ¡o lá»‡ch khi NHÃƒN/cÃ¢u chá»¯ cá»‘ Ä‘á»‹nh Ä‘á»©ng ngoÃ i cÃ´ng thá»©c (vÃ­ dá»¥ `Ná»™i dung ná»™p tiá»n:`) bá»‹ Ä‘á»•i/thiáº¿u.
>
> **Danh sÃ¡ch / khá»‘i láº·p máº«u (sá»‘ lÆ°á»£ng khÃ´ng cá»‘ Ä‘á»‹nh):** khi khung liá»‡t kÃª nhiá»u má»¥c cÃ¹ng kiá»ƒu theo sá»‘ thá»© tá»± (vÃ­ dá»¥ `Äá»£t 1 / Äá»£t 2 / Äá»£t 3`, danh sÃ¡ch bÃªn, cÃ¡c dÃ²ng láº·p), Sá» LÆ¯á»¢NG pháº§n tá»­ trong khung chá»‰ lÃ  máº«u minh há»a. Sá»‘ Ä‘á»£t/sá»‘ dÃ²ng thá»±c táº¿ do dá»¯ liá»‡u tá»«ng há»“ sÆ¡ quyáº¿t Ä‘á»‹nh â€” khÃ¡ch hÃ ng cÃ³ Ã­t hÆ¡n hoáº·c nhiá»u hÆ¡n Ä‘á»u há»£p lá»‡, KHÃ”NG bá»‹ coi lÃ  "thiáº¿u Äá»£t N". Chá»‰ bÃ¡o lá»‡ch khi nhÃ£n cá»‘ Ä‘á»‹nh cá»§a cáº£ khá»‘i bá»‹ Ä‘á»•i/thiáº¿u.
>
> **Kiá»ƒm tra bao phá»§ Ä‘áº§y Ä‘á»§ theo khung:** khi cÃ¹ng loáº¡i, comparator duyá»‡t láº§n lÆ°á»£t Tá»ªNG má»¥c tiÃªu Ä‘á»/ná»™i dung Cá» Äá»ŠNH cá»§a khung vÃ  Ä‘á»‘i chiáº¿u vá»›i file khÃ¡ch hÃ ng. Má»—i pháº§n tá»­ trong `clauses_modified[]` chá»‰ Ä‘Ã­ch danh má»™t vá»‹ trÃ­ lá»‡ch cá»§a pháº§n cá»‘ Ä‘á»‹nh:
> - `action: "missing"` â€” khÃ¡ch hÃ ng thiáº¿u háº³n má»™t má»¥c/tiÃªu Ä‘á»/ná»™i dung báº¯t buá»™c cÃ³ trong khung.
> - `action: "modified"` â€” má»¥c cÃ³ nhÆ°ng ná»™i dung lá»‡ch (sai chá»¯/sá»‘/ngÃ y/sá»‘ tiá»n), kÃ¨m `template` (ná»™i dung khung), `customer` (ná»™i dung khÃ¡ch hÃ ng).
> - `action: "added"` â€” khÃ¡ch hÃ ng cÃ³ má»¥c thá»«a khÃ´ng cÃ³ trong khung.
> - `detail` â€” message cá»¥ thá»ƒ mÃ´ táº£ chÃ­nh xÃ¡c chá»— lá»‡ch (báº¯t buá»™c cho má»—i entry).
>
> `verdict = "FAIL"` khi cÃ³ báº¥t ká»³ má»¥c `missing` hoáº·c `modified` báº¯t buá»™c (severity `critical`); `WARNING` vá»›i khÃ¡c biá»‡t nhá»; `PASS` chá»‰ khi khÃ¡ch hÃ ng bao phá»§ Ä‘áº§y Ä‘á»§ vÃ  khá»›p toÃ n bá»™ má»¥c cá»§a khung.

---

## 4. Mode `validation`

Phá»©c táº¡p nháº¥t â€” cháº¡y song song 2 viá»‡c: **copy-check** (Ä‘á»‘i chiáº¿u N báº£n sao cÃ¹ng `doc_type` + `group_id`, N â‰¥ 3, dÃ¹ng AI so sÃ¡nh toÃ n vÄƒn) vÃ  **template-check** (giá»‘ng `framework`, dÃ¹ng file `role: template`).

- `group_id` **báº¯t buá»™c** khi `doc_type` lÃ  `thoa_thuan_ky_quy` hoáº·c `thanh_ly_ky_quy`.
- File khÃ´ng thuá»™c 2 loáº¡i trÃªn khÃ´ng cáº§n `group_id`, sáº½ Ä‘Æ°á»£c bá» qua copy-check (kÃ¨m `warning`, khÃ´ng lá»—i).

```bash
curl -X POST http://localhost:2023/api/v1/docs/workflows \
  -H "x-api-key: YOUR_API_KEY" \
  -H "x-correlation-id: margin-validation-001" \
  -F "process=margin-deposit" \
  -F 'metadata={"mode":"validation","file_meta":[{"doc_type":"thoa_thuan_ky_quy","role":"customer","group_id":"bo-ho-so-001"},{"doc_type":"thoa_thuan_ky_quy","role":"customer","group_id":"bo-ho-so-001"},{"doc_type":"thoa_thuan_ky_quy","role":"customer","group_id":"bo-ho-so-001"},{"doc_type":"thoa_thuan_ky_quy","role":"template"}]}' \
  -F "files[]=@./ttkq-ban-1.pdf" \
  -F "files[]=@./ttkq-ban-2.pdf" \
  -F "files[]=@./ttkq-ban-3.pdf" \
  -F "files[]=@./ttkq-khung-mau.pdf" \
  -F "webhook_url=https://your-app.example.com/callbacks/margin-validation"
```

**Response â€” rÃºt gá»n:**

```jsonc
{
  "extracted_data": {
    "mode": "validation",
    "result": {
      "documents": [
        {
          "file_id": "input-001::ttkq-ban-1.pdf",
          "name": "ttkq-ban-1.pdf",
          "doc_type": "thoa_thuan_ky_quy",
          "group_id": "bo-ho-so-001",
          "template_check": { "clauses_modified": [], "verdict": "PASS", "status": "success" },
          "warning": null,
          "error": null
        }
      ],
      "copy_checks": [
        {
          "doc_type": "thoa_thuan_ky_quy",
          "group_id": "bo-ho-so-001",
          "copies_found": 3,
          "file_ids": ["input-001::ttkq-ban-1.pdf", "input-002::ttkq-ban-2.pdf", "input-003::ttkq-ban-3.pdf"],
          "differences": [],
          "verdict": "MATCH",
          "status": "success"
        }
      ],
      "summary": { "overall_verdict": "PASS" }
    }
  }
}
```

**VÃ­ dá»¥ khi thiáº¿u báº£n (< 3 file cÃ¹ng group_id):**

```jsonc
{
  "copy_checks": [
    {
      "doc_type": "thoa_thuan_ky_quy",
      "group_id": "bo-ho-so-001",
      "copies_found": 2,
      "differences": [],
      "verdict": "COMPARISON_SKIPPED",
      "error_code": "INSUFFICIENT_COPIES",
      "status": "success"
    }
  ],
  "summary": { "overall_verdict": "WARNING" }
}
```

**VÃ­ dá»¥ khi cÃ¡c báº£n khÃ¡c nhau (MISMATCH â†’ overall_verdict luÃ´n FAIL, khÃ´ng xÃ©t severity):**

```jsonc
{
  "copy_checks": [
    {
      "doc_type": "thoa_thuan_ky_quy",
      "group_id": "bo-ho-so-001",
      "copies_found": 3,
      "differences": [
        {
          "location": "Äiá»u 3 - Sá»‘ tiá»n kÃ½ quá»¹",
          "description": "Báº£n 1 ghi 478.000.000, báº£n 3 ghi 478.500.000",
          "file_refs": ["input-001::ttkq-ban-1.pdf", "input-003::ttkq-ban-3.pdf"],
          "severity": "critical"
        }
      ],
      "verdict": "MISMATCH",
      "status": "success"
    }
  ],
  "summary": { "overall_verdict": "FAIL" }
}
```

---

## Báº£ng tra nhanh `file_meta` theo mode

| Mode | Cáº§n `file_meta`? | `doc_type` | `role` | `group_id` |
|---|---|---|---|---|
| `classify` | KhÃ´ng | KhÃ´ng cáº§n | KhÃ´ng dÃ¹ng | KhÃ´ng dÃ¹ng |
| `extraction` | CÃ³, báº¯t buá»™c | Báº¯t buá»™c má»—i file | KhÃ´ng dÃ¹ng | KhÃ´ng dÃ¹ng |
| `framework` | CÃ³, báº¯t buá»™c | Báº¯t buá»™c má»—i file | `customer` (máº·c Ä‘á»‹nh) / `template` | KhÃ´ng dÃ¹ng |
| `validation` | CÃ³, báº¯t buá»™c | Báº¯t buá»™c má»—i file | `customer` (máº·c Ä‘á»‹nh) / `template` | Báº¯t buá»™c khi `role=customer` vÃ  `doc_type` âˆˆ {`thoa_thuan_ky_quy`, `thanh_ly_ky_quy`} |

**Danh sÃ¡ch `doc_type` há»£p lá»‡:** `thoa_thuan_ky_quy`, `thanh_ly_ky_quy`, `dang_ky_nguyen_vong`, `cccd`, `ho_chieu`, `thoa_thuan_chuyen_nhuong`, `don_tra_soat`.

**Lá»—i thÆ°á»ng gáº·p:**
- `files.length` khÃ¡c `file_meta.length` â†’ `400 INVALID_INPUT`, khÃ´ng xá»­ lÃ½ file nÃ o.
- `doc_type` khÃ´ng thuá»™c 7 mÃ£ trÃªn â†’ `400 INVALID_INPUT`.
- `role` khÃ¡c `customer`/`template` â†’ `400 INVALID_INPUT`.
- Thiáº¿u `group_id` khi cáº§n (validation, TTKQ/BBTL) â†’ `400 INVALID_INPUT`.
