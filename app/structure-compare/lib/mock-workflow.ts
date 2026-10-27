// app/structure-compare/lib/mock-workflow.ts
// Mock workflow simulation for testing the structure-compare UI without a backend.
// Simulates the full lifecycle: submit → polling (steps reveal) → WAITING_USER_INPUT → resume → complete.

import type { MappingTable, DocumentOutline, ComparisonReport, ChangeRecord } from '@/lib/structure-compare/types';

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_V1_OUTLINE: DocumentOutline = {
  documentId: 'v1-mock',
  documentName: 'Hop dong V1.pdf',
  sections: [
    { id: 'v1-s1', identifier: 'Điều 1', title: 'Phạm vi điều chỉnh', level: 4, startPos: 0, endPos: 500, content: 'Hợp đồng này quy định...' },
    { id: 'v1-s2', identifier: 'Điều 2', title: 'Đối tượng áp dụng', level: 4, startPos: 500, endPos: 1000, content: 'Áp dụng cho các bên...' },
    { id: 'v1-s3', identifier: 'Điều 3', title: 'Quyền và nghĩa vụ', level: 4, startPos: 1000, endPos: 1800, content: 'Bên A có quyền...' },
    { id: 'v1-s4', identifier: 'Điều 4', title: 'Thanh toán', level: 4, startPos: 1800, endPos: 2500, content: 'Thanh toán trong vòng 15 ngày...' },
    { id: 'v1-s5', identifier: 'Điều 5', title: 'Phạt vi phạm', level: 4, startPos: 2500, endPos: 3000, content: 'Phạt 3% giá trị hợp đồng...' },
    { id: 'v1-s6', identifier: 'Điều 6', title: 'Giải quyết tranh chấp', level: 4, startPos: 3000, endPos: 3500, content: 'Tranh chấp giải quyết tại...' },
  ],
  confidence: 92,
  isUncertain: false,
  source: 'ai_extracted',
};

const MOCK_V2_OUTLINE: DocumentOutline = {
  documentId: 'v2-mock',
  documentName: 'Hop dong V2.pdf',
  sections: [
    { id: 'v2-s1', identifier: 'Điều 1', title: 'Phạm vi điều chỉnh', level: 4, startPos: 0, endPos: 500, content: 'Hợp đồng này quy định...' },
    { id: 'v2-s2', identifier: 'Điều 2', title: 'Đối tượng áp dụng', level: 4, startPos: 500, endPos: 1000, content: 'Áp dụng cho các bên...' },
    { id: 'v2-s3', identifier: 'Điều 3', title: 'Bảo mật thông tin', level: 4, startPos: 1000, endPos: 1500, content: 'Các bên cam kết bảo mật...' },
    { id: 'v2-s4', identifier: 'Điều 4', title: 'Quyền và nghĩa vụ', level: 4, startPos: 1500, endPos: 2300, content: 'Bên A có quyền kiểm soát...' },
    { id: 'v2-s5', identifier: 'Điều 5', title: 'Thanh toán', level: 4, startPos: 2300, endPos: 3000, content: 'Thanh toán trong vòng 5 ngày...' },
    { id: 'v2-s6', identifier: 'Điều 6', title: 'Phạt vi phạm', level: 4, startPos: 3000, endPos: 3500, content: 'Phạt 5% giá trị hợp đồng...' },
    { id: 'v2-s7', identifier: 'Điều 7', title: 'Giải quyết tranh chấp', level: 4, startPos: 3500, endPos: 4000, content: 'Tranh chấp giải quyết tại...' },
  ],
  confidence: 88,
  isUncertain: false,
  source: 'ai_extracted',
};

const MOCK_MAPPING_TABLE: MappingTable = {
  sessionId: 'mock-session-001',
  entries: [
    { id: 'map-0', v1Sections: ['v1-s1'], v2Sections: ['v2-s1'], matchType: 'SAME', confidenceScore: 98, needsReview: false },
    { id: 'map-1', v1Sections: ['v1-s2'], v2Sections: ['v2-s2'], matchType: 'SAME', confidenceScore: 95, needsReview: false },
    { id: 'map-2', v1Sections: [], v2Sections: ['v2-s3'], matchType: 'NEW', confidenceScore: 100, needsReview: false },
    { id: 'map-3', v1Sections: ['v1-s3'], v2Sections: ['v2-s4'], matchType: 'CHANGED', confidenceScore: 72, needsReview: false },
    { id: 'map-4', v1Sections: ['v1-s4'], v2Sections: ['v2-s5'], matchType: 'CHANGED', confidenceScore: 68, needsReview: true },
    { id: 'map-5', v1Sections: ['v1-s5'], v2Sections: ['v2-s6'], matchType: 'CHANGED', confidenceScore: 75, needsReview: false },
    { id: 'map-6', v1Sections: ['v1-s6'], v2Sections: ['v2-s7'], matchType: 'RENUMBERED', confidenceScore: 90, needsReview: false },
  ],
  v1Outline: MOCK_V1_OUTLINE,
  v2Outline: MOCK_V2_OUTLINE,
  autoMappedPercentage: 85,
  isLocked: false,
};

const MOCK_CHANGE_RECORDS: ChangeRecord[] = [
  {
    code: 'CR-001',
    severity: 'CRITICAL',
    mappingEntryId: 'map-2',
    v1SectionId: '',
    v2SectionId: 'v2-s3',
    description: 'Thay đổi gì: V2 thêm mới Điều 3 về Bảo mật thông tin, yêu cầu các bên cam kết không tiết lộ thông tin mật.\\nTác động: Tạo nghĩa vụ bảo mật mới cho cả hai bên, vi phạm có thể dẫn đến bồi thường thiệt hại.',
    v1Quote: '[KHÔNG CÓ TRONG V1]',
    v2Quote: 'Các bên cam kết bảo mật toàn bộ thông tin liên quan đến Hợp đồng này. Bên vi phạm nghĩa vụ bảo mật phải bồi thường toàn bộ thiệt hại phát sinh.',
    category: 'STR-ADD',
  },
  {
    code: 'CR-002',
    severity: 'MAJOR',
    mappingEntryId: 'map-3',
    v1SectionId: 'v1-s3',
    v2SectionId: 'v2-s4',
    description: 'Thay đổi gì: V2 bổ sung quyền "kiểm soát" cho Bên A, mở rộng phạm vi quyền từ "giám sát" thành "kiểm soát".\\nTác động: Tăng cường quyền lực cho Bên A trong quá trình thực hiện hợp đồng.',
    v1Quote: 'Bên A có quyền giám sát việc thực hiện hợp đồng của Bên B.',
    v2Quote: 'Bên A có quyền kiểm soát và giám sát việc thực hiện hợp đồng của Bên B, bao gồm cả việc yêu cầu báo cáo định kỳ.',
    category: 'CON-RIGHT',
  },
  {
    code: 'CR-003',
    severity: 'CRITICAL',
    mappingEntryId: 'map-4',
    v1SectionId: 'v1-s4',
    v2SectionId: 'v2-s5',
    description: 'Thay đổi gì: Rút ngắn thời hạn thanh toán từ 15 ngày xuống còn 5 ngày làm việc.\\nTác động: Tăng áp lực tài chính cho Bên B, giảm thời gian chuẩn bị thanh toán đáng kể.',
    v1Quote: 'Thanh toán trong vòng 15 (mười lăm) ngày làm việc kể từ ngày nhận được hóa đơn hợp lệ.',
    v2Quote: 'Thanh toán trong vòng 05 (năm) ngày làm việc kể từ ngày nhận được hóa đơn hợp lệ.',
    category: 'CON-VAL',
  },
  {
    code: 'CR-004',
    severity: 'MAJOR',
    mappingEntryId: 'map-5',
    v1SectionId: 'v1-s5',
    v2SectionId: 'v2-s6',
    description: 'Thay đổi gì: Tăng mức phạt vi phạm từ 3% lên 5% giá trị hợp đồng.\\nTác động: Tăng mức răn đe, bên vi phạm phải chịu chi phí cao hơn.',
    v1Quote: 'Bên vi phạm phải chịu phạt 3% (ba phần trăm) giá trị hợp đồng.',
    v2Quote: 'Bên vi phạm phải chịu phạt 5% (năm phần trăm) giá trị hợp đồng.',
    category: 'CON-PENALTY',
  },
  {
    code: 'CR-005',
    severity: 'STRUCTURAL',
    mappingEntryId: 'map-6',
    v1SectionId: 'v1-s6',
    v2SectionId: 'v2-s7',
    description: 'Thay đổi gì: Điều 6 (V1) đổi thành Điều 7 (V2) do thêm mới Điều 3 về Bảo mật. Nội dung giữ nguyên.\\nTác động: Thay đổi cấu trúc, không ảnh hưởng nội dung.',
    v1Quote: 'Mọi tranh chấp phát sinh từ hoặc liên quan đến Hợp đồng này sẽ được giải quyết tại Trung tâm Trọng tài Quốc tế Việt Nam.',
    v2Quote: 'Mọi tranh chấp phát sinh từ hoặc liên quan đến Hợp đồng này sẽ được giải quyết tại Trung tâm Trọng tài Quốc tế Việt Nam.',
    category: 'STR-REN',
  },
];

const MOCK_REPORT: ComparisonReport = {
  sessionId: 'mock-session-001',
  totalChanges: 5,
  changesBySeverity: { CRITICAL: 2, MAJOR: 2, STRUCTURAL: 1 },
  changes: MOCK_CHANGE_RECORDS,
  summary: 'Phát hiện 5 thay đổi: 2 nghiêm trọng, 2 quan trọng, 1 cấu trúc.',
  generatedAt: new Date().toISOString(),
};

// ─── Mock Workflow State Machine ─────────────────────────────────────────────

type MockState = 'idle' | 'ingesting' | 'extracting' | 'mapping' | 'waiting_input' | 'comparing' | 'done';

let mockState: MockState = 'idle';
let mockStepsResult: any[] = [];
let stateChangeTime = 0;

function advanceState() {
  const now = Date.now();
  const elapsed = now - stateChangeTime;

  switch (mockState) {
    case 'ingesting':
      if (elapsed > 2000) {
        mockState = 'extracting';
        stateChangeTime = now;
        mockStepsResult.push({
          step: 0, stepName: 'Layout OCR', processor: 'ext-doc-layout',
          content_preview: JSON.stringify({ v1: { chars: 3500 }, v2: { chars: 4000 } }),
        });
      }
      break;
    case 'extracting':
      if (elapsed > 2000) {
        mockState = 'mapping';
        stateChangeTime = now;
        mockStepsResult.push({
          step: 1, stepName: 'Structure Extraction', processor: 'ext-data-extractor',
          content_preview: JSON.stringify({ v1: { sections: 6 }, v2: { sections: 7 } }),
          extracted_data: { v1Outline: MOCK_V1_OUTLINE, v2Outline: MOCK_V2_OUTLINE },
        });
      }
      break;
    case 'mapping':
      if (elapsed > 1000) {
        mockState = 'waiting_input';
        stateChangeTime = now;
        mockStepsResult.push({
          step: 2, stepName: 'Auto-Mapping', processor: 'section-mapper',
          content_preview: JSON.stringify({ totalEntries: 7, autoMappedPercentage: 85 }),
          extracted_data: MOCK_MAPPING_TABLE,
        });
      }
      break;
    case 'comparing':
      if (elapsed > 3000) {
        mockState = 'done';
        stateChangeTime = now;
        mockStepsResult.push({
          step: 3, stepName: 'Section Comparison', processor: 'ext-comparator',
          content_preview: JSON.stringify({ totalChanges: 5, strategy: 'single-call' }),
          extracted_data: MOCK_CHANGE_RECORDS,
        });
        mockStepsResult.push({
          step: 4, stepName: 'Report Aggregation', processor: 'report-aggregator',
          content_preview: JSON.stringify({ totalChanges: 5, summary: MOCK_REPORT.summary }),
          extracted_data: MOCK_REPORT,
        });
      }
      break;
  }
}

// ─── Mock API Handlers ───────────────────────────────────────────────────────

export function mockSubmitWorkflow(): { id: string } {
  mockState = 'ingesting';
  mockStepsResult = [];
  stateChangeTime = Date.now();
  return { id: 'mock-op-structure-compare' };
}

export function mockPollOperation(): any {
  advanceState();

  const isWaiting = mockState === 'waiting_input';
  const isDone = mockState === 'done';

  return {
    name: 'operations/mock-op-structure-compare',
    done: isDone,
    metadata: {
      state: isDone ? 'SUCCEEDED' : isWaiting ? 'WAITING_USER_INPUT' : 'RUNNING',
      pipeline_steps: mockStepsResult,
      progress_percent: isDone ? 100 : mockStepsResult.length * 20,
      progress_message: isDone ? 'Hoàn tất' : 'Đang xử lý...',
    },
    ...(isDone ? {
      result: {
        pipeline_steps: mockStepsResult,
        extracted_data: MOCK_REPORT,
      },
    } : {}),
  };
}

export function mockResumeOperation(): { success: boolean } {
  mockState = 'comparing';
  stateChangeTime = Date.now();
  return { success: true };
}

export function isMockEnabled(): boolean {
  return typeof window !== 'undefined' &&
    (window.location.search.includes('mock=true') ||
     process.env.NEXT_PUBLIC_MOCK_MODE === 'true');
}
