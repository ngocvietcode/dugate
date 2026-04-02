// responses/ext-translator.js
// Connector: ext-translator — Document Translator
// DU Cases: transform:translate
// Returns: Markdown string (translated text)

'use strict';

const LANG_NAMES = {
  vi: 'Tiếng Việt',
  en: 'English',
  ja: '日本語 (Tiếng Nhật)',
  zh: '中文 (Tiếng Trung)',
  fr: 'Français (Tiếng Pháp)',
  ko: '한국어 (Tiếng Hàn)',
};

function buildResponse(fields, files, filename) {
  const targetLang = fields.target_language || 'vi';
  const tone = fields.tone || 'formal';
  const langName = LANG_NAMES[targetLang] || targetLang;

  const content = `# [DỊCH SANG ${langName.toUpperCase()}] ${filename}

> **Thông tin dịch thuật:**
> - Ngôn ngữ đích: **${langName}**
> - Giọng văn: **${tone}**
> - File gốc: \`${filename}\`

---

## 1. Introduction / Giới thiệu

This document has been translated to **${langName}** with a **${tone}** tone.
All original formatting, tables, and headings have been preserved during translation.

Tài liệu này đã được dịch sang **${langName}** theo giọng văn **${tone}**.
Toàn bộ định dạng gốc, bảng biểu và tiêu đề được giữ nguyên trong quá trình dịch.

---

## 2. Main Content / Nội dung chính

### 2.1 Điều Khoản Dịch Vụ / Service Terms

**[${langName}]** The service provider agrees to deliver the contracted services within the stipulated timeframe, ensuring quality standards are met at all stages of delivery.

The following key terms apply:
- **Delivery period:** 30 business days from contract signing
- **Quality standard:** ISO 9001:2015 compliance required
- **Acceptance criteria:** Formal sign-off by authorized representative

### 2.2 Bảng Giá / Pricing Table

| Dịch vụ / Service | Đơn giá / Unit Price | Đơn vị / Unit |
|------------------|--------------------|--------------|
| Dịch vụ cơ bản / Basic Service | 5,000,000 VND | Tháng / Month |
| Dịch vụ nâng cao / Advanced Service | 12,000,000 VND | Tháng / Month |
| Hỗ trợ kỹ thuật / Technical Support | 2,500,000 VND | Lần / Incident |

---

## 3. Kết Luận / Conclusion

**[${langName}]** Both parties agree to the terms and conditions as stated herein. This translated document carries the same legal weight as the original.

---
*[MOCK] Translated by du-mock-service — ext-translator (gpt-4o)*
*Glossary applied: ${fields.glossary ? 'Có / Yes' : 'Không / No'}*`;

  return {
    content,
    model: fields.model || 'gpt-4o',
    target_language: targetLang,
    mock: true,
  };
}

module.exports = { buildResponse };
