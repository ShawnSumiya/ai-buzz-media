import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { scrapePageText } from "@/lib/scraper";
import { generateStreamComments, generateJSON, generateContent } from "@/lib/gemini";
import type { TranscriptTurn } from "@/types/promo";

interface ExtractedProduct {
  product_name: string;
  manufacturer: string;
  model_number: string;
  price: string;
  selling_point: string;
  key_specs: string;
}

/** スレッドタイトル生成用の厳格なNGルール（AIが絶対に守ること） */
const THREAD_TITLE_SYSTEM_INSTRUCTION = `あなたは5ch風のスレッドタイトルを1つだけ生成するAIです。

【🚨 タイトル生成に関する厳格なNGルール（絶対に守ること）】
1. 禁止ワード: 「このページの注目商品」「あの商品」「新作」「話題のアイテム」のような、どの商品にも当てはまる抽象的な言葉をタイトルに入れることは【絶対禁止】です。
2. 商品名の必須化: タイトルには、必ず「具体的な商品名」または「メーカー名＋短い特徴（例：Ankerの10000mAhのやつ）」を含めてください。読者がタイトルを見ただけで何の商品か分かる状態にしてください。
3. パターンの多様化: 毎回同じようなトーンや文末（〜と話題にｗｗｗ）を使い回さないでください。商品のジャンルやコンテキスト（追加指示）に合わせて、【速報】【朗報】【悲報】【徹底議論】【相談】【疑問】など、スレタイトルのテイストを毎回ランダムに変化させてください。

出力はスレッドタイトル1行のみ。余計な説明・引用符・改行は不要です。`;

/** AIでスレッドタイトルを生成（NGルール厳守）。失敗時はフォールバックを返す。 */
async function generateThreadTitle(
  p: ExtractedProduct,
  context?: string | null
): Promise<string> {
  const productInfo = [
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

  const prompt = `以下の商品情報を元に、5ch風のスレッドタイトルを1つだけ生成してください。

${productInfo}

上記の情報を基に、【厳格なNGルール】を守って、具体的な商品名を含んだ多様なスレッドタイトルを生成してください。`;

  try {
    const title = await generateContent(prompt, THREAD_TITLE_SYSTEM_INSTRUCTION);
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

/** AIに渡す商品情報。>>1で商品を明示し、以降は自然な代名詞・省略形で参照すること。 */
function buildProductInfoForComments(p: ExtractedProduct, url: string): string {
  const lines = [
    "★商品情報（>>1の投稿者が商品を紹介する際に使う。以降のレスでは「これ」「あれ」等の自然な表現に切り替えること）★",
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

/** 会話生成用：商品名は>>1と一部のみ。それ以外は「これ」「あれ」等で自然な掲示板っぽく */
const CRON_COMMENTS_SYSTEM_INSTRUCTION = `あなたは5ちゃんねるやX(Twitter)に書き込む本物の人間です。商品スレを見てリアルに反応する。

【絶対守ること】
- 敬語禁止。タメ口・ネットスラング必須（「マジか」「これ神」「うわ」「ｗ」「（笑）」など）
- 短文中心。1文が長くなりすぎるな
- 適度に誤字、「w」「（笑）」「！」の連打を混ぜてリアリティを出す

【★重要：商品名（フルネーム・型番）の使用は厳しく制限★】
- 商品の正式名称や型番を使うのは、**>>1（スレッド最初の発言）と、全体のレスのうち1〜2割程度のみ**にすること
- 全員が商品名・型番を復唱するのは禁止。業者のサクラっぽくなり不自然になる
- スレッドタイトルと>>1で商品が何か分かるので、2回目以降のレスでは基本的に代名詞・省略形を使うこと

【自然な代名詞・省略形を積極的に使うこと】
- 2回目以降の発言では以下を使うこと：
  「これ」「あれ」「それ」「新作」「〇〇（メーカー名）のやつ」「ドライヤー（一般名詞）」など
- 良い例：「Ankerのこれ、3000円なら即ポチだろ」「それマジで言ってる？」「前のモデルより軽くなってるのいいな」
- 悪い例：全レスで「Anker PowerCore 10000」「Dyson Supersonic HD08」を連呼する（不自然）

【スペック・価格の小出し】
- 全員が価格やスペックを暗唱するのも禁止
- ある人は価格に反応し、別の人は機能に反応する、というように情報を分散させる
- 自然な会話のキャッチボールとして、1人1〜2点程度の反応にとどめること

【ペルソナ多様性】
全員ハイテンションだと嘘っぽい。以下を混ぜろ:
- 冷静に評価するオタク
- 金欠だけど欲しい学生
- 様子見してる慎重派（でも最後は欲しくなる）

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
    // 1. topic_queue から pending の一番古いものを1件取得（affiliate_url も取得）
    const { data: queued, error: queueError } = await supabase
      .from("topic_queue")
      .select("id, url, affiliate_url, context, status, created_at")
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
      // キューが空なら何もしない
      return NextResponse.json({
        status: "no_topic",
        message: "pending の topic_queue はありません。",
      });
    }

    const topic = queued[0] as {
      id: string;
      url: string | null;
      affiliate_url?: string | null;
      context?: string | null;
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
    const scraped = await scrapePageText(rawUrl);
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
    const ogImage = "ogImage" in scraped ? scraped.ogImage : undefined;

    const extractionPrompt = `
      以下のWebページのテキストから、最も重要な「商品」または「セール情報」を1つ抽出してください。
      数値（価格、割引率など）はテキストに明記されているもの以外、絶対に創作しないでください。

      Webページテキスト:
      "${scrapedText.substring(0, 10000)}"
    `;

    const extractionSystemInstruction = `
      あなたは厳格なデータ抽出AIです。
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
      extractionSystemInstruction
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

    // 3: 無限サクラ会話の初期10件を生成
    let productInfoForComments = buildProductInfoForComments(extracted, rawUrl);
    if (topic.context) {
      productInfoForComments += `\n\n【重要：スレッド構成への追加指示】\nこのスレッドの会話の流れや結論について、以下の指示を最優先で守ってください：\n"${topic.context}"\n\n※指示に登場する競合製品名（DysonやPanasonicなど）については、あなたの持つ知識を使って具体的に比較・言及してください。`;
    }

    const comments: TranscriptTurn[] = [];
    while (comments.length < 10) {
      const batch = await generateStreamComments(
        comments.map((c) => `${c.speaker_name}「${c.content}」`),
        productInfoForComments,
        { systemInstruction: CRON_COMMENTS_SYSTEM_INSTRUCTION }
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

    const threadTitle = await generateThreadTitle(extracted, topic.context);

    const keyFeaturesLines = [
      `【抽出された目玉情報】`,
      `- 商品/キャンペーン名: ${extracted.product_name}`,
      extracted.manufacturer ? `- メーカー: ${extracted.manufacturer}` : null,
      extracted.model_number ? `- 型番: ${extracted.model_number}` : null,
      extracted.price ? `- 価格: ${extracted.price}` : null,
      extracted.key_specs ? `- 主なスペック: ${extracted.key_specs}` : null,
      `- 推しポイント: ${extracted.selling_point}`,
    ].filter(Boolean);

    const { data: row, error } = await supabase
      .from("promo_threads")
      .insert({
        product_name: threadTitle,
        source_url: rawUrl,
        affiliate_url: buttonUrl,
        key_features: keyFeaturesLines.join("\n"),
        og_image_url: ogImage || null,
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

