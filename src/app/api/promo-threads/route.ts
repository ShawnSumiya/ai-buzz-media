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

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("promo_threads")
      .select("id, product_name, source_url, key_features, og_image_url, cast_profiles, transcript, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase list error:", error);
      return NextResponse.json(
        { error: "一覧の取得に失敗しました。" },
        { status: 500 }
      );
    }

    const rows = (data ?? []).map((row) => ({
      ...row,
      transcript: normalizeTranscript(row.transcript ?? []),
    }));

    return NextResponse.json(rows);
  } catch (e) {
    console.error("promo-threads GET error:", e);
    return NextResponse.json(
      { error: "一覧の取得に失敗しました。" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "id が指定されていません。" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("promo_threads")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Supabase delete error:", error);
      return NextResponse.json(
        { error: "削除に失敗しました。" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("promo-threads DELETE error:", e);
    return NextResponse.json(
      { error: "削除に失敗しました。" },
      { status: 500 }
    );
  }
}
