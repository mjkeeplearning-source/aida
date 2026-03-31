"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/hooks/useChat";
import { MessageBubble } from "./MessageBubble";
import { ToolCallIndicator } from "./ToolCallIndicator";

interface Props {
  messages: Message[];
  activeToolCall: string | null;
}

export function ChatWindow({ messages, activeToolCall }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeToolCall]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Ask anything about your Tableau data
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {activeToolCall && (
        <div className="flex justify-start">
          <ToolCallIndicator toolName={activeToolCall} />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
