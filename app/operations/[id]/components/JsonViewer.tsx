'use client';

import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';

interface JsonViewerProps {
  data: unknown;
  defaultExpanded?: boolean;
}

export default function JsonViewer({ data, defaultExpanded = false }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const jsonStr = JSON.stringify(data, null, 2);
    
    // Try modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(jsonStr);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // Fall through to fallback
      }
    }

    // Fallback: textarea + execCommand (works in all contexts)
    try {
      const textarea = document.createElement('textarea');
      textarea.value = jsonStr;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: open in new window for manual copy
      const win = window.open('', '_blank', 'width=800,height=600');
      if (win) {
        win.document.write(`<pre style="white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:12px;">${jsonStr.replace(/</g, '&lt;')}</pre>`);
        win.document.close();
      }
    }
  }, [data]);

  if (data === null || data === undefined) {
    return (
      <span className="text-muted-foreground italic text-sm">null</span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={handleCopy}
        className="absolute top-0 right-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium hover:bg-background/80 border border-border/50 transition-colors z-10 bg-background/60 backdrop-blur-sm"
        title="Copy JSON"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-green-500" />
            <span className="text-green-600 dark:text-green-400">Copied!</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Copy</span>
          </>
        )}
      </button>
      <div className="font-mono text-sm overflow-auto pr-8">
        <JsonNode value={data} defaultExpanded={defaultExpanded} depth={0} />
      </div>
    </div>
  );
}

interface JsonNodeProps {
  value: unknown;
  defaultExpanded: boolean;
  depth: number;
  keyName?: string;
}

function JsonNode({ value, defaultExpanded, depth, keyName }: JsonNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => setExpanded((e) => !e), []);

  // Primitives
  if (value === null || value === undefined) {
    return (
      <div className="flex items-start" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-purple-600 dark:text-purple-400 mr-1">&quot;{keyName}&quot;: </span>
        )}
        <span className="text-muted-foreground italic">null</span>
      </div>
    );
  }

  if (typeof value === 'string') {
    return (
      <div className="flex items-start" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-purple-600 dark:text-purple-400 mr-1">&quot;{keyName}&quot;: </span>
        )}
        <span className="text-green-700 dark:text-green-400">&quot;{value}&quot;</span>
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="flex items-start" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-purple-600 dark:text-purple-400 mr-1">&quot;{keyName}&quot;: </span>
        )}
        <span className="text-blue-600 dark:text-blue-400">{String(value)}</span>
      </div>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <div className="flex items-start" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-purple-600 dark:text-purple-400 mr-1">&quot;{keyName}&quot;: </span>
        )}
        <span className="text-orange-600 dark:text-orange-400">{String(value)}</span>
      </div>
    );
  }

  // Arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="flex items-start" style={{ paddingLeft: depth * 16 }}>
          {keyName !== undefined && (
            <span className="text-purple-600 dark:text-purple-400 mr-1">&quot;{keyName}&quot;: </span>
          )}
          <span className="text-foreground">[]</span>
        </div>
      );
    }

    return (
      <div style={{ paddingLeft: depth * 16 }}>
        <button
          onClick={toggle}
          className="flex items-center gap-1 hover:bg-muted/50 rounded px-1 -ml-1 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          {keyName !== undefined && (
            <span className="text-purple-600 dark:text-purple-400 mr-1">&quot;{keyName}&quot;: </span>
          )}
          <span className="text-foreground">[</span>
          {!expanded && (
            <span className="text-muted-foreground ml-1">{value.length} items ...]</span>
          )}
        </button>
        {expanded && (
          <>
            {value.map((item, idx) => (
              <JsonNode key={idx} value={item} defaultExpanded={defaultExpanded} depth={depth + 1} />
            ))}
            <div style={{ paddingLeft: depth * 16 }}>
              <span className="text-foreground">]</span>
            </div>
          </>
        )}
      </div>
    );
  }

  // Objects
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return (
        <div className="flex items-start" style={{ paddingLeft: depth * 16 }}>
          {keyName !== undefined && (
            <span className="text-purple-600 dark:text-purple-400 mr-1">&quot;{keyName}&quot;: </span>
          )}
          <span className="text-foreground">{'{}'}</span>
        </div>
      );
    }

    return (
      <div style={{ paddingLeft: depth * 16 }}>
        <button
          onClick={toggle}
          className="flex items-center gap-1 hover:bg-muted/50 rounded px-1 -ml-1 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          {keyName !== undefined && (
            <span className="text-purple-600 dark:text-purple-400 mr-1">&quot;{keyName}&quot;: </span>
          )}
          <span className="text-foreground">{'{'}</span>
          {!expanded && (
            <span className="text-muted-foreground ml-1">{entries.length} keys ...{'}'}</span>
          )}
        </button>
        {expanded && (
          <>
            {entries.map(([key, val]) => (
              <JsonNode key={key} value={val} defaultExpanded={defaultExpanded} depth={depth + 1} keyName={key} />
            ))}
            <div style={{ paddingLeft: depth * 16 }}>
              <span className="text-foreground">{'}'}</span>
            </div>
          </>
        )}
      </div>
    );
  }

  // Fallback for other types
  return (
    <div className="flex items-start" style={{ paddingLeft: depth * 16 }}>
      {keyName !== undefined && (
        <span className="text-purple-600 dark:text-purple-400 mr-1">&quot;{keyName}&quot;: </span>
      )}
      <span className="text-foreground">{String(value)}</span>
    </div>
  );
}
