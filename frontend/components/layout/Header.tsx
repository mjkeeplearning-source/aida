"use client";

import { useEffect, useState } from "react";
import { Database } from "lucide-react";

export function Header() {
  const [toolCount, setToolCount] = useState<number | null>(null);
  const connected = toolCount !== null && toolCount > 0;

  useEffect(() => {
    fetch("/health")
      .then((r) => r.json())
      .then((d) => setToolCount(d.mcp_tools ?? 0))
      .catch(() => setToolCount(0));
  }, []);

  return (
    <header className="border-b border-gray-200 bg-white px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Database className="w-5 h-5 text-blue-600" />
        <span className="font-semibold text-gray-900">Tableau AI</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`w-2 h-2 rounded-full ${
            toolCount === null
              ? "bg-gray-300 animate-pulse"
              : connected
              ? "bg-green-500"
              : "bg-red-500"
          }`}
        />
        <span className="text-gray-500">
          {toolCount === null
            ? "Connecting…"
            : connected
            ? `Tableau Cloud (${toolCount} tools)`
            : "Not connected"}
        </span>
      </div>
    </header>
  );
}
