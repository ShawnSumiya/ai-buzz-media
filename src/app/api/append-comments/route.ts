import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateAppendComments } from "@/lib/gemini";
import type { TranscriptTurn } from "@/types/promo";

/** レガシー形式を新形式に変換 */
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

/**
 * 既存スレッドに追いコメントを5件追加するAPI
 * 盛り上がりに便乗し、文脈を繋げた新規コメントを生成
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const threadId = typeof body?.thread_id === "string" ? body.thread_id.trim() : null;

    if (!threadId) {
      return NextResponse.json(
        { error: "thread_id が必要です" },
        { status: 400 }
      );
    }

    // Step 1: スレッド情報と最新の transcript を取得
    const { data: row, error: fetchError } = await supabase
      .from("promo_threads")
      .select("id, product_name, key_features, transcript")
      .eq("id", threadId)
      .single();

    if (fetchError || !row) {
      return NextResponse.json(
        { error: "スレッドが見つかりません" },
        { status: 404 }
      );
    }

    const transcript = normalizeTranscript(row.transcript ?? []);
    const productInfo = `${row.product_name}\n${row.key_features ?? ""}`;

    // 直近の会話をコンテキストとして渡す（新しい順、最大15件）
    const recentTurns = transcript.slice(-15).reverse();
    const context = recentTurns.map(
      (t) => `${t.speaker_name}「${t.content}」`
    );

    // Step 2: 追いコメント5件を生成
    const newComments = await generateAppendComments(context, productInfo);

    if (newComments.length === 0) {
      return NextResponse.json({
        newComments: [],
        transcript,
      });
    }

    const updatedTranscript = [...transcript, ...newComments];

    // Step 3: DBに追記
    const { error: updateError } = await supabase
      .from("promo_threads")
      .update({ transcript: updatedTranscript })
      .eq("id", threadId);

    if (updateError) {
      console.error("append-comments Supabase update error:", updateError);
      return NextResponse.json(
        { error: "コメントの保存に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      newComments,
      transcript: updatedTranscript,
    });
  } catch (e) {
    console.error("append-comments error:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "追いコメントの追加に失敗しました",
      },
      { status: 500 }
    );
  }
}
