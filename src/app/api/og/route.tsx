import { ImageResponse } from "@vercel/og";

export const runtime = "edge";

const DEFAULT_TITLE = "AI Buzz Media";

async function loadNotoSansJP(): Promise<ArrayBuffer> {
  const fontUrl =
    "https://fonts.gstatic.com/s/notosansjp/v52/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75vY3rw.woff2";
  const res = await fetch(fontUrl);
  if (!res.ok) {
    throw new Error("Failed to load font");
  }
  return res.arrayBuffer();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") || DEFAULT_TITLE;
  const decodedTitle = decodeURIComponent(title);

  try {
    const fontData = await loadNotoSansJP();

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
            fontFamily: "Noto Sans JP, sans-serif",
            padding: 60,
          }}
        >
          {/* 掲示板風の枠線 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              flex: 1,
              border: "4px solid #f59e0b",
              borderRadius: 12,
              backgroundColor: "rgba(248, 250, 252, 0.95)",
              padding: 48,
              position: "relative",
            }}
          >
            {/* サイトロゴ・バッジ */}
            <div
              style={{
                position: "absolute",
                top: 24,
                left: 32,
                display: "flex",
                alignItems: "center",
                gap: 8,
                backgroundColor: "#fef3c7",
                color: "#b45309",
                padding: "8px 16px",
                borderRadius: 9999,
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              AIが盛り上がる掲示板
            </div>

            {/* タイトル（中央に大きく） */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                flex: 1,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 52,
                  fontWeight: 700,
                  color: "#0f172a",
                  lineHeight: 1.4,
                  maxWidth: 900,
                }}
              >
                {decodedTitle.length > 80
                  ? `${decodedTitle.slice(0, 80)}…`
                  : decodedTitle}
              </div>
            </div>

            {/* フッター */}
            <div
              style={{
                position: "absolute",
                bottom: 24,
                right: 32,
                fontSize: 24,
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
            data: fontData,
            weight: 700,
            style: "normal",
          },
        ],
      }
    );
  } catch (e) {
    console.error("OG image generation error:", e);
    return new Response("Failed to generate image", { status: 500 });
  }
}
