import { useEffect, useRef, useState } from 'react';

export default function ChatPanel({ messages, onSend, meName }) {
  const [text, setText] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const submit = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">Chat phòng</div>
      <div className="chat-log" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.from === meName ? 'me' : ''}`}>
            <span className="chat-name">{m.from}:</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
        {messages.length === 0 && <div className="chat-empty">Chưa có tin nhắn.</div>}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Gõ tin nhắn..."
          maxLength={300}
        />
        <button className="btn btn-primary" type="submit">
          Gửi
        </button>
      </form>
    </div>
  );
}
