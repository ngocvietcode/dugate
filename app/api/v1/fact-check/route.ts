// app/api/v1/fact-check/route.ts
// POST /api/v1/fact-check — Recipe: 2-step Fact-check pipeline

import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

/**
 * @swagger
 * /api/v1/fact-check:
 *   post:
 *     summary: Kiểm tra và đối chiếu tài liệu với dữ liệu tham chiếu (2 bước)
 *     description: |
 *       Pipeline 2 bước:
 *       1. **Trích xuất (claim-extract)**: Đọc tài liệu PDF/DOCX và trích xuất các điểm dữ liệu (claims) cần kiểm tra.
 *       2. **Đối chiếu (fact-verify)**: So sánh claims với `reference_data` theo `business_rules` đã được admin cấu hình per API key.
 *
 *       **Trả về JSON report:**
 *       - `verdict`: `PASS | FAIL | WARNING | INCONCLUSIVE`
 *       - `score`: Tỉ lệ compliance (0–100)
 *       - `results[]`: Kết quả từng field với `document_value` vs `reference_value`
 *       - `discrepancies[]`: Danh sách điểm sai lệch
 *
 *       **Lưu ý bảo mật:** `business_rules` được admin cấu hình cố định theo API key profile.
 *       Client KHÔNG được gửi `business_rules` — request sẽ bị từ chối 400.
 *
 *       **Use cases:**
 *       - Xác minh hóa đơn khớp với đơn đặt hàng
 *       - Kiểm tra điều khoản hợp đồng với thư viện mẫu
 *       - Validate hồ sơ KYC với dữ liệu khách hàng
 *     tags: [Analyze]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, reference_data]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Tài liệu cần kiểm tra — PDF hoặc DOCX
 *               reference_data:
 *                 type: string
 *                 description: |
 *                   Dữ liệu tham chiếu để đối chiếu (JSON string hoặc văn bản thuần).
 *                   Ví dụ: JSON object từ ERP, nội dung đơn đặt hàng, dữ liệu khách hàng.
 *               extract_fields:
 *                 type: string
 *                 description: |
 *                   (Tùy chọn) Danh sách trường cần trích xuất, mô tả bằng ngôn ngữ tự nhiên.
 *                   Nếu không gửi, sẽ dùng danh sách mặc định trong profile của API key.
 *                   Ví dụ: "tên người mua, ngày hóa đơn, tổng tiền, mã số thuế người bán"
 *               webhook_url:
 *                 type: string
 *                 description: URL nhận thông báo khi xử lý xong (async)
 *     responses:
 *       202:
 *         description: |
 *           Operation đã tạo. Poll GET /api/v1/operations/{id} để lấy kết quả.
 *           Khi done=true, `result.extracted_data` chứa full check report.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name: { type: string }
 *                 done: { type: boolean }
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     state: { type: string, enum: [RUNNING, SUCCEEDED, FAILED, CANCELLED] }
 *                     progress_percent: { type: integer }
 *       400:
 *         description: Thiếu file, reference_data, hoặc client cố gắng gửi business_rules
 */
export async function POST(req: NextRequest) {
  return runEndpoint('fact-check', req);
}
