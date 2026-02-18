import Link from "next/link";
import { Zap } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
          >
            <Zap className="h-4 w-4" />
            AI Buzz Media
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link
              href="/privacy"
              className="font-medium text-slate-600 underline-offset-4 transition-colors hover:text-slate-900 hover:underline"
            >
              プライバシーポリシー・免責事項
            </Link>
          </nav>
        </div>
        <p className="mt-4 text-center text-xs text-slate-500 sm:text-left">
          © {new Date().getFullYear()} AI Buzz Media. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
