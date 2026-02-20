import { NextRequest, NextResponse } from "next/server";

// 一般的なブラウザヘッダー（楽天・Amazon で弾かれないようにする）
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
} as const;

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

    // 楽天商品ページかどうかを判定（item.rakuten.co.jp/[shopCode]/[itemCode]）
    const rakutenMatch = targetUrl.match(
      /item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/
    );
    if (!rakutenMatch) {
      // item.rakuten.co.jp を含むが形式が不正な場合もここに来る
      if (targetUrl.includes("item.rakuten.co.jp")) {
        console.error("楽天の商品コードが抽出できませんでした URL:", targetUrl);
        return NextResponse.json(
          { title: "", error: "商品コードが特定できませんでした。手動で入力してください。" },
          { status: 200 }
        );
      }
      // 楽天以外のURLの場合は後続のスクレイピングへ
    } else {
      const shopCode = rakutenMatch[1];
      const itemCode = rakutenMatch[2];
      // 抽出値の検証（空・不正文字でAPIを叩かない）
      if (!shopCode || !itemCode || shopCode.length < 1 || itemCode.length < 1) {
        console.error("楽天の商品コードが不正です shopCode:", shopCode, "itemCode:", itemCode, "URL:", targetUrl);
        return NextResponse.json(
          { title: "", error: "商品コードが特定できませんでした。手動で入力してください。" },
          { status: 200 }
        );
      }

    // 楽天の場合は公式APIを使用（スクレイピングなし）
      const appId = process.env.RAKUTEN_APP_ID;
      if (!appId) {
        return NextResponse.json(
          { error: "楽天APIの設定がありません。RAKUTEN_APP_ID を設定してください。" },
          { status: 500 }
        );
      }
      try {
        const apiUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?format=json&itemCode=${encodeURIComponent(shopCode + ":" + itemCode)}&applicationId=${encodeURIComponent(appId)}`;
        const apiRes = await fetch(apiUrl, {
          signal: AbortSignal.timeout(10000),
        });
        const data = (await apiRes.json()) as {
          Items?: Array<{ Item?: { itemName?: string } }>;
          error?: string;
          error_description?: string;
        };
        if (!apiRes.ok) {
          const errMsg =
            data?.error_description ?? data?.error ?? `API エラー（HTTP ${apiRes.status}）`;
          return NextResponse.json({ error: errMsg }, { status: apiRes.status });
        }
        const itemName =
          data?.Items?.[0]?.Item?.itemName;
        if (!itemName || typeof itemName !== "string") {
          return NextResponse.json(
            { error: "楽天APIから商品名を取得できませんでした。" },
            { status: 404 }
          );
        }
        const title = cleanTitle(itemName);
        return NextResponse.json({ title });
      } catch (rakutenError) {
        if (rakutenError instanceof Error) {
          if (rakutenError.name === "AbortError") {
            return NextResponse.json(
              { error: "楽天APIの取得がタイムアウトしました。" },
              { status: 408 }
            );
          }
          return NextResponse.json(
            { error: rakutenError.message || "楽天APIの取得に失敗しました。" },
            { status: 500 }
          );
        }
        return NextResponse.json(
          { error: "楽天APIの取得に失敗しました。" },
          { status: 500 }
        );
      }
    }

    // 楽天以外: 通常のスクレイピング
    const res = await fetch(targetUrl, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(10000), // 10秒でタイムアウト
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `ページの取得に失敗しました（HTTP ${res.status}）` },
        { status: res.status }
      );
    }

    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!titleMatch || !titleMatch[1]) {
      return NextResponse.json(
        { error: "ページからタイトルを取得できませんでした。" },
        { status: 404 }
      );
    }

    const rawTitle = titleMatch[1]
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
