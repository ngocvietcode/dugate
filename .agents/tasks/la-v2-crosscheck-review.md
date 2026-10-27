# Đánh giá mục "Dữ liệu không khớp giữa chứng từ" (Loan Appraisal V2)

Phạm vi: chỉ đọc, nhánh `feat/account-opening` @ `7f631c6`. Không sửa code repo.

## Tóm tắt

- UI v2 (`CrossCheckMatrix`/`CrossCheckDialog`) chỉ hiển thị nguyên trạng `result.cross_check_matrix` do backend tính deterministic. Logic giống hệt v1, v2 không tự so khớp lại.
- Với hồ sơ chỉ gồm `ho_so_phap_ly.pdf` (4 bản căn cước), ma trận **không đối chiếu được trường nào**: 12/12 dòng là `INSUFFICIENT`, `compared = 0`. Dù vậy card vẫn hiện badge xanh "Không có trường lệch" và câu "Không phát hiện trường nào lệch". Đây là trạng thái "an toàn" giả.
- Lỗi gom nhóm ở backend vẫn lộ ra trong mục này. Có 4 "đối tượng" cho 2 người: `145864944` và `163411615` (CMND 9 số) thành đối tượng riêng. Cả 4 đều mang nhãn `NGUYỄN THỊ KIỀU ANH`, kể cả dòng của Trần Ánh Dương. Cột "Đối tượng" chỉ ghi tên, không ghi số CCCD hay vai trò, nên không khớp với các card OCR mới (`ocr-documents.ts`) vốn hiển thị đúng tên, CCCD 12 số và vai trò.
- Báo lệch oan (đã chạy thử): địa chỉ ghi khác cấp hành chính ("Đại Đồng" so với "xã Đại Đồng", "TP." so với "Thành phố"), và chữ **Đ/đ** không được bỏ dấu ("ĐỖ VĂN ĐẠT" so với "Do Van Dat" bị kết luận LỆCH).
- Bỏ sót (false negative):
  - Các bản cùng loại trong cùng một file không bao giờ được so với nhau.
  - Bản VNeID không được so với Giấy đề nghị vay vốn (ĐNVV).
  - Ngày sinh, ngày cấp, giới tính không nằm trong ma trận.
  - Hộ chiếu không được đối chiếu.
  - Khi đã có ma trận, các phát hiện mâu thuẫn do AI (LLM) đưa ra bị ẩn khỏi mục này. Tuy vậy, chúng vẫn sinh ra dòng "Xử lý dữ liệu không khớp: …" trong "Việc cần hoàn tất".
- Có thể sửa phía client v2 (không đổi kết luận Khớp/Lệch): định danh đối tượng, trạng thái rỗng, liên kết chứng từ nguồn, hiển thị >2 vế, hiện lại phát hiện của AI. Nguyên nhân gốc (gom nhóm, chuẩn hóa, phạm vi so sánh) nằm ở backend.

## 1. Luồng dữ liệu đầu–cuối

1. `buildEvidenceRegistry` (`lib/pipelines/workflows/loan-appraisal/evidence.ts`) làm phẳng mọi leaf đã bóc tách thành `EvidenceRecord` (`field_path`, `normalized_value`, `file_name`, `doc_type_key`, `doc_type_label`).
2. `buildDossierGrouping` (`grouping.ts`) dựng `participants` (gom theo `idDigits`) và `document_views[].segments[].party_id`.
3. `buildCrossCheckMatrix` (`cross-check-matrix.ts`) được gọi ở `loan-appraisal.ts:339`, kết quả lưu vào `cross_check_matrix` (`loan-appraisal.ts:532`).
   - Có 16 field chuẩn (`STANDARD_FIELDS`). Với dimension `party` chỉ có 3 field: **Họ tên, Số CCCD/CMND, Địa chỉ thường trú**.
   - Field `party` được tính riêng cho từng `participant.id_number`. Chỉ lấy các evidence có `partyByEvidence === participant.id_number`, tức theo phân đoạn của `document_views`. Nói cách khác, so sánh **theo người** (theo id), không theo loại chứng từ.
   - Field `asset` tính theo `collateral_groups`, field `single` tính trên toàn hồ sơ.
   - Mỗi giá trị được chuẩn hóa theo `kind` (`normalizeKey`), rồi gom thành các "vế" (`clusterSides`).
   - Một **nguồn** là một cặp `file_name × doc_type_key` (`cross-check-matrix.ts:248`).
   - `resultOf` (`:293`):
     - Dưới 2 nguồn, hoặc một nguồn tự chứa nhiều giá trị khác nhau (`ambiguous`), cho ra `INSUFFICIENT`.
     - Chỉ có 1 vế cho ra `MATCH`.
     - Với tên: tập tên bên này là tập con của bên kia thì cho ra `MATCH`.
     - Còn lại là `MISMATCH`.
   - `summary`:
     - `compared` = số dòng MATCH + MISMATCH (không tính INSUFFICIENT).
     - `matched` = số dòng MATCH.
     - `mismatched` = số dòng MISMATCH.
4. Phía UI v2, `IntakeWorkspace.tsx:103`:
   - Nếu có `matrix`, hiện `<CrossCheckMatrix matrix>`, kèm `BusinessWarnings` nếu có `dossier_checks`.
   - Nếu không có ma trận (kết quả cũ hoặc kết quả tạm), hiện card dự phòng. Card này liệt kê `readiness.conflicts`, hoặc `result.cross_check` khi chưa có readiness. Subtitle ghi "`N` điểm đối chiếu chéo" (`:110`), trong đó N = **số phát hiện của AI/quy tắc ở mọi mức độ**, kể cả `info`. Đây không phải số điểm đã được so sánh.
   - Trong `CrossCheckMatrix.tsx`:
     - Subtitle (`:50`): "`compared` trường đã đối chiếu · `matched` khớp · `mismatched` lệch".
     - Badge (`:51`) đếm số dòng MISMATCH.
     - Mỗi dòng lệch là một `MismatchCard`, sắp theo `GROUP_ORDER` (chỉ theo nhóm, không theo người). Tiêu đề card là `field_label (subject_label)` (`:23`). Mỗi vế hiển thị `side.documents` (là **`doc_type_label`**, không phải tên file, xem `cross-check-matrix.ts:253`) và `side.value`.
   - `CrossCheckDialog.tsx` liệt kê mọi dòng, có lọc Tất cả/Lệch/Khớp/Chưa đủ dữ liệu, và xuất CSV có BOM (`csv.ts`). Bảng chỉ có cột A/B, lấy `sides[0]` và `sides[1]` (`:81-82`).
5. `readiness.conflicts` = `evaluation.cross_check`, gồm phát hiện của LLM cộng `dossier_checks` (`strategies.ts:166`, `loan-appraisal.ts:351`). Những conflict mức `error` sinh dòng "Xử lý dữ liệu không khớp: …" trong "Việc cần hoàn tất" (`strategies.ts:186`), và sinh ngoại lệ trong `collectExceptions` (`selectors.ts:134`).

## 2. Tính đúng: kiểm chứng bằng script

Tôi chạy `npx tsx` trên script tạm (đã xóa), gọi trực tiếp `buildEvidenceRegistry` → `buildDossierGrouping` → `buildCrossCheckMatrix` → `buildOcrFileGroups`, với fixture tái tạo 4 instance của `ho_so_phap_ly.pdf` theo đúng giá trị người dùng cung cấp.

**Kịch bản A — chỉ có file căn cước:**

```
participants: 033199002299 NGUYỄN THỊ KIỀU ANH | 036097002872 NGUYỄN THỊ KIỀU ANH
              145864944 NGUYỄN THỊ KIỀU ANH    | 163411615 NGUYỄN THỊ KIỀU ANH   (đều UNRESOLVED)
summary: { compared: 0, matched: 0, mismatched: 0 }
full_name subj=NGUYỄN THỊ KIỀU ANH pid=036097002872 INSUFFICIENT :: TRẦN ÁNH DƯƠNG
full_name subj=NGUYỄN THỊ KIỀU ANH pid=163411615   INSUFFICIENT :: Trần Ánh Dương
id_number subj=NGUYỄN THỊ KIỀU ANH pid=145864944   INSUFFICIENT :: 033199002299
...12 dòng, tất cả INSUFFICIENT
```

**Kịch bản B — thêm ĐNVV ở file khác (địa chỉ ghi đủ cấp hành chính, tên không dấu):**

```
summary: { compared: 6, matched: 4, mismatched: 2 }
permanent_address (Nguyễn Thị Kiều Anh) MISMATCH: "Thôn Văn Ó, Đại Đồng, Văn Lâm, Hưng Yên" ≠ "Thôn Văn Ó, xã Đại Đồng, huyện Văn Lâm, tỉnh Hưng Yên"
permanent_address (Tran Anh Duong)      MISMATCH: "…, Trần Quang Khải, TP. Nam Định, …" ≠ "…, P. Trần Quang Khải, Thành phố Nam Định, …"
full_name / id_number: MATCH ("036 097 002 872" ≡ "036097002872"; "Tran Anh Duong" ≡ "TRẦN ÁNH DƯƠNG")
Dòng của 145864944 / 163411615 vẫn INSUFFICIENT với nhãn "NGUYỄN THỊ KIỀU ANH"
```

**Kịch bản C/D — chữ Đ:**

```
permanent_address MISMATCH: "Thôn Văn Ó, Đại Đồng, …" ≠ "Thon Van O, Dai Dong, …"
full_name        MISMATCH: "ĐỖ VĂN ĐẠT" ≠ "Do Van Dat"
```

Song song, `buildOcrFileGroups` cho ra 4 card đúng: "Căn cước · NGUYỄN THỊ KIỀU ANH id=033199002299", "VNeID · Nguyễn Thị Kiều Anh id=033199002299 old=145864944", … và vai trò được lan truyền đúng (BORROWER/CO_BORROWER).

### Báo lệch oan (chỉ khác cách viết)

| Trường hợp | Kết quả | Nguyên nhân |
|---|---|---|
| Khoảng trắng trong số CCCD | Đúng (khớp) | `kind: 'id'` dùng `normalizeDocumentId`, bỏ mọi ký tự không phải chữ/số |
| Hoa/thường, dấu trong tên (trừ Đ) | Đúng (khớp) | `parseNames`, `stripDiacritics` |
| **Chữ Đ/đ** | **Lệch oan** | `stripDiacritics` (`cross-check-matrix.ts:136`) chỉ bỏ dấu tổ hợp U+0300–036F. "đ" không tách được nên bị regex `[^a-z0-9]` xóa mất: "Đại" thành "ai", trong khi "Dai" vẫn là "dai" |
| **Địa chỉ: xã/huyện/tỉnh/P./TP./Thành phố** | **Lệch oan** | `kind: 'text'` chỉ hạ chữ thường, bỏ dấu và dấu câu; không có bảng đơn vị hành chính |
| `identification_type`, `issuing_authority`, `chip_enabled` (boolean so với chuỗi) | Không áp dụng | Không có trong `STANDARD_FIELDS`, nên không bao giờ bị báo lệch |
| Định dạng ngày | Không áp dụng hiện tại | `kind: 'date'` không được field nào dùng. Nếu dùng, nó chỉ giữ chữ số, nên "5/10/1999" khác "05/10/1999" và "1999-10-05" khác "05/10/1999", tức sẽ báo lệch oan |
| Thiếu giá trị (VNeID không có quốc tịch/hạn dùng) | Đúng | `normalizeKey` trả `null` thì bỏ qua; thiếu giá trị không bị coi là lệch |

### Bỏ sót (false negative)

1. **Các bản cùng loại trong một file không được so với nhau.** Nguồn là `file × doc_type`, nên 4 instance `cccd` trong `ho_so_phap_ly.pdf` chỉ là 1 nguồn. Nếu instance khác nhau lại rơi vào cùng party, chúng thành `ambiguous` và cho ra `INSUFFICIENT`. Vì vậy bản cứng và bản VNeID của cùng một người không bao giờ được đối chiếu.
2. **VNeID gán nhầm party.**
   - `isIdPath` khớp cả `old_id_number_9digits` (`grouping.ts:43`, do `p.includes('id_number')`).
   - Trong `buildDocumentPartyViews`, mỗi container lấy id **cuối cùng** gặp được (`grouping.ts:365`), nên instance VNeID bị gán `party_id` = số 9 chữ số.
   - Hệ quả: VNeID không được so với ĐNVV hay CCCD của đúng người.
   - Vì party 9 số chỉ có 1 nguồn, lỗi này **không gây so sánh giữa hai người khác nhau** (không sinh MISMATCH sai người). Nó làm mất phép so sánh, và sinh thêm dòng INSUFFICIENT mang nhãn sai.
3. **Nhãn đối tượng sai.**
   - `full_name` của participant lấy `seed.name` từ ĐNVV (có thể là tên không dấu "Tran Anh Duong").
   - Nếu không có ĐNVV, nó lấy **tên đầu tiên của cặp (file, loại)** qua `nameByFileType` (`grouping.ts:155,178`). Vì thế cả 4 đối tượng đều là "NGUYỄN THỊ KIỀU ANH".
4. **Phạm vi trường hẹp.** Field `party` chỉ có tên, số CCCD, địa chỉ. Không đối chiếu ngày sinh, giới tính, ngày cấp, nơi cấp, quê quán.
5. **Hộ chiếu.**
   - `idDigits` chỉ giữ chữ số và cần ≥9 chữ số, nên "C1234567" thành `null`: người chỉ có hộ chiếu không thành participant, và không có dòng party nào.
   - Spec `id_number` cũng không có leaf `passport_number`.
   - Đây là cùng loại lỗi người dùng đã báo ở message #11, nhưng nằm ở backend.
6. **Phát hiện của LLM bị ẩn.** Khi đã có `matrix`, `IntakeWorkspace.tsx:103-108` chỉ hiện ma trận cộng `dossier_checks`; các finding LLM trong `result.cross_check` / `readiness.conflicts` không hiển thị ở đâu trên tab tiếp nhận. Trong khi đó, "Việc cần hoàn tất" và danh sách ngoại lệ vẫn trích tiêu đề của chúng, nên người dùng thấy "Xử lý dữ liệu không khớp: X" mà không tìm được X. V1 có cùng hành vi (`DossierIntakeWorkspace.tsx:172`).

## 3. Nhất quán với tách chứng từ mới (`ocr-documents.ts`)

- **Không nhất quán.**
  - Card OCR: "VNeID · Trần Ánh Dương", CCCD 036097002872, Người đồng vay.
  - Ma trận/dialog: "Họ tên (NGUYỄN THỊ KIỀU ANH)" với giá trị "Trần Ánh Dương", `party_id` 163411615.
- **Số CMND 9 số có được hiển thị như ID chính không?** Có, nhưng gián tiếp. `field.party_id` (9 số) không được render trực tiếp; nó chỉ nằm trong React key (`CrossCheckMatrix.tsx:55`, `CrossCheckDialog.tsx:75`). Tuy vậy nó vẫn sinh ra **đối tượng riêng**, với các dòng "Họ tên / Số CCCD/CMND / Địa chỉ" lặp lại. Trong file CSV xuất ra, cột "Đối tượng" lặp "NGUYỄN THỊ KIỀU ANH" 4 lần.
- Nhãn chứng từ của mỗi vế là `doc_type_label`, ví dụ "Căn cước". Vì vậy bản cứng và bản VNeID không phân biệt được, và cũng không có tên file. Disclosure "Toàn bộ chứng từ nguồn" (`CrossCheckMatrix.tsx:34`) đưa `doc_type_label` vào `SourceFileChips`, vốn được thiết kế cho tên file. Kết quả là nó lặp lại "Căn cước · Giấy đề nghị vay vốn" và không bao giờ hiện file thật.
- Không có liên kết sang card OCR hay bằng chứng: `side.evidence_ids` có sẵn nhưng không được dùng.

## 4. UX / Accessibility / parity với v1

- **Trạng thái rỗng sai nghĩa** (`CrossCheckMatrix.tsx:51,57`): khi `compared = 0` vẫn hiện tone `success`. Subtitle không cho biết có bao nhiêu dòng "Chưa đủ dữ liệu".
- **Nhóm hiển thị:** card chỉ sắp theo nhóm nghiệp vụ, không gom theo người. Khi có nhiều người, các card xen kẽ nhau.
- **Mức độ:** hệ thống chủ đích chỉ báo Khớp/Lệch. Một chênh lệch thuần định dạng địa chỉ cũng mang màu đỏ giống hệt lệch số CCCD.
- **Dialog:**
  - Focus trap, Esc, trả focus, khóa cuộn đều tốt (`ui/Dialog.tsx`, `useFocusTrap`). Bộ lọc có `aria-pressed` và `role="group"`.
  - Bảng có `minWidth 820` nên cuộn ngang trên mobile. Chấp nhận được.
  - **Vế thứ 3 trở đi bị mất** trong bảng (`:81-82`) và trong CSV (`csv.ts`, `crossCheckRows`), dù card có hiện.
  - Tiêu đề cột "Field" là tiếng Anh. V1 cũng vậy.
- **MismatchCard:** icon `aria-hidden`, không có chữ "Lệch" cho trình đọc màn hình ngoài tiêu đề card. Ngữ cảnh card ngoài đã đủ, mức LOW.
- **Nút "Xem toàn bộ kết quả đối chiếu"** bị `disabled` khi rỗng mà không có lời giải thích.
- **Card dự phòng:** "điểm đối chiếu chéo" thực chất là số phát hiện. V2 bỏ dòng "Không xác định được tài liệu" của v1 khi finding không có `documents` (`FindingItem` chỉ ẩn đi). Đây là khác biệt nhỏ.
- **Parity:** v2 giữ đủ thông tin v1 (tóm tắt, badge, card lệch, dialog, lọc, CSV có BOM, chứng từ nguồn), và còn tốt hơn ở a11y dialog. Không có dữ liệu v1 nào bị v2 bỏ, ngoài chi tiết nhỏ ở card dự phòng nói trên.

## 5. Danh sách vấn đề theo mức ưu tiên

### Sửa được phía client v2 (không đổi kết luận Khớp/Lệch của backend)

| # | Mức | Vị trí | Vấn đề | Đề xuất |
|---|---|---|---|---|
| C1 | HIGH | `CrossCheckMatrix.tsx:23`, `CrossCheckDialog.tsx:80`, `IntakeWorkspace.tsx:105` | Nhãn đối tượng sai người; đối tượng CMND 9 số tách riêng; không có CCCD hay vai trò | Truyền `document_views` và `participants` vào `CrossCheckMatrix`. Thêm selector, ví dụ `resolveCrossCheckSubject` trong `ocr-documents.ts`, dựng chỉ mục người từ `buildOcrFileGroups` (`idNumber`, `oldIdNumber`, tên ưu tiên bản cứng, `roles`). Map `party_id` sang người chuẩn, rồi hiển thị "TRẦN ÁNH DƯƠNG · CCCD 036097002872 · Người đồng vay". Gom các dòng của party bí danh (9 số) dưới người chuẩn, gắn nhãn "Bản VNeID — chưa đối chiếu". Không bao giờ hiện số 9 chữ số làm ID chính |
| C2 | HIGH | `CrossCheckMatrix.tsx:50-57` | `compared = 0` vẫn báo xanh "Không có trường lệch" | Nếu `compared === 0`, dùng badge `neutral` "Chưa đủ dữ liệu để đối chiếu" và câu giải thích "N trường chỉ có 1 nguồn chứng từ". Thêm số INSUFFICIENT vào subtitle |
| C3 | MEDIUM | `IntakeWorkspace.tsx:103-117` | Finding LLM bị ẩn khi có ma trận, nhưng vẫn được trích ở "Việc cần hoàn tất" | Hiển thị `readiness.conflicts` không thuộc `dossier_checks` thành mục "Phát hiện của AI" trong card ma trận, hoặc một card riêng. Đây là thay đổi về những gì người dùng thấy, cần xác nhận trước khi làm |
| C4 | MEDIUM | `CrossCheckMatrix.tsx:29,34`, `CrossCheckDialog.tsx:81-84` | Vế chỉ ghi loại chứng từ; disclosure hiện loại thay vì file; không phân biệt bản cứng với VNeID | Dùng `EvidenceChips ids={side.evidence_ids}` (provider đã bọc ở `page.tsx:156`, portal vẫn nhận context) để có tên file và loại. Gắn nhãn bản theo `instances[N]` của evidence, dùng `documentKindLabel` |
| C5 | MEDIUM | `CrossCheckDialog.tsx:81-82`, `lib/csv.ts` (`crossCheckRows`) | Vế thứ 3 trở đi bị mất trong bảng và CSV | Render danh sách mọi vế trong một cột; CSV nối các vế còn lại vào một cột "Giá trị khác" |
| C6 | LOW | `CrossCheckMatrix.tsx:42` | Card lệch không gom theo người | Sắp và gom theo người chuẩn (sau C1), rồi mới theo nhóm |
| C7 | LOW | `CrossCheckMatrix.tsx` | Lệch thuần định dạng mang cùng màu đỏ với lệch thật | Thêm nhãn gợi ý "Có thể chỉ khác cách viết" dùng chuẩn hóa mạnh hơn phía client (Đ→D, bỏ xã/phường/huyện/quận/tỉnh/TP./Thành phố). Không đổi `result`, ghi rõ đây là gợi ý |
| C8 | LOW | `CrossCheckDialog.tsx:79`, `IntakeWorkspace.tsx:110`, `CrossCheckMatrix.tsx:60` | "Field" bằng tiếng Anh; "điểm đối chiếu chéo" sai nghĩa; nút bị disabled không có lý do | Đổi thành "Trường dữ liệu" và "N phát hiện"; thêm chú thích khi nút bị vô hiệu |

### Cần sửa backend (người dùng chưa yêu cầu, chỉ báo cáo)

| # | Mức | Vị trí | Vấn đề | Đề xuất |
|---|---|---|---|---|
| B1 | HIGH | `grouping.ts:43,365` | `old_id_number_9digits` được coi là ID chính; container lấy id cuối nên VNeID thành party 9 số | Loại `old_id`/`9digits` khỏi `isIdPath`; ưu tiên ID 12 số; liên kết CMND 9 số làm bí danh của người |
| B2 | HIGH | `grouping.ts:155,178` | Tên participant lấy tên đầu tiên của (file, loại) | Lấy tên trong cùng container hoặc instance với id |
| B3 | HIGH | `cross-check-matrix.ts:248,293` | Nguồn = file × loại, nên các bản trong một file không được đối chiếu; `ambiguous` che mất lệch thật | Tính nguồn theo `file × loại × instances[N]`; tính `ambiguous` theo instance |
| B4 | HIGH | `cross-check-matrix.ts:136` (cả `evidence.ts` `normalizeDocumentId`) | Chữ Đ/đ bị xóa thay vì đổi thành D, gây lệch oan cả tên lẫn địa chỉ (đã kiểm chứng) | Thêm `.replace(/[đĐ]/g, 'd')` trước khi bỏ dấu |
| B5 | MEDIUM | `cross-check-matrix.ts:209` | Địa chỉ báo lệch oan vì tiền tố đơn vị hành chính | Chuẩn hóa từ điển (xã, phường, thị trấn, huyện, quận, thị xã, tỉnh, TP., Thành phố, P., Q.) hoặc so theo token |
| B6 | MEDIUM | `STANDARD_FIELDS` | Thiếu ngày sinh, ngày cấp, giới tính; `kind: 'date'` chỉ giữ chữ số | Thêm các field này với bộ parse ngày thật (d/m/y, ISO) |
| B7 | MEDIUM | `grouping.ts` `idDigits`; spec `id_number` | Hộ chiếu không thành participant và không được đối chiếu | Dùng chuẩn hóa chữ+số như `normalizeIdNumber`; thêm leaf `passport_number` |
| B8 | LOW | `cross-check-matrix.ts:253` | `side.documents` là nhãn loại, không có file hay instance | Trả thêm `file_name` và `instance_index` cho từng vế |

## Đã kiểm chứng và chưa kiểm chứng

- **Đã kiểm chứng:**
  - Đọc toàn bộ code nêu trên.
  - Chạy backend thật (`buildEvidenceRegistry`/`buildDossierGrouping`/`buildCrossCheckMatrix`) và `buildOcrFileGroups` bằng `npx tsx` trên fixture tái tạo `ho_so_phap_ly.pdf`, cùng các kịch bản ĐNVV và chữ Đ (kết quả trích ở mục 2).
  - `npx jest tests/loan-appraisal-v2 --testPathIgnorePatterns .worktrees`: 8 suite, 62 test đều pass. Hiện không có test v2 nào cho `CrossCheckMatrix`/`CrossCheckDialog` ngoài test CSV.
- **Chưa kiểm chứng:**
  - Payload thật của operation (dùng fixture dựng lại; thứ tự leaf `id_number` trước `old_id_number_9digits` được suy ra từ dữ liệu người dùng gửi).
  - Loại chứng từ thứ 2 thật trong `ho_so_phap_ly.pdf` ("2 loại chứng từ"). Nếu đó là ĐNVV, kết quả sẽ giống kịch bản B (cùng file, khác loại nên vẫn là 2 nguồn).
  - Hiển thị thực tế trên trình duyệt và trình đọc màn hình.
