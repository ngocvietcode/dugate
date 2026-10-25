# credit-kit/lac — hướng dẫn cho agent

Đọc trước: `docs/constitution.md`, `docs/credit/lac-rules.md`, `specs/002-credit-appraisal-assist/tasks.md` (Phase L).

## Luật của package này
1. **Tất định.** Không gọi mạng, không gọi AI, không đọc giờ hệ thống làm đầu vào quy tắc (ngày tham chiếu đi qua tham số `--ref-date`). Cùng đầu vào + cùng cấu hình → cùng output.
2. **Không dữ liệu thật trong repo.** Fixture chỉ là hồ sơ giả lập (L2). Không dán số định danh, SĐT, họ tên, địa chỉ thật vào code, test, comment, commit message. `cases/` và `out/` đã bị ignore.
3. **Không log giá trị trường của người**; log mã F#/X#/D# và hash.
4. **Phase L giữ nguyên logic PoC.** Chỉ đổi import, tách hằng số ra cấu hình (L4), thêm test. Thay đổi hành vi quy tắc phải: (a) có trong `docs/credit/lac-rules.md`, (b) có test, (c) cập nhật snapshot có giải thích.
5. **Không bao giờ tự sửa số tiền, số định danh, chủ sở hữu**; nghi ngờ thì xếp C (lac-rules §1).
6. Package là activity của tầng Apps (constitution L2): không import code của Core, không gọi Core/AIHub/DB.

## Lệnh
```bash
pip install -e '.[draw,dev]'
python -m lac.validate <case.json> -o out/ --ref-date YYYY-MM-DD
pytest            # từ L3 trở đi
```
