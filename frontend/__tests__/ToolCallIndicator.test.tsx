import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallIndicator } from "@/components/chat/ToolCallIndicator";

describe("ToolCallIndicator", () => {
  it("renders the tool name", () => {
    render(<ToolCallIndicator toolName="list-datasources" />);
    // Text is split by interpolation: "Calling " + toolName + "…"
    expect(screen.getByText(/Calling list-datasources/)).toBeInTheDocument();
  });

  it("renders with a different tool name", () => {
    render(<ToolCallIndicator toolName="query-datasource" />);
    expect(screen.getByText(/Calling query-datasource/)).toBeInTheDocument();
  });
});
