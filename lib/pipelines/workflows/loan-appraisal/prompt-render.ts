// Dựng prompt từ template cho mọi bước LLM của loan-appraisal: thay placeholder, tự nối placeholder bắt buộc còn thiếu,
// bọc đoạn chống prompt injection và yêu cầu chỉ trả JSON. Tách khỏi `intake-review.ts` (bước đang tắt) để đường chạy
// chính không phải import module đó (D-97).
import { JSON_ONLY_OUTPUT_RULE } from '@/lib/loan-dossier/common/llm-json';

import { ensurePlaceholders, UNTRUSTED_DATA_GUARD } from '../prompts/loan-appraisal-prompts';

export function renderPrompt(template: string, required: string[], vars: Record<string, string>): string {
  const body = ensurePlaceholders(template, required).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => (key in vars ? vars[key] : match));
  return `${UNTRUSTED_DATA_GUARD}\n\n${body}\n\n${JSON_ONLY_OUTPUT_RULE}`;
}
