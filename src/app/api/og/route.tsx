import { ImageResponse } from "@vercel/og";

export const runtime = "edge";

const DEFAULT_TITLE = "AI Buzz Media";

// WOFF使用: 日本語TTFは9MB超でVercel Edge 500KB制限に抵触するため
const fontData = fetch(
  new URL("./NotoSansJP-Bold.woff", import.meta.url)
).then((res) => res.arrayBuffer());

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") || DEFAULT_TITLE;
  const decodedTitle = decodeURIComponent(title);
  const displayTitle =
    decodedTitle.length > 80
      ? `${decodedTitle.slice(0, 80)}…`
      : decodedTitle;

  try {
    const fontBuffer = await fontData;

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
            fontFamily: "Noto Sans JP, sans-serif",
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
        fonts: [
          {
            name: "Noto Sans JP",
            data: fontBuffer,
            weight: 700 as const,
            style: "normal" as const,
          },
        ],
      }
    );
  } catch (e) {
    console.error("OG image generation error:", e);
    return new Response("Failed to generate image", { status: 500 });
  }
}
