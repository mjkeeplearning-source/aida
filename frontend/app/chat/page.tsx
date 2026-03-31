"use client";

import { ChatWindow } from "@/components/chat/ChatWindow";
import { MessageInput } from "@/components/chat/MessageInput";
import { Header } from "@/components/layout/Header";
import { useChat } from "@/hooks/useChat";

export default function ChatPage() {
  const { messages, isStreaming, activeToolCall, send } = useChat();

  return (
    <div className="flex flex-col h-screen bg-white">
      <Header />
      <ChatWindow messages={messages} activeToolCall={activeToolCall} />
      <MessageInput onSend={send} disabled={isStreaming} />
    </div>
  );
}
