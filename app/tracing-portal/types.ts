// app/tracing-portal/types.ts
// Shared types for the Tracing Portal (BBKQ CDM/ATM OCR Test) page.

export type ProcessingStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export interface TracingDocument {
  file_name: string;
  status: 'success' | 'error';
  extracted_data: ExtractedFields | null;
  error_message?: string;
}

export interface ExtractedFields {
  loai_tai_lieu: string;
  don_vi_tiep_quy: string;
  ma_may: string;
  loai_may: string;
  ngay_bat_dau_chu_ky: string;
  ngay_kiem_quy: string;
  so_tien_chenh_lech: string;
}

export interface TracingResult {
  tong_so_tai_lieu: number;
  danh_sach_tai_lieu: TracingDocument[];
}

export interface OperationResponse {
  name: string;
  done: boolean;
  metadata: {
    state: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    progress_percent?: number;
    progress_message?: string;
  };
  result?: {
    extracted_data: TracingResult;
  };
  error?: {
    message: string;
    code: string;
  };
}
