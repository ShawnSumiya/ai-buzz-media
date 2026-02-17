import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateJSON } from "@/lib/gemini";
import type { CastProfile, TranscriptTurn } from "@/types/promo";

// Vercel Serverless Function Config
export const maxDuration = 60; // デフォルトの10秒だと2段階生成でタイムアウトする恐れがあるため
export const dynamic = 'force-dynamic';

/** レガシー形式 { speaker, content } を新形式に変換 */
function toNewFormat(
  turns: { speaker: string; content: string; timestamp: string }[]
): TranscriptTurn[] {
  return turns.map((t, i) => ({
    id: crypto.randomUUID(),
    speaker_name: t.speaker,
    speaker_attribute: "一般ユーザー",
    content: t.content,
    timestamp: t.timestamp ?? new Date().toISOString(),
  }));
}

const SYSTEM_INSTRUCTION = `あなたは5ちゃんねるやX(Twitter)に書き込む本物の人間のように振る舞う。商品を絶対に批判・否定・嘲笑してはいけない。
敬語禁止。タメ口・ネットスラング必須。短文中心。スペック説明・論理構文禁止。体験・感情のみ。「マジか」「これ神」「ｗ」などを適度に。
全員ハイテンションNG。冷静オタク、金欠学生、様子見派などの多様なペルソナを混ぜる。
Output valid JSON only, no markdown code fences or extra text.`;

/** Step 1: 商品分析と3名のキャラクター設定をJSONで返す */
async function analyzeAndCast(
  inputText: string
): Promise<{
  product_name: string;
  key_features: string;
  cast_profiles: CastProfile[];
}> {
  const prompt = `以下の商品/ページ内容を分析し、JSONのみ出力せよ。

Input:
${inputText.slice(0, 12000)}

Output a single JSON object with these exact keys:
- product_name: string (短い商品名)
- key_features: string (USP・訴求ポイントを箇条書き or 要約)
- cast_profiles: array of exactly 3 objects, each with:
  - name: string (5ch/X風ニックネーム。例: おでん、ガジェッター、主婦A)
  - role: string (ペルソナ種別)
  - short_description: string (1行で性格・視点を説明)

キャラ役割は多様に。全員ハイテンションNG。例:
- role: "冷静オタク" / 最初は疑ってるが最後は欲しくなる
- role: "金欠学生" / お金ないけど欲しい、悩んでる
- role: "様子見派" / 慎重に評価、口コミ見に来た

全員商品にポジティブだが、声色・テンションはバラバラに。`;

  const text = await generateJSON(prompt, SYSTEM_INSTRUCTION);
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned) as {
    product_name: string;
    key_features: string;
    cast_profiles: CastProfile[];
  };
}

/** Step 2: 会話10〜15ターンを生成 */
async function generateHypeTranscript(
  productName: string,
  keyFeatures: string,
  castProfiles: CastProfile[]
): Promise<TranscriptTurn[]> {
  const castSummary = castProfiles
    .map((c) => `- ${c.name}: ${c.role} — ${c.short_description}`)
    .join("\n");

  const prompt = `この商品について、5ch/X風のリアルな会話（10〜15ターン）を生成せよ。

Product: ${productName}
Key features (context): ${keyFeatures}

Cast（speaker には以下の名前をそのまま使用）:
${castSummary}

【文体・必須】
- 敬語禁止。タメ口・ネットスラング。「マジか」「これ神」「ｗ」「（笑）」「！」適度に
- スペック説明・「〜なので便利」禁止。体験・感情のみ。短文中心
- Bad: 「セール中ですね！バッテリーが良いので最適です。」
- Good: 「うわ安くなってるマジか」「スタバでドヤるしかねえｗ」「この値段バグだろ...」

【ルール】
1. 全員ポジティブ。批判禁止
2. 最後に CTA: 「とりあえずポチった」「公式見てくるわ」「売り切れ前に急げ」など

Output a single JSON object:
- transcript: array of objects, each with: speaker (string), content (string), timestamp (string, e.g. "00:00", "00:01")
Output valid JSON only.`;

  const text = await generateJSON(prompt, SYSTEM_INSTRUCTION);
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as {
    transcript: { speaker: string; content: string; timestamp: string }[];
  };
  const raw = parsed.transcript ?? [];
  return toNewFormat(raw);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = typeof body?.url === "string" ? body.url.trim() : undefined;
    const textContent = typeof body?.text_content === "string" ? body.text_content.trim() : undefined;

    let inputText = textContent ?? "";
    if (!inputText && url) {
      // MVP: URL のみの場合は簡易フェッチ（同一オリジン or CORS 許可サーバーのみ有効）。まずはテキストを促す。
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; HypeBot/1.0)" },
        });
        if (res.ok) inputText = await res.text();
        else inputText = `[URL only, no body fetched: ${url}]`;
      } catch {
        inputText = `[URL provided but could not fetch: ${url}. Please paste content as text_content.]`;
      }
    }

    if (!inputText || inputText.length < 10) {
      return NextResponse.json(
        { error: "url または text_content を入力してください（テキストは10文字以上）。" },
        { status: 400 }
      );
    }

    const step1 = await analyzeAndCast(inputText);
    const transcript = await generateHypeTranscript(
      step1.product_name,
      step1.key_features,
      step1.cast_profiles
    );

    const sourceUrl = url || null;

    const { data: row, error } = await supabase
      .from("promo_threads")
      .insert({
        product_name: step1.product_name,
        source_url: sourceUrl,
        key_features: step1.key_features,
        cast_profiles: step1.cast_profiles,
        transcript,
      })
      .select("id, product_name, source_url, key_features, cast_profiles, transcript, created_at")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { error: "保存に失敗しました。promo_threads テーブルが存在するか確認してください。" },
        { status: 500 }
      );
    }

    return NextResponse.json(row);
  } catch (e) {
    console.error("create-hype error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "会話の生成に失敗しました。" },
      { status: 500 }
    );
  }
}
