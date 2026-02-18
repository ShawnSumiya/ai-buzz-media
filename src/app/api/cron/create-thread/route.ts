import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { scrapePageText } from "@/lib/scraper";
import { generateStreamComments, generateJSON } from "@/lib/gemini";
import type { TranscriptTurn } from "@/types/promo";

interface ExtractedProduct {
  product_name: string;
  price: string;
  selling_point: string;
}

function buildThreadTitle(p: ExtractedProduct): string {
  const baseName = p.product_name || "このページの目玉商品";
  if (p.price) {
    return `【急げ】${baseName} が ${p.price} になってるんだがｗ`;
  }
  return `【話題】${baseName} がアツすぎる件`;
}

function buildProductInfoForComments(p: ExtractedProduct, url: string): string {
  return [
    `商品/キャンペーン名: ${p.product_name}`,
    p.price ? `価格: ${p.price}` : null,
    `推しポイント: ${p.selling_point}`,
    `参照URL: ${url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

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
      .select("id, url, affiliate_url, status, created_at")
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

    const topic = queued[0];
    const rawUrl = topic.url?.trim();
    // 記事内ボタン用: アフィリエイトURLがあればそれ、なければ商品ページURL
    const buttonUrl =
      (topic as { affiliate_url?: string | null }).affiliate_url?.trim() ||
      rawUrl ||
      null;

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
        "product_name": "商品名（必須）",
        "price": "価格（不明なら空文字）",
        "selling_point": "魅力的なポイントや特徴（50文字以内）"
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
      price: parsed.price == null ? "" : String(parsed.price).trim(),
      selling_point:
        String(parsed.selling_point ?? "").trim() ||
        "ページで紹介されている目玉商品・キャンペーンです。",
    };

    // 3: 無限サクラ会話の初期10件を生成
    const productInfoForComments = buildProductInfoForComments(extracted, rawUrl);

    const comments: TranscriptTurn[] = [];
    while (comments.length < 10) {
      const batch = await generateStreamComments(
        comments.map((c) => `${c.speaker_name}「${c.content}」`),
        productInfoForComments
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

    const threadTitle = buildThreadTitle(extracted);

    const keyFeaturesLines = [
      `【抽出された目玉情報】`,
      `- 商品/キャンペーン名: ${extracted.product_name}`,
      extracted.price ? `- 価格: ${extracted.price}` : null,
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

