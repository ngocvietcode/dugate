// T-S1-06 — cổng gọi model phân loại (S1-R03, R09, R10).
import { buildClassifyPrompt, ClassifierParseError, parseClassifierResponse } from '@/lib/loan-dossier/s1/classifier-port';

const valid = {
  page_quality: 'OK',
  matches: [{ doc_type_key: 'id_card', confidence: 0.9, instances: [{ page_range: [1, 2], confidence: 0.9, starts_new_document: true }] }],
};

describe('parseClassifierResponse', () => {
  it('phản hồi hợp lệ (object, chuỗi, chuỗi bọc ```json) được parse', () => {
    expect(parseClassifierResponse(valid).matches[0].doc_type_key).toBe('id_card');
    expect(parseClassifierResponse(JSON.stringify(valid)).page_quality).toBe('OK');
    expect(parseClassifierResponse('```json\n' + JSON.stringify(valid) + '\n```').matches).toHaveLength(1);
  });

  it('thiếu field → JSON_PARSE_ERROR', () => {
    const { page_quality: _drop, ...noQuality } = valid;
    expect(() => parseClassifierResponse(noQuality)).toThrow(ClassifierParseError);
    const noRange = { ...valid, matches: [{ ...valid.matches[0], instances: [{ confidence: 0.9 }] }] };
    expect(() => parseClassifierResponse(noRange)).toThrow(/JSON_PARSE_ERROR/);
  });

  it('JSON hỏng → JSON_PARSE_ERROR', () => {
    expect(() => parseClassifierResponse('{"page_quality": ')).toThrow(/JSON_PARSE_ERROR/);
  });
});

describe('buildClassifyPrompt', () => {
  it('chỉ nhận dải trang và số trang — không có tham số tên file/đường dẫn', () => {
    expect(buildClassifyPrompt.length).toBe(2);
  });

  it('liệt kê đủ 47 loại của catalog và yêu cầu xoay trang', () => {
    const p = buildClassifyPrompt([1, 4], 4);
    expect(p.match(/^- [a-z_]+: /gm)).toHaveLength(47);
    expect(p).toContain('xoay');
    expect(p).toContain('Tài liệu có 4 trang');
  });

  it('batch giữa file nêu trang tuyệt đối', () => {
    expect(buildClassifyPrompt([21, 40], 130)).toContain('trang 21–40 của tài liệu 130 trang');
  });

  it('S1-R18 / S1-AC12: định giá nội bộ vs chứng thư ngoài — dấu hiệu nhận biết thay cho note, và quy tắc chọn theo đơn vị lập', () => {
    const p = buildClassifyPrompt([1, 4], 4);
    const line = (k: string) => p.split('\n').find((l) => l.startsWith(`- ${k}: `))!;
    expect(line('real_estate_valuation_report')).toContain('Do Công ty TNHH Thịnh Điền lập');
    expect(line('real_estate_valuation_report')).not.toContain('Thay thế lẫn nhau');
    expect(line('external_valuation_certificate')).toContain('CHỨNG THƯ THẨM ĐỊNH GIÁ');
    expect(p).toContain('chọn loại theo ĐƠN VỊ LẬP văn bản');
  });

  it('S1-R18 / S1-AC13: màn hình "Thông tin Căn cước công dân" (lấy từ QR) phân biệt được với VNeID', () => {
    const p = buildClassifyPrompt([1, 4], 4);
    const line = (k: string) => p.split('\n').find((l) => l.startsWith(`- ${k}: `))!;
    expect(line('qr_code_info')).toContain('Thông tin này được lấy từ mã QR in trên CCCD');
    expect(line('qr_code_info')).toContain('Số CMND');
    expect(line('qr_code_info')).toContain('KHÔNG có ảnh chân dung');
    expect(line('vneid')).toContain('ảnh chân dung');
    expect(line('vneid')).toContain('KHÔNG phải màn hình thông tin lấy từ mã QR');
  });

  it('S1-R18 / S1-AC14: màn hình VNeID "Thông tin cá nhân" (ảnh + "Định danh mức 2", không quê quán) được nhận là VNeID', () => {
    const p = buildClassifyPrompt([1, 4], 4);
    const line = (k: string) => p.split('\n').find((l) => l.startsWith(`- ${k}: `))!;
    expect(line('vneid')).toContain('Định danh mức 2');
    expect(line('vneid')).toContain('Thông tin cá nhân');
    expect(line('vneid')).toContain('Số định danh cá nhân');
    expect(line('vneid')).toContain('Số điện thoại');
    expect(line('vneid')).toContain('có thể không có quê quán');
    // QR vẫn bị loại trừ: không ảnh chân dung, không huy hiệu định danh
    expect(line('vneid')).toContain('không huy hiệu định danh');
  });

  it('S1-R18 / S1-AC15: báo cáo Thịnh Điền BĐS vs động sản phân biệt theo tiêu đề / dòng "Áp dụng đối với"', () => {
    const p = buildClassifyPrompt([1, 4], 4);
    const line = (k: string) => p.split('\n').find((l) => l.startsWith(`- ${k}: `))!;
    expect(line('real_estate_valuation_report')).toContain('BÁO CÁO TƯ VẤN VỀ GIÁ TÀI SẢN BẢO ĐẢM');
    expect(line('real_estate_valuation_report')).toContain('Áp dụng đối với tài sản là Bất động sản');
    expect(line('real_estate_valuation_report')).toContain('KHÔNG thuộc loại này, thuộc movable_asset_valuation_report');
    expect(line('movable_asset_valuation_report')).toContain('BÁO CÁO TƯ VẤN GIÁ HIỆN TRẠNG TÀI SẢN ĐẢM BẢO');
    expect(line('movable_asset_valuation_report')).toContain('PTVT/PTTC/MMTB/DCSX');
    expect(line('movable_asset_valuation_report')).toContain('KHÔNG thuộc loại này');
    expect(p).toContain('LOẠI TÀI SẢN ghi ở tiêu đề');
    // chứng thư công ty ngoài vẫn tách riêng
    expect(line('external_valuation_certificate')).toContain('CHỨNG THƯ THẨM ĐỊNH GIÁ');
  });
});
