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
        console.error(
          "【エラー】楽天の商品コード抽出に失敗しました。 対象URL:",
          targetUrl
        );
        return NextResponse.json(
          { title: "", error: "商品コードが特定できませんでした。手動で入力してください。" },
          { status: 200 }
        );
      }
      // 楽天以外のURLの場合は後続のスクレイピングへ
    } else {
      // 楽天の場合は公式APIを使用（スクレイピングなし）
      // 1. APP_ID と ACCESS_KEY の両方を環境変数から取得
      if (!process.env.RAKUTEN_APP_ID || !process.env.RAKUTEN_ACCESS_KEY) {
        console.error(
          "【エラー】楽天APIの認証情報（APP_IDまたはACCESS_KEY）が設定されていません。"
        );
        return NextResponse.json(
          { title: "", error: "システム設定エラーのため取得できません。" },
          { status: 200 }
        );
      }

      const shopCode = rakutenMatch[1];
      const itemCode = rakutenMatch[2];
      // 2. 正しい最新のエンドポイント（クエリパラメータに accessKey を含める）
      let apiUrl = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?format=json&itemCode=${shopCode}:${itemCode}&applicationId=${process.env.RAKUTEN_APP_ID}&accessKey=${process.env.RAKUTEN_ACCESS_KEY}`;

      console.log(`【実行】楽天API（新仕様）へリクエスト: ${apiUrl}`);

      const fetchOptions = {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Referer: "https://ai-buzz-media.vercel.app/",
          Origin: "https://ai-buzz-media.vercel.app",
        },
        signal: AbortSignal.timeout(10000),
      };

      try {
        // 3. WAF突破のための Referer と Origin ヘッダーを両方付与する
        let response = await fetch(apiUrl, fetchOptions);

        if (!response.ok) {
          const errorText = await response.text();

          // itemCodeが無効な場合、keyword検索にフォールバック
          if (
            response.status === 400 &&
            errorText.includes("itemCode is not valid")
          ) {
            console.log(
              `【フォールバック】itemCodeでの取得に失敗したため、shopCodeとkeywordで再検索します: shop=${shopCode}, keyword=${itemCode}`
            );
            apiUrl = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?format=json&keyword=${encodeURIComponent(itemCode)}&shopCode=${shopCode}&applicationId=${process.env.RAKUTEN_APP_ID}&accessKey=${process.env.RAKUTEN_ACCESS_KEY}`;
            response = await fetch(apiUrl, fetchOptions);

            if (!response.ok) {
              const fallbackError = await response.text();
              console.error(
                `【楽天API フォールバック失敗】ステータス: ${response.status}, 詳細: ${fallbackError}`
              );
              return NextResponse.json(
                {
                  title: "",
                  error:
                    "商品データが見つかりませんでした。手動で入力してください。",
                },
                { status: 200 }
              );
            }
          } else {
            // その他の致命的エラー
            console.error(
              `【楽天API 致命的エラー】ステータス: ${response.status}, 詳細: ${errorText}`
            );
            return NextResponse.json(
              {
                title: "",
                error:
                  "楽天APIからエラーが返されました。手動で入力してください。",
              },
              { status: 200 }
            );
          }
        }

        // 4. データ取得成功時
        const data = (await response.json()) as {
          Items?: Array<{ Item?: { itemName?: string } }>;
        };
        if (!data.Items || data.Items.length === 0) {
          console.error(
            "【エラー】楽天APIは正常終了しましたが、該当商品が見つかりませんでした。"
          );
          return NextResponse.json(
            { title: "", error: "商品データが見つかりませんでした。" },
            { status: 200 }
          );
        }

        const rawTitle = data.Items[0]?.Item?.itemName;
        if (!rawTitle || typeof rawTitle !== "string") {
          console.error("【エラー】楽天API: itemName が取得できませんでした。");
          return NextResponse.json(
            { title: "", error: "商品名の取得に失敗しました。" },
            { status: 200 }
          );
        }

        const title = cleanTitle(rawTitle);
        return NextResponse.json({ title });
      } catch (rakutenError) {
        console.error("【楽天API 例外】", rakutenError);
        if (rakutenError instanceof Error) {
          if (rakutenError.name === "AbortError") {
            return NextResponse.json(
              {
                title: "",
                error: "楽天APIの取得がタイムアウトしました。",
              },
              { status: 200 }
            );
          }
        }
        return NextResponse.json(
          {
            title: "",
            error: "楽天APIの取得に失敗しました。手動で入力してください。",
          },
          { status: 200 }
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
