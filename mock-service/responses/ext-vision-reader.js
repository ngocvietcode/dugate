// responses/ext-vision-reader.js
// Connector: ext-vision-reader — Handwriting Vision Reader
// DU Cases: ingest:digitize
// Returns: Plain text string (digitized handwriting)

'use strict';

function buildResponse(fields, files, filename) {
  const model = fields.model || 'gpt-4o';

  const content = `Biểu mẫu: ${filename}
Ngày điền: 01/04/2026

── THÔNG TIN CÁ NHÂN ──────────────────────────────
Họ và tên:      NGUYỄN VĂN AN
Ngày sinh:      15/08/1988
Giới tính:      Nam  [✓]    Nữ  [✗]
CCCD/CMND:      079188001234
Nơi cấp:        Cục Cảnh sát QLHKTT - CA TP.HCM
Ngày cấp:       20/03/2019

── ĐỊA CHỈ LIÊN HỆ ─────────────────────────────────
Địa chỉ:        123 Đường Lê Văn Lương, P. Tân Hưng
Quận/Huyện:     Quận 7
Tỉnh/Thành phố: TP. Hồ Chí Minh
Điện thoại:     0901 234 567
Email:          nguyenvanan@email.com

── LỰA CHỌN DỊCH VỤ ────────────────────────────────
[✓] Gói cơ bản (500,000 VND/tháng)
[✗] Gói nâng cao (1,200,000 VND/tháng)
[✗] Gói doanh nghiệp (liên hệ)

── CAM KẾT & CHỮ KÝ ────────────────────────────────
Tôi cam kết những thông tin trên là đúng sự thật.

Chữ ký:   (đã ký)
Ngày:     01/04/2026

── GHI CHÚ CÁN BỘ TIẾP NHẬN ───────────────────────
Hồ sơ đầy đủ: Có
Đã xác minh:  Chưa
Ghi chú:      Cần photo CCCD mặt sau

---
[MOCK] Digitized by du-mock-service — ext-vision-reader (${model})`;

  return { content, model, mock: true };
}

module.exports = { buildResponse };
