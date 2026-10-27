'use client';

// components/MarkdownPreview.tsx
// Render markdown bằng react-markdown + remark-gfm

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
}

export default function MarkdownPreview({ content }: Props) {
  return (
    <div className="bg-white dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-800 rounded-lg p-6 min-h-[300px] transition-colors">
      <div className="prose dark:prose-invert prose-sm max-w-none
        prose-headings:text-[#00B74F] prose-headings:font-heading
        prose-a:text-[#00B74F]
        prose-blockquote:border-l-[#00B74F] prose-blockquote:bg-emerald-50/50 dark:prose-blockquote:bg-emerald-500/10 prose-blockquote:py-1
        prose-code:bg-slate-100 dark:prose-code:bg-zinc-800 prose-code:text-slate-800 dark:prose-code:text-zinc-200 prose-code:rounded
        prose-table:text-sm
        prose-img:rounded-lg prose-img:border prose-img:border-slate-200 dark:prose-img:border-zinc-800">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
