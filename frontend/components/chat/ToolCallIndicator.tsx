import { Loader2 } from "lucide-react";

interface Props {
  toolName: string;
}

export function ToolCallIndicator({ toolName }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-xs w-fit">
      <Loader2 className="w-3 h-3 animate-spin" />
      <span>Calling {toolName}…</span>
    </div>
  );
}
