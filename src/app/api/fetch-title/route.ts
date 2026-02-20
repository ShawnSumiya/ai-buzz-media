import { NextRequest, NextResponse } from "next/server";

// 一般的なブラウザの User-Agent（楽天・Amazon で弾かれないようにする）
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function cleanTitle(raw: string): string {
  let title = raw.trim();
  // ECサイト特有の接頭辞・接尾辞を削除
  const prefixes = [
    /^【楽天市場】\s*/,
    /^【楽天】\s*/,
    /^楽天市場\s*-\s*/i,
    /^Amazon \|\s*/i,
    /^Amazon\.co\.jp：\s*/i,
    /^Yahoo!ショッピング\s*-\s*/i,
    /^Yahoo!ショッピング：\s*/i,
    /^【ヤフオク!】\s*/,
  ];
  const suffixes = [
    /\s*-\s*楽天市場$/,
    /\s*-\s*楽天$/,
    /\s*\|\s*Amazon\.co\.jp$/i,
    /\s*-\s*Yahoo!ショッピング$/i,
  ];
  for (const re of prefixes) {
    title = title.replace(re, "");
  }
  for (const re of suffixes) {
    title = title.replace(re, "");
  }
  return title.trim();
}

export async function GET(request: NextRequest) {
  try {
    const urlParam = request.nextUrl.searchParams.get("url");
    if (!urlParam || typeof urlParam !== "string") {
      return NextResponse.json(
        { error: "url クエリパラメータを指定してください。" },
        { status: 400 }
      );
    }

    const trimmedUrl = urlParam.trim();
    // 簡易URLバリデーション
    try {
      new URL(trimmedUrl);
    } catch {
      return NextResponse.json(
        { error: "有効なURLを指定してください。" },
        { status: 400 }
      );
    }

    // URLのパースと実際のターゲットURLの抽出
    let targetUrl = trimmedUrl;
    try {
      const parsedUrl = new URL(trimmedUrl);
      // 楽天アフィリエイトのリンクかどうかを判定
      if (parsedUrl.hostname === "hb.afl.rakuten.co.jp") {
        const pcUrl = parsedUrl.searchParams.get("pc");
        if (pcUrl) {
          targetUrl = decodeURIComponent(pcUrl); // デコードして本物のURLを取り出す
        }
      }
    } catch (error) {
      console.error("URLの解析に失敗しました:", error);
      // パース失敗時は元のurlのまま進める
    }

    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000), // 10秒でタイムアウト
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `ページの取得に失敗しました（HTTP ${res.status}）` },
        { status: res.status }
      );
    }

    const html = await res.text();
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!match || !match[1]) {
      return NextResponse.json(
        { error: "ページからタイトルを取得できませんでした。" },
        { status: 404 }
      );
    }

    const rawTitle = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    const title = cleanTitle(rawTitle);

    return NextResponse.json({ title });
  } catch (e) {
    if (e instanceof Error) {
      if (e.name === "AbortError") {
        return NextResponse.json(
          { error: "タイムアウトしました。しばらくしてから再度お試しください。" },
          { status: 408 }
        );
      }
      return NextResponse.json(
        { error: e.message || "タイトルの取得に失敗しました。" },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "タイトルの取得に失敗しました。" },
      { status: 500 }
    );
  }
}
