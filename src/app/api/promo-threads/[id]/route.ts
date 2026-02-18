import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { TranscriptTurn } from "@/types/promo";

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id が必要です" }, { status: 400 });
    }

    const { data: row, error } = await supabase
      .from("promo_threads")
      .select("id, product_name, source_url, affiliate_url, key_features, og_image_url, transcript, created_at")
      .eq("id", id)
      .single();

    if (error || !row) {
      return NextResponse.json({ error: "スレッドが見つかりません" }, { status: 404 });
    }

    const transcript = normalizeTranscript(row.transcript ?? []);

    return NextResponse.json({
      ...row,
      transcript,
    });
  } catch (e) {
    console.error("promo-threads GET [id] error:", e);
    return NextResponse.json(
      { error: "スレッドの取得に失敗しました" },
      { status: 500 }
    );
  }
}
