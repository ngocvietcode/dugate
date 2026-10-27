// Registry phân khúc → Segment Pack (D-100). Nguồn duy nhất workflow dùng để chọn logic stage 2–4 theo sản phẩm.
// Thêm phân khúc: viết pack mới, thêm vào PACKS, trỏ phân khúc trong SEGMENT_PACK; `validateSegmentPackRegistry`
// (chạy khi worker khởi động và ở test) bắt sản phẩm nào trong loan_products.json không có pack.
import { listLoanProductConfigs, loanProductConfig, loadLoanProducts, type LoanProductsCatalog } from '@/lib/loan-dossier/catalog/products';

import { HKD_SECURED_PACK } from './hkd-secured';
import type { Segment, SegmentPack, SegmentPackSnapshot } from './types';

const PACKS: readonly SegmentPack[] = [HKD_SECURED_PACK];

/**
 * Phân khúc → pack_id. Phân khúc không có ở đây thì không có pack (sản phẩm thuộc phân khúc đó không chạy được).
 * SME → hkd-secured là HÀNH VI HIỆN TẠI được ghi tường minh: sản phẩm `sme` (khung, D-96) vẫn tính tài chính, policy,
 * khuyến nghị theo HKD cho tới khi có SME pack (ARCHITECTURE §10 giai đoạn 4). Kết quả SME vì vậy mang
 * `config_snapshot.segment_pack.pack_id = "hkd-secured"`.
 */
const SEGMENT_PACK: Readonly<Partial<Record<Segment, string>>> = {
  HKD: HKD_SECURED_PACK.pack_id,
  SME: HKD_SECURED_PACK.pack_id,
};

export function packById(packId: string): SegmentPack | undefined {
  return PACKS.find((p) => p.pack_id === packId);
}

/** Pack của sản phẩm; ném lỗi (không có pack mặc định) khi sản phẩm hoặc phân khúc chưa có pack. */
export function packForProduct(productCode: string, catalog: LoanProductsCatalog = loadLoanProducts()): { pack: SegmentPack; snapshot: SegmentPackSnapshot } {
  const product = loanProductConfig(productCode, catalog);
  if (!product) throw new Error(`INVALID_INPUT: Unsupported loan product_code "${productCode}".`);
  const packId = SEGMENT_PACK[product.segment];
  const pack = packId ? packById(packId) : undefined;
  if (!pack) throw new Error(`SYSTEM_ERROR: Phân khúc ${product.segment} của sản phẩm "${productCode}" chưa có segment pack.`);
  return { pack, snapshot: { pack_id: pack.pack_id, pack_version: pack.pack_version, segment: product.segment } };
}

/** Lỗi cấu hình registry so với danh mục sản phẩm; rỗng = hợp lệ. Fail-closed: worker không khởi động khi có lỗi. */
export function validateSegmentPackRegistry(catalog: LoanProductsCatalog = loadLoanProducts()): string[] {
  const errors: string[] = [];
  const ids = PACKS.map((p) => p.pack_id);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) errors.push(`pack_id trùng: ${id}`);
  for (const [segment, packId] of Object.entries(SEGMENT_PACK)) {
    if (packId && !packById(packId)) errors.push(`Phân khúc ${segment} trỏ tới pack không tồn tại: ${packId}`);
  }
  for (const p of listLoanProductConfigs(catalog)) {
    if (!SEGMENT_PACK[p.segment]) errors.push(`Sản phẩm "${p.product_code}" (phân khúc ${p.segment}) chưa có segment pack.`);
  }
  return errors;
}
