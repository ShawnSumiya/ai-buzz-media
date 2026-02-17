"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Zap, ExternalLink, Loader2, MessageCircle, Flame } from "lucide-react";
import type { PromoThread, TranscriptTurn } from "@/types/promo";

function PromoCard({ thread }: { thread: PromoThread }) {
  const firstTurn: TranscriptTurn | undefined =
    thread.transcript && thread.transcript.length > 0
      ? thread.transcript[0]
      : undefined;
  const restCount =
    thread.transcript && thread.transcript.length > 1
      ? thread.transcript.length - 1
      : 0;

  return (
    <Link
      href={`/thread/${thread.id}`}
      className="group block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      {thread.og_image_url && (
        <div className="relative h-40 w-full overflow-hidden bg-slate-100">
          <img
            src={thread.og_image_url}
            alt={thread.product_name}
            className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        </div>
      )}
      <div className="flex flex-col gap-3 p-5">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="line-clamp-2 text-base font-semibold text-slate-900">
              {thread.product_name}
            </h2>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700">
            <Flame className="h-3.5 w-3.5" />
            🔥 盛り上がり中
          </div>
        </div>

        <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {firstTurn ? (
            <>
              <p className="line-clamp-3">
                <span className="font-semibold text-slate-600">
                  {firstTurn.speaker_name}
                  <span className="mx-1 text-slate-400">：</span>
                </span>
                {firstTurn.content}
              </p>
              {restCount > 0 && (
                <p className="text-[11px] text-slate-400">
                  …他 {restCount} 件のコメント
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-slate-400">
              まだコメントがありません。最初の盛り上がりをお楽しみに。
            </p>
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <time>
            {thread.created_at
              ? new Date(thread.created_at).toLocaleString("ja-JP")
              : ""}
          </time>
          {thread.source_url && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.open(thread.source_url ?? "", "_blank", "noopener,noreferrer");
              }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
            >
              商品ページ
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  const [threads, setThreads] = useState<PromoThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/promo-threads");
      if (!res.ok) throw new Error("一覧の取得に失敗しました");
      const data = await res.json();
      setThreads(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-900">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500">
              <Zap className="h-5 w-5 text-white" />
            </span>
            AI Buzz Media
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <section>
          <h2 className="mb-6 text-xl font-bold text-slate-900">
            Latest Buzz
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-slate-400" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 py-12 text-center text-red-700">
              {error}
            </div>
          ) : threads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-500">
              まだ記事がありません。まもなく公開されます。
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {threads.map((t) => (
                <PromoCard key={t.id} thread={t} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
