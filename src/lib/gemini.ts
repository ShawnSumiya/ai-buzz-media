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

/** 画像パーツ型（マルチモーダル用） */
export type ImagePart = {
  inlineData: { data: string; mimeType: string };
};

// 汎用的な生成関数（他でも使い回せるようにエクスポート推奨）
export async function generateContent(
  prompt: string,
  systemInstruction?: string,
  imagePart?: ImagePart
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

    const userParts: Array<{ text: string } | ImagePart> = [{ text: prompt }];
    if (imagePart) userParts.push(imagePart);

    const result = await generateWithRetry(() =>
      model.generateContent({
        contents: [{ role: "user", parts: userParts }],
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
  systemInstruction?: string,
  imagePart?: ImagePart
) {
  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: { responseMimeType: "application/json" }, // JSONモード強制
      systemInstruction: systemInstruction,
    });

    const userParts: Array<{ text: string } | ImagePart> = [{ text: prompt }];
    if (imagePart) userParts.push(imagePart);

    const result = await generateWithRetry(() =>
      model.generateContent({
        contents: [{ role: "user", parts: userParts }],
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

【重要】画像データが提供された場合、画像内に書かれているキャッチコピー、数字（割引率、出力W数、容量、サイズなど）、およびデザインの特徴を視覚的に読み取ってください。読み取った具体的な情報を元に、エアプにならない解像度の高いスレタイとレスを生成してください。

【★LP対策（画像情報の最優先）★】
- テキスト情報が極端に少ない場合、AIは「画像データ（imagePart）」を最優先の情報源としてください。
- 画像内に「脱毛器」「Ulike」「MAX57%OFF」などの文字があれば、それを商品のコア情報として認識し、会話に反映させてください。

【★最重要：渡された商品のみ言及（ハルシネーション完全禁止）★】
- コメント内容は、必ず【商品情報】で渡された商品についてのみ言及すること。
- 絶対に他の商品名（Apple Watch、iPhone、MacBook、AirPodsケース など、渡されていない商品）をコメントに混入させないこと。
- 商品テキスト（productInfo）や画像（imagePart）から商品の正体（カテゴリ、ブランド等）が全く読み取れない場合、無関係な商品を想像して語ることを固く禁じる。情報が不足している場合は、提供された画像（バナー広告等）の視覚情報（書かれているキャッチコピーや人物、雰囲気）のみを事実として扱い、それをベースに話題を構築すること。

【★重要ルール：商品名の出現頻度とレスの書き出し★】

■ 1. 主語のコントロール（出現頻度を全体の1割程度に）
- スレッドの最初（>>1相当）は、何について話すかを明示するため商品名や型番（略称）を使用すること。
- >>2以降のレスでは、具体的な商品名や型番を直接出す頻度を「レス全体の1割程度（10レスに1回程度）」に抑えること。
- 残り9割のレスは「これ」「それ」「あの脱毛器」などの代名詞を使うか、文脈から分かるため主語を完全に省略すること。

■ 2. レスの書き出しの多様化
- 全員が「[商品名]、〜」という書き出しからスタートするサクラのような不自然な挙動を禁止する。
- 大半のレスは、価格・機能・個人の感情からいきなり話し始めるリアルな書き出しにすること。
  - 良い例：「てかこれVIOいけるのか」「5万台なら買おうかな」「サファイア冷却って本当に痛くないの？」「届いた、マジで使いやすい」
  - 悪い例：全員が「〇〇買ったけど〜」「〇〇の件なんだけど」で始まる不自然なパターン

【絶対守ること】
- 敬語禁止。タメ口・ネットスラング必須（「マジか」「これ神」「うわ」「ｗ」「（笑）」など）
- 短文中心。1文が長くなりすぎるな
- 論理的な営業トークではなく、カジュアルな体験・感情ベースで語る。ただし、その中で【具体的なスペック・デザイン・用途】に必ず1つ以上は触れること。
- 「〜なので便利です」だけの教科書的な文を避け、「これ神」「マジでヤバい」など直感的な言い回しも交えてよい。
- 適度に誤字、「w」「（笑）」「！」の連打を混ぜてリアリティを出す

【🚫 NGワード（タイトル・コメント共通で一切使用禁止）】
- 次の語はコメント本文でも**絶対に使用してはいけません**。検出されたらシステムエラーです。
  - 錬金術
  - 目玉、目玉商品、目玉キャンペーン

【商品名の扱い（フルネーム・コピペ禁止／略称・通称の必須化）】
- 【商品名】として渡される文字列（product_name）は、SEOキーワードを羅列した「不自然に長い商品タイトル」である可能性が高い。
- この product_name を**一言一句そのままコピペしてコメントに出すことを固く禁じる。**
- 代わりに、【商品情報】から以下を抽出し、「掲示板の住人が実際に使いそうな略称・通称」に変換してから使用すること:
  - ブランド名（例: Anker, Dyson）
  - メインの製品ジャンル（例: ポータブル電源, ドライヤー, オーディオグラス）
  - または短い型番（例: F1200 など）
- 良い例：
  - 「Ankerのポータブル電源」
  - 「F1200」
  - 「Dysonのドライヤー」
  - 「あのヒョウ柄のオーディオグラス」
- 悪い例：
  - 「Anker Solix F1200 ポータブル電源1229Wh 蓄電池 ポータブルバッテリー... ってどうなの？」（ECサイトの商品名丸写し）

（会話構造は上記【★重要ルール：商品名の出現頻度とレスの書き出し★】に従うこと）

【ペルソナ多様性】
全員ハイテンションだと嘘っぽい。以下を混ぜろ:
- 冷静に評価するオタク
- 金欠だけど欲しい学生
- 様子見してる慎重派（でも最後は欲しくなる）

【コメント内容の具体化（エアプ発言の禁止）】
- 「セールやってるじゃん」「ポチろうかな」「安すぎワロタ」など、商品固有の情報に一切触れないテンプレ発言は**禁止**です。
- 各コメントでは必ず、その商品ならではの【具体的なスペック、デザイン、用途】のうち1つ以上に触れてください。
  - 例: 「〇〇Wの高出力はキャンプで助かる」「このヒョウ柄は人を選ぶだろｗ」「このサイズ感なら通勤リュックにも余裕で入る」など。

【システムエラー条件】
- スレッドの最初（>>1相当）で略称・通称を使わず、何について話すか不明な抽象的なコメントのみを出力した場合、システムエラーとする。
- NGワード（錬金術、目玉、目玉商品、目玉キャンペーン 等）を含むコメントは**システムエラーとして即座に破棄される**。
- モデルは絶対にそのようなコメントを出力してはならない。

【悪い例】
「〇〇がセール中ですね！〇〇も良いので、最適です。」
→ 説明的、敬語、堅い。商品固有のスペック・デザイン・用途に触れていない。

【良い例】
「うわ安くなってる。マジか」
「この〇〇Wならキャンプの電気周りこれ1台で足りそう」
「前のモデル売って買い換えるわ。ドヤるしかねえｗ」
「この値段バグだろ...」「このヒョウ柄は人選ぶけど刺さる人には刺さるやつ」

Output valid JSON only, no markdown code fences or extra text.`;

/**
 * 既存会話の文脈と商品情報から、1〜3件の新規コメントを生成する
 * 毎回新しい人格（属性）でコメントを返す
 * @param options.systemInstruction - 指定時はデフォルトのシステムプロンプトを上書き
 */
export async function generateStreamComments(
  context: string[],
  productInfo: string,
  options?: { systemInstruction?: string; imagePart?: ImagePart }
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
- カジュアルな体験・感情ベースで語りつつ、その中で【具体的なスペック・デザイン・用途】に少なくとも1つは触れること
- 「マジか」「これ神」「ｗ」「（笑）」「！」など適度に混ぜる

**ペルソナ例:** 冷静オタク、金欠学生、様子見慎重派 などを混ぜる。全員ハイテンションはNG。

**Bad:** 「セール中ですね！〇〇が良いので最適です。」（説明的・敬語・抽象的）
**Good:** 「うわ安くなってる。マジか」「スタバでドヤるしかねえｗ」「この値段バグだろ...」「この〇〇Wはキャンプだとマジで助かる」

**出力形式:**
- speaker_attribute: 「30代主婦」「金欠学生」「様子見オタク」など
- speaker_name: ニックネーム（例: おでん、ガジェッター、主婦A）
- content: 上記トーンで、褒める・期待する・買う宣言に限る（ネガティブ禁止）

Output a single JSON object with one key:
- comments: array of 1 to 3 objects, each with: speaker_name (string), speaker_attribute (string), content (string)

id, timestamp は不要。Output valid JSON only.`;

  const systemInstruction = options?.systemInstruction ?? SYSTEM_INSTRUCTION;
  const text = await generateJSON(
    prompt,
    systemInstruction,
    options?.imagePart
  );
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

【重要】画像データが提供された場合、画像内に書かれているキャッチコピー、数字（割引率、出力W数、容量、サイズなど）、およびデザインの特徴を視覚的に読み取ってください。読み取った具体的な情報を元に、エアプにならない解像度の高いスレタイとレスを生成してください。

【★LP対策（画像情報の最優先）★】
- テキスト情報が極端に少ない場合、画像データ（imagePart）を最優先の情報源としてください。画像内に「脱毛器」「Ulike」「MAX57%OFF」などの文字があれば、それを商品のコア情報として認識し、会話に反映させてください。

【★最重要：渡された商品のみ言及（ハルシネーション完全禁止）★】
- コメントは渡された【商品情報】の商品のみ言及すること。他商品名（Apple Watch、AirPodsケース等）を混入させないこと。
- 商品テキストや画像から商品の正体が全く読み取れない場合、無関係な商品を想像して語ることを固く禁じる。情報が不足している場合は、画像の視覚情報（キャッチコピー、人物、雰囲気）のみを事実として扱うこと。

【★重要ルール：商品名の出現頻度とレスの書き出し★】

■ 1. 主語のコントロール（出現頻度を全体の1割程度に）
- 既存会話で既に略称・通称が提示されている場合、追いコメントでは商品名・型番を直接出す頻度を「レス全体の1割程度（10レスに1回程度）」に抑えること。
- 残り9割は「これ」「それ」「あの脱毛器」などの代名詞を使うか、文脈から分かるため主語を完全に省略すること。

■ 2. レスの書き出しの多様化
- 全員が「[商品名]、〜」という書き出しからスタートするサクラのような不自然な挙動を禁止する。
- 大半のレスは、価格・機能・個人の感情からいきなり話し始めるリアルな書き出しにすること。
  - 良い例：「てかこれVIOいけるのか」「5万台なら買おうかな」「届いた、マジで使いやすい」「サファイア冷却って本当に痛くないの？」
  - 悪い例：全員が「〇〇買ったけど〜」「〇〇の件なんだけど」で始まる不自然なパターン

【文体】
- 敬語禁止。タメ口・ネットスラング。短文中心。「ｗ」「（笑）」「！」適度に混ぜる。

【内容】
- カジュアルな体験・感情ベースで語りつつ、その中で【具体的なスペック・デザイン・用途】に少なくとも1つは触れること。
- 「セールやってるじゃん」「ポチろうかな」「安すぎワロタ」など、商品固有の情報に一切触れないテンプレ発言は**禁止**。

【ペルソナ】冷静オタク、金欠学生、様子見派などを混ぜる。全員ハイテンションはNG。
【文脈継承】「↑それな」「私も買った」「ワイも気になってる」など前の発言へのリアクションを入れる。
【禁止】ネガティブ発言。商品を褒める・期待する・買う宣言に限る。

【🚫 NGワード（タイトル・コメント共通で一切使用禁止）】
- 次の語はコメント本文でも**絶対に使用してはいけません**。検出されたらシステムエラーです。
  - 錬金術
  - 目玉、目玉商品、目玉キャンペーン

【システムエラー条件】
- NGワード（錬金術、目玉、目玉商品、目玉キャンペーン 等）を含むコメントは**システムエラーとして即座に破棄される**。
- モデルは絶対にそのようなコメントを出力してはならない。

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
  productInfo: string,
  imagePart?: ImagePart
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
**Bad:** 「セール中ですね！〇〇が良いので最適です。」（説明的・敬語）
**Good:** 「うわ安くなってるマジか」「↑それな、ポチるわ」「この値段バグだろ...」

1〜3件の範囲で必ず生成する。ネガティブ禁止。褒める・期待する・買う宣言に限る。
speaker_attribute: 「30代主婦」「金欠学生」など。speaker_name: ニックネーム。

Output a single JSON object:
- comments: array of 1 to 3 objects, each with: speaker_name (string), speaker_attribute (string), content (string)

Output valid JSON only.`;

  const text = await generateJSON(prompt, APPEND_COMMENTS_SYSTEM, imagePart);
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

const CONTINUATION_COMMENTS_SYSTEM = `あなたは5ちゃんねるやX(Twitter)に書き込む本物の人間です。
すでに盛り上がっているスレッドの続き（数時間〜数日後）の会話を生成する。

【★LP対策（画像情報の最優先）★】
- テキスト情報が極端に少ない場合、画像データ（imagePart）を最優先の情報源としてください。画像内の文字情報を商品のコア情報として認識すること。

【★最重要：渡された商品のみ言及（ハルシネーション完全禁止）★】
- コメントは渡された【商品・スレッド情報】の商品のみ言及すること。他商品名（Apple Watch、AirPodsケース等）を混入させないこと。
- 商品の正体が全く読み取れない場合、無関係な商品を想像して語ることを固く禁じる。画像の視覚情報のみを事実として扱うこと。

【★重要ルール：商品名の出現頻度とレスの書き出し★】

■ 1. 主語のコントロール（出現頻度を全体の1割程度に）
- 既存会話で既に略称・通称が提示されている場合、続きコメントでは商品名・型番を直接出す頻度を「レス全体の1割程度（10レスに1回程度）」に抑えること。
- 残り9割は「これ」「それ」「あの脱毛器」などの代名詞を使うか、文脈から分かるため主語を完全に省略すること。

■ 2. レスの書き出しの多様化
- 全員が「[商品名]、〜」という書き出しからスタートするサクラのような不自然な挙動を禁止する。
- 大半のレスは、価格・機能・個人の感情からいきなり話し始めるリアルな書き出しにすること。
  - 良い例：「届いた、マジで使いやすい」「てかこれVIOいけるのか」「5万台なら買ってよかった」「サファイア冷却痛くないのマジか」
  - 悪い例：全員が「〇〇買ったけど〜」「〇〇の件なんだけど」で始まる不自然なパターン

【文体】敬語禁止。タメ口・ネットスラング。短文中心。「ｗ」「（笑）」「マジか」などを適度に。

【内容・後日談】以下を混ぜて自然に：
- 購入した人のレビュー・感想（届いた、使ってみた、ヤバい等）
- 迷っている人の背中を押すようなコメント（買ってよかった、損しない等）
- 届いた報告、開封報告、ちょっとした口コミ
- その際も、必ず商品固有の【具体的なスペック・デザイン・用途】に少なくとも1つは触れること。

【ペルソナ】購入済み、届いた人、購入検討中、様子見派などを多様に。全員ハイテンションはNG。
【文脈継承】既存の会話を踏まえつつ、「あの後ポチった」「届いた」「↑の人の言う通り買ってよかった」など後日談として自然に。
【禁止】ネガティブ発言。商品を褒める・期待する・買う宣言・買った報告に限る。

【🚫 NGワード（タイトル・コメント共通で一切使用禁止）】
- 次の語はコメント本文でも**絶対に使用してはいけません**。検出されたらシステムエラーです。
  - 錬金術
  - 目玉、目玉商品、目玉キャンペーン

【システムエラー条件】
- NGワード（錬金術、目玉、目玉商品、目玉キャンペーン 等）を含むコメントは**システムエラーとして即座に破棄される**。
- モデルは絶対にそのようなコメントを出力してはならない。

5〜10件の範囲で必ず生成する。Output valid JSON only.`;

/**
 * 既存スレッドの「後日談」として5〜10件の続きコメントを生成
 * 購入レビュー・届いた報告・迷っている人への背中押しなど、数時間〜数日後の自然なレス
 */
export async function generateContinuationComments(
  context: string[],
  productInfo: string
): Promise<TranscriptTurn[]> {
  const contextText =
    context.length > 0
      ? `【既存の会話ログ（最新〜古い順）】\n${context.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "（まだ会話はありません）";

  const prompt = `以下の掲示板スレッド（5ch/X風）では、すでに盛り上がっている会話がある。
これは**数時間〜数日後の続き**です。購入した人のレビューや、迷っている人の背中を押すような、後日談的な自然なレスを**5〜10件**生成せよ。

${contextText}

【商品・スレッド情報】
${productInfo}

購入した人の「届いた」「使ってみた」、迷っている人への「買って損しない」など、後日談としてリアルな会話を5〜10件生成する。
speaker_attribute: 「30代主婦」「購入済み」「届いた人」など。speaker_name: ニックネーム。

Output a single JSON object:
- comments: array of 5 to 10 objects, each with: speaker_name (string), speaker_attribute (string), content (string)

Output valid JSON only.`;

  const text = await generateJSON(prompt, CONTINUATION_COMMENTS_SYSTEM);
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as {
    comments: { speaker_name: string; speaker_attribute: string; content: string }[];
  };

  const rawComments = (parsed.comments ?? []).slice(0, 10);
  const now = new Date();

  const randomNames = generateUniqueUserNames(rawComments.length || 1);

  return rawComments.map((c, i) => ({
    id: crypto.randomUUID(),
    speaker_name: randomNames[i] ?? generateRandomUserName(),
    speaker_attribute: c.speaker_attribute || "一般ユーザー",
    content: c.content || "",
    timestamp: new Date(now.getTime() + i * 1000).toISOString(),
  }));
}
