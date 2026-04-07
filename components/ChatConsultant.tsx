"use client";

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ChatConsultant() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Xin chào! Tôi là trợ lý Hệ thống DUGate. Bạn đang cần xử lý loại tài liệu nào, hay giải bài toán nghiệp vụ gì?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea: min 2 rows, max 5 rows
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 24; // px, matches leading-6
    const minHeight = lineHeight * 2 + 32; // 2 rows + padding
    const maxHeight = lineHeight * 5 + 32; // 5 rows + padding
    el.style.height = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight) + 'px';
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });
      const data = await res.json();

      let reply = data.response || "Xin lỗi, hiện tại tôi không thể kết nối tới server. Vui lòng thử lại sau.";
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Xin lỗi, đã có lỗi kết nối mạng xảy ra." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter hoặc Ctrl+Enter → gửi message
    if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    // Enter đơn → xuống hàng (mặc định của textarea, không cần xử lý)
  };

  return (
    <div className="modern-card max-w-7xl mx-auto rounded-3xl overflow-hidden shadow-xl border border-border">
      <div className="bg-gradient-to-r from-[#00B74F] to-emerald-600 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shadow-inner flex-shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 text-left">
          <h2 className="text-lg font-bold text-white leading-tight">Trợ lý Tích hợp DUGate</h2>
          <p className="text-emerald-100 text-xs mt-0.5">Trò chuyện để tôi tự động định tuyến nhu cầu của bạn vào tính năng phù hợp nhất.</p>
        </div>
      </div>

      <div className="bg-muted/30 p-6 h-[600px] overflow-y-auto flex flex-col gap-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-[#00B74F] text-white' : 'bg-transparent border border-border'}`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-5 h-5 text-emerald-600" />}
            </div>
            <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              msg.role === 'user' 
                ? 'bg-[#00B74F] text-white rounded-tr-sm shadow-md shadow-[#00B74F]/20' 
                : 'bg-card text-foreground border border-border rounded-tl-sm shadow-sm'
            }`}>
              <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'text-white prose-invert' : 'dark:prose-invert text-foreground'} [&>*:first-child]:mt-0 [&>*:last-child]:mb-0`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3 max-w-[85%]">
            <div className="w-8 h-8 rounded-full bg-transparent border border-border flex items-center justify-center flex-shrink-0">
               <Bot className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="px-4 py-3 rounded-2xl bg-card text-foreground border border-border rounded-tl-sm shadow-sm flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00B74F] animate-bounce"></span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00B74F] animate-bounce delay-100"></span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00B74F] animate-bounce delay-200"></span>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-card border-t border-border">
        <div className="flex flex-wrap gap-2 mb-3">
          {["Trích xuất bảng biểu từ Báo cáo tài chính?", "So sánh hai phiên bản Hợp đồng?", "Phân loại tự động Hồ sơ vay vốn?"].map((suggestion, idx) => (
            <button
              key={idx}
              onClick={() => setInput(suggestion)}
              type="button"
              className="text-xs bg-muted hover:bg-muted/80 text-foreground px-3 py-1.5 rounded-full border border-border transition-colors cursor-pointer"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <form onSubmit={sendMessage} className="relative flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            className="flex-1 bg-muted border border-border rounded-2xl pl-4 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B74F]/50 transition-all font-medium resize-none leading-6"
            placeholder="Bạn cần giải quyết bài toán tài liệu gì? (Shift+Enter để gửi)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            style={{ minHeight: '80px', maxHeight: '152px' }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-[#00B74F] hover:bg-[#009940] flex items-center justify-center shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-0.5"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </form>
        <p className="text-center text-xs text-muted-foreground mt-3 italic">
          Lưu ý: Đây là phản hồi do AI tạo ra, không phải quyết định kỹ thuật chính thức.
        </p>
      </div>
    </div>
  );
}
