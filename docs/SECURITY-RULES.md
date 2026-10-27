# Quy tắc bảo mật khi phát triển trên DUGate

> **Bắt buộc đọc trước khi** viết/sửa bất kỳ file nào dưới `app/api/**/route.ts`, hoặc bất kỳ
> code nào chạm tới secret, credential, mật khẩu, khoá, token, session, hay file upload.
>
> Mọi quy tắc dưới đây sinh ra từ **lỗi thật đã xảy ra trong repo này**, không phải OWASP
> chung chung. Mỗi mục đều dẫn `file:dòng` của lỗi gốc để đối chiếu.
>
> Bối cảnh: đợt quét Fortify SAST 18/09/2026 ra 177 finding. Nhưng **9 lỗ hổng nghiêm trọng
> nhất lại là những lỗi Fortify KHÔNG bắt được** — tìm ra bằng đọc code. Nặng nhất trong đó là
> credential thật nằm trong repo 5 tháng (§10). Nghĩa là:
> **quét sạch không có nghĩa là an toàn.** Checklist này mới là lưới an toàn, không phải scanner.

---

## 0. Ba điều rút ra từ đợt quét 18/09

1. **Scanner bỏ sót lỗi thật.** 9/9 lỗ hổng nặng nhất đợt đó không có finding nào — kể cả
   secret hardcode, loại lỗi scanner được thiết kế để bắt. Đừng coi "Fortify pass" là điều kiện đủ.
2. **Scanner báo sai rất nhiều.** 110/177 finding là dương tính giả, riêng 34 cái chỉ vì
   **tên biến**. Đặt tên sai khiến cả đợt triage tốn nhiều ngày. Xem §7.
3. **Comment `[SEC <ngày> <mã>]` là bắt buộc** khi sửa lỗi bảo mật. Xem §8.

---

## 1. Route API không bao giờ trả secret đã giải mã về browser

**Lỗi gốc:** `app/api/internal/profile-endpoints/route.ts:85-96, 140` (tại `3ec1a70`) — GET giải mã
`fileUrlAuthConfig` rồi trả **nguyên văn** `client_secret`, `token`, `header_value` xuống UI.
Ai có quyền `endpoint:manage` mở DevTools là đọc được toàn bộ credential đối tác.
Đã đóng ở commit `2f9cab5` bằng cách **bỏ hẳn** tầng override đó.

- [ ] Mọi response GET/LIST **không** chứa giá trị secret. Chỉ trả: `present: boolean`,
      `type`, và bản mask (`maskApiKey()`).
- [ ] Muốn UI biết "đã có secret rồi" thì trả **boolean**, không trả giá trị.
- [ ] PUT/PATCH không yêu cầu client gửi lại secret cũ. Server tự merge — mẫu:
      `mergeAuthConfigPreservingSecrets` (`app/api/internal/apikeys/route.ts:131, 391, 408`).
- [ ] Không log secret. Kể cả `console.warn` lúc debug. Lỗi thật:
      `lib/profiles/integration-config.ts:330` (tại commit `3ec1a70`) từng in cả object draft ra
      log; giờ chỉ in `Object.keys()`.
- [ ] Không log **giá trị người gọi gửi lên** khi xác thực thất bại. Một lần gõ gần đúng (sai
      hoa/thường, thừa khoảng trắng) là gần như cả key nằm trong log. Log nguồn + độ dài là đủ
      debug — mẫu: `mock-service/server.js:56-58`.

> **Tự kiểm:** grep response của route mới cho `client_secret`, `token`, `secret`, `password`,
> `authSecret`. Nếu có giá trị thật đi ra ngoài → sai.

---

## 2. Thao tác đổi state phải là POST, không được là GET

**Lỗi gốc, hai chỗ:**
- `app/api/internal/dev-sync-endpoints/route.ts` — `GET` chạy `db.delete(profileEndpoints)`
  **xoá trắng cả bảng**.
- `app/api/cleanup/route.ts` — `GET` xoá file hết hạn.

Cả hai đều có `requireAdmin()`, và **vẫn không an toàn**. Lý do: cookie `session_token` của
NextAuth là `SameSite=Lax` (`node_modules/next-auth/core/lib/cookie.js:18-27`), mà Lax **vẫn
gắn cookie vào điều hướng GET top-level**. Chỉ cần dụ một ADMIN bấm vào link là bảng bị xoá.
POST không được gửi cross-site dưới Lax. Đã đóng ở `bc9786f`.

- [ ] `export async function GET` chỉ được **đọc**. Không `db.delete`, `db.insert`,
      `db.update`, không xoá file, không gọi API bên ngoài gây thay đổi.
- [ ] Mọi thứ đổi state → `POST` (hoặc PUT/PATCH/DELETE).
- [ ] Auth guard **không thay thế** được việc chọn đúng method. Phải có cả hai.
- [ ] Route huỷ diệt dành cho dev → chặn thêm bằng env, mẫu:
      `app/api/internal/dev-sync-endpoints/route.ts:14-16` (`NODE_ENV === 'production' && ALLOW_DEV_SYNC !== 'true'` → 403).

---

## 3. Guard ở client không phải là guard. Và không được báo thành công khi đã bỏ qua

**Lỗi gốc:** form Settings. GET trả secret đã mask; client có logic "field còn `****` thì
đừng gửi". Hai vấn đề:
- Guard đó **chỉ có ở client** → gọi PUT trực tiếp là ghi chuỗi mask `****` đè lên secret thật.
- Khi client tự bỏ qua field, UI vẫn **báo lưu thành công** → người vận hành tưởng đã đổi
  secret, thực tế không. Đây là kiểu lỗi tệ nhất: im lặng.

Đã đóng ở `5e3c44c`. Guard giờ ở server: `app/api/settings/route.ts:76-79` so sánh với mask
của **giá trị đang lưu**, không so với `''`.

- [ ] Mọi validate/guard phải có bản **ở server**. Bản ở client chỉ để UX.
- [ ] Nếu server bỏ qua một phần payload → response phải **nói rõ field nào bị bỏ qua**,
      không trả `success` trơn.
- [ ] Field nửa vời (còn `****` nhưng khác mask) → **từ chối kèm lý do**, đừng đoán ý.

---

## 4. Credential không bao giờ vào `localStorage`

**Lỗi gốc:** `app/payment-account-management/page.tsx:61` và
`components/ServiceTestClient.tsx:470` (cả hai tại `3ec1a70`) lưu API key `/api/v1` vào `localStorage`. Key đó có
thể mang role ADMIN, mà `localStorage` **sống qua cả sign-out và mọi tab**. Đã đóng ở `737a848`.

- [ ] Credential (API key, token, secret) → `sessionStorage` là mức tối thiểu; tốt hơn là
      không lưu ở client chút nào.
- [ ] Dữ liệu nghiệp vụ (`LS_BANK_DATA`…) ở `localStorage` thì không sao — phân biệt rõ hai loại.
- [ ] Không đặt credential vào URL, query string, hay `<input type="text">`.

---

## 5. Secret phải được mã hoá at-rest

**Lỗi gốc — VẪN ĐANG MỞ, ưu tiên P1:** `csp_client_secret` nằm **nguyên văn** trong cột
`ProfileEndpoint.parameters`. Cột đó là `text('parameters')` (`lib/db/schema.ts:225`), được
ghi bằng `JSON.stringify` thẳng (`app/api/internal/profile-endpoints/route.ts:384`), và trả
raw ở `:127` cho mọi user có `endpoint:manage`. Ai đọc được DB hoặc bản backup là có secret.
Chưa đóng được vì banner migration CSP (`app/profiles/page.tsx:1653-1672`) còn cần đọc nó.

- [ ] Secret ghi xuống DB phải qua `encrypt()` (AES-256-GCM, `lib/crypto`). Không
      `JSON.stringify` trực tiếp.
- [ ] Đọc lên dùng `decrypt()`, có nhánh fallback cho dữ liệu plaintext cũ — mẫu:
      `parseStoredFileUrlAuthConfig` (`lib/endpoints/profile-resolver.ts`).
- [ ] Thêm cột mới chứa secret → ghi vào `docs/` là cột đó được mã hoá, để lần sau không ai
      tưởng là plaintext.
- [ ] Không hardcode khoá/mật khẩu trong code. Khoá lấy từ env hoặc Vault
      (`lib/crypto/key-resolver.ts`). Đây chính là rule nhóm A phải sửa ở
      `app/api/internal/crypto/decrypt/route.ts:14`.

---

## 6. Không bao giờ tắt kiểm TLS

**Bối cảnh:** `mock-service` chạy HTTPS với cert self-signed (`4287b39`). Cách đúng là **thêm**
cert đó làm CA tin cậy: `NODE_EXTRA_CA_CERTS=/certs/mock-service.crt`
(`docker-compose.yml:25, 123`).

- [ ] **Tuyệt đối không** set `NODE_TLS_REJECT_UNAUTHORIZED=0`. Nó tắt kiểm chứng cho **mọi**
      upstream của cả process, không riêng cái đang cần — biến một tiện lợi lúc dev thành lỗ
      hổng thật. Cảnh báo này đã ghi ở `docker-compose.yml:22-24`.
- [ ] Cần tin một cert riêng → thêm CA, không hạ mức kiểm tra.
- [ ] Không commit private key. `mock-service/.gitignore` chặn `certs/ *.key *.crt *.pem`;
      cert sinh lúc container start, không `RUN` trong Dockerfile (nếu `RUN` thì key bị nướng
      vào layer image = vẫn là khoá hardcode).

---

## 7. Đừng đặt tên biến không-phải-secret là `*Secret*`

**Đây là quy tắc đặc thù của dự án này, không sách nào dạy, và nó tốn của chúng ta nhiều ngày nhất.**

Rule Privacy Violation của Fortify bắt theo **tên định danh**. Nó đã sinh **34 finding Critical**
cho những thứ hoàn toàn không phải secret:

| Bị bắt | Thực chất là gì |
|---|---|
| `SecretField` | một React **component** (tức một function) |
| `onSecretRefChange` | một **callback** |
| `missingSecretItems.length` | một **con số** — chính Fortify gắn nhãn `NUMBER, PRIVATE` 17 lần |
| `EMPTY_FORM.authSecret` | hằng **chuỗi rỗng** |
| `secretRef` | một **đường dẫn Vault**, không phải secret nó trỏ tới |

Đã sửa ở `d900ccc` bằng cách đổi tên: `SecretField`→`CredentialField`,
`secretRef`→`vaultPath`, `missingSecretItems`→`itemsNeedingInput`,
`fileAuthSecret`→`fileAuthInput`.

- [ ] Biến/prop/component **không chứa giá trị secret** thì đừng đặt tên có `Secret`, `Password`,
      `Token`, `Credential`. Gọi đúng bản chất: `vaultPath`, `CredentialField`, `itemsNeedingInput`.
- [ ] Đây **không phải** né scanner — đặt tên sai bản chất là lỗi diễn đạt. Sửa tên là sửa đúng.
- [ ] **Ngược lại: KHÔNG đổi tên** những định danh đã bị khoá bởi cột DB, surface công khai
      `/api/v1`, hay schema bundle: `authSecret`, `vaultSecretPath`, `token`, `client_secret`,
      `header_value`, `query_value`, `*_secret_ref`, `inlineSecret`, `s3_secret_key`. Đổi là vỡ
      dữ liệu hoặc vỡ hợp đồng API.

---

## 8. Sửa lỗi bảo mật thì phải để lại dấu

Repo đang dùng convention này, giữ cho nhất quán — nó là cách người sau hiểu **vì sao** code
trông "lạ" và không vô tình hoàn nguyên.

```ts
// [SEC 18/09 P0.3] POST, not GET. A NextAuth `session_token` is SameSite=Lax
// (node_modules/next-auth/core/lib/cookie.js:18-27), and Lax still attaches the
// cookie to a top-level GET navigation — so a GET handler that wipes a whole
// table is reachable cross-site. POST is not sent cross-site under Lax.
```

- [ ] Format: `[SEC <ngày quét> <mã việc>]` + **cơ chế tấn công**, không chỉ ghi "security fix".
- [ ] Dẫn bằng chứng (`file:dòng`, cả trong `node_modules` nếu cần) để người sau kiểm lại được.
- [ ] Dẫn `file:dòng` thì **lấy từ output có số dòng thật** (`git grep -n`, `grep -n`), không
      đếm bằng mắt. Tham chiếu tới code đã bị sửa thì ghi kèm commit (`… tại 3ec1a70`) vì số dòng
      trôi sau mỗi commit. Đợt 18/09 cùng một số dòng đã sai 3 lượt liên tiếp vì đếm tay.
- [ ] Đang dùng ở: `app/api/cleanup/route.ts:9`, `app/api/internal/dev-sync-endpoints/route.ts:7`,
      `app/api/settings/route.ts:14, 76`, `components/SettingsForm.tsx:25, 49, 83`,
      `components/ServiceTestClient.tsx:448`, `app/payment-account-management/page.tsx:47`.

---

## 9. Hash: SHA-256, trừ đúng một ngoại lệ

- [ ] Mọi mục đích bảo mật → SHA-256. Codebase đã làm đúng chỗ nào quan trọng.
- [ ] MD5 **chỉ** được dùng cho S3 ETag (`lib/storage/s3-backend.ts:157`) vì giao thức S3
      định nghĩa ETag là MD5 — không thay được, và nó là checksum toàn vẹn, không phải
      cơ chế bảo mật. Fortify báo 2 finding ở đây; đã biện luận là dương tính giả.
- [ ] Đừng thêm chỗ dùng MD5 mới.

---

## 10. Không có credential thật nào trong code — kể cả test và script

**Lỗi gốc — nặng nhất cả đợt.** Credential thật nằm trong repo nhiều tháng, ở 4 chỗ:

| Chỗ | Credential | Vào repo |
|---|---|---|
| `scripts/test-csp-integration.ts:19` — script một developer chạy tay | client secret cổng CSP | `0faeb9b`, 22/04/2026 |
| `tests/payroll-verify/e2e-idp-integration.test.ts:64, 248` — test **không hề cần** giá trị thật, không assertion nào đọc nó | cùng client secret CSP | `46b925a`, 22/04/2026 |
| `docs/IDP-PAYROLL-VERIFY-API-GUIDE.md:53, 109` — ví dụ cURL trong tài liệu | **API key DUGate** (`dg_…`) | `5c7ba0d`, 23/04/2026 |
| `run_api.py:10` — script gọi `/api/v1/transform` | **API key DUGate** khác | `3151a35`, 08/04/2026 |

Số dòng trong bảng là tại commit gốc. Cả 4 commit gốc nằm trên `origin/develop`, `master`, `release` và trong bản `GOLIVE_0808` —
ai clone repo đều đọc được. **Fortify không báo finding nào** ở cả 4 chỗ. Đã gỡ ở `c25ccad`,
`7a48fd3` và commit sửa tài liệu này.

Hai API key DUGate là loại **DUGate tự quản** — thu hồi được ngay trong UI (`/profiles` →
deactivate key), không cần chờ đối tác như secret CSP.

- [ ] **Không** commit giá trị thật của client secret, API key, mật khẩu, token, private key —
      ở **bất kỳ** file nào: `app/`, `lib/`, `tests/`, `scripts/`, `docs/`, file mẫu JSON.
- [ ] Test cần một secret → dùng chuỗi giả rõ ràng (`'test-client-secret'`). Nếu test **thật sự**
      phải gọi hệ thống thật thì đọc từ env và `skip` khi không có env — không bao giờ nhúng giá trị.
- [ ] Script cá nhân chứa credential → **không** để trong repo. Để ngoài, hoặc đọc từ `.env.local`
      (đã gitignore).
- [ ] Lỡ commit rồi: **xoá file KHÔNG sửa được lỗi** — giá trị vẫn trong git history. Việc duy nhất
      đóng được rủi ro là **báo chủ hệ thống để thu hồi và cấp credential mới**.
- [ ] Ví dụ trong tài liệu (cURL, Postman, README) dùng placeholder: `dg_live_xxxxxxxxxxxxxxxx`.
      Không dán key thật "cho tiện copy".
- [ ] Kiểm trước khi commit bằng `git grep` trên **toàn bộ file tracked**, đừng tự chọn thư mục —
      đợt 18/09 bỏ sót chỗ thứ hai đúng vì quét theo danh sách thư mục và quên `tests/`.
      Hai câu lệnh dưới đã chạy thật và **bắt được cả 4 chỗ ở bảng trên** trên commit gốc:
      ```
      # 1. key DUGate thật
      git grep -n -I -E 'dg_[A-Za-z0-9_-]{30,}'
      # 2. chuỗi dài gán cho biến có tên kiểu credential
      git grep -n -I -i -E '(secret|password|token|api[_-]?key)[^:=]{0,3}[:=][[:space:]]*.[A-Za-z0-9+/=_-]{24,}.'
      ```
      Lệnh 2 có nhiễu (tên hàm như `encodeBusinessOperationToken(`, secret test cố ý dài) —
      đọc từng hit, đừng bỏ qua cả lệnh. Dùng **nháy đơn** như trên: trong PowerShell 5.1,
      dấu `"` lồng trong tham số truyền cho `git` bị hỏng và regex âm thầm không khớp gì.

---

## 11. `fetch` ra ngoài mà mang credential phải đi qua `ssrfSafeFetch` + có timeout

**Lỗi gốc:** `app/api/chat/route.ts:113` (tại `3ec1a70`) gọi `fetch` thô tới URL connector, kèm
API key của connector trong header. Không kiểm URL có trỏ vào mạng nội bộ, không timeout. Mọi chỗ
gọi ra ngoài khác trong repo đều đã dùng `ssrfSafeFetch`. Đã đóng bằng cách xoá tính năng Chat
(`933e085`) — tính năng không còn ai dùng.

- [ ] Server gọi ra URL do cấu hình/người dùng cung cấp → dùng `ssrfSafeFetch`
      (`lib/pipelines/processors/http-client.ts:331`). Nó chặn địa chỉ nội bộ trừ host nằm trong
      `ALLOWED_PRIVATE_HOSTS`.
- [ ] `ssrfSafeFetch` **không tự áp timeout**. Luôn truyền `signal: AbortSignal.timeout(ms)` —
      mẫu: `lib/delivery/webhook-sender.ts:110`, `lib/auth-config/oauth2-token.ts:137`.
- [ ] Ngoại lệ hợp lệ: URL lấy từ env của hệ thống, không phải input — vd địa chỉ Vault
      (`lib/secrets/vault-provider.ts:211`, có `AbortController` riêng).
- [ ] Tính năng chết mà vẫn mang credential → **xoá hẳn**, đừng để lại "phòng khi cần".

---

## 12. Trước khi báo hoàn thành

- [ ] Đọc lại §1–§11, đối chiếu từng mục với code vừa viết.
- [ ] `node node_modules/typescript/bin/tsc --noEmit` → 0 lỗi.
      (`npx` bị chặn bởi execution policy trên máy Windows — gọi trực tiếp qua `node`.)
- [ ] `node node_modules/jest/bin/jest.js <file>` → pass.
- [ ] Route mới: đã kiểm method (§2), response không rò secret (§1), guard ở server (§3)?
- [ ] Có chạm secret: đã mã hoá at-rest (§5), không vào `localStorage` (§4), tên biến đúng bản chất (§7)?
- [ ] Sửa lỗi bảo mật: đã có comment `[SEC …]` (§8)?
- [ ] Không có credential thật trong diff, kể cả test/script — đã chạy `git grep` ở §10?
- [ ] Gọi ra ngoài kèm credential: qua `ssrfSafeFetch` + có timeout (§11)?

---

## Tham chiếu

| Nội dung | Chỗ |
|---|---|
| Checklist chức năng mới (prompt, parameter, verify) | [feature-development-checklist.md](feature-development-checklist.md) |
| Biến môi trường, cấu hình deploy | [DEPLOYMENT-CONFIG.md](DEPLOYMENT-CONFIG.md) |
| Kiến trúc tổng thể | [SOLUTION_ARCHITECTURE.md](SOLUTION_ARCHITECTURE.md) |
| Hồ sơ phân tích đợt quét 18/09 + tool đọc `.fpr` | `handover-report/SEC/SecTool/` — **lưu ý: folder này bị `.gitignore`**, chỉ có trên máy người chạy đợt quét. Cần đưa vào repo thì bàn riêng |
