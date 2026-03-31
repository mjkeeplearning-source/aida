"use client";

import { useCallback, useRef, useState } from "react";
import { postChat } from "@/lib/api";

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  isStreaming?: boolean;
  error?: boolean;
}

interface UseChatReturn {
  messages: Message[];
  isStreaming: boolean;
  activeToolCall: string | null;
  lastSentText: string;
  send: (message: string) => Promise<void>;
}

const TOOL_CALL_TIMEOUT_MS = 30_000;

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolCall, setActiveToolCall] = useState<string | null>(null);
  const [lastSentText, setLastSentText] = useState("");
  const toolCallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToolCallTimer = () => {
    if (toolCallTimerRef.current) {
      clearTimeout(toolCallTimerRef.current);
      toolCallTimerRef.current = null;
    }
  };

  const send = useCallback(async (text: string) => {
    if (isStreaming) return;

    setLastSentText(text);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);
    setActiveToolCall(null);

    try {
      const response = await postChat(text);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);

            if (eventType === "token") {
              clearToolCallTimer();
              setActiveToolCall(null);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + data }
                    : m
                )
              );
            } else if (eventType === "tool_call") {
              setActiveToolCall(data.trim());
              clearToolCallTimer();
              toolCallTimerRef.current = setTimeout(() => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content:
                            m.content +
                            "\n\n*(This is taking longer than expected…)*",
                        }
                      : m
                  )
                );
                setActiveToolCall(null);
              }, TOOL_CALL_TIMEOUT_MS);
            } else if (eventType === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, isStreaming: false } : m
                )
              );
            } else if (eventType === "error") {
              let msg = "Something went wrong.";
              try {
                msg = JSON.parse(data).message ?? msg;
              } catch {}
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: msg, isStreaming: false, error: true }
                    : m
                )
              );
            }
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: "Connection lost. Please try again.",
                isStreaming: false,
                error: true,
              }
            : m
        )
      );
    } finally {
      clearToolCallTimer();
      setIsStreaming(false);
      setActiveToolCall(null);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        )
      );
    }
  }, [isStreaming]);

  return { messages, isStreaming, activeToolCall, lastSentText, send };
}
