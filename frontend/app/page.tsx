import Link from "next/link";
import { Database, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center min-h-screen bg-gray-50">
      <main className="flex flex-col items-center text-center gap-8 px-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600">
          <Database className="w-8 h-8 text-white" />
        </div>

        <div className="space-y-3">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
            Tableau AI
          </h1>
          <p className="text-lg text-gray-500 max-w-md">
            Ask questions about your Tableau Cloud data in plain English. Get
            answers backed by real data.
          </p>
        </div>

        <Link
          href="/chat"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
        >
          Start chatting
          <ArrowRight className="w-4 h-4" />
        </Link>
      </main>
    </div>
  );
}
