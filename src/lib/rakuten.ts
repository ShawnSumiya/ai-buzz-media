/**
 * 楽天商品検索API（URLからのItem Code完全一致検索）
 * キーワード検索ではなく、itemCodeで確実に1件を特定する。
 */

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://ai-buzz-media.vercel.app/",
  Origin: "https://ai-buzz-media.vercel.app",
} as const;

const RAKUTEN_ITEM_URL_REGEX = /item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/;

/**
 * 楽天商品URLから商品詳細（itemCaption等）を取得する。
 * アフィリエイト短縮URL → リダイレクト解決 → itemCode抽出 → API完全一致検索
 *
 * @param url 楽天商品ページのURL（アフィリエイト短縮URL可）
 * @returns 商品説明文を連結した文字列。取得失敗時は空文字
 */
export async function getRakutenItemDetails(
  url: string
): Promise<string> {
  if (!url?.trim()) return "";

  const trimmed = url.trim();
  if (!process.env.RAKUTEN_APP_ID || !process.env.RAKUTEN_ACCESS_KEY) {
    console.warn("[rakuten] RAKUTEN_APP_ID または RAKUTEN_ACCESS_KEY が未設定です");
    return "";
  }

  try {
    // ① リダイレクト解決: アフィリエイト短縮URL等から最終到達URLを取得
    let canonicalUrl = trimmed;
    try {
      const parsed = new URL(trimmed);
      // 楽天アフィリエイトリンク: pc パラメータに本URLが入っている場合
      if (parsed.hostname === "hb.afl.rakuten.co.jp" && parsed.searchParams.get("pc")) {
        canonicalUrl = decodeURIComponent(parsed.searchParams.get("pc")!);
      } else {
        const headRes = await fetch(trimmed, {
          method: "HEAD",
          redirect: "follow",
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(10000),
        });
        canonicalUrl = headRes.url;
      }
    } catch {
      // パース/取得失敗時は元URLのまま正規表現を試す
    }

    // ② 正規表現で店舗名($1)と商品番号($2)を抽出
    const match = canonicalUrl.match(RAKUTEN_ITEM_URL_REGEX);
    if (!match) {
      return "";
    }

    const shopCode = match[1];
    const itemCode = match[2];
    const itemCodeParam = `${shopCode}:${itemCode}`;

    // ③ API呼び出し: itemCode で完全一致検索（keyword は使用しない）
    const apiUrl = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?format=json&itemCode=${encodeURIComponent(itemCodeParam)}&applicationId=${process.env.RAKUTEN_APP_ID}&accessKey=${process.env.RAKUTEN_ACCESS_KEY}`;

    const apiRes = await fetch(apiUrl, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(10000),
    });

    if (!apiRes.ok) {
      console.warn(
        `[rakuten] API error: ${apiRes.status} ${await apiRes.text()}`
      );
      return "";
    }

    const data = (await apiRes.json()) as {
      Items?: Array<{
        Item?: {
          itemName?: string;
          itemCaption?: string;
          itemPrice?: number;
          catchcopy?: string;
        };
      }>;
    };

    if (!data.Items || data.Items.length === 0) {
      return "";
    }

    const item = data.Items[0]?.Item;
    if (!item) return "";

    const parts: string[] = [];
    if (item.itemName) parts.push(item.itemName);
    if (item.catchcopy) parts.push(item.catchcopy);
    if (item.itemCaption) parts.push(item.itemCaption);
    if (item.itemPrice != null) parts.push(`価格: ${item.itemPrice}円`);

    return parts.filter(Boolean).join("\n\n").trim() || "";
  } catch (e) {
    console.warn("[rakuten] getRakutenItemDetails failed:", e);
    return "";
  }
}
