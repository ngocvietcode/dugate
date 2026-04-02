// responses/ext-pdf-tools.js
// Connector: ext-pdf-tools — PDF Tools (Split/Merge)
// DU Cases: ingest:split
// Returns: Plain text describing result

'use strict';

function buildResponse(fields, files, filename) {
  const pages = fields.pages || '1-3';

  // Parse page range for mock page count
  let pageCount = 3;
  if (pages.includes('-')) {
    const [start, end] = pages.split('-').map(Number);
    pageCount = (end - start) + 1;
  } else if (pages.includes(',')) {
    pageCount = pages.split(',').length;
  } else {
    pageCount = 1;
  }

  const outputFileName = filename.replace(/\.[^.]+$/, '') + `_pages_${pages.replace(/[,\s]/g, '_')}.pdf`;

  const content = `PDF Split thành công.

Thông tin xử lý:
  File gốc    : ${filename}
  Trang chọn  : ${pages}
  Số trang    : ${pageCount}
  File output : ${outputFileName}
  Kích thước  : ~${(pageCount * 128).toFixed(0)} KB (ước tính)

Kết quả: OK — ${pageCount} trang đã được tách ra từ "${filename}".
Output file sẵn sàng tải về tại: /mock/outputs/${outputFileName}

---
[MOCK] Processed by du-mock-service — ext-pdf-tools`;

  return { content, mock: true };
}

module.exports = { buildResponse };
