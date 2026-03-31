"use client";

import { useState } from "react";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { MessageInput } from "@/components/chat/MessageInput";
import { Header } from "@/components/layout/Header";
import { useChat } from "@/hooks/useChat";

export default function ChatPage() {
  const { messages, isStreaming, activeToolCall, lastSentText, send } = useChat();
  const [prefillText, setPrefillText] = useState("");

  const handleRetry = () => setPrefillText(lastSentText);

  return (
    <div className="flex flex-col h-screen bg-white">
      <Header />
      <ChatWindow
        messages={messages}
        activeToolCall={activeToolCall}
        onRetry={handleRetry}
      />
      <MessageInput
        onSend={send}
        disabled={isStreaming}
        prefill={prefillText}
        onPrefillConsumed={() => setPrefillText("")}
      />
    </div>
  );
}
