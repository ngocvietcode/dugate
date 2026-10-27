import { orgNameLevel, parseOrgName } from '@/lib/loan-dossier/common/org-name';

describe('parseOrgName', () => {
  it('bỏ loại hình / danh xưng ở đầu, giữ phần tên riêng và loại hình chuẩn hóa', () => {
    expect(parseOrgName('CÔNG TY TNHH ABC')).toEqual({ core: 'ABC', form: 'TNHH' });
    expect(parseOrgName('Công ty trách nhiệm hữu hạn một thành viên Sao Mai')).toEqual({ core: 'SAO MAI', form: 'TNHH' });
    expect(parseOrgName('CTY CP Thương mại Hòa Bình')).toEqual({ core: 'THƯƠNG MẠI HÒA BÌNH', form: 'CP' });
    expect(parseOrgName('Công ty cổ phần ABC')).toEqual({ core: 'ABC', form: 'CP' });
    expect(parseOrgName('DNTN Minh Phát')).toEqual({ core: 'MINH PHÁT', form: 'DNTN' });
    expect(parseOrgName('Hợp tác xã Nông nghiệp Xanh')).toEqual({ core: 'NÔNG NGHIỆP XANH', form: 'HTX' });
  });

  it('tên không có loại hình giữ nguyên; rỗng / null an toàn', () => {
    expect(parseOrgName('ABC')).toEqual({ core: 'ABC', form: null });
    expect(parseOrgName('')).toEqual({ core: '', form: null });
    expect(parseOrgName(null)).toEqual({ core: '', form: null });
    expect(parseOrgName('CÔNG TY').core).toBe('');
  });

  it('chỉ bóc ở ĐẦU tên: từ loại hình nằm giữa tên riêng được giữ', () => {
    expect(parseOrgName('ABC CỔ PHẦN XYZ').core).toBe('ABC CỔ PHẦN XYZ');
  });
});

describe('orgNameLevel', () => {
  it('khác cách viết loại hình nhưng cùng tên riêng → EXACT', () => {
    expect(orgNameLevel('CÔNG TY TNHH ABC', 'Cty TNHH ABC')).toBe('EXACT');
    expect(orgNameLevel('CÔNG TY TNHH MTV ABC', 'Công ty TNHH ABC')).toBe('EXACT');
    expect(orgNameLevel('CÔNG TY TNHH ABC', 'ABC')).toBe('EXACT');
  });

  it('khác loại hình (TNHH ≠ CP, DNTN) thì không khớp dù cùng tên riêng', () => {
    expect(orgNameLevel('CÔNG TY TNHH ABC', 'CÔNG TY CỔ PHẦN ABC')).toBe('NO_MATCH');
    expect(orgNameLevel('CÔNG TY TNHH ABC', 'DNTN ABC')).toBe('NO_MATCH');
  });

  it('chỉ khác dấu tiếng Việt → SPELLING_DIFFERENCE (không tự gộp)', () => {
    expect(orgNameLevel('CÔNG TY TNHH THƯƠNG MẠI HÒA BÌNH', 'CONG TY TNHH THUONG MAI HOA BINH')).toBe('SPELLING_DIFFERENCE');
  });

  it('KHÔNG chấp nhận đảo từ hay lệch vài ký tự: tên công ty đảo từ là công ty khác', () => {
    expect(orgNameLevel('CÔNG TY TNHH VIỆT NAM ABC', 'CÔNG TY TNHH ABC VIỆT NAM')).toBe('NO_MATCH');
    expect(orgNameLevel('CÔNG TY TNHH ABC', 'CÔNG TY TNHH ABD')).toBe('NO_MATCH');
  });

  it('tên chỉ có loại hình hoặc rỗng không đủ để kết luận', () => {
    expect(orgNameLevel('CÔNG TY', 'CÔNG TY')).toBe('NO_MATCH');
    expect(orgNameLevel(null, 'CÔNG TY TNHH ABC')).toBe('NO_MATCH');
  });
});
