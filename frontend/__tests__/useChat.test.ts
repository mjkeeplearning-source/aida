import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "@/hooks/useChat";
import { postChat } from "@/lib/api";

vi.mock("@/lib/api");
const mockPostChat = vi.mocked(postChat);

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function makeOkResponse(chunks: string[]) {
  return new Response(makeStream(chunks), { status: 200 });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useChat", () => {
  it("token events accumulate into assistant message content", async () => {
    mockPostChat.mockResolvedValue(
      makeOkResponse([
        "event: token\ndata: Hello\n\n",
        "event: token\ndata:  world\n\n",
        "event: done\ndata: {}\n\n",
      ])
    );

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send("hi");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toBe("Hello world");
    expect(assistant?.isStreaming).toBe(false);
    expect(result.current.isStreaming).toBe(false);
  });

  it("tool_call event sets activeToolCall; next token clears it", async () => {
    mockPostChat.mockResolvedValue(
      makeOkResponse([
        "event: tool_call\ndata: list-datasources\n\n",
        "event: token\ndata: Found it\n\n",
        "event: done\ndata: {}\n\n",
      ])
    );

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send("hi");
    });

    // After stream completes, activeToolCall should be cleared
    expect(result.current.activeToolCall).toBeNull();
    expect(result.current.messages.find((m) => m.role === "assistant")?.content).toBe("Found it");
  });

  it("error event sets error flag and message", async () => {
    mockPostChat.mockResolvedValue(
      makeOkResponse([
        'event: error\ndata: {"message":"Something failed"}\n\n',
      ])
    );

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send("hi");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.error).toBe(true);
    expect(assistant?.content).toBe("Something failed");
    expect(result.current.isStreaming).toBe(false);
  });

  it("error event with malformed JSON falls back to default message", async () => {
    mockPostChat.mockResolvedValue(
      makeOkResponse(["event: error\ndata: not-json\n\n"])
    );

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send("hi");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.error).toBe(true);
    expect(assistant?.content).toBe("Something went wrong.");
  });

  it("network failure sets connection lost error", async () => {
    mockPostChat.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send("hi");
    });

    const assistant = result.current.messages.find((m) => m.role === "assistant");
    expect(assistant?.error).toBe(true);
    expect(assistant?.content).toContain("Connection lost");
    expect(result.current.isStreaming).toBe(false);
  });

  it("done event clears isStreaming", async () => {
    mockPostChat.mockResolvedValue(
      makeOkResponse(["event: done\ndata: {}\n\n"])
    );

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it("send while isStreaming is a no-op", async () => {
    const encoder = new TextEncoder();
    let closeStream!: () => void;
    const neverEndingResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          closeStream = () => {
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
            controller.close();
          };
        },
      }),
      { status: 200 }
    );

    mockPostChat.mockResolvedValue(neverEndingResponse);
    const { result } = renderHook(() => useChat());

    // Start first send — don't await
    act(() => { void result.current.send("first"); });

    // Wait for isStreaming to become true
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    // Second send while streaming — should be a no-op
    await act(async () => { await result.current.send("second"); });

    expect(mockPostChat).toHaveBeenCalledTimes(1);

    // Clean up: close the stream
    closeStream();
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it("lastSentText is updated on each send", async () => {
    mockPostChat.mockResolvedValue(
      makeOkResponse(["event: done\ndata: {}\n\n"])
    );

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.send("my question");
    });

    expect(result.current.lastSentText).toBe("my question");
  });
});
