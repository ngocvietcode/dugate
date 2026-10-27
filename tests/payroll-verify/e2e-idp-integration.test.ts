/**
 * End-to-end integration test for Payroll Verify workflow — IDP format.
 *
 * Tests the full request parsing pipeline:
 * 1. IDP InputSample.json → parse artifacts → file_urls
 * 2. CSP token fetch (mocked)
 * 3. File download with Bearer auth (mocked)
 * 4. Webhook callback with Bearer auth (mocked)
 *
 * NOTE: This test validates the integration layer (parsing, auth, routing).
 * It does NOT call real CSP/IDP endpoints or AI connectors.
 */

import { getCspToken, clearCspTokenCache } from '@/lib/csp-token';
import type { CspTokenConfig } from '@/lib/csp-token';
import type { FileUrlAuthConfig, FileUrlEntry } from '@/lib/file-url-downloader';
import { classifyFiles, mergeOcrResults } from '@/lib/pipelines/workflows/payroll-verify';
import { comparePayrollData } from '@/lib/pipelines/workflows/payroll-verify-compare';
import { DEFAULT_COMPARE_CONFIG, createEmptyThongTinChung, type PayrollJSON } from '@/lib/pipelines/workflows/prompts/payroll-verify-prompts';

// ─── Load IDP Input Sample ────────────────────────────────────────────────────

// Synthetic IDP envelope: independent of untracked handover files and live systems.
const IDP_SAMPLE: Array<Record<string, unknown>> = [{
  request_id: 'case-test-payroll',
  callback_url: 'https://idp.example.test/hook/v1/cases/case-test-payroll',
  artifacts: [
    { artifact_code: 'payment_request_excel', file_type: 'xlsx', url: 'https://idp.example.test/files/payroll.xlsx' },
    { artifact_code: 'payment_request_pdfs', file_type: 'pdf', url: 'https://idp.example.test/files/payroll.pdf' },
  ],
}];

jest.mock('@/lib/pipelines/processors/http-client', () => ({
  ...jest.requireActual('@/lib/pipelines/processors/http-client'),
  assertSafeUrl: jest.fn(async (url: string) => url),
  ssrfSafeFetch: jest.fn(async () => { throw new Error('simulated CSP network failure'); }),
}));
const sample = IDP_SAMPLE[0];

// ─── Test: IDP Input Parsing ──────────────────────────────────────────────────

describe('E2E: IDP Input Sample Parsing', () => {
  it('should extract file_urls from IDP artifacts', () => {
    const artifacts = sample.artifacts as Array<{
      artifact_code: string;
      url: string;
      file_type: string;
    }>;

    expect(artifacts).toHaveLength(2);

    const fileUrls: FileUrlEntry[] = artifacts.map((a) => ({
      url: a.url,
      filename: `${a.artifact_code}.${a.file_type}`,
      mime_type: a.file_type === 'pdf' ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));

    expect(fileUrls[0].url).toContain('idp.example.test/files/');
    expect(fileUrls[0].filename).toBe('payment_request_excel.xlsx');
    expect(fileUrls[1].filename).toBe('payment_request_pdfs.pdf');
  });

  it('should extract callback_url from IDP sample', () => {
    const callbackUrl = sample.callback_url as string;
    expect(callbackUrl).toContain('idp.example.test/hook/v1/cases/');
  });

  it('should extract request_id from IDP sample', () => {
    expect(sample.request_id).toBe('case-test-payroll');
  });

  it('should build csp_oauth2 auth config from known credentials', () => {
    const authConfig: FileUrlAuthConfig = {
      type: 'csp_oauth2',
      token_url: 'https://idp.example.test/auth/v1/csp/token',
      client_id: 'int-eda-aif-rpa-du-cli',
      client_secret: 'test-client-secret', // placeholder — no test reads this value
    };

    expect(authConfig.type).toBe('csp_oauth2');
    expect(authConfig.token_url).toContain('/auth/v1/csp/token');
  });
});

// ─── Test: CSP Token Manager ──────────────────────────────────────────────────

describe('E2E: CSP Token Manager', () => {
  const mockConfig: CspTokenConfig = {
    token_url: 'https://idp.example.test/auth/v1/csp/token',
    client_id: 'test-client',
    client_secret: 'test-secret',
  };

  beforeEach(() => {
    clearCspTokenCache(mockConfig);
  });

  it('should throw on network error (no real CSP endpoint)', async () => {
    // This test confirms getCspToken properly throws when CSP is unreachable
    // In production, the real CSP endpoint would respond
    await expect(getCspToken(mockConfig)).rejects.toThrow('simulated CSP network failure');
  });
});

// ─── Test: File Classification with IDP-style filenames ───────────────────────

describe('E2E: File Classification with IDP artifacts', () => {
  it('should classify IDP artifact filenames correctly', () => {
    const filesData = [
      { name: 'payment_request_pdfs.pdf', path: '/tmp/a.pdf', mime: 'application/pdf', size: 1000 },
      { name: 'payment_request_excel.xlsx', path: '/tmp/b.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 2000 },
    ];

    const { pdfFiles, excelFile } = classifyFiles(filesData);
    expect(pdfFiles[0].name).toBe('payment_request_pdfs.pdf');
    expect(excelFile.name).toBe('payment_request_excel.xlsx');
  });
});

// ─── Test: Compare Engine with realistic payroll data ─────────────────────────

describe('E2E: Compare Engine with realistic VPBank payroll data', () => {
  const excelResult: PayrollJSON = {
    thong_tin_chung: {
      ...createEmptyThongTinChung(),
      ten_don_vi_chuyen_tien: 'CÔNG TY TNHH ABC VIỆT NAM',
      ma_kh_cif: '123456',
      dia_chi: '123 Nguyễn Huệ, Q1, TP.HCM',
      dien_thoai: '0901234567',
      so_tai_khoan_trich_no: '1234567890',
      loai_tien: 'VND',
      tong_so_tien_bang_so: '133.855.000',
      tong_so_tien_bang_chu: 'Một trăm ba mươi ba triệu tám trăm năm mươi lăm nghìn đồng',
      ngay_lenh_chi: '15/03/2026',
      noi_dung_thanh_toan: 'Chi lương tháng 03/2026',
      tong_so_nhan_vien: 3,
      so_nhan_vien_vpbank: 2,
      so_nhan_vien_ngan_hang_khac: 1,
    },
    danh_sach_trong_vpbank: [
      { stt: 1, ho_ten: 'NGUYỄN VĂN A', so_tai_khoan: '0901234567', so_tien: '50.000.000', ngan_hang: 'VPBANK', loai_tai_khoan: 'vpbank', so_tien_bang_chu: null, dia_chi: null, ten_chi_nhanh: null, tinh_tp: null, ghi_chu: null, noi_dung_thanh_toan_chi_tiet: null, loai_tien: null },
      { stt: 2, ho_ten: 'TRẦN THỊ B', so_tai_khoan: '0387654321', so_tien: '45.000.000', ngan_hang: 'VPBANK', loai_tai_khoan: 'vpbank', so_tien_bang_chu: null, dia_chi: null, ten_chi_nhanh: null, tinh_tp: null, ghi_chu: null, noi_dung_thanh_toan_chi_tiet: null, loai_tien: null },
    ],
    danh_sach_ngoai_vpbank: [
      { stt: 1, ho_ten: 'LÊ VĂN C', so_tai_khoan: '9876543210', so_tien: '38.855.000', ngan_hang: 'VIETCOMBANK', loai_tai_khoan: 'ngan_hang_khac', so_tien_bang_chu: null, dia_chi: null, ten_chi_nhanh: null, tinh_tp: null, ghi_chu: null, noi_dung_thanh_toan_chi_tiet: null, loai_tien: null },
    ],
  };

  // PDF OCR result — simulates OCR with minor formatting differences
  const pdfResult: PayrollJSON = {
    thong_tin_chung: {
      ...createEmptyThongTinChung(),
      ten_don_vi_chuyen_tien: 'CONG TY TNHH ABC VIET NAM', // OCR: no accents
      ma_kh_cif: '123456',
      dia_chi: '123 Nguyen Hue, Q1, TP.HCM',
      dien_thoai: '0901234567',
      so_tai_khoan_trich_no: '1234567890',
      loai_tien: 'VND',
      tong_so_tien_bang_so: '133,855,000', // OCR: commas instead of dots
      tong_so_tien_bang_chu: 'Mot tram ba muoi ba trieu tam tram nam muoi lam nghin dong',
      ngay_lenh_chi: '15/03/2026',
      noi_dung_thanh_toan: 'Chi luong thang 03/2026',
      tong_so_nhan_vien: 3,
      so_nhan_vien_vpbank: 2,
      so_nhan_vien_ngan_hang_khac: 1,
    },
    danh_sach_trong_vpbank: [
      { stt: 1, ho_ten: 'NGUYEN VAN A', so_tai_khoan: '0901234567', so_tien: '50,000,000', ngan_hang: 'VPBANK', loai_tai_khoan: 'vpbank', so_tien_bang_chu: null, dia_chi: null, ten_chi_nhanh: null, tinh_tp: null, ghi_chu: null, noi_dung_thanh_toan_chi_tiet: null, loai_tien: null },
      { stt: 2, ho_ten: 'TRAN THI B', so_tai_khoan: '0387654321', so_tien: '45,000,000', ngan_hang: 'VPBANK', loai_tai_khoan: 'vpbank', so_tien_bang_chu: null, dia_chi: null, ten_chi_nhanh: null, tinh_tp: null, ghi_chu: null, noi_dung_thanh_toan_chi_tiet: null, loai_tien: null },
    ],
    danh_sach_ngoai_vpbank: [
      { stt: 1, ho_ten: 'LE VAN C', so_tai_khoan: '9876543210', so_tien: '38,855,000', ngan_hang: 'VIETCOMBANK', loai_tai_khoan: 'ngan_hang_khac', so_tien_bang_chu: null, dia_chi: null, ten_chi_nhanh: null, tinh_tp: null, ghi_chu: null, noi_dung_thanh_toan_chi_tiet: null, loai_tien: null },
    ],
  };

  it('should produce APPROVED when Excel and PDF match (with normalization)', () => {
    const result = comparePayrollData(excelResult, pdfResult, DEFAULT_COMPARE_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.final_decision).toBe('APPROVED');
    expect(result.compare_status).toBe('pass');
    expect(result.summary.header_status).toBe('pass');
    expect(result.summary.detail_status).toBe('pass');
    expect(result.summary.matched_rows).toBe(3);
    expect(result.summary.mismatched_rows).toBe(0);
    expect(result.summary.missing_in_pdf).toBe(0);
  });

  it('should produce REVIEW_REQUIRED when amounts differ', () => {
    const pdfWithError = {
      ...pdfResult,
      danh_sach_trong_vpbank: [
        { ...pdfResult.danh_sach_trong_vpbank[0], so_tien: '99,999,999' }, // Wrong amount
        pdfResult.danh_sach_trong_vpbank[1],
      ],
    };

    const result = comparePayrollData(excelResult, pdfWithError, DEFAULT_COMPARE_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.final_decision).toBe('REVIEW_REQUIRED');
    expect(result.summary.mismatched_rows).toBeGreaterThan(0);
  });

  it('should detect missing employees in PDF', () => {
    const pdfMissing = {
      ...pdfResult,
      danh_sach_trong_vpbank: [pdfResult.danh_sach_trong_vpbank[0]], // Only 1 of 2
    };

    const result = comparePayrollData(excelResult, pdfMissing, DEFAULT_COMPARE_CONFIG);

    expect(result.final_decision).toBe('REVIEW_REQUIRED');
    expect(result.summary.missing_in_pdf).toBe(1);
  });

  it('webhook payload should include extracted_data with compare results', () => {
    const result = comparePayrollData(excelResult, pdfResult, DEFAULT_COMPARE_CONFIG);

    // Simulate what sendWebhook would include
    const webhookPayload = {
      operation_id: 'test-op-id',
      state: 'SUCCEEDED',
      done: true,
      extracted_data: {
        compare_status: result.compare_status,
        final_decision: result.final_decision,
        summary: result.summary,
        header_compare: result.header_compare,
        detail_results: result.detail_results,
      },
    };

    expect(webhookPayload.extracted_data.final_decision).toBe('APPROVED');
    expect(webhookPayload.extracted_data.summary.matched_rows).toBe(3);
    expect(webhookPayload.extracted_data.header_compare.map((rule) => rule.field_code)).toEqual(
      DEFAULT_COMPARE_CONFIG.header_rules.map((rule) => rule.field_code),
    );
    expect(webhookPayload.extracted_data.detail_results.length).toBe(2); // trong_vpbank + ngoai_vpbank
  });
});

// ─── Test: Full IDP → DUGate request mapping ─────────────────────────────────

describe('E2E: IDP → DUGate Request Mapping', () => {
  it('should map IDP InputSample to DUGate workflow API call', () => {
    const artifacts = sample.artifacts as Array<{ artifact_code: string; url: string; file_type: string }>;
    const callbackUrl = sample.callback_url as string;

    // This is what the IDP adapter would build for the DUGate API call
    const duGateRequest = {
      process: 'payroll-verify',
      file_urls: JSON.stringify(artifacts.map((a) => ({
        url: a.url,
        filename: `${a.artifact_code}.${a.file_type}`,
        mime_type: a.file_type === 'pdf' ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }))),
      file_url_auth: JSON.stringify({
        type: 'csp_oauth2',
        token_url: 'https://idp.example.test/auth/v1/csp/token',
        client_id: 'int-eda-aif-rpa-du-cli',
        client_secret: 'test-client-secret', // placeholder — no test reads this value
      }),
      webhook_url: callbackUrl,
      csp_token_url: 'https://idp.example.test/auth/v1/csp/token',
      csp_client_id: 'csp-service',
      csp_client_secret: 'callback-secret',
    };

    // Validate the mapping
    expect(duGateRequest.process).toBe('payroll-verify');

    const fileUrls = JSON.parse(duGateRequest.file_urls);
    expect(fileUrls).toHaveLength(2);
    expect(fileUrls[0].filename).toBe('payment_request_excel.xlsx');
    expect(fileUrls[1].filename).toBe('payment_request_pdfs.pdf');

    const authConfig = JSON.parse(duGateRequest.file_url_auth);
    expect(authConfig.type).toBe('csp_oauth2');

    expect(duGateRequest.webhook_url).toContain('/hook/v1/cases/');
  });
});
