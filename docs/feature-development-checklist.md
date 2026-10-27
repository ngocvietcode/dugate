# Checklist xây dựng chức năng mới (Workflow / Endpoint / Tính năng AI)

> Mục đích: MỖI khi thêm một chức năng mới (workflow, endpoint, hoặc tính năng gọi LLM
> tương tác), phải đi ĐỦ các bước dưới đây. **Tuyệt đối không bỏ qua phần Prompt Override
> và Parameter cấu hình qua Profile** — đây là 2 phần hay bị quên nhất.

Áp dụng cho repo này (Next.js + pipeline connector `ext-*` + ProfileEndpoint). Tham chiếu
mẫu: `lib/pipelines/workflows/statement-analyze.ts`, `.../prompts/statement-analyze-prompts.ts`,
`app/api/statement-analyze/ask/route.ts`, `lib/endpoints/registry.ts`.

---

## 0. Nguyên tắc cốt lõi (đọc trước khi code)

- **Mọi lời gọi LLM đều phải có prompt CẤU HÌNH ĐƯỢC bởi admin** — không hardcode prompt
  ở dạng cố định không thể override.
- **Mọi tham số vận hành phải khai báo và tài liệu hoá** trong registry, đọc từ Profile.
- **Không bịa số liệu tài chính**; prompt phải có ràng buộc grounding.
- **Verify được**: typecheck + test hàm thuần + không để lại file tạm.
- **Bảo mật: đọc [SECURITY-RULES.md](SECURITY-RULES.md) TRƯỚC KHI** viết route API mới hoặc
  chạm tới secret/credential/token/file upload. 11 quy tắc trong đó đều sinh ra từ lỗ hổng
  thật đã có trong repo này, kèm `file:dòng` của lỗi gốc. **Fortify quét sạch không có nghĩa
  là an toàn** — 6 lỗ hổng nặng nhất của đợt 18/09 không có finding nào.

---

## 1. Backend — Prompt (KHÔNG BỎ QUA)

Với **từng bước** có gọi LLM:

- [ ] Viết **prompt builder** trong `lib/pipelines/workflows/prompts/<feature>-prompts.ts`.
- [ ] Builder **luôn nhận `promptOverride?`** và dùng nó nếu có; nếu không → template mặc định trong code.
- [ ] Nếu override cần biến động → dùng `interpolatePrompt(template, vars)` với placeholder `{{...}}` và **tài liệu hoá danh sách placeholder**.
- [ ] Prompt mặc định có: role rõ ràng, ràng buộc grounding (chỉ dùng dữ liệu cung cấp, không bịa), định dạng output rõ (JSON schema nếu cần), và các quy tắc số/định dạng đặc thù.
- [ ] Khi gọi: truyền `ctx.promptOverrides.<step>` vào builder. **Mỗi bước = 1 step key riêng**, đặt tên nhất quán (vd `ocr`, `classify`, `extract`, `report`, `statement_qa`, `statement_risk`).

```ts
// Mẫu gọi trong workflow:
const promptVars = buildXxxPrompt(args, ctx.promptOverrides.myStep);
const result = await enqueueSubStep(
  ctx, 'ext-<connector>', promptVars, filesJson,
  ctx.modelOverrides.myStep,            // model override theo bước
  ctx.reasoningEffortOverrides.myStep,  // reasoning_effort override theo bước
);
```

---

## 2. Backend — Parameter & cấu hình qua Profile (KHÔNG BỎ QUA)

- [ ] Đăng ký handler trong `WORKFLOW_REGISTRY` (`lib/pipelines/workflow-engine.ts`).
- [ ] Đăng ký subcase trong `SERVICE_REGISTRY.workflows.subCases` (`lib/endpoints/registry.ts`) với:
  - [ ] `displayName`, `description` (nêu rõ input/output).
  - [ ] `parameters`: khai báo TẤT CẢ tham số request-time (kiểu, mô tả, options, default, `defaultLocked` nếu cần).
  - [ ] `isWorkflow: true`, `connections: []`.
- [ ] **Tài liệu hoá các step prompt** trong `description`: liệt kê tên step dùng cho
      `_workflowPrompts` / `_workflowModels` và placeholder (nếu có).
- [ ] Đọc tham số từ `ctx.pipelineVars` (kẹp/validate giá trị; có default an toàn).
- [ ] Nếu giới hạn định dạng file → thêm vào map allowed extensions (vd `'workflows:<name>': [...]`).

Admin cấu hình tại **ProfileEndpoint** (`profileEndpoints.parameters`, JSON):
- `_workflowPrompts.value.<step>` = prompt override.
- `_workflowModels.value.<step>` = model override.
- `_workflowReasoning.value.<step>` = reasoning_effort override (nếu dùng).
- Các key param khác = giá trị + `isLocked`.

> Kiểm tra chéo: `ctx.promptOverrides`, `ctx.modelOverrides`, `ctx.reasoningEffortOverrides`
> được nạp trong `createWorkflowContext` từ `_workflowPrompts/_workflowModels/_workflowReasoning`.
> Nếu thêm step mới mà quên đọc override → admin không chỉnh được ⇒ **lỗi thường gặp, phải tránh**.

---

## 3. Backend — Gọi connector (chuẩn hoá)

- [ ] Workflow (chạy nền): dùng `enqueueSubStep(ctx, slug, promptVars, filesJson, model, reasoning)`.
- [ ] Tính năng **tương tác/đồng bộ** (vd Q&A sau phân tích): dùng `runConnectorPrompt(slug, prompt, { model, correlationId })` (`lib/pipelines/run-connector-prompt.ts`) — nạp connection từ DB, không qua queue.
- [ ] Chọn đúng connector trong 5 endpoint nguyên thủy: `extract` (`ext-data-extractor`), `analyze` (`ext-classifier`/`ext-quality-eval`/...), `transform`, `generate` (`ext-content-gen`), `compare` (`ext-comparator`). OCR/layout dùng `ext-doc-layout`.
- [ ] `_prompt` bỏ qua template DB (ưu tiên cao nhất). Nếu muốn admin override tầng connector/profile thay vì code, cân nhắc KHÔNG đặt `_prompt` mà truyền biến interpolation.

---

## 4. Tính năng LLM tương tác (post-processing, vd Q&A / đánh giá)

- [ ] Tạo API route dưới `app/api/<feature>/.../route.ts`, `export const dynamic = 'force-dynamic'`.
- [ ] Auth: `resolveCallerIdentity(req)` → yêu cầu `apiKeyId || userId`; enforce ownership nếu đọc theo `operationId`.
- [ ] **Prompt override từ Profile**: resolve theo `apiKeyId` + `endpointSlug` (vd `workflows:<name>`) + step key (mẫu: `lib/pipelines/statement-ask-config.ts`). Truyền vào prompt builder.
- [ ] **Model override từ Profile**: đọc `_workflowModels.value.<step>` và truyền vào lời gọi connector.
- [ ] **Giảm token**: gửi dữ liệu dạng gọn (CSV thay JSON, **bỏ cột toàn null**), kèm số liệu đã tính sẵn; cap kích thước payload; báo khi bị cắt.
- [ ] Frontend truyền `apiKey` (X-API-Key) xuống component gọi route để resolve đúng Profile.
- [ ] Trả lỗi rõ ràng khi connector chưa cấu hình/ENABLED (503) vs lỗi nội bộ (500).

---

## 5. Frontend

- [ ] Submit qua API chuẩn (`/api/v1/docs/workflows` với `process=<name>`), poll `/api/v1/operations/{id}`, đọc `result.extracted_data`.
- [ ] Render kết quả; thêm tab/panel mới trong component kết quả nếu cần.
- [ ] Cảnh báo/hiển thị các trường quan trọng (warnings, nguồn dữ liệu ước tính...) — không giấu.
- [ ] Truyền `apiKey`/`operationId` xuống các panel gọi LLM tương tác.

---

## 5b. Bảo mật (bắt buộc — xem [SECURITY-RULES.md](SECURITY-RULES.md) để biết lý do từng mục)

- [ ] Route mới: `GET` chỉ đọc; mọi thứ đổi state là `POST`. Auth guard **không** làm cho một
      `GET` huỷ diệt trở nên an toàn (`SameSite=Lax` vẫn gửi cookie session khi điều hướng GET).
- [ ] Response **không** chứa secret đã giải mã. Trả `present: boolean` hoặc bản mask.
- [ ] Mọi guard đều có bản ở **server**. Server bỏ qua field nào thì response phải nói rõ,
      không trả `success` trơn.
- [ ] Credential không vào `localStorage` (dùng `sessionStorage`, hoặc không lưu ở client).
- [ ] Secret ghi DB qua `encrypt()` của `lib/crypto`, không `JSON.stringify` thẳng vào cột text.
- [ ] Không set `NODE_TLS_REJECT_UNAUTHORIZED=0` ở bất kỳ đâu.
- [ ] Biến/prop/component không chứa secret thì **đừng** đặt tên có `Secret`/`Password`/`Token`
      (tránh 34 finding giả như đợt 18/09). Ngược lại, **đừng đổi** tên đã bị khoá bởi cột DB
      hoặc surface `/api/v1`.
- [ ] Nếu đang sửa một lỗi bảo mật: đã để lại comment `[SEC <ngày quét> <mã việc>]` nêu rõ
      cơ chế tấn công.
- [ ] **Không có credential thật** trong bất kỳ file nào của diff — kể cả `tests/`, `scripts/`,
      ví dụ cURL trong `docs/`. Đã chạy 2 lệnh `git grep` ở SECURITY-RULES.md §10 trên **cả repo**.
- [ ] Server gọi ra URL cấu hình được mà kèm credential → `ssrfSafeFetch` **và**
      `signal: AbortSignal.timeout(ms)` (wrapper không tự có timeout).
- [ ] Tính năng không còn ai dùng mà vẫn mang credential → xoá hẳn, không để "phòng khi cần".

---

## 6. Verify (bắt buộc trước khi báo hoàn thành)

- [ ] `npx tsc --noEmit -p tsconfig.json` → **0 lỗi** ở các file đã đụng.
      (Trên Windows `npx` có thể bị chặn bởi execution policy → dùng
      `node node_modules/typescript/bin/tsc --noEmit`.)
- [ ] Viết test cho hàm THUẦN (parse, CSV, tính toán, phát hiện...) trong `tests/`, chạy `npx jest <file>` → pass.
- [ ] **Xoá mọi file tạm** (test tạm, output tsc/jest).
- [ ] Cập nhật `docs/` và `registry` mô tả nếu hành vi/tham số thay đổi.
- [ ] Rà lại: mỗi bước LLM đã có prompt override? mỗi param đã khai báo + tài liệu? model/reasoning override đã nối?

---

## 7. Definition of Done

Một chức năng mới CHỈ được coi là xong khi:
1. Prompt của **mọi bước** admin cấu hình được qua Profile (`_workflowPrompts`), có default hợp lý.
2. Model/reasoning của **mọi bước** override được qua Profile.
3. **Tất cả parameter** đã khai báo trong registry + tài liệu hoá + đọc/validate trong code.
4. Prompt có ràng buộc grounding (không bịa), định dạng output rõ.
5. Typecheck sạch, test hàm thuần pass, không còn file tạm.
6. Tài liệu (mô tả registry / docs) đã cập nhật.
7. **Đã đi hết checklist §5b và đối chiếu với [SECURITY-RULES.md](SECURITY-RULES.md).**

> Ghi nhớ: **bỏ qua Prompt Override hoặc Parameter là thiếu sót nghiêm trọng** — chức năng
> sẽ không cấu hình lại được khi vận hành, phải làm lại. Luôn kiểm mục 1 và 2.
