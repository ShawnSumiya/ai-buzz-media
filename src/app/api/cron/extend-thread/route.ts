import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateAppendComments } from "@/lib/gemini";
import type { TranscriptTurn } from "@/types/promo";

/** レガシー形式を新形式に変換（append-comments API と同等のロジック） */
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
          timestamp: String(r.timestamp ?? new Date().toISOString()),
        } satisfies TranscriptTurn;
      }
      if (typeof r.content === "string") {
        const speaker = typeof r.speaker === "string" ? r.speaker : "匿名";
        return {
          id: crypto.randomUUID(),
          speaker_name: speaker,
          speaker_attribute: "一般ユーザー",
          content: r.content,
          timestamp: String(r.timestamp ?? new Date().toISOString()),
        } satisfies TranscriptTurn;
      }
      return null;
    })
    .filter((t): t is TranscriptTurn => t !== null);
}

// Vercel Cron 用: 20分おきに最新スレッドを自動で伸ばす
export async function GET(req: Request) {
  // --- セキュリティチェック開始 ---
  const authHeader = req.headers.get("authorization");
  // ★ 自分で決めたキー (CRON_API_KEY) をチェック
  if (authHeader !== `Bearer ${process.env.CRON_API_KEY}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }
  // --- セキュリティチェック終了 ---

  try {
    // 1. promo_threads から created_at が一番新しいスレッドを1件取得
    const { data: rows, error: fetchError } = await supabase
      .from("promo_threads")
      .select("id, product_name, key_features, transcript, created_at")
      .order("created_at", { ascending: false })
      .limit(1);

    if (fetchError) {
      console.error("cron/extend-thread fetch error:", fetchError);
      return NextResponse.json(
        { error: "promo_threads の取得に失敗しました。" },
        { status: 500 }
      );
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        status: "no_thread",
        message: "promo_threads にスレッドが存在しません。",
      });
    }

    const thread = rows[0];
    const transcript = normalizeTranscript(thread.transcript ?? []);
    const productInfo = `${thread.product_name}\n${thread.key_features ?? ""}`;

    // 2. 直近の会話（最大10件程度）を文脈として渡す（新しい順）
    const recentTurns = transcript.slice(-10).reverse();
    const context = recentTurns.map(
      (t) => `${t.speaker_name}「${t.content}」`
    );

    // 3. generateAppendComments で 1〜3件の追いコメント生成
    const newComments = await generateAppendComments(context, productInfo);

    if (newComments.length === 0) {
      return NextResponse.json({
        status: "no_new_comments",
        thread_id: thread.id,
        message: "生成された追いコメントが0件でした。",
      });
    }

    const updatedTranscript = [...transcript, ...newComments];

    // 4. DB を更新
    const { error: updateError } = await supabase
      .from("promo_threads")
      .update({ transcript: updatedTranscript })
      .eq("id", thread.id);

    if (updateError) {
      console.error("cron/extend-thread Supabase update error:", updateError);
      return NextResponse.json(
        { error: "transcript の更新に失敗しました。" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "extended",
      thread_id: thread.id,
      added_count: newComments.length,
    });
  } catch (e) {
    console.error("cron/extend-thread error:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "cron/extend-thread 実行中にエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}

