// lib/pipelines/workflows/payment-account-management/shared/documents.ts
// Document-type taxonomy for the payment-account-management classifier.
// Shared across modes (open / update / ...) — classification uses the same taxonomy.
//
// Each entry describes one document type found in an account dossier:
//   - code:        machine identifier used downstream (never shown to end users)
//   - indicators:  keyword hints the classifier LLM matches against
//   - description:  disambiguation rules (e.g. MB02 vs MB04, căn cước vs căn cước công dân)
//   - title:       display name. Static (e.g. "Điều lệ") OR templated with <slot>
//                  placeholders (e.g. "<Tên người> - <Số Căn cước công dân>") that
//                  the classifier fills from the document.

export interface DocumentType {
  code: string;
  indicators: string[];
  description: string;
  title: string;
}

// ─── Title slot helpers ────────────────────────────────────────────────────────
// Some titles are templates with <slot> placeholders the classifier must fill,
// e.g. "<Tên người> - <Số Căn cước công dân>" → "Nguyễn Văn A - 038201005678".
// The LLM extracts raw field values; the CODE does the substitution below so the
// final title format (separators, "N/A" for missing) stays deterministic.

// Maps a placeholder label (exact text inside <>) to a stable field key the LLM returns.
// All ID-document number slots collapse to a single "so_giay_to" key on purpose:
// the classifier only needs the person's name + one document number.
export const SLOT_FIELD_MAP: Record<string, string> = {
  'Tên người': 'ho_ten',
  'Số Căn cước công dân': 'so_giay_to',
  'Số Căn cước': 'so_giay_to',
  'Số Hộ chiếu': 'so_giay_to',
  'Số Thị thực': 'so_giay_to',
  'Số Thẻ tạm trú': 'so_giay_to',
};

/**
 * Find all <slot> placeholder labels in a title.
 * "<Tên người> - <Số Hộ chiếu>" → ["Tên người", "Số Hộ chiếu"].
 * A static title like "Điều lệ" returns [] (no placeholders).
 */
export function parseSlots(title: string): string[] {
  const matches = title.match(/<([^>]+)>/g) ?? [];
  // Strip the surrounding < > from each match.
  return matches.map((m) => m.slice(1, -1).trim());
}

/**
 * Build the final display title by replacing each <slot> with its extracted value.
 * A slot with no value (missing/blank field) becomes "N/A".
 * Static titles (no placeholders) are returned unchanged.
 *
 * @param title  the template from ACCOUNT_DOCUMENTS (may contain <slot>s)
 * @param fields field values the LLM extracted, keyed by SLOT_FIELD_MAP values
 */
export function fillTitle(title: string, fields: Record<string, unknown>): string {
  return title.replace(/<([^>]+)>/g, (_match, label: string) => {
    const fieldKey = SLOT_FIELD_MAP[label.trim()];
    const value = fieldKey ? fields[fieldKey] : undefined;
    // Treat null / undefined / empty string as "not read" → N/A.
    if (value === null || value === undefined || String(value).trim() === '') {
      return 'N/A';
    }
    return String(value).trim();
  });
}

export const ACCOUNT_DOCUMENTS: DocumentType[] = [
  {
    code: 'dieu_le',
    indicators: ['điều lệ', 'quy chế hoạt động', 'quy chế tài chính', 'quy chế thu chi', 'nghị quyết', 'thể lệ', 'charter', 'regulation', 'resolution'],
    description: 'Nhận diện khi tiêu đề là văn bản nội bộ quy định tổ chức/hoạt động của đơn vị: Điều lệ (Charter), Quy chế hoạt động (Operating regulation), Quy chế tài chính, Quy chế thu chi, Nghị quyết (Resolution), hoặc Thể lệ. Đặc trưng: có các Điều/Khoản/Chương (Articles/Clauses/Chapters) đánh số, con dấu và chữ ký người đứng đầu tổ chức. KHÁC văn bản ủy quyền (van_ban_uy_quyen) ở chỗ điều lệ/quy chế quy định chung cho cả tổ chức, không giao việc cho một cá nhân cụ thể. KHÁC cam_ket_khong_co_ktt: Biên bản họp Hội đồng thành viên/Hội đồng quản trị CÓ THỂ trông giống điều lệ vì có đánh số vấn đề/khoản — nhưng nếu nội dung đề cập đến (a) chưa đăng ký/chưa bổ nhiệm Kế toán trưởng/Người phụ trách kế toán trong giao dịch với VPBank, hoặc (b) miễn trừ trách nhiệm VPBank khi lệnh thanh toán chỉ có chữ ký Chủ tài khoản → PHẢI chọn cam_ket_khong_co_ktt, KHÔNG chọn dieu_le.',
    title: 'Điều lệ',
  },
  {
    code: 'tracuu_1414',
    indicators: ['TTTB số GTTT', 'tra cứu 1414', 'thông tin thuê bao', 'subscriber information', '1414'],
    description: "Nhận diện qua cụm 'TTTB số GTTT' (Thông tin thuê bao theo số giấy tờ tùy thân) — kết quả tra cứu thông tin thuê bao di động (mobile subscriber information) qua tổng đài 1414. Đặc trưng: bảng thông tin thuê bao gắn với số CMND/CCCD, không phải văn bản có tiêu đề trang trọng.",
    title: 'Tra cứu 1414',
  },
  {
    code: 'bien_ban_giao_nhan',
    indicators: ['biên bản giao nhận', 'handover record', 'handover minutes', 'delivery record'],
    description: "Nhận diện khi tiêu đề chứa 'Biên bản giao nhận' (Handover record/minutes). Đặc trưng bắt buộc: có mục người giao (deliverer) và người nhận (receiver), phần nội dung/danh mục giao nhận, và chữ ký của các bên liên quan. Nếu không có đủ hai bên giao–nhận thì KHÔNG phải loại này.",
    title: 'Biên bản giao nhận',
  },
  {
    code: 'van_ban_uy_quyen',
    indicators: ['văn bản ủy quyền', 'giấy ủy quyền', 'ủy quyền', 'phân công công việc', 'phân công nhiệm vụ', 'power of attorney', 'letter of authorization', 'authorization'],
    description: 'Nhận diện khi tiêu đề là Văn bản/Giấy ủy quyền (Power of Attorney / Letter of Authorization), Ủy quyền, Phân công công việc hoặc Phân công nhiệm vụ. Đặc trưng: một cá nhân/tổ chức (bên ủy quyền / principal) giao cho một người cụ thể (bên được ủy quyền / attorney) thực hiện công việc/nhiệm vụ nêu rõ, kèm phạm vi và thời hạn. KHÁC điều lệ/quy chế (dieu_le) ở chỗ luôn chỉ đích danh người được giao việc.',
    title: 'Văn bản ủy quyền',
  },
  {
    code: 'cam_ket_khong_co_ktt',
    indicators: ['cam kết chưa có chữ ký của kế toán trưởng', 'cam kết không có kế toán trưởng', 'cam kết chưa có kế toán trưởng', 'chưa đăng ký và sử dụng chữ ký của kế toán trưởng', 'chưa đăng ký chữ ký của kế toán trưởng', 'chưa bổ nhiệm được kế toán trưởng', 'chưa bổ trí được người phụ trách kế toán', 'miễn trừ trách nhiệm của vpbank', 'lệnh thanh toán chỉ có chữ ký của chủ tài khoản', 'commitment no chief accountant', 'no chief accountant signature'],
    description: "Nhận diện văn bản CAM KẾT liên quan đến việc CHƯA CÓ/CHƯA ĐĂNG KÝ chữ ký Kế toán trưởng hoặc Người phụ trách kế toán (KTT/PTKT) trong giao dịch tài khoản với VPBank. Tồn tại dưới HAI dạng: (1) Văn thư/cam kết độc lập: tiêu đề 'CAM KẾT' hoặc 'VV: Chưa đăng ký và sử dụng chữ ký của Kế toán trưởng...', nội dung cam kết chịu trách nhiệm khi chưa bổ nhiệm/đăng ký KTT/PTKT, đề nghị VPBank thực hiện lệnh khi chỉ có chữ ký CTK/người ủy quyền, kèm miễn trừ trách nhiệm VPBank; (2) Biên bản họp HĐTV/HĐQT: tiêu đề là 'BIÊN BẢN HỌP' nhưng NỘI DUNG có ít nhất một trong: (a) cam kết/đồng ý chưa đăng ký KTT/PTKT trong giao dịch với VPBank, (b) chấp nhận rủi ro + miễn trừ VPBank khi lệnh chỉ có chữ ký CTK/người ủy quyền. Dấu hiệu then chốt: cụm 'chưa đăng ký/chưa bổ nhiệm/không có' + 'Kế toán trưởng/PTKT'; cụm 'miễn trừ trách nhiệm của VPBank'; cụm 'lệnh thanh toán chỉ có chữ ký của CTK'. KHÁC quyet_dinh_bo_nhiem_ktt: loại đó BỔ NHIỆM người vào vị trí KTT, loại này CAM KẾT/CHẤP NHẬN việc THIẾU vị trí đó. KHÁC dieu_le: điều lệ/quy chế KHÔNG đề cập VPBank, không có nội dung miễn trừ trách nhiệm ngân hàng — Biên bản họp HĐTV/HĐQT dù có đánh số Điều/Khoản nếu có nội dung về KTT/PTKT hoặc miễn trừ VPBank thì PHẢI là cam_ket_khong_co_ktt, KHÔNG phải dieu_le. KHÁC bien_ban_giao_nhan: loại đó bàn giao tài liệu/hồ sơ, không có nội dung KTT hay miễn trừ VPBank.",
    title: 'Cam kết chưa đăng ký chữ ký KTT/PTKT (văn thư hoặc biên bản họp)',
  },
  {
    code: 'quyet_dinh_bo_nhiem_ktt',
    indicators: ['quyết định bổ nhiệm kế toán trưởng', 'quyết định bổ nhiệm phụ trách kế toán', 'bổ nhiệm kế toán trưởng', 'decision on appointment of chief accountant', 'appointment decision'],
    description: "Nhận diện khi tiêu đề là 'Quyết định' (Decision) về việc BỔ NHIỆM (appointment) một cá nhân vào vị trí Kế toán trưởng hoặc Phó/Phụ trách kế toán (Chief Accountant). Đặc trưng: nêu tên người được bổ nhiệm, ngày hiệu lực, quyền hạn/trách nhiệm, có số quyết định và chữ ký người có thẩm quyền. KHÁC cam_ket_khong_co_ktt (loại đó cam kết THIẾU KTT, loại này XÁC LẬP có KTT).",
    title: 'QĐ bổ nhiệm KTT/PTKT',
  },
  {
    code: 'vneid',
    indicators: ['VNeID', 'định danh điện tử', 'mã định danh điện tử', 'nhận diện điện tử', 'electronic identification', 'digital identity'],
    description: 'Nhận diện khi tài liệu là ảnh chụp/bản in từ ứng dụng VNeID hoặc văn bản về mã định danh điện tử (electronic identification / digital identity). Đặc trưng: giao diện ứng dụng VNeID, thông tin định danh điện tử của cá nhân/tổ chức. KHÁC căn cước công dân (can_cuoc_cong_dan) — VNeID là danh tính điện tử trên ứng dụng, không phải thẻ vật lý.',
    title: 'VNeID',
  },
  {
    code: 'MB01',
    indicators: ['MB01.HDM-TT.DT.TK/02', 'MB01.HDM', 'giấy đăng ký thiết lập quan hệ', 'relationship establishment registration'],
    description: "Nhận diện CHẮC CHẮN qua mã biểu mẫu (form code) 'MB01.HDM-TT.DT.TK/02' — ưu tiên tuyệt đối mã này. Tiêu đề: GIẤY ĐĂNG KÝ THIẾT LẬP QUAN HỆ (Relationship Establishment Registration). Đây là bước thiết lập quan hệ ban đầu giữa khách hàng và ngân hàng. KHÁC MB02/MB03/MB04 duy nhất ở mã biểu mẫu — LUÔN đối chiếu mã MBxx trước khi so tiêu đề.",
    title: 'GIẤY ĐĂNG KÝ THIẾT LẬP QUAN HỆ',
  },
  {
    code: 'MB02',
    indicators: ['MB02.HDM-TT.DT.TK/02', 'MB02.HDM', 'giấy đề nghị kiêm hợp đồng mở và sử dụng tài khoản thanh toán, dịch vụ', 'payment account opening contract'],
    description: "Nhận diện CHẮC CHẮN qua mã biểu mẫu (form code) 'MB02.HDM-TT.DT.TK/02' — ưu tiên tuyệt đối mã này. Tiêu đề: GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN, DỊCH VỤ (payment account opening & service contract — tài khoản riêng, KHÔNG có từ 'CHUNG'/'JOINT'). CẢNH BÁO: rất dễ nhầm với MB04 — MB04 có thêm chữ 'CHUNG' (joint) ở cuối tiêu đề. LUÔN đối chiếu mã MBxx trước.",
    title: 'GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN, DỊCH VỤ',
  },
  {
    code: 'MB03',
    indicators: ['MB03.HDM-TT.DT.TK/02', 'MB03.HDM', 'giấy đề nghị cập nhật thông tin và dịch vụ', 'information and service update request'],
    description: "Nhận diện CHẮC CHẮN qua mã biểu mẫu (form code) 'MB03.HDM-TT.DT.TK/02' — ưu tiên tuyệt đối mã này. Tiêu đề: GIẤY ĐỀ NGHỊ CẬP NHẬT THÔNG TIN VÀ DỊCH VỤ (Information and Service Update Request). Đây là biểu mẫu CẬP NHẬT (update — không phải mở mới) thông tin/dịch vụ của tài khoản hiện có. KHÁC MB02 (mở mới) — đối chiếu mã MBxx trước.",
    title: 'GIẤY ĐỀ NGHỊ CẬP NHẬT THÔNG TIN VÀ DỊCH VỤ',
  },
  {
    code: 'MB04',
    indicators: ['MB04.HDM-TT.DT.TK/02', 'MB04.HDM', 'giấy đề nghị kiêm hợp đồng mở và sử dụng tài khoản thanh toán chung', 'joint payment account opening contract'],
    description: "Nhận diện CHẮC CHẮN qua mã biểu mẫu (form code) 'MB04.HDM-TT.DT.TK/02' — ưu tiên tuyệt đối mã này. Tiêu đề: GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN CHUNG (Joint payment account opening contract). Dấu hiệu phân biệt then chốt: từ 'CHUNG' (JOINT) ở cuối tiêu đề (tài khoản đồng sở hữu / joint account). CẢNH BÁO: nếu KHÔNG có từ 'CHUNG' thì là MB02, không phải MB04.",
    title: 'GIẤY ĐỀ NGHỊ KIÊM HỢP ĐỒNG MỞ VÀ SỬ DỤNG TÀI KHOẢN THANH TOÁN CHUNG',
  },
  {
    code: 'dang_ky_kinh_doanh',
    indicators: ['giấy chứng nhận đăng ký doanh nghiệp', 'giấy chứng nhận đăng ký hộ kinh doanh', 'giấy chứng nhận đăng ký hoạt động', 'giấy chứng nhận đăng ký', 'quyết định thành lập', 'quyết định công nhận', 'quyết định đầu tư', 'thông báo đăng ký', 'thông báo thành lập', 'apostille', 'apostile', 'chứng thực hợp pháp hóa lãnh sự', 'hợp pháp hóa lãnh sự', 'legalisation', 'legalization', 'business registration certificate', 'enterprise registration certificate', 'certificate of incorporation', 'certificate of registration', 'establishment decision', 'investment decision', 'investment certificate', 'mã số doanh nghiệp', 'mã số thuế', 'tax code'],
    description: 'Nhận diện tài liệu pháp lý TỔ CHỨC — chấp nhận: (1) Giấy chứng nhận đăng ký doanh nghiệp / đăng ký hộ kinh doanh / đăng ký hoạt động (có Mã số doanh nghiệp/Mã số thuế, tên tổ chức, địa chỉ trụ sở, người đại diện pháp luật, do Sở KH&ĐT hoặc cơ quan đăng ký kinh doanh cấp); (2) Quyết định thành lập tổ chức hoặc Quyết định đầu tư (establishment/investment decision) do cơ quan nhà nước có thẩm quyền ban hành để thành lập/cấp phép hoạt động cho một pháp nhân; (3) Quyết định công nhận tổ chức (ban quản trị, hội, hiệp hội, tổ chức xã hội, quỹ…) do UBND cấp phường/xã/huyện/tỉnh hoặc cơ quan nhà nước ban hành — loại này thường có tiêu đề "Về việc công nhận [tên tổ chức]", cơ quan ban hành là "Ủy ban nhân dân [phường/xã/huyện]"; (4) Giấy chứng nhận (Certificate of Registration) cấp cho văn phòng đại diện, chi nhánh, quỹ, hiệp hội; (5) Thông báo đăng ký/thành lập do cơ quan nhà nước ban hành xác nhận tư cách pháp nhân; (6) Apostille hoặc chứng thực hợp pháp hóa lãnh sự đính kèm/xác nhận một trong các tài liệu trên. Đây là giấy tờ pháp nhân của TỔ CHỨC, không phải giấy tờ tùy thân cá nhân. KHÁC quyet_dinh_bo_nhiem_ktt: quyết định ở đây thành lập/cấp phép/công nhận cho tổ chức, không bổ nhiệm cá nhân vào vị trí KTT. KHÁC dieu_le: điều lệ/quy chế có Điều/Khoản nội bộ và do tổ chức tự ban hành hoặc thông qua; loại này do cơ quan nhà nước hoặc bên ngoài cấp/ban hành cho tổ chức. KHÁC van_ban_uy_quyen: ủy quyền giao việc cho cá nhân cụ thể; loại này xác lập tư cách pháp nhân tổ chức. KHÁC webca: webca là bảng đối chiếu chữ ký số, không phải giấy chứng nhận thành lập.',
    title: 'Đăng ký kinh doanh',
  },
  {
    code: 'can_cuoc_cong_dan',
    indicators: ['CĂN CƯỚC CÔNG DÂN', 'CITIZEN IDENTITY CARD', 'số CCCD', 'personal identification number'],
    description: "Nhận diện thẻ CĂN CƯỚC CÔNG DÂN (Citizen Identity Card — mẫu cũ, trước 2024) khi tiêu đề ghi ĐẦY ĐỦ cụm 'CĂN CƯỚC CÔNG DÂN' hoặc 'CITIZEN IDENTITY CARD'. Đặc trưng: ảnh chân dung, số định danh 12 chữ số, có chữ 'CÔNG DÂN'/'CITIZEN'. QUY TẮC PHÂN BIỆT: nếu tiêu đề có từ 'CÔNG DÂN'/'CITIZEN' → chọn loại này; nếu chỉ ghi 'CĂN CƯỚC'/'IDENTITY CARD' (không có 'CÔNG DÂN'/'CITIZEN') → chọn can_cuoc.",
    title: '<Tên người> - <Số Căn cước công dân>',
  },
  {
    code: 'can_cuoc',
    indicators: ['CĂN CƯỚC', 'IDENTITY CARD', 'số căn cước'],
    description: "Nhận diện thẻ CĂN CƯỚC (Identity Card — mẫu mới từ 07/2024) khi tiêu đề ghi 'CĂN CƯỚC'/'IDENTITY CARD' mà KHÔNG có từ 'CÔNG DÂN'/'CITIZEN'. Đặc trưng: thẻ căn cước theo Luật Căn cước 2023. QUY TẮC PHÂN BIỆT bắt buộc: chỉ chọn loại này khi tiêu đề là 'CĂN CƯỚC' đứng riêng; nếu có 'CÔNG DÂN'/'CITIZEN' phía sau thì thuộc can_cuoc_cong_dan.",
    title: '<Tên người> - <Số Căn cước>',
  },
  {
    code: 'passport',
    indicators: ['HỘ CHIẾU', 'PASSPORT', 'số hộ chiếu', 'passport no', 'nationality'],
    description: "Nhận diện khi tiêu đề/đầu trang có 'HỘ CHIẾU' hoặc 'PASSPORT'. Đặc trưng: có 'Type/Loại', 'Passport No./Số hộ chiếu', 'Nationality/Quốc tịch', dòng MRZ (machine-readable zone — dãy ký tự và dấu '<<' ở cuối trang), ảnh chân dung. KHÁC căn cước/thị thực — hộ chiếu là sổ/trang xuất nhập cảnh do Bộ Công an cấp cho công dân.",
    title: '<Tên người> - <Số Hộ chiếu>',
  },
  {
    code: 'webca',
    indicators: ['WEBCA', 'Serial Number', 'Độ dài khóa', 'key length', 'Ban Cơ yếu Chính phủ', 'CN =', 'OU =', 'Trạng thái', 'digital signature'],
    description: "Nhận diện BẢNG KẾT QUẢ KIỂM TRA CHỮ KÝ SỐ (digital signature verification table — tra cứu WEBCA của VPBank) — bảng danh sách người ký/chứng thư số (certificate list), mỗi dòng một khách hàng. Dấu hiệu MẠNH NHẤT: các cột đặc trưng 'STT | Tên (Name) | Serial Number | DN | Độ dài khóa (Key length) | CA | Trạng thái (Status) | Lý do (Reason) | Thời hạn từ (Valid from) | Thời hạn đến (Valid to) | Chữ ký (Signature) | Ngày ký (Signed date) | Chủ TK | KTT'. Cực kỳ đặc trưng: cột DN (Distinguished Name) và CA chứa chuỗi định danh X.500 dạng 'C = VN, L = ..., O = ..., OU = ..., CN = ..., E = ...@....gov.vn' (C = Country/mã Quốc gia, L = Locality/Tỉnh, O = Organization/Tổ chức, OU = Organizational Unit/Đơn vị, CN = Common Name/Tên thường gọi, E = Email). Có Serial Number dạng hex, Độ dài khóa (2048/3072), tổ chức cấp 'Ban Cơ yếu Chính phủ', và trạng thái 'Hợp lệ'/'Valid'. Chỉ cần thấy chuỗi 'C = VN, ... O = ..., CN = ...' trong bảng là gắn nhãn này. KHÁC dang_ky_kinh_doanh — webca là bảng đối chiếu chữ ký số, không phải giấy chứng nhận đăng ký.",
    title: 'Check webca',
  },
  {
    code: 'thi_thuc',
    indicators: ['THỊ THỰC', 'VISA', 'ELECTRONIC VISA', 'e-visa', 'số thị thực', 'visa no'],
    description: "Nhận diện khi tài liệu là THỊ THỰC/VISA (kể cả thị thực điện tử ELECTRONIC VISA / e-visa). Đặc trưng: có 'Visa No.'/'Số thị thực', loại thị thực (type), thời hạn lưu trú (duration of stay — từ ngày/đến ngày), cơ quan cấp thị thực. KHÁC hộ chiếu (passport) và thẻ tạm trú — thị thực là giấy phép NHẬP CẢNH/LƯU TRÚ (entry/stay permit) có thời hạn, thường dán/đính kèm hộ chiếu.",
    title: '<Tên người> - <Số Thị thực>',
  },
  {
    code: 'the_tam_tru',
    indicators: ['THẺ TẠM TRÚ', 'Temporary Residence Card', 'số thẻ tạm trú'],
    description: 'Nhận diện khi tiêu đề là THẺ TẠM TRÚ / Temporary Residence Card. Đặc trưng: cấp cho người nước ngoài được phép cư trú có thời hạn tại Việt Nam, có số thẻ (card no.), thời hạn tạm trú (period of temporary residence), ảnh chân dung. KHÁC thị thực (thi_thuc) — thẻ tạm trú là THẺ cư trú dài hạn (residence card) thay thế thị thực, không phải giấy phép nhập cảnh từng lần.',
    title: '<Tên người> - <Số Thẻ tạm trú>',
  },
  {
    code: 'phieu_thu_phi',
    indicators: ['PHIẾU THU PHÍ', 'phiếu thu phí dịch vụ', 'phiếu thu', 'receipt', 'service fee receipt'],
    description: 'Nhận diện khi tiêu đề là PHIẾU THU PHÍ / Phiếu thu phí dịch vụ (Service Fee Receipt). Đặc trưng: chứng từ xác nhận đã thu một khoản phí dịch vụ, có số tiền (amount), nội dung thu phí, người/đơn vị nộp, ngày thu và chữ ký/xác nhận của thu ngân (cashier). Bản chất là chứng từ tài chính, không phải giấy tờ định danh hay biểu mẫu hợp đồng.',
    title: 'Phiếu thu phí',
  },
];
