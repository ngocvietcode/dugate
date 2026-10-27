// mock-service/responses/ext-prompt-wizard.js
// Connector: ext-prompt-wizard — Prompt Upgrade Wizard
// Receives: prompt field containing the meta-prompt built by /api/internal/prompt-wizard
// Returns: { content: "<upgraded prompt text>" }

'use strict';

// Extracts the original prompt from between <prompt>...</prompt> tags in the meta-prompt
function extractOriginalPrompt(metaPrompt) {
  const match = metaPrompt.match(/<prompt>([\s\S]*?)<\/prompt>/);
  return match ? match[1].trim() : metaPrompt.trim();
}

// Extracts the problem description from the meta-prompt
function extractProblem(metaPrompt) {
  const lines = metaPrompt.split('\n');
  const idx = lines.findIndex(l => l.trim() === '## Vấn Đề Đang Gặp');
  if (idx === -1) return null;
  const next = lines.slice(idx + 1).find(l => l.trim() && !l.startsWith('##'));
  return next?.trim() || null;
}

function buildResponse(fields) {
  const metaPrompt = fields.query || fields.prompt || '';
  const originalPrompt = extractOriginalPrompt(metaPrompt);
  const problem = extractProblem(metaPrompt);

  // Simulate an upgraded prompt based on the original + problem
  const upgradedLines = [];

  // Header instruction
  upgradedLines.push('Bạn là AI chuyên gia xử lý tài liệu. Thực hiện nhiệm vụ sau với độ chính xác cao nhất.');
  upgradedLines.push('');

  // If there is a problem hint, add a targeted instruction
  if (problem && !problem.startsWith('Không có')) {
    upgradedLines.push(`## Lưu ý quan trọng`);
    upgradedLines.push(`Đảm bảo xử lý đúng trường hợp: ${problem}`);
    upgradedLines.push('');
  }

  // Paste the original prompt body (improved formatting)
  upgradedLines.push('## Nhiệm vụ');
  upgradedLines.push(originalPrompt);
  upgradedLines.push('');

  // Output format section
  upgradedLines.push('## Yêu cầu output');
  upgradedLines.push('- Trả về kết quả dưới dạng JSON hợp lệ, không thêm markdown code fence');
  upgradedLines.push('- Tất cả các trường bắt buộc phải có giá trị; nếu không tìm thấy, dùng null');
  upgradedLines.push('- Không thêm giải thích hay chú thích ngoài JSON');

  // Keep template variables if they were in the original
  if (originalPrompt.includes('{{input_content}}')) {
    upgradedLines.push('');
    upgradedLines.push('Dữ liệu đầu vào từ bước trước: {{input_content}}');
  }

  const content = upgradedLines.join('\n');

  return { content, mock: true };
}

module.exports = { buildResponse };
