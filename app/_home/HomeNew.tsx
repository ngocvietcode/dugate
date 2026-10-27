// app/_home/HomeNew.tsx
// Trang chủ mới — Technical Skill Reference (dùng cho LIVE)

import Link from 'next/link';
import {
  GitCompareArrows, ArrowRight,
  BrainCircuit, Repeat2, Layers, Sparkles,
} from 'lucide-react';

// ── 5 Core Skills (docs/AI_Skills) ─────────────────────────────────────────────
const SKILLS = [
  {
    method: 'POST',
    path: '/api/v2/docs/extract',
    name: 'extract',
    description: 'Bóc tách thông tin có cấu trúc từ tài liệu với schema JSON tuỳ biến',
    modes: ['invoice', 'contract', 'id-card', 'table', 'query', 'custom'],
    icon: Layers,
    href: '/docs/extract',
    curl: `curl -X POST {host}/api/v2/docs/extract?sync=true \\
  -H "x-api-key: sk_xxx" \\
  -F "file=@invoice.pdf" \\
  -F "mode=invoice"`,
    response: `{
  "operationId": "op-def456",
  "state": "DONE",
  "skill": "extract",
  "mode": "invoice",
  "result": {
    "invoiceNo": "INV-2026-0042",
    "amount": 15000000,
    "currency": "VND",
    "vendor": "Công ty ABC"
  }
}`,
  },
  {
    method: 'POST',
    path: '/api/v2/docs/analyze',
    name: 'analyze',
    description: 'Phân loại, kiểm tra tuân thủ, đánh giá rủi ro, chấm điểm chất lượng',
    modes: ['classify', 'compliance', 'risk', 'quality'],
    icon: BrainCircuit,
    href: '/docs/analyze',
    curl: `curl -X POST {host}/api/v2/docs/analyze?sync=true \\
  -H "x-api-key: sk_xxx" \\
  -F "file=@report.pdf" \\
  -F "mode=classify"`,
    response: `{
  "operationId": "op-ghi789",
  "state": "DONE",
  "skill": "analyze",
  "mode": "classify",
  "result": {
    "category": "financial_report",
    "confidence": 0.92,
    "tags": ["Q1", "revenue", "forecast"]
  }
}`,
  },
  {
    method: 'POST',
    path: '/api/v2/docs/transform',
    name: 'transform',
    description: 'Đổi định dạng, dịch thuật, viết lại, redact PII, điền form template, tách trang',
    modes: ['convert', 'translate', 'rewrite', 'redact', 'template', 'split'],
    icon: Repeat2,
    href: '/docs/transform',
    curl: `curl -X POST {host}/api/v2/docs/transform?sync=true \\
  -H "x-api-key: sk_xxx" \\
  -F "file=@doc.pdf" \\
  -F "mode=translate" \\
  -F "targetLang=en"`,
    response: `{
  "operationId": "op-jkl012",
  "state": "DONE",
  "skill": "transform",
  "mode": "translate",
  "result": {
    "translatedText": "Socialist Republic of...",
    "sourceLang": "vi",
    "targetLang": "en"
  }
}`,
  },
  {
    method: 'POST',
    path: '/api/v2/docs/generate',
    name: 'generate',
    description: 'Sinh nội dung từ tài liệu gốc: tóm tắt, báo cáo, email, biên bản họp',
    modes: ['summary', 'report', 'email', 'minutes'],
    icon: Sparkles,
    href: '/docs/generate',
    curl: `curl -X POST {host}/api/v2/docs/generate?sync=true \\
  -H "x-api-key: sk_xxx" \\
  -F "file=@meeting.pdf" \\
  -F "mode=summary"`,
    response: `{
  "operationId": "op-mno345",
  "state": "DONE",
  "skill": "generate",
  "mode": "summary",
  "result": {
    "summary": "Cuộc họp Q1 thống nhất 3 điểm chính: ...",
    "wordCount": 120
  }
}`,
  },
  {
    method: 'POST',
    path: '/api/v2/docs/compare',
    name: 'compare',
    description: 'Đối chiếu & phát hiện sai lệch: verify, diff, semantic, version',
    modes: ['verify', 'diff', 'semantic', 'version'],
    icon: GitCompareArrows,
    href: '/docs/compare',
    curl: `curl -X POST {host}/api/v2/docs/compare?sync=true \\
  -H "x-api-key: sk_xxx" \\
  -F "file=@v1.pdf" \\
  -F "file2=@v2.pdf" \\
  -F "mode=semantic"`,
    response: `{
  "operationId": "op-pqr678",
  "state": "DONE",
  "skill": "compare",
  "mode": "semantic",
  "result": {
    "changesCount": 5,
    "riskLevel": "medium",
    "changes": [{"clause": "4.2", "type": "modified"}]
  }
}`,
  },
];

export default function HomeNew() {
  return (
    <main className="flex-1 bg-background">
      <div className="max-w-6xl mx-auto px-6 py-12">

        {/* ── Skill Endpoints ─────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Available Skills (5)</h2>
            <Link href="/api-docs" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              Full API Docs <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="space-y-4">
            {SKILLS.map((skill, idx) => (
              <div key={idx} className="border border-border rounded-xl overflow-hidden bg-card">
                {/* Skill Header */}
                <Link
                  href={skill.href}
                  className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <skill.icon className="w-4.5 h-4.5 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">
                        {skill.method}
                      </span>
                      <code className="text-sm font-mono font-medium text-foreground truncate">{skill.path}</code>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{skill.description}</p>
                  </div>

                  <div className="hidden md:flex flex-wrap gap-1 max-w-[280px]">
                    {skill.modes.map((mode) => (
                      <span key={mode} className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded text-muted-foreground">
                        {mode}
                      </span>
                    ))}
                  </div>

                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </Link>

                {/* Curl + Response */}
                <div className="border-t border-border grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
                  <div className="p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Request</div>
                    <pre className="text-xs font-mono text-foreground/80 bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre leading-relaxed">
                      {skill.curl}
                    </pre>
                  </div>
                  <div className="p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Response · 200 OK</div>
                    <pre className="text-xs font-mono text-foreground/80 bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre leading-relaxed">
                      {skill.response}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Sync hint */}
          <div className="mt-6 p-4 rounded-xl bg-muted/40 border border-border text-xs text-muted-foreground font-mono">
            <span className="font-semibold text-foreground">?sync=true</span>{' '}
            — chờ xử lý xong và trả kết quả trực tiếp (200 OK). Bỏ param này để dùng mode async (202 Accepted + polling).
          </div>
        </section>

      </div>
    </main>
  );
}
