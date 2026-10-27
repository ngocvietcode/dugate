# Design: Checklist hồ sơ chính xác

> Thiết kế viết từ yêu cầu nghiệp vụ, chưa đối chiếu code. Dev/Agent khảo sát code và điền mục đầu tiên trước khi sửa.

## Kết quả khảo sát (dev điền)
- Nơi lưu bảng yêu cầu chứng từ (file/DB/prompt): _TBD_
- Logic sinh checklist và điều kiện áp dụng hiện tại: _TBD_
- Bảng đang dùng khác bản chuẩn BA cung cấp ở điểm nào: _TBD_

## Hướng thiết kế
1. Đưa bảng yêu cầu chứng từ về dạng dữ liệu có cấu trúc: `document_type`, `applies_when` (điều kiện), `required`, `version`, `effective_date`.
2. Điều kiện áp dụng dựa trên thuộc tính hồ sơ: loại khách hàng, loại tài sản, có đồng sở hữu, loại khoản vay... Danh sách thuộc tính do BA chốt.
3. Logic sinh checklist đọc bảng và chỉ yêu cầu chứng từ có điều kiện thỏa.
4. Nếu logic hiện tại nhúng cứng trong prompt, tách bảng ra khỏi prompt và nạp vào theo phiên bản.
5. Rà soát từng lỗi highlight, phân loại nguyên nhân và sửa dữ liệu hoặc logic tương ứng.

## Rủi ro
- Thuộc tính hồ sơ cần cho điều kiện (ví dụ có đồng sở hữu) có thể chưa được trích xuất. Khi đó phải phối hợp với spec Sổ đỏ hoặc bổ sung trích xuất.

## Kiểm thử
- Với mỗi lỗi highlight: hồ sơ tái hiện trước/sau sửa.
- Bộ ca theo tổ hợp điều kiện: cá nhân/pháp nhân x có/không đồng sở hữu.
