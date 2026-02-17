import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 管理画面から URL を「ネタ帳キュー」に積むためのAPI

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";

    if (!rawUrl) {
      return NextResponse.json(
        { error: "url を指定してください。" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("topic_queue")
      .insert({
        url: rawUrl,
        status: "pending",
      })
      .select("id, url, status, created_at")
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
    const { data, error } = await supabase
      .from("topic_queue")
      .select("id, url, status, created_at")
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

// キューから指定IDのレコードを削除
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "id を指定してください。" },
        { status: 400 }
      );
    }

    const { error } = await supabase
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

