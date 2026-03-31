import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageInput } from "@/components/chat/MessageInput";

describe("MessageInput", () => {
  it("calls onSend with trimmed text on Enter and clears the input", async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "hello{Enter}");

    expect(onSend).toHaveBeenCalledWith("hello");
    expect(textarea).toHaveValue("");
  });

  it("Shift+Enter inserts a newline and does not submit", async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);

    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "line1{Shift>}{Enter}{/Shift}line2");

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("line1\nline2");
  });

  it("disables textarea and send button when disabled=true", () => {
    render(<MessageInput onSend={vi.fn()} disabled={true} />);

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows placeholder 'Thinking…' when disabled", () => {
    render(<MessageInput onSend={vi.fn()} disabled={true} />);
    expect(screen.getByPlaceholderText("Thinking…")).toBeInTheDocument();
  });

  it("does not call onSend when text is only whitespace", async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);

    await userEvent.type(screen.getByRole("textbox"), "   {Enter}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("enforces 2000 character limit via onChange", () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "a".repeat(2100) } });

    expect(textarea.value.length).toBeLessThanOrEqual(2000);
  });

  it("pre-fills text from prefill prop and calls onPrefillConsumed", () => {
    const onPrefillConsumed = vi.fn();
    render(
      <MessageInput
        onSend={vi.fn()}
        disabled={false}
        prefill="retry this"
        onPrefillConsumed={onPrefillConsumed}
      />
    );

    expect(screen.getByRole("textbox")).toHaveValue("retry this");
    expect(onPrefillConsumed).toHaveBeenCalledTimes(1);
  });
});
