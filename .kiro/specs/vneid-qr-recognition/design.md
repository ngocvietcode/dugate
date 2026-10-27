# Design: Tách riêng nhận diện VNeID/QR

> Thiết kế này được viết từ yêu cầu nghiệp vụ, chưa đối chiếu code. Dev/Agent phải khảo sát code và điền mục "Kết quả khảo sát" trước khi sửa.

## Kết quả khảo sát (dev điền)
- Vị trí phân loại loại chứng từ: _TBD_
- Danh mục/enum loại chứng từ: _TBD_
- Vị trí định nghĩa trường trích xuất theo loại chứng từ: _TBD_
- Nơi checklist/đối chiếu chéo tham chiếu CCCD: _TBD_

## Hướng thiết kế
1. Thêm loại chứng từ mới `VNEID_QR` (tên theo quy ước code hiện có) vào danh mục loại.
2. Cập nhật bộ phân loại (prompt/rule) để tách hai loại, nêu đặc điểm nhận dạng: giao diện ứng dụng VNeID, mã QR định danh, so với mặt trước/sau thẻ CCCD vật lý.
3. Thêm bộ trường trích xuất riêng cho VNeID/QR theo danh sách BA chốt.
4. Rà soát mọi nơi tham chiếu CCCD (checklist, đối chiếu chéo) và quyết định dùng loại mới hay giữ nguyên theo quy tắc BA.

## Rủi ro
- Logic cũ coi VNeID/QR là CCCD có thể bị các bước sau phụ thuộc ngầm. Cần rà soát trước khi tách.

## Kiểm thử
- Bộ mẫu: CCCD, VNeID, QR, hồ sơ hỗn hợp. Kiểm tra phân loại và hiển thị checklist.
