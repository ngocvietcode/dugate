import { cleanLlmJson, extractJsonText, JSON_ONLY_OUTPUT_RULE, parseLlmJson } from '@/lib/loan-dossier/common/llm-json';
import { buildIncomeSourcePrompt, buildLoanPurposePrompt } from '@/lib/pipelines/workflows/loan-appraisal/condition-prompts';
import { buildCorrectionFacts, MASTER_CORRECTION_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/master-correction';
import { renderPrompt } from '@/lib/pipelines/workflows/loan-appraisal/intake-review';

const OBJ = { a: 1, b: 'x', nested: { c: [1, 2, 3] } };
const JSON_TEXT = JSON.stringify(OBJ);

describe('extractJsonText', () => {
  it.each([
    ['JSON trần', JSON_TEXT],
    ['khối mã ```json đầy đủ', '```json\n' + JSON_TEXT + '\n```'],
    ['khối mã ``` không ghi ngôn ngữ', '```\n' + JSON_TEXT + '\n```'],
    ['khối mã viết hoa ```JSON', '```JSON\n' + JSON_TEXT + '\n```'],
    ['THIẾU dấu đóng ```', '```json\n' + JSON_TEXT],
    ['thiếu dấu đóng và có xuống dòng cuối', '```json\n' + JSON_TEXT + '\n'],
    ['mở ngay trên cùng dòng với JSON', '```json ' + JSON_TEXT + ' ```'],
    ['lời dẫn rồi khối mã', 'Đây là kết quả:\n```json\n' + JSON_TEXT + '\n```'],
    ['khối mã rồi lời kết', '```json\n' + JSON_TEXT + '\n```\nHy vọng giúp ích.'],
    ['lời dẫn + khối mã thiếu dấu đóng', 'Kết quả như sau:\n```json\n' + JSON_TEXT],
    ['lời dẫn rồi JSON, không khối mã', 'Kết quả: ' + JSON_TEXT + ' — xong.'],
    ['CRLF', '```json\r\n' + JSON_TEXT + '\r\n```'],
    ['BOM', '\uFEFF' + JSON_TEXT],
  ])('%s', (_name, raw) => {
    expect(JSON.parse(extractJsonText(raw))).toEqual(OBJ);
  });

  it('dấu ngoặc và dấu ``` nằm TRONG chuỗi JSON không làm hỏng việc cân bằng ngoặc', () => {
    const tricky = { note: 'có } và { và ``` và \\" trong chuỗi', ok: true };
    const raw = 'Đây:\n' + JSON.stringify(tricky) + '\nHết.';
    expect(JSON.parse(extractJsonText(raw))).toEqual(tricky);
  });

  it('mảng gốc vẫn đọc được', () => {
    expect(JSON.parse(extractJsonText('```json\n[1,2,3]\n```'))).toEqual([1, 2, 3]);
  });

  it('lấy đối tượng JSON đầu tiên hợp lệ, bỏ qua ngoặc nhọn rác ở lời dẫn', () => {
    expect(JSON.parse(extractJsonText('Lưu ý {không phải JSON}. Kết quả: ' + JSON_TEXT))).toEqual(OBJ);
  });

  it('phản hồi bị cắt cụt (ngoặc không cân bằng) → trả nguyên chuỗi, không bịa dữ liệu', () => {
    const truncated = '```json\n{"a":1,"nested":{"c":[1,2';
    expect(extractJsonText(truncated)).toBe(truncated);
    expect(parseLlmJson(truncated)).toBeNull();
  });

  it('chuỗi không có JSON → trả nguyên, không throw', () => {
    expect(extractJsonText('xin lỗi, tôi không thể')).toBe('xin lỗi, tôi không thể');
    expect(extractJsonText('')).toBe('');
  });
});

describe('cleanLlmJson / parseLlmJson', () => {
  it('giá trị không phải chuỗi giữ nguyên (đã parse sẵn)', () => {
    expect(cleanLlmJson(OBJ)).toBe(OBJ);
    expect(parseLlmJson(OBJ)).toBe(OBJ);
    expect(parseLlmJson(null)).toBeNull();
  });
  it('chuỗi có khối mã → parse được', () => {
    expect(parseLlmJson('```json\n' + JSON_TEXT)).toEqual(OBJ);
  });
});

describe('quy tắc "chỉ JSON thuần" ở cuối prompt', () => {
  it('có đủ ý chính: ký tự đầu / cuối, cấm khối mã, cấm lời dẫn', () => {
    expect(JSON_ONLY_OUTPUT_RULE).toContain('{');
    expect(JSON_ONLY_OUTPUT_RULE).toMatch(/KHÔNG dùng khối mã markdown/);
    expect(JSON_ONLY_OUTPUT_RULE).toMatch(/không lời dẫn/);
  });

  it('renderPrompt luôn đặt quy tắc ở CUỐI, kể cả khi admin ghi đè prompt không còn câu dặn', () => {
    const p = renderPrompt('Khung riêng. {{x}}', ['x'], { x: 'dữ liệu' });
    expect(p.endsWith(JSON_ONLY_OUTPUT_RULE)).toBe(true);
    expect(p).toContain('Khung riêng. dữ liệu');
  });

  it('các prompt dựng bằng renderPrompt đều kết thúc bằng quy tắc', () => {
    expect(buildIncomeSourcePrompt(['Lương']).endsWith(JSON_ONLY_OUTPUT_RULE)).toBe(true);
    expect(buildLoanPurposePrompt(['Mua xe']).endsWith(JSON_ONLY_OUTPUT_RULE)).toBe(true);
    expect(renderPrompt(MASTER_CORRECTION_PROMPT_TEMPLATE, ['proposals', 'output_schema'], { proposals: '[]', output_schema: '{}' }).endsWith(JSON_ONLY_OUTPUT_RULE)).toBe(true);
    expect(buildCorrectionFacts([])).toEqual([]);
  });
});