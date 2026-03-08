import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { TranscriptTurn } from "@/types/promo";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

/** is_closed および og_image_url を更新（終了/再開・サムネイル画像URL） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id が必要です" }, { status: 400 });
    }

    const body = await request.json();
    const isClosed =
      body?.is_closed !== undefined ? body.is_closed : undefined;
    const ogImageUrl =
      body?.og_image_url !== undefined
        ? (typeof body.og_image_url === "string"
            ? body.og_image_url.trim() || null
            : null)
        : undefined;

    if (isClosed === undefined && ogImageUrl === undefined) {
      return NextResponse.json(
        { error: "is_closed または og_image_url のいずれかを指定してください" },
        { status: 400 }
      );
    }

    const updatePayload: Record<string, unknown> = {};
    if (typeof isClosed === "boolean") updatePayload.is_closed = isClosed;
    if (ogImageUrl !== undefined) updatePayload.og_image_url = ogImageUrl;

    const { data, error } = await supabase
      .from("promo_threads")
      .update(updatePayload)
      .eq("id", id)
      .select("id, is_closed, og_image_url")
      .single();

    if (error) {
      console.error("promo-threads PATCH error:", error);
      return NextResponse.json(
        { error: "更新に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("promo-threads PATCH error:", e);
    return NextResponse.json(
      { error: "更新に失敗しました" },
      { status: 500 }
    );
  }
}
