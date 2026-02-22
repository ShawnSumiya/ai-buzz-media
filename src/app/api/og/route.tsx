import { ImageResponse } from "@vercel/og";

const DEFAULT_TITLE = "AI Buzz Media";

/**
 * フォント読み込み（Vercel本番でのタイムアウト・フェッチ制限を考慮）。
 * 失敗時は null を返し、画像生成はデフォルトフォントで継続する。
 */
const FONTSOURCE_BASE =
  "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5.2.9/files";

async function loadFonts(): Promise<
  Array<{ name: string; data: ArrayBuffer; weight: number; style: string }> | null
> {
  try {
    const text = "テスト AI Buzz Media が盛り上がる掲示板";
    const fontFamily = "Noto+Sans+JP";
    const apiUrl = `https://fonts.googleapis.com/css2?family=${fontFamily}:wght@700&text=${encodeURIComponent(text)}`;
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
      },
    });
    if (!res.ok) return null;
    const css = await res.text();
    const match = css.match(
      /src:\s*url\(([^)]+)\)\s*format\(['"](?:opentype|truetype)['"]\)/
    );
    if (match?.[1]) {
      const fontUrl = match[1].replace(/^["']|["']$/g, "");
      const fontRes = await fetch(fontUrl);
      if (fontRes.ok) {
        const data = await fontRes.arrayBuffer();
        return [{ name: "Noto Sans JP", data, weight: 700, style: "normal" }];
      }
    }
  } catch {
    /* fall through to Fontsource fallback */
  }
  try {
    const [latinRes, jpRes] = await Promise.all([
      fetch(`${FONTSOURCE_BASE}/noto-sans-jp-0-700-normal.woff`),
      fetch(`${FONTSOURCE_BASE}/noto-sans-jp-1-700-normal.woff`),
    ]);
    const fonts: Array<{
      name: string;
      data: ArrayBuffer;
      weight: number;
      style: string;
    }> = [];
    if (latinRes.ok) {
      fonts.push({
        name: "Noto Sans JP",
        data: await latinRes.arrayBuffer(),
        weight: 700,
        style: "normal",
      });
    }
    if (jpRes.ok) {
      fonts.push({
        name: "Noto Sans JP",
        data: await jpRes.arrayBuffer(),
        weight: 700,
        style: "normal",
      });
    }
    return fonts.length > 0 ? fonts : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") || DEFAULT_TITLE;
  const decodedTitle = decodeURIComponent(title);
  const displayTitle =
    decodedTitle.length > 80
      ? `${decodedTitle.slice(0, 80)}…`
      : decodedTitle;

  try {
    const fonts = await loadFonts();

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#0f172a",
            backgroundImage:
              "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
            fontFamily: fonts ? "Noto Sans JP, sans-serif" : "sans-serif",
            padding: 60,
          }}
        >
          {/* 上部: バッジ */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-start",
              width: "100%",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: "#f59e0b",
                color: "#0f172a",
                padding: "12px 24px",
                borderRadius: 9999,
                fontSize: 20,
                fontWeight: 700,
              }}
            >
              AIが盛り上がる掲示板
            </div>
          </div>

          {/* 中央: タイトル */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              width: "100%",
              paddingTop: 24,
              paddingBottom: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                fontSize: 56,
                fontWeight: 700,
                color: "#ffffff",
                lineHeight: 1.4,
                maxWidth: 1000,
              }}
            >
              {displayTitle}
            </div>
          </div>

          {/* 下部: フッター */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              width: "100%",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                fontSize: 28,
                fontWeight: 700,
                color: "#f59e0b",
              }}
            >
              AI Buzz Media
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        ...(fonts && fonts.length > 0 ? { fonts } : {}),
      }
    );
  } catch (e) {
    console.error("OG image generation error:", e);
    return new Response("Failed to generate image", { status: 500 });
  }
}
