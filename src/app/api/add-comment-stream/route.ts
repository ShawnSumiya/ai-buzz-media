import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateStreamComments } from "@/lib/gemini";
import type { TranscriptTurn } from "@/types/promo";

/** レガシー形式を新形式に変換 */
function normalizeTranscript(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const r = item as Record<string, unknown>;
      // 新形式
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
      // レガシー形式 (speaker, content)
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

    // Step 1: Context Loading - 直近10件程度の会話を取得
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

    // 直近10件をコンテキストとして渡す（新しい順）
    const recentTurns = transcript.slice(-10).reverse();
    const context = recentTurns.map(
      (t) => `[${t.speaker_attribute}] ${t.speaker_name}: ${t.content}`
    );

    // Step 2: Dynamic Persona & Comment Generation (Gemini)
    const newComments = await generateStreamComments(context, productInfo);

    if (newComments.length === 0) {
      return NextResponse.json({
        newComments: [],
        transcript,
      });
    }

    const updatedTranscript = [...transcript, ...newComments];

    // DBに保存
    const { error: updateError } = await supabase
      .from("promo_threads")
      .update({ transcript: updatedTranscript })
      .eq("id", threadId);

    if (updateError) {
      console.error("Supabase update error:", updateError);
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
    console.error("add-comment-stream error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "コメントの追加に失敗しました" },
      { status: 500 }
    );
  }
}
