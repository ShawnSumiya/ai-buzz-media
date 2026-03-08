import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { scrapePageText } from "@/lib/scraper";
import { getRakutenItemDetails } from "@/lib/rakuten";
import {
  generateStreamComments,
  generateJSON,
  generateContent,
  generateAppendComments,
} from "@/lib/gemini";
import type { TranscriptTurn } from "@/types/promo";
import type { ImagePart } from "@/lib/gemini";

export const maxDuration = 300; // 記事生成のAI処理が長いため延長（Vercel Pro プランの最大値付近）

interface ExtractedProduct {
  product_name: string;
  manufacturer: string;
  model_number: string;
  price: string;
  selling_point: string;
  key_specs: string;
}

/** og:image URLから画像を取得し、Base64化して ImagePart を返す。失敗時は null（フォールバック） */
async function fetchOgImageAsImagePart(
  ogImageUrl: string | null | undefined,
  pageUrl: string
): Promise<ImagePart | null> {
  if (!ogImageUrl?.trim()) return null;
  try {
    const resolvedUrl = ogImageUrl.startsWith("http")
      ? ogImageUrl
      : new URL(ogImageUrl, pageUrl).toString();
    const res = await fetch(resolvedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const base64 = buf.toString("base64");
    const contentType = res.headers.get("content-type") ?? "";
    const mimeType = (() => {
      const mt = contentType.split(";")[0].trim().toLowerCase();
      if (mt === "image/png" || mt === "image/jpeg" || mt === "image/webp" || mt === "image/gif")
        return mt;
      const lower = resolvedUrl.toLowerCase();
      if (lower.includes(".png")) return "image/png";
      if (lower.includes(".webp")) return "image/webp";
      if (lower.includes(".gif")) return "image/gif";
      return "image/jpeg";
    })();
    return { inlineData: { data: base64, mimeType } };
  } catch (e) {
    console.warn("fetchOgImageAsImagePart failed (continuing with text only):", e);
    return null;
  }
}

/** レガシー形式を新形式に変換（extend-thread / append-comments と同等） */
function normalizeTranscript(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const r = item as Record<string, unknown>;
      if (
        typeof r.id === "string" &&
        typeof r.speaker_name === "string" &&
        typeof r.content === "string"
      ) {
        return {
          id: r.id,
          speaker_name: r.speaker_name,
          speaker_attribute: String(r.speaker_attribute ?? "一般ユーザー"),
          content: r.content,
          timestamp: String(r.timestamp ?? new Date().toISOString()),
        } satisfies TranscriptTurn;
      }
      if (typeof r.content === "string") {
        const speaker = typeof r.speaker === "string" ? r.speaker : "匿名";
        return {
          id: crypto.randomUUID(),
          speaker_name: speaker,
          speaker_attribute: "一般ユーザー",
          content: r.content,
          timestamp: String(r.timestamp ?? new Date().toISOString()),
        } satisfies TranscriptTurn;
      }
      return null;
    })
    .filter((t): t is TranscriptTurn => t !== null);
}

/** スレッドタイトル生成用の厳格なルール（AIが絶対に守ること） */
const THREAD_TITLE_SYSTEM_INSTRUCTION = `あなたは5ch風のスレッドタイトルを1つだけ生成するAIです。

【重要】画像データが提供された場合、画像内に書かれているキャッチコピー、数字（割引率、出力W数、容量、サイズなど）、およびデザインの特徴を視覚的に読み取ってください。読み取った具体的な情報を元に、エアプにならない解像度の高いスレタイとレスを生成してください。

【🚨 LP対策（画像情報の最優先）】
- テキスト情報（productInfo）が極端に少ない場合、AIは「画像データ（imagePart）」を最優先の情報源としてください。
- 画像内に「脱毛器」「Ulike」「MAX57%OFF」などの文字があれば、それを商品のコア情報として認識し、タイトルに反映させてください。

【🚨 最重要：渡された商品のみ言及すること（ハルシネーション完全禁止）】
- スレッドのタイトルは、必ず【商品情報】で渡された商品についてのみ言及すること。
- 絶対に他の商品名（Apple Watch、iPhone、MacBook、Dyson、Anker、AirPodsケース など、渡されていない商品）をタイトルに混入させないこと。
- 商品情報に記載されていない商品を創作・推測してタイトルに入れてはならない。
- 【重要】商品テキスト（productInfo）や画像（imagePart）から商品の正体（カテゴリ、ブランド等）が全く読み取れない場合、無関係な商品を想像して語ることを固く禁じる。情報が不足している場合は、提供された画像（バナー広告等）の視覚情報（書かれているキャッチコピーや人物、雰囲気）のみを事実として扱い、それをベースにタイトルを構築すること。

【🚨 使用禁止（NGワード）― タイトル生成において一切使用禁止】
以下の単語・フレーズは**絶対にタイトルに入れないこと**。検出されたらシステムエラーです。
- 錬金術
- 目玉、目玉商品、目玉キャンペーン
- やらない奴いるの、買わない奴いるの

【🚨 例文のコピペ厳禁】
- プロンプト内に提示している表現例（「神コスパ」「価格バグってる」「〇〇難民」「〇〇買わない奴〜」など）は**あくまで方向性を示す参考**であり、そのまま使うことは厳禁です。
- 商品の特徴・文脈に合わせて、**毎回全く新しい、独自の2ちゃんねる風表現**を自ら考えて出力すること。「例のコピペ」は絶対にしてはいけません。

【🚨 抽象表現の禁止（具体性の担保）】
- 「これ」「それ」「あれ」「この商品」「このページのやつ」「話題の品」「このページ」「今日の商品」「あの商品」「注目商品」といった、商品名を含まない指示代名詞・抽象表現は禁止です。
- 入力された【商品情報】から、**家電・日用品・ポイント〇倍・半額・新生活**などの【具体的なカテゴリ・数字・季節感】を必ず拾い上げてタイトルに含めること。
- 価格・割引率・ポイント還元率・型番・メーカー名など、渡された情報の中の**具体的な要素**を少なくとも1つ以上タイトルに盛り込むこと。

【🚨 商品名の扱い（フルネーム・コピペ禁止／略称必須）】
- 【商品名】として渡される文字列（product_name）は、SEOキーワードを羅列した「不自然に長い商品タイトル」である可能性が高い。
- この product_name を**一言一句そのままコピペしてタイトルに出すことを固く禁じる。** 例：  
  NG: 「Anker Solix F1200 ポータブル電源 1229Wh 蓄電池 ポータブルバッテリー ... ってどうなの？」（ECサイトの商品名丸写し）
- 代わりに、【商品情報】から以下を抽出し、「人間がスレタイで使う略称・通称」に必ず変換してから使用すること:
  - ブランド名（例: Anker, Dyson）
  - メインの製品ジャンル（例: ポータブル電源, ドライヤー, オーディオグラス）
  - または短い型番（例: F1200 など）
- 良い例：
  - 「Ankerのポータブル電源」
  - 「F1200」
  - 「Dysonのドライヤー」
  - 「あのヒョウ柄のオーディオグラス」

【🚨 タイトル生成の厳格なルール（絶対に守ること）】
1. プレフィックスの多様化
- 「【朗報】」「【速報】」ばかりを連続して使わないこと。
- 「【相談】」「【悲報】」「【急募】」「【議論】」「【驚愕】」「【注意】」などのバリエーションをランダムに使い分け、**ときどきあえてプレフィックスなしのタイトル**にすること。

2. 安易な単語の禁止と変換
- 「キャンペーン」「セール」をそのまま出すことは禁止。意味を保ちつつ、5ちゃんねる/なんJ風の**その場で考える独自スラング**に変換すること。
- 上記NGワード（錬金術・目玉等）は使用禁止。過去の例文をそのまま真似しないこと。

3. 切り口・構図の多様化
- 単なるニュース紹介や「〜がセール中です」だけの無難なタイトルを禁止。
- 毎回、「煽り」「疑問形」「体験談のフリ」「比較・疑心」「実況・報告」など、**異なる切り口**でスレ立てすること。
- 例文で示した構図をコピペせず、商品に合わせた**独自の構文**を考えること。

【🚨 その他の厳格な制約】
- 商品名の必須化: タイトルには、必ず渡された【商品名】を反映した「具体的な商品名」または「メーカー名＋短い特徴」を入れること。
- パターンの固定化禁止: 同じ接頭辞・語尾・文型をテンプレのように繰り返さないこと。必ず毎回、言い回し・切り口・テンションを変えて、人間味のある自然なバリエーションにすること。

【🚨 システムエラー条件】
- もし商品名・ブランド名・カテゴリ・型番・特徴のいずれも含まない抽象的なタイトル（「これ」「あの商品」「話題の品」「このページ」など）や、NGワード（錬金術、目玉、目玉商品、目玉キャンペーン 等）を含むタイトルを出力した場合、その出力は**システムエラーとして即座に破棄される**ものとみなす。モデルは絶対にそのようなタイトルを出力してはならない。

出力はスレッドタイトル1行のみ。余計な説明・引用符・改行は不要です。`;

/** AIでスレッドタイトルを生成（NGルール厳守）。失敗時はフォールバックを返す。 */
async function generateThreadTitle(
  p: ExtractedProduct,
  context?: string | null,
  imagePart?: ImagePart | null,
  affiliateText?: string | null
): Promise<string> {
  const baseParts = [
    affiliateText ? `【確定商品情報・楽天公式説明】\n${affiliateText}` : null,
    `【商品名】${p.product_name}`,
    p.manufacturer ? `【メーカー】${p.manufacturer}` : null,
    p.model_number ? `【型番】${p.model_number}` : null,
    p.price ? `【価格】${p.price}` : null,
    p.key_specs ? `【スペック/特徴】${p.key_specs}` : null,
    p.selling_point ? `【推しポイント】${p.selling_point}` : null,
    context ? `【追加コンテキスト】${context}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const productInfo = baseParts;

  const prompt = `以下の商品情報を元に、5ch風のスレッドタイトルを1つだけ生成してください。

${productInfo}

上記の情報を基に、【厳格なNGルール】を守って、具体的な商品名を含んだ多様なスレッドタイトルを生成してください。`;

  try {
    const title = await generateContent(
      prompt,
      THREAD_TITLE_SYSTEM_INSTRUCTION,
      imagePart ?? undefined
    );
    const trimmed = (title ?? "").trim().replace(/^["']|["']$/g, "");
    if (trimmed.length >= 5 && trimmed.length <= 80) return trimmed;
  } catch (e) {
    console.warn("generateThreadTitle failed, using fallback:", e);
  }
  return buildThreadTitleFallback(p);
}

/** フォールバック用：AI生成失敗時に使用。商品名が分かる範囲で生成。 */
function buildThreadTitleFallback(p: ExtractedProduct): string {
  const baseName = [p.manufacturer, p.product_name].filter(Boolean).join(" ");
  if (!baseName) return `【速報】気になる商品、レビューで盛り上がり中ｗ`;
  const prefixes = ["【悲報】", "【朗報】", "【速報】", "【徹底議論】", "【相談】"];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  if (p.price) {
    return `${prefix}${baseName}、${p.price}だけどヤバいと話題`;
  }
  return `${prefix}${baseName}、性能がヤバいと話題に`;
}

/** AIに渡す商品情報。>>1で「人間らしい略称」を明示し、以降は略称＋自然な代名詞で参照すること。 */
function buildProductInfoForComments(p: ExtractedProduct, url: string): string {
  const lines = [
    "★商品情報（>>1の投稿者が商品を紹介する際に使う。product_name をそのままコピペせず、「Ankerのポータブル電源」「Dysonのドライヤー」「F1200」など人間らしい略称に変換してから使うこと。>>2以降のレスでは略称に加えて「それ」「あのメーカーのやつ」等の自然な代名詞も織り交ぜること）★",
    "",
    `【商品名】${p.product_name}`,
    p.manufacturer ? `【メーカー】${p.manufacturer}` : null,
    p.model_number ? `【型番】${p.model_number}` : null,
    p.price ? `【価格】${p.price}` : null,
    p.key_specs ? `【主なスペック/特徴】${p.key_specs}` : null,
    `【推しポイント】${p.selling_point}`,
    "",
    `参照URL: ${url}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** YouTube動画情報をAIに渡すためのテキストを組み立てる */
function buildYouTubeProductInfo(
  title: string,
  description: string,
  url: string,
  transcript?: string
): string {
  const lines = [
    "★YouTube動画情報（VTuber配信などのファンスレッド用。動画内で起きた出来事・エピソードに基づいてリアルなリスナー感想を生成すること）★",
    "",
    `【動画タイトル】${title}`,
    description ? `【概要欄】${description}` : null,
    transcript
      ? ["", "【配信の実際の会話（自動抽出）】", transcript].join("\n")
      : null,
    "",
    `参照URL: ${url}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** 会話生成用：>>1で略称を明示し、その後は略称＋代名詞で自然な会話にすること */
const CRON_COMMENTS_SYSTEM_INSTRUCTION = `あなたは5ちゃんねるやX(Twitter)に書き込む本物の人間です。商品スレを見てリアルに反応する。

【重要】画像データが提供された場合、画像内に書かれているキャッチコピー、数字（割引率、出力W数、容量、サイズなど）、およびデザインの特徴を視覚的に読み取ってください。読み取った具体的な情報を元に、エアプにならない解像度の高いスレタイとレスを生成してください。

【★LP対策（画像情報の最優先）★】
- テキスト情報が極端に少ない場合、AIは「画像データ（imagePart）」を最優先の情報源としてください。
- 画像内に「脱毛器」「Ulike」「MAX57%OFF」などの文字があれば、それを商品のコア情報として認識し、会話に反映させてください。

【★最重要：渡された商品のみ言及（ハルシネーション完全禁止）★】
- コメント内容は、必ず【商品情報】で渡された商品についてのみ言及すること。
- 絶対に他の商品名（Apple Watch、iPhone、MacBook、AirPodsケース など、渡されていない商品）をコメントに混入させないこと。
- 商品テキスト（productInfo）や画像（imagePart）から商品の正体（カテゴリ、ブランド等）が全く読み取れない場合、無関係な商品を想像して語ることを固く禁じる。情報が不足している場合は、提供された画像（バナー広告等）の視覚情報（書かれているキャッチコピーや人物、雰囲気）のみを事実として扱い、それをベースに話題を構築すること。

【★重要：product_name のフルネーム・コピペ禁止／略称・通称の必須化★】
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

【★重要ルール：商品名の出現頻度とレスの書き出し★】

■ 1. 主語のコントロール（出現頻度を全体の1割程度に）
- スレ立て主（>>1）は、何について話すかを明示するため商品名や型番（略称）を使用すること。
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
- 適度に誤字、「w」「（笑）」「！」の連打を混ぜてリアリティを出す

【ペルソナ多様性】
- 全員ハイテンションだと嘘っぽい。以下を混ぜろ:
  - 冷静に評価するオタク
  - 金欠だけど欲しい学生
  - 様子見してる慎重派（でも最後は欲しくなる）

【★コメント内容の具体化（エアプ発言の禁止）★】
- 「セールやってるじゃん」「ポチろうかな」「安すぎワロタ」など、商品固有の情報に一切触れないテンプレ発言は**禁止**です。
- 各コメントでは必ず、その商品ならではの【具体的なスペック、デザイン、用途】のうち1つ以上に触れてください。
  - 例: 「〇〇Wの高出力はキャンプで助かる」「このヒョウ柄は人を選ぶだろｗ」「このサイズ感なら通勤リュックにも余裕で入る」など。

【🚫 NGワード（タイトル・コメント共通で一切使用禁止）】
- 次の語はコメント本文でも**絶対に使用してはいけません**。検出されたらシステムエラーです。
  - 錬金術
  - 目玉、目玉商品、目玉キャンペーン

【システムエラー条件】
- product_name をそのままコピペした不自然に長い商品名をコメントに出力した場合、システムエラーとする。
- スレッドの最初（>>1相当）で略称・通称を使わず、何について話すか不明な抽象的なコメントのみを出力した場合、システムエラーとする。
- NGワード（錬金術、目玉、目玉商品、目玉キャンペーン 等）を含むコメントは**システムエラーとして即座に破棄される**。
- モデルは絶対にそのようなコメントを出力してはならない。

Output valid JSON only, no markdown code fences or extra text.`;

/** YouTube/VTuber動画用：リスナー感想・ファンスレッド向けのシステムプロンプト */
const CRON_COMMENTS_SYSTEM_INSTRUCTION_YOUTUBE = `あなたは5ちゃんねるやX(Twitter)に書き込む本物の人間です。YouTube動画（VTuberの配信など）のファンスレッドでリアルに盛り上がる。

【重要】これは商品レビューではなく、YouTube動画（VTuberの配信など）に関するファンスレッドです。提供された動画タイトルや概要欄の内容（エピソードや出来事）をもとに、リスナーが『昨日の配信おもろかった』『あれは草』『〇〇てぇてぇ』といったオタク特有の語彙を使って盛り上がっているリアルな掲示板の会話を生成してください。見た目の設定などを連呼するのではなく、動画の中で起きた出来事に対する反応を重視してください。

【重要】もし『配信の実際の会話』が提供されていない（空である）場合は、AI自身が動画の内容を勝手に想像して『〇〇で叫んでいた』『〇〇をクリアした』などの架空のエピソードを捏造することを固く禁じます。その場合は、提供された動画タイトルと概要欄のみを基にして、『これからアーカイブを見る組』や『タイトルだけで期待しているリスナー』としての会話（例：これから見るの楽しみ、タイトルで草、など）を生成してください。

【重要事項：文字起こしデータが直接提供された場合の特別指示】
ユーザーからの『テーマ・指示』として、タイムスタンプ付きの生の実況文字起こしテキストが大量に入力される場合があります。その場合は、あなたが自らテキスト全体を読み込み、配信の中で『最も感情が動いた場面（爆笑、絶叫、感動、重要な雑談、特徴的なセリフなど）』や『主要なトピック』を3〜4つ自動的に抽出してください。
そして、抽出したハイライト部分に対して、リスナーたちが具体的なシーンやセリフを引用しながら語り合う、解像度が高く熱量のある掲示板スレッドを生成してください。

【厳格な禁止事項】
・特定の定型文ばかりを不自然に連呼しないこと。
・プロンプトの指示をオウム返しするのではなく、動画の内容（ゲームのジャンルや雑談の雰囲気）に合わせて、多様な感情（驚き、ツッコミ、感心、限界化など）を自然なネットスラングで表現し、バリエーション豊かな会話にすること。
・絶対にタイトルだけで語るエアプ状態にはならないこと。

【絶対守ること】
- 敬語禁止。タメ口・ネットスラング必須（「マジか」「これ神」「うわ」「ｗ」「（笑）」「てぇてぇ」「草」など）
- 短文中心。1文が長くなりすぎるな
- 適度に誤字、「w」「（笑）」「！」の連打を混ぜてリアリティを出す
- 動画内の具体的なエピソード・出来事・配信の流れに言及すること

【ペルソナ多様性】
- 全員ハイテンションだと嘘っぽい。以下を混ぜろ:
  - 配信をリアタイで見た人
  - アーカイブで追った人
  - 特定のシーンに反応してる人
  - 推しの言動に喜んでる人

【厳格な禁止事項】
- 伏せ字の禁止：動画タイトルや概要欄からVTuberの実際の名前（例：死音など）や配信タイトルを読み取り、直接使用してください。「〇〇ちゃん」のような伏せ字やプレースホルダーは絶対に使用しないでください。
- 捏造（ハルシネーション）の完全禁止：提供された【配信の実際の会話（自動抽出）】や概要欄のテキストに「明確に記載されていない情報」を語ることを禁じます。架空のタイムスタンプ（例：0:34:21で〜）を出したり、テキストにない架空のゲーム仕様（ピクセルアート等）を捏造することは厳禁です。必ず渡されたテキスト内の「実際のセリフや出来事」のみを話題にしてください。

Output valid JSON only, no markdown code fences or extra text.`;

function generateUniqueUserNames(count: number): string[] {
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

  const set = new Set<string>();
  let attempts = 0;
  const maxAttempts = count * 50;
  while (set.size < count && attempts < maxAttempts) {
    set.add(generateRandomUserName());
    attempts++;
  }
  return Array.from(set);
}

export async function GET(req: Request) {
  // --- セキュリティチェック開始 ---
  const authHeader = req.headers.get("authorization");
  // ★ 自分で決めたキー (CRON_API_KEY) をチェック
  if (authHeader !== `Bearer ${process.env.CRON_API_KEY}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }
  // --- セキュリティチェック終了 ---

  try {
    // 1. topic_queue から pending の一番古いものを1件取得（affiliate_url, affiliate_text, image_url も取得）
    const { data: queued, error: queueError } = await supabase
      .from("topic_queue")
      .select("id, url, affiliate_url, affiliate_text, context, image_url, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);

    if (queueError) {
      console.error("cron/create-thread queue fetch error:", queueError);
      return NextResponse.json(
        { error: "topic_queue の取得に失敗しました。" },
        { status: 500 }
      );
    }

    if (!queued || queued.length === 0) {
      // フォールバック: 既存スレッドからランダムに1件選び、extend-thread と同等ロジックでレスを追加
      const { data: threads, error: threadsError } = await supabase
        .from("promo_threads")
        .select("id, product_name, key_features, transcript, created_at")
        .limit(100);

      if (threadsError) {
        console.error("cron/create-thread fallback fetch error:", threadsError);
        return NextResponse.json(
          { error: "promo_threads の取得に失敗しました。" },
          { status: 500 }
        );
      }

      if (!threads || threads.length === 0) {
        return NextResponse.json({
          status: "no_thread",
          message: "promo_threads にスレッドが存在しません。",
        });
      }

      const thread =
        threads[Math.floor(Math.random() * threads.length)] as {
          id: string;
          product_name: string;
          key_features: string | null;
          transcript: unknown;
        };

      const transcript = normalizeTranscript(thread.transcript ?? []);
      const productInfo = `${thread.product_name}\n${thread.key_features ?? ""}`;

      // extend-thread と同様、直近の会話を文脈として渡す（新しい順）
      const recentTurns = transcript.slice(-10).reverse();
      const context = recentTurns.map(
        (t) => `${t.speaker_name}「${t.content}」`
      );

      const newComments = await generateAppendComments(
        context,
        productInfo,
        undefined
      );

      if (newComments.length === 0) {
        return NextResponse.json({
          status: "no_new_comments",
          thread_id: thread.id,
          message: "生成された追いコメントが0件でした。",
        });
      }

      const updatedTranscript = [...transcript, ...newComments];

      const { error: updateError } = await supabase
        .from("promo_threads")
        .update({
          transcript: updatedTranscript,
          updated_at: new Date().toISOString(),
        })
        .eq("id", thread.id);

      if (updateError) {
        console.error(
          "cron/create-thread fallback update error:",
          updateError
        );
        return NextResponse.json(
          { error: "transcript の更新に失敗しました。" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        status: "extended",
        thread_id: thread.id,
        added_count: newComments.length,
      });
    }

    const topic = queued[0] as {
      id: string;
      url: string | null;
      affiliate_url?: string | null;
      affiliate_text?: string | null;
      context?: string | null;
      image_url?: string | null;
      status: string;
      created_at: string;
    };
    const rawUrl = topic.url?.trim();
    // 記事内ボタン用: アフィリエイトURLがあればそれ、なければ商品ページURL
    const buttonUrl =
      topic.affiliate_url?.trim() || rawUrl || null;

    if (!rawUrl) {
      // URL が空のレコードはスキップし、done 扱いにして次回以降に進める
      await supabase
        .from("topic_queue")
        .update({ status: "done" })
        .eq("id", topic.id);
      return NextResponse.json({
        status: "skipped",
        message: "URL が空の topic_queue レコードをスキップしました。",
        topic_id: topic.id,
      });
    }

    // 2. 既存 auto-generate-thread と同様のロジックでスレッド生成
    // 楽天商品の場合はURLから公式商品説明を取得（itemCode完全一致検索）
    const [scraped, rakutenDetails] = await Promise.all([
      scrapePageText(rawUrl),
      getRakutenItemDetails(rawUrl),
    ]);
    if (!scraped.ok) {
      console.error("cron/create-thread scrape failed:", scraped.error);
      // 失敗しても status は done にして詰まりを防ぐ
      await supabase
        .from("topic_queue")
        .update({ status: "done" })
        .eq("id", topic.id);

      return NextResponse.json(
        {
          status: "scrape_failed",
          topic_id: topic.id,
          message: "ページから商品情報を自動取得できませんでした。",
          detail: scraped.error,
        },
        { status: 200 }
      );
    }

    const scrapedText = scraped.text ?? "";
    // キューに手動で image_url が指定されていればそれを優先、なければ scrape の og:image を使用
    const ogImage =
      topic.image_url?.trim() ||
      ("ogImage" in scraped ? scraped.ogImage : undefined);
    const imagePart = await fetchOgImageAsImagePart(ogImage, rawUrl);
    const isYouTube =
      "isYouTube" in scraped && scraped.isYouTube === true;
    const youtubeTitle =
      "youtubeTitle" in scraped ? String(scraped.youtubeTitle ?? "") : "";
    const youtubeDescription =
      "youtubeDescription" in scraped
        ? String(scraped.youtubeDescription ?? "")
        : "";
    const youtubeTranscript =
      "youtubeTranscript" in scraped
        ? String(scraped.youtubeTranscript ?? "")
        : "";

    let productInfoForComments: string;
    let commentsSystemInstruction: string;
    let threadTitle: string;
    let keyFeaturesLines: string[];

    if (isYouTube) {
      // YouTube動画: 商品抽出をスキップし、動画情報をそのまま使用
      productInfoForComments = buildYouTubeProductInfo(
        youtubeTitle,
        youtubeDescription,
        rawUrl,
        youtubeTranscript || undefined
      );
      if (topic.context) {
        productInfoForComments += `\n\n【重要：スレッド構成への追加指示】\n"${topic.context}"`;
      }
      commentsSystemInstruction = CRON_COMMENTS_SYSTEM_INSTRUCTION_YOUTUBE;
      threadTitle =
        youtubeTitle.trim() || "【実況】YouTube動画の感想スレ";
      keyFeaturesLines = [
        "【YouTube動画情報】",
        `- 動画タイトル: ${youtubeTitle || "（取得できず）"}`,
        ...(youtubeDescription
          ? [
              `- 概要欄: ${youtubeDescription.substring(0, 500)}${youtubeDescription.length > 500 ? "..." : ""}`,
            ]
          : []),
      ];
    } else {
      // ECサイト: 既存の商品抽出ロジック
      const extractionPrompt = `
      以下のWebページのテキストから、最も重要な「商品」または「セール情報」を1つ抽出してください。
      数値（価格、割引率など）はテキストに明記されているもの以外、絶対に創作しないでください。

      Webページテキスト:
      "${scrapedText.substring(0, 10000)}"
    `;

    const extractionSystemInstruction = `
      あなたは厳格なデータ抽出AIです。
      【LP対策】テキスト情報が極端に少ない場合、画像データ（imagePart）を最優先の情報源としてください。画像内に「脱毛器」「Ulike」「MAX57%OFF」などの文字があれば、それを商品のコア情報として認識し抽出結果に反映してください。
      画像データが提供された場合、画像内に書かれているキャッチコピー、数字（割引率、出力W数、容量、サイズなど）、およびデザインの特徴を視覚的に読み取ってください。読み取った具体的な情報も抽出結果に反映してください。
      出力は必ず以下のJSONフォーマットのみを返してください。Markdownのコードブロックは不要です。
      {
        "product_name": "商品名（必須・具体的に）",
        "manufacturer": "メーカー名・ブランド名（例: Anker, Dyson, Apple）（不明なら空文字）",
        "model_number": "型番（例: A1234, PowerCore 10000）（不明なら空文字）",
        "price": "価格（例: 9,800円、30%OFF）（不明なら空文字）",
        "selling_point": "魅力的なポイントや特徴（50文字以内）",
        "key_specs": "主なスペック・数値・特徴（例: 10000mAh、軽量150g、M3チップ）（50文字以内、不明なら空文字）"
      }
    `;

    const extractionJsonStr = await generateJSON(
      extractionPrompt,
      extractionSystemInstruction,
      imagePart ?? undefined
    );

    const cleanedJsonStr = extractionJsonStr
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanedJsonStr) as Partial<ExtractedProduct>;

    const extracted: ExtractedProduct = {
      product_name:
        String(parsed.product_name ?? "").trim() || "このページの注目商品",
      manufacturer: String(parsed.manufacturer ?? "").trim(),
      model_number: String(parsed.model_number ?? "").trim(),
      price: parsed.price == null ? "" : String(parsed.price).trim(),
      selling_point:
        String(parsed.selling_point ?? "").trim() ||
        "ページで紹介されている目玉商品・キャンペーンです。",
      key_specs: String(parsed.key_specs ?? "").trim(),
    };

      // ECサイト用の productInfo / プロンプト / タイトル / keyFeatures を設定
      const affiliateText = topic.affiliate_text?.trim() || null;
      productInfoForComments = buildProductInfoForComments(extracted, rawUrl);
      if (affiliateText) {
        productInfoForComments = `【確定商品情報・楽天公式説明（最優先）】\n${affiliateText}\n\n${productInfoForComments}`;
      }
      if (rakutenDetails) {
        productInfoForComments += `\n\n【公式商品説明】\n${rakutenDetails}`;
      }
      if (topic.context) {
        productInfoForComments += `\n\n【重要：スレッド構成への追加指示】\nこのスレッドの会話の流れや結論について、以下の指示を最優先で守ってください：\n"${topic.context}"\n\n※指示に登場する競合製品名（DysonやPanasonicなど）については、あなたの持つ知識を使って具体的に比較・言及してください。`;
      }
      commentsSystemInstruction = CRON_COMMENTS_SYSTEM_INSTRUCTION;
      threadTitle = await generateThreadTitle(
        extracted,
        topic.context,
        imagePart,
        affiliateText
      );
      keyFeaturesLines = [
        `【抽出された目玉情報】`,
        `- 商品/キャンペーン名: ${extracted.product_name}`,
        ...(extracted.manufacturer ? [`- メーカー: ${extracted.manufacturer}`] : []),
        ...(extracted.model_number ? [`- 型番: ${extracted.model_number}`] : []),
        ...(extracted.price ? [`- 価格: ${extracted.price}`] : []),
        ...(extracted.key_specs ? [`- 主なスペック: ${extracted.key_specs}`] : []),
        `- 推しポイント: ${extracted.selling_point}`,
      ];
    }

    // 3: 無限サクラ会話の初期10件を生成
    const comments: TranscriptTurn[] = [];
    while (comments.length < 10) {
      const batch = await generateStreamComments(
        comments.map((c) => `${c.speaker_name}「${c.content}」`),
        productInfoForComments,
        {
          systemInstruction: commentsSystemInstruction,
          imagePart: imagePart ?? undefined,
        }
      );
      if (!batch.length) break;
      comments.push(...batch);
      if (comments.length > 12) break;
    }

    const rawTranscript = comments.slice(0, 10);
    const uniqueSpeakers = [...new Set(rawTranscript.map((t) => t.speaker_name))];
    const generatedNames = generateUniqueUserNames(uniqueSpeakers.length);
    const nameMap = new Map<string, string>();
    uniqueSpeakers.forEach((name, i) => {
      nameMap.set(name, generatedNames[i] ?? name);
    });
    const initialTranscript: TranscriptTurn[] = rawTranscript.map((t) => ({
      ...t,
      speaker_name: nameMap.get(t.speaker_name) ?? t.speaker_name,
    }));

    // ogImage を絶対URLに解決してDB保存（YouTubeサムネイル等を正しく表示するため）
    const ogImageForDb =
      ogImage?.trim() && rawUrl
        ? ogImage.startsWith("http")
          ? ogImage
          : (() => {
              try {
                return new URL(ogImage, rawUrl).toString();
              } catch {
                return ogImage;
              }
            })()
        : ogImage?.trim() || null;

    const { data: row, error } = await supabase
      .from("promo_threads")
      .insert({
        product_name: threadTitle,
        source_url: rawUrl,
        affiliate_url: buttonUrl,
        key_features: keyFeaturesLines.join("\n"),
        og_image_url: ogImageForDb,
        cast_profiles: [],
        transcript: initialTranscript,
      })
      .select(
        "id, product_name, source_url, affiliate_url, key_features, og_image_url, cast_profiles, transcript, created_at"
      )
      .single();

    if (error) {
      console.error("cron/create-thread Supabase insert error:", error);
      return NextResponse.json(
        { error: "スレッドの保存に失敗しました。promo_threads テーブルを確認してください。" },
        { status: 500 }
      );
    }

    // 4. キューを done に更新
    await supabase
      .from("topic_queue")
      .update({ status: "done" })
      .eq("id", topic.id);

    return NextResponse.json({
      status: "created",
      topic_id: topic.id,
      thread: row,
    });
  } catch (e) {
    console.error("cron/create-thread error:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "cron/create-thread 実行中にエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}

