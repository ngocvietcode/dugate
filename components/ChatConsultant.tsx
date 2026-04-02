"use client";

import { useState } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';

export default function ChatConsultant() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Xin chào! Tôi là trợ lý Hệ thống DUGate. Bạn đang cần xử lý loại tài liệu nào, hay giải bài toán nghiệp vụ gì?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <div className="modern-card max-w-4xl mx-auto rounded-3xl overflow-hidden shadow-xl border border-border">
      <div className="bg-gradient-to-r from-[#00B74F] to-emerald-600 p-6 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center mb-3 shadow-inner">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-1">Trợ lý Tích hợp DUGate</h2>
        <p className="text-emerald-100 text-sm">Trò chuyện để tôi tự động định tuyến nhu cầu của bạn vào tính năng phù hợp nhất.</p>
      </div>

      <div className="bg-muted/30 p-6 h-[400px] overflow-y-auto flex flex-col gap-4">
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
              {/* Basic markdown bold parsing for **text** */}
              {msg.content.split(/(\*\*.*?\*\*)/).map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
                }
                return part;
              })}
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
        <form onSubmit={sendMessage} className="relative flex items-center">
          <input
            type="text"
            className="w-full bg-muted border border-border rounded-full pl-6 pr-14 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B74F]/50 transition-all font-medium"
            placeholder="Bạn cần giải quyết bài toán tài liệu gì?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
          />
          <button 
            type="submit" 
            disabled={!input.trim() || isLoading}
            className="absolute right-2 w-10 h-10 rounded-full bg-[#00B74F] hover:bg-[#009940] flex items-center justify-center shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4 text-white -mt-0.5 ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
