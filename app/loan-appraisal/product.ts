// app/loan-appraisal/product.ts
// Sản phẩm mặc định phía client, đọc từ loan_products.json (không khai báo cứng mã sản phẩm ở frontend nữa).
// Danh sách checklist KHÔNG khai báo ở frontend: giao diện đọc `checklist.items` của kết quả (S4, theo checklist_catalog.json — V2-R10).
// Danh sách sản phẩm và luồng để chọn: app/loan-appraisal-v2/lib/product-options.ts.
import loanProducts from '@/lib/loan-dossier/catalog/data/loan_products.json';

const fallback = loanProducts.products.find((p) => p.product_code === loanProducts.default_product_code) ?? loanProducts.products[0];

export const PRODUCT = {
  code: fallback.product_code,
  name: fallback.name,
};