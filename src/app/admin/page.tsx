"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Link2, FileText, Loader2, Settings2, ExternalLink, Trash2 } from "lucide-react";
import type { PromoThread } from "@/types/promo";

type TopicQueueItem = {
  id: string;
  url: string;
  status: string;
  created_at: string;
};

function AdminThreadRow({
  thread,
  onDelete,
  isDeleting,
}: {
  thread: PromoThread;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const router = useRouter();

  return (
    <li className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-slate-900">{thread.product_name}</h3>
        <p className="text-xs text-slate-500">
          {thread.created_at
            ? new Date(thread.created_at).toLocaleString("ja-JP")
            : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push(`/thread/${thread.id}`)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
        >
          閲覧
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(thread.id)}
          disabled={isDeleting}
          className="inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          title="削除"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </div>
    </li>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<PromoThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scrapeFailedMessage, setScrapeFailedMessage] = useState<string | null>(null);
  const [fallbackText, setFallbackText] = useState("");
  const [fallbackMode, setFallbackMode] = useState(false);
  const [queueList, setQueueList] = useState<TopicQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);

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

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/topic-queue");
      if (!res.ok) throw new Error("キューの取得に失敗しました");
      const data = await res.json();
      setQueueList(Array.isArray(data) ? data : []);
    } catch {
      setQueueList([]);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setScrapeFailedMessage(null);
    setFallbackMode(false);

    if (!url.trim()) {
      setError("URL を入力してください。");
      return;
    }
    setCreating(true);
    try {
      // 以前はここで /api/auto-generate-thread を叩いて即スレ生成していたが、
      // 現在は URL を「ネタ帳キュー」に積み、Cron が指定時間にスレを立てる。
      const res = await fetch("/api/topic-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "キューへの追加に失敗しました");

      // 成功時は入力だけクリアし、キュー一覧を再取得
      setUrl("");
      setFallbackText("");
      setFallbackMode(false);
      setScrapeFailedMessage(null);
      fetchQueue();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "キューへの追加に失敗しました"
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteQueue(id: string) {
    if (!window.confirm("このキューを削除しますか？")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/topic-queue?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "削除に失敗しました");
      setQueueList((prev) => prev.filter((q) => q.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteThread(id: string) {
    if (!window.confirm("本当にこの記事を削除しますか？（復元できません）")) return;
    setDeletingThreadId(id);
    try {
      const res = await fetch(`/api/promo-threads?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "削除に失敗しました");
      setThreads((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeletingThreadId(null);
    }
  }

  function getStatusBadgeClass(status: string) {
    switch (status) {
      case "done":
        return "bg-emerald-100 text-emerald-800";
      case "error":
        return "bg-red-100 text-red-800";
      default:
        return "bg-amber-100 text-amber-800";
    }
  }

  async function handleFallbackSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fallbackText.trim() || fallbackText.trim().length < 10) {
      setError("商品の説明文を10文字以上入力してください。");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/create-hype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim() || undefined,
          text_content: fallbackText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成に失敗しました");
      setThreads((prev) => [data, ...prev]);
      setFallbackText("");
      setFallbackMode(false);
      setScrapeFailedMessage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成に失敗しました");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Settings2 className="h-5 w-5 text-slate-600" />
            管理画面
          </h1>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            <ExternalLink className="h-4 w-4" />
            サイトを確認する
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">
            新規スレッド作成
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700">
                <Link2 className="h-4 w-4" />
                商品ページURL（必須）
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/product"
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>
            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            {scrapeFailedMessage && (
              <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
                {scrapeFailedMessage}
              </p>
            )}
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  生成中…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  URLをキューに追加
                </>
              )}
            </button>
          </form>

          {fallbackMode && (
            <form
              onSubmit={handleFallbackSubmit}
              className="mt-6 space-y-4 border-t border-slate-200 pt-6"
            >
              <h3 className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <FileText className="h-4 w-4" />
                自動取得に失敗したため、商品の説明文から生成します
              </h3>
              <textarea
                value={fallbackText}
                onChange={(e) => setFallbackText(e.target.value)}
                placeholder="商品の特徴やキャンペーン内容、セール情報などをそのまま貼り付けてください。"
                rows={5}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
              <button
                type="submit"
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-60"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    テキストから生成中…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    テキストから生成
                  </>
                )}
              </button>
            </form>
          )}
        </section>

        <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-slate-500">
            Queue Status
            <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">
              {queueList.length} 件
            </span>
          </h2>
          {queueLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : queueList.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              キューに登録されたURLはありません。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="pb-3 font-medium">URL</th>
                    <th className="w-24 pb-3 font-medium">ステータス</th>
                    <th className="w-40 pb-3 font-medium">作成日時</th>
                    <th className="w-16 pb-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {queueList.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="max-w-[280px] py-3">
                        <span
                          className="block truncate text-slate-700"
                          title={item.url}
                        >
                          {item.url}
                        </span>
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusBadgeClass(item.status)}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3 text-slate-500">
                        {item.created_at
                          ? new Date(item.created_at).toLocaleString("ja-JP")
                          : "-"}
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => handleDeleteQueue(item.id)}
                          disabled={deletingId === item.id}
                          className="inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="削除"
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">
            作成済みスレッド管理
          </h2>
          {loading ? (
            <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : threads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-slate-500">
              まだスレッドがありません。上記から1件作成してください。
            </div>
          ) : (
            <ul className="space-y-2">
              {threads.map((t) => (
                <AdminThreadRow
                  key={t.id}
                  thread={t}
                  onDelete={handleDeleteThread}
                  isDeleting={deletingThreadId === t.id}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
