import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/** 楽天アフィリエイト「テキストのみ」HTMLタグかどうかを判定 */
function isRakutenAffiliateHtmlTag(input: string): boolean {
  return input.trim().toLowerCase().startsWith("<a ");
}

/**
 * HTMLタグ（<a href="...">...</a>）からURLとリンクテキストを抽出
 * @returns { url, affiliateText } 抽出できたもののみ。失敗時は null
 */
function parseAffiliateHtmlTag(
  input: string
): { url: string; affiliateText: string } | null {
  const trimmed = input.trim();
  if (!isRakutenAffiliateHtmlTag(trimmed)) return null;

  // href 属性を抽出（href="..." または href='...'）
  const hrefMatch = trimmed.match(/href\s*=\s*["']([^"']+)["']/i);
  const url = hrefMatch?.[1]?.trim();
  if (!url) return null;

  // <a> と </a> の間のテキストを抽出
  const textMatch = trimmed.match(/<a\s[^>]*>([\s\S]*?)<\/a>/i);
  const affiliateText = textMatch?.[1]?.trim() ?? "";

  return { url, affiliateText };
}

// RLSを無視できる特権クライアント
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

// 管理画面から URL を「ネタ帳キュー」に積むためのAPI

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawInput =
      typeof body?.url === "string" ? body.url.trim() : "";
    const title =
      typeof body?.title === "string" ? body.title.trim() || null : null;
    const affiliateUrl =
      typeof body?.affiliate_url === "string" ? body.affiliate_url.trim() : null;
    const context =
      typeof body?.context === "string" ? body.context.trim() || null : null;

    if (!rawInput) {
      return NextResponse.json(
        { error: "url または楽天アフィリエイトのHTMLタグを指定してください。" },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json(
        { error: "title（商品名・管理用メモ）を指定してください。" },
        { status: 400 }
      );
    }

    // 楽天アフィリエイトHTMLタグ（<a href="...">...</a>）の場合は解析して抽出
    let urlToStore: string;
    let affiliateTextToStore: string | null = null;

    const parsed = parseAffiliateHtmlTag(rawInput);
    if (parsed) {
      urlToStore = parsed.url;
      if (parsed.affiliateText) {
        affiliateTextToStore = parsed.affiliateText;
      }
    } else {
      // 通常のURLとしてそのまま使用
      urlToStore = rawInput;
    }

    const { data, error } = await supabaseAdmin
      .from("topic_queue")
      .insert({
        url: urlToStore,
        title: title || null,
        affiliate_url: affiliateUrl || null,
        affiliate_text: affiliateTextToStore,
        context,
        status: "pending",
      })
      .select("id, url, title, affiliate_url, affiliate_text, context, status, created_at")
      .single();

    if (error) {
      console.error("topic-queue insert error:", error);
      return NextResponse.json(
        { error: "キューへの追加に失敗しました。" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("topic-queue POST error:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "キューへの追加処理中にエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}

// （オプション）簡易的な一覧取得。今は pending のみ返す。
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("topic_queue")
      .select("id, url, title, affiliate_url, affiliate_text, context, status, created_at")
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("topic-queue list error:", error);
      return NextResponse.json(
        { error: "キューの取得に失敗しました。" },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error("topic-queue GET error:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "キュー一覧取得中にエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}

// ステータスを pending に戻して再実行可能にする
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const status = typeof body?.status === "string" ? body.status.trim() : "";
    if (!id) {
      return NextResponse.json(
        { error: "id を指定してください。" },
        { status: 400 }
      );
    }
    if (status !== "pending") {
      return NextResponse.json(
        { error: "status は 'pending' を指定してください。" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("topic_queue")
      .update({ status })
      .eq("id", id)
      .select("id, url, title, affiliate_url, affiliate_text, context, status, created_at")
      .single();

    if (error) {
      console.error("topic-queue PATCH error:", error);
      return NextResponse.json(
        { error: "ステータスの更新に失敗しました。" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("topic-queue PATCH error:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "ステータス更新中にエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}

// キューから指定IDのレコードを削除
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json(
        { error: "id を指定してください。" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("topic_queue")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("topic-queue delete error:", error);
      return NextResponse.json(
        { error: "キューの削除に失敗しました。" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("topic-queue DELETE error:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "キュー削除中にエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}

