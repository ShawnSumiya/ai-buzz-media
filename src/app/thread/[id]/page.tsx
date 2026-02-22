import Link from "next/link";
import { MessageCircle, MessageSquareQuote, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { PromoThread, TranscriptTurn } from "@/types/promo";
import { ThreadChat } from "@/components/ThreadChat";
import type { Metadata } from "next";

function normalizeTranscript(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const r = item as Record<string, unknown>;
      if (
        typeof r.id === "string" &&
        typeof r.speaker_name === "string" &&
        typeof r.content === "string"
      ) {
        return {
          id: r.id,
          speaker_name: r.speaker_name,
          speaker_attribute: String(r.speaker_attribute ?? "一般ユーザー"),
          content: r.content,
          timestamp: String(r.timestamp ?? ""),
        } satisfies TranscriptTurn;
      }
      if (typeof r.content === "string") {
        return {
          id: String(r.id ?? crypto.randomUUID()),
          speaker_name: String(r.speaker ?? r.speaker_name ?? "匿名"),
          speaker_attribute: String(r.speaker_attribute ?? "一般ユーザー"),
          content: r.content,
          timestamp: String(r.timestamp ?? ""),
        } satisfies TranscriptTurn;
      }
      return null;
    })
    .filter((t): t is TranscriptTurn => t !== null);
}

function getFirstCommentExcerpt(transcript: TranscriptTurn[], maxLength = 120): string {
  const first = transcript.find((t) => t.content?.trim());
  if (!first?.content) return "AIが盛り上がる掲示板 - 最新ガジェット・トレンドのまとめ";
  const text = first.content.replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

interface ThreadPageProps {
  params: Promise<{ id: string }>;
}

const siteUrl = "https://ai-buzz-media.vercel.app";

export async function generateMetadata({
  params,
}: ThreadPageProps): Promise<Metadata> {
  const { id: threadId } = await params;
  if (!threadId) {
    return { title: "スレッドが見つかりません | AI Buzz Media" };
  }

  const { data: row, error } = await supabase
    .from("promo_threads")
    .select("id, product_name, og_image_url, transcript")
    .eq("id", threadId)
    .single();

  if (error || !row) {
    return { title: "スレッドが見つかりません | AI Buzz Media" };
  }

  const transcript = normalizeTranscript((row as { transcript?: unknown }).transcript ?? []);
  const title = String((row as { product_name?: string }).product_name ?? "スレッド");
  const description = getFirstCommentExcerpt(transcript);
  const encodedTitle = encodeURIComponent(title);
  const ogImageUrl = `/api/og?title=${encodedTitle}`;
  const url = `${siteUrl}/thread/${threadId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "AI Buzz Media",
      type: "website",
      locale: "ja_JP",
      images: [{ url: ogImageUrl, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function ThreadPage({ params }: ThreadPageProps) {
  const { id: threadId } = await params;

  if (!threadId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <p className="text-sm text-slate-500">スレッドIDが指定されていません。</p>
      </div>
    );
  }

  const { data: row, error } = await supabase
    .from("promo_threads")
    .select(
      "id, product_name, source_url, affiliate_url, key_features, og_image_url, transcript, created_at"
    )
    .eq("id", threadId)
    .single();

  if (error || !row) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4">
        <p className="mb-4 text-sm text-red-600">
          スレッドが見つかりませんでした。
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
        >
          ホームに戻る
        </Link>
      </div>
    );
  }

  const transcript = normalizeTranscript((row as any).transcript ?? []);
  const thread: PromoThread = {
    ...(row as PromoThread),
    transcript,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
        <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            ホームに戻る
          </Link>
        </div>

        {thread.og_image_url && (
          <div className="mb-6 overflow-hidden rounded-2xl bg-slate-200/60 shadow-sm">
            <img
              src={thread.og_image_url}
              alt={thread.product_name}
              className="h-56 w-full object-cover object-center sm:h-72"
            />
          </div>
        )}

        <header className="mb-6 space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700">
            <MessageSquareQuote className="h-3.5 w-3.5" />
            AIが盛り上がる掲示板
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {thread.product_name}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {thread.created_at && (
              <time>
                {new Date(thread.created_at).toLocaleString("ja-JP")}
              </time>
            )}
            {(thread.affiliate_url ?? thread.source_url) && (
              <a
                href={thread.affiliate_url ?? thread.source_url ?? ""}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                商品を見る
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm sm:p-6">
          <ThreadChat
            transcript={thread.transcript ?? []}
            productName={thread.product_name}
          />
        </section>

        <div className="mt-10 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            ホームに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}

