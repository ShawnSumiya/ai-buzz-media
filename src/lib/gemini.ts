import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import type { TranscriptTurn } from "@/types/promo";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY が設定されていません");
}

const genAI = new GoogleGenerativeAI(apiKey);

// モデル設定を一箇所で管理
const MODEL_NAME = "gemini-2.5-flash"; // 必要に応じて環境変数などで差し替え可能

// 安全性設定（エラー回避のため、制限を緩める）
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gemini 向けの汎用リトライヘルパー
 * - レートリミットなど一時的エラー時に指数バックオフで再試行する
 * - waitTime: 5秒 → 10秒 → 20秒 ...（5000 * 2^i）
 */
async function generateWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = i === maxRetries;

      // レートリミット系の判定（ステータスコード or メッセージ）
      const status = error?.status ?? error?.response?.status;
      const message: string = error?.message ?? "";
      const isRateLimitError =
        status === 429 ||
        /rate limit/i.test(message) ||
        /quota/i.test(message) ||
        /Resource has been exhausted/i.test(message);

      if (isLastAttempt || !isRateLimitError) {
        console.error("Gemini API Error (no more retries):", error);
        throw error;
      }

      const waitTime = 5000 * Math.pow(2, i); // 5秒 → 10秒 → 20秒 ...
      console.warn(
        `Gemini API rate limited (status: ${status ?? "unknown"}). Retrying in ${
          waitTime / 1000
        }s...`
      );
      await sleep(waitTime);
    }
  }

  // ここには到達しない想定
  throw new Error("generateWithRetry: unexpected state");
}

// 汎用的な生成関数（他でも使い回せるようにエクスポート推奨）
export async function generateContent(
  prompt: string,
  systemInstruction?: string
) {
  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: systemInstruction
        ? {
            role: "system",
            parts: [{ text: systemInstruction }],
          }
        : undefined,
    });

    const result = await generateWithRetry(() =>
      model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        safetySettings,
      })
    );

    const response = result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

// JSONを強制的に返させるためのヘルパー
export async function generateJSON(
  prompt: string,
  systemInstruction?: string
) {
  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: { responseMimeType: "application/json" }, // JSONモード強制
      systemInstruction: systemInstruction,
    });

    const result = await generateWithRetry(() =>
      model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        safetySettings,
      })
    );

    return result.response.text();
  } catch (error) {
    console.error("Gemini JSON Generation Error:", error);
    throw error;
  }
}

const SYSTEM_INSTRUCTION = `あなたは5ちゃんねるやX(Twitter)に書き込む本物の人間です。商品スレを見てリアルに反応する。

【絶対守ること】
- 敬語禁止。タメ口・ネットスラング必須（「マジか」「これ神」「うわ」「ｗ」「（笑）」など）
- 短文中心。1文が長くなりすぎるな
- スペックの説明禁止。「M3チップで〜」のような論理的な説明はダメ。体験・感情だけ語れ
- 「〜なので便利です」みたいな論理構文禁止。「これ神」「マジでヤバい」など直感的に
- 適度に誤字、「w」「（笑）」「！」の連打を混ぜてリアリティを出す

【ペルソナ多様性】
全員ハイテンションだと嘘っぽい。以下を混ぜろ:
- 冷静に評価するオタク
- 金欠だけど欲しい学生
- 様子見してる慎重派（でも最後は欲しくなる）

【悪い例】
「MacBook Airがセール中ですね！バッテリー持ちも良いので、カフェでの作業に最適です。」
→ 説明的、敬語、堅い

【良い例】
「うわAir安くなってる。マジか」
「前のモデル売って買い換えるわ。スタバでドヤるしかねえｗ」
「M3チップでこの値段はバグだろ...」

Output valid JSON only, no markdown code fences or extra text.`;

/**
 * 既存会話の文脈と商品情報から、1〜3件の新規コメントを生成する
 * 毎回新しい人格（属性）でコメントを返す
 */
export async function generateStreamComments(
  context: string[],
  productInfo: string
): Promise<TranscriptTurn[]> {
  const contextText =
    context.length > 0
      ? `【既存の会話ログ（最新順）】\n${context.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "（まだ会話はありません）";

  const prompt = `あなたは今、この商品の掲示板（5ch/X風）を見て、思わず書き込みたくてたまらなくなった一般ユーザーです。

${contextText}

【商品情報】
${productInfo}

既存の会話の流れ（Context）を読み、**前の人とは全く違う属性**になりきって、1〜3件のコメントを書き込んでください。

**文体・トーン（必須）:**
- 敬語禁止。タメ口・ネットスラングで。短文中心
- スペックの説明や「〜なので便利」は禁止。体験・感情のみ
- 「マジか」「これ神」「ｗ」「（笑）」「！」など適度に混ぜる

**ペルソナ例:** 冷静オタク、金欠学生、様子見慎重派 などを混ぜる。全員ハイテンションはNG。

**Bad:** 「セール中ですね！バッテリー持ちが良いのでカフェでの作業に最適です。」
**Good:** 「うわ安くなってる。マジか」「スタバでドヤるしかねえｗ」「この値段バグだろ...」

**出力形式:**
- speaker_attribute: 「30代主婦」「金欠学生」「様子見オタク」など
- speaker_name: ニックネーム（例: おでん、ガジェッター、主婦A）
- content: 上記トーンで、褒める・期待する・買う宣言に限る（ネガティブ禁止）

Output a single JSON object with one key:
- comments: array of 1 to 3 objects, each with: speaker_name (string), speaker_attribute (string), content (string)

id, timestamp は不要。Output valid JSON only.`;

  const text = await generateJSON(prompt, SYSTEM_INSTRUCTION);
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as {
    comments: { speaker_name: string; speaker_attribute: string; content: string }[];
  };

  const comments = parsed.comments ?? [];
  const now = new Date();

  return comments.map((c, i) => ({
    id: crypto.randomUUID(),
    speaker_name: c.speaker_name || "匿名",
    speaker_attribute: c.speaker_attribute || "一般ユーザー",
    content: c.content || "",
    timestamp: new Date(now.getTime() + i * 1000).toISOString(),
  }));
}

const APPEND_COMMENTS_SYSTEM = `あなたは5ちゃんねるやX(Twitter)に書き込む本物の人間です。
既存コメントの盛り上がりに便乗して、リアルな追いコメントを5件生成する。

【文体】敬語禁止。タメ口・ネットスラング。短文中心。「ｗ」「（笑）」「！」適度に混ぜる。
【内容】スペック説明・論理構文禁止。体験・感情のみ。「マジか」「これ神」など直感的に。
【ペルソナ】冷静オタク、金欠学生、様子見派などを混ぜる。全員ハイテンションはNG。
【文脈継承】「↑それな」「私も買った」「ワイも気になってる」など前の発言へのリアクションを入れる。
【禁止】ネガティブ発言。商品を褒める・期待する・買う宣言に限る。

Output valid JSON only, no markdown code fences or extra text.`;

// ----- 無限ランダムユーザー名（追いコメント用にも使う） -----
const jpAdjectives = [
  "眠い", "腹ペコ", "限界", "謎の", "通りすがりの", "深夜の", "無職の", "匿名の",
  "暇な", "常連の", "新参の", "熱烈な", "冷静な", "適当な", "本気の", "うっかり",
  "今日も", "明日も", "永遠の", "刹那の", "伝説の", "ただの",
];
const jpNouns = [
  "猫", "OL", "おじさん", "学生", "エンジニア", "主婦", "名無し", "浪人",
  "ニート", "オタク", "ガジェッター", "社会人", "大学生", "高校生", "主夫",
  "フリーター", "プログラマー", "デザイナー", "主婦", "パパ", "ママ",
  "一般人", "常連", "新規", "通りすがり", "暇人",
];
const enAdjectives = [
  "Happy", "Lazy", "Super", "Yellow", "Cool", "Dark", "Silent", "Quick",
  "Tiny", "Wild", "Calm", "Bored", "Chill", "Random", "Real", "True",
  "Sleepy", "Hungry", "Anonymous", "Mystery",
];
const enNouns = [
  "Dog", "Cat", "User", "Taro", "Hanako", "Papa", "Mama", "Dev", "Geek",
  "Guy", "Gal", "Kid", "Dad", "Mom", "Anon", "Guest", "Visitor",
  "Reader", "Writer", "Coder", "Gamer", "Otaku",
];
const decorators = [
  "123", "007", "_jp", "w", "（仮）", "2026", "!!", "_sub", "...", "",
  "さん", "氏", "ちゃん", "2nd", "v2", "01", "99", "（二度目）",
];

function getRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomUserName(): string {
  const patterns = [
    () => getRandom(jpAdjectives) + getRandom(jpNouns) + getRandom(decorators),
    () =>
      getRandom(enAdjectives).toLowerCase() +
      "_" +
      getRandom(enNouns).toLowerCase() +
      String(Math.floor(Math.random() * 1000)).padStart(3, "0"),
    () => getRandom(jpNouns) + getRandom(decorators),
  ];
  return patterns[Math.floor(Math.random() * patterns.length)]();
}

function generateUniqueUserNames(count: number): string[] {
  const set = new Set<string>();
  let attempts = 0;
  const maxAttempts = count * 50;
  while (set.size < count && attempts < maxAttempts) {
    set.add(generateRandomUserName());
    attempts++;
  }
  return Array.from(set);
}

/**
 * 既存スレッドに「追いコメント」を1〜3件生成
 * - 直近の文脈を引き継ぐ
 * - 毎回「無限ランダムユーザー名」で persona を付与する
 */
export async function generateAppendComments(
  context: string[],
  productInfo: string
): Promise<TranscriptTurn[]> {
  const contextText =
    context.length > 0
      ? `【既存の会話ログ（最新〜古い順）】\n${context.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "（まだ会話はありません）";

  const prompt = `以下の掲示板スレッド（5ch/X風）では、すでに盛り上がっている会話がある。
その流れに便乗して、**1〜3件**のリアルな追いコメントを生成せよ。

${contextText}

【商品情報】
${productInfo}

**文体:** 敬語禁止。タメ口・ネットスラング。短文。「ｗ」「（笑）」「マジか」「これ神」などを適度に。
**文脈:** 「↑それな」「私も買った」「ワイも気になってる」など前の発言へのリアクションを入れる。
**ペルソナ:** 初見、既存ファン、衝動買い検討中、様子見オタクなど多様に。全員ハイテンションはNG。
**Bad:** 「セール中ですね！バッテリーが良いので最適です。」
**Good:** 「うわ安くなってるマジか」「↑それな、ポチるわ」「この値段バグだろ...」

1〜3件の範囲で必ず生成する。ネガティブ禁止。褒める・期待する・買う宣言に限る。
speaker_attribute: 「30代主婦」「金欠学生」など。speaker_name: ニックネーム。

Output a single JSON object:
- comments: array of 1 to 3 objects, each with: speaker_name (string), speaker_attribute (string), content (string)

Output valid JSON only.`;

  const text = await generateJSON(prompt, APPEND_COMMENTS_SYSTEM);
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as {
    comments: { speaker_name: string; speaker_attribute: string; content: string }[];
  };

  const rawComments = (parsed.comments ?? []).slice(0, 3);
  const now = new Date();

  // LLM が付けた名前は無視し、「無限ランダムユーザー名」で一括置き換えする
  const randomNames = generateUniqueUserNames(rawComments.length || 1);

  return rawComments.map((c, i) => ({
    id: crypto.randomUUID(),
    speaker_name: randomNames[i] ?? generateRandomUserName(),
    speaker_attribute: c.speaker_attribute || "一般ユーザー",
    content: c.content || "",
    timestamp: new Date(now.getTime() + i * 1000).toISOString(),
  }));
}
