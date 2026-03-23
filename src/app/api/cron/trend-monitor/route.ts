export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

/** ブラックリスト: 実店舗・オフライン（楽天等のネット通販で買えない可能性が高い） */
const BLACKLIST_KEYWORDS = [
  '店', '行列', '駅前', 'ランチ', '食堂', '食べに行',
  '並んで', 'スーパー', 'コンビニ', '町中華', 'レストラン', '店舗',
];

/** ホワイトリスト: 通販・ネット購入に直結するキーワード（食品/家電/コスメ等全ジャンル、1つ以上必須） */
const WHITELIST_KEYWORDS = [
  'お取り寄せ', '通販', 'ポチ', '楽天', 'Amazon', 'Qoo10', 'カート',
  '売り切れ', '在庫', '買う', '買お', '注文', '欲しい', '探そ', '買ってみ',
];

/** 放送番組の放送時間帯（Asia/Tokyo）に基づきターゲットハッシュタグを決定 */
function getTargetHashtag(): string | null {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[parts.find((p) => p.type === 'weekday')?.value ?? ''] ?? -1;
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);

  // 平日(月-金:1〜5)の8時台・9時台 → #ラヴィット
  if (weekday >= 1 && weekday <= 5 && (hour === 8 || hour === 9)) {
    return '#ラヴィット';
  }
  // 火曜(2)の20時台〜22時台 → #マツコの知らない世界
  if (weekday === 2 && hour >= 20 && hour <= 22) {
    return '#マツコの知らない世界';
  }
  // 木曜(4)の23時台、または金曜(5)の0時台 → #アメトーーク
  if ((weekday === 4 && hour === 23) || (weekday === 5 && hour === 0)) {
    return '#アメトーーク';
  }
  // 土曜(6)の7時台(50分以降)・8時台・9時台 → #サタプラ
  if (weekday === 6) {
    if (hour === 7 && minute >= 50) return '#サタプラ';
    if (hour === 8 || hour === 9) return '#サタプラ';
  }

  return null;
}

/** Yahooリアルタイム検索のURL */
const YAHOO_REALTIME_URL = 'https://search.yahoo.co.jp/realtime/search';

/** URL・ユーザーIDらしきノイズを除去 */
function removeNoise(text: string): string {
  let result = text;
  // URL除去（http/https/pic.x.com等）
  result = result.replace(/https?:\/\/[^\s]+/g, '');
  result = result.replace(/pic\.x\.com\/[^\s]*/g, '');
  result = result.replace(/t\.co\/[^\s]*/g, '');
  // @ユーザー名/ID除去
  result = result.replace(/@\S+/g, '');
  return result.trim().replace(/\s+/g, ' ');
}

/** ツイートブロック内から x.com / twitter.com のポストURLを抽出（/status/ を優先） */
function extractPostUrl($: cheerio.CheerioAPI, $block: cheerio.Cheerio<any>): string | null {
  const links = $block.find('a[href*="x.com"], a[href*="twitter.com"]');
  let fallback: string | null = null;
  for (let i = 0; i < links.length; i++) {
    const href = $(links[i]).attr('href');
    if (!href || (!href.includes('x.com') && !href.includes('twitter.com'))) continue;
    if (href.includes('/status/')) return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

/** ポストURLのフォールバック（検索URLを生成） */
function fallbackSearchUrl(text: string): string {
  return `https://x.com/search?q=${encodeURIComponent(text.slice(0, 20))}`;
}

type TweetItem = { text: string; url: string };

/** ツイート本文を抽出（複数のセレクタを試す） */
function extractTweetTexts(
  $: cheerio.CheerioAPI,
  searchHashtag: string
): TweetItem[] {
  const items: TweetItem[] = [];
  const seen = new Set<string>();
  const PREFIX_LEN = 30;

  const addIfNew = (text: string, url: string) => {
    if (!text || text.length < 10 || text.length > 500) return;
    const p = text.slice(0, PREFIX_LEN);
    if (seen.has(p)) return;
    const isDup = items.some((e) => {
      const pe = e.text.slice(0, PREFIX_LEN);
      return p === pe || p.startsWith(pe) || pe.startsWith(p);
    });
    if (!isDup) {
      seen.add(p);
      items.push({ text, url });
    }
  };

  // Yahooリアルタイムのツイート本文クラス（構造変更に備え複数パターン）
  const selectors = [
    '[class*="Tweet_body"]',
    '[class*="TweetBody"]',
    '[class*="tweet-body"]',
    'div[class*="Tweet"] p',
    'article div[class*="content"]',
  ];

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const $el = $(el);
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (!text || text.length < 10 || text.length > 500 || seen.has(text.slice(0, PREFIX_LEN))) return;
      const $block = $el.closest('div[class*="Tweet"], article, [class*="tweet"]').length
        ? $el.closest('div[class*="Tweet"], article, [class*="tweet"]')
        : $el.parent();
      const postUrl = extractPostUrl($, $block) ?? fallbackSearchUrl(text);
      addIfNew(text, postUrl);
    });
  }

  // フォールバック: x.com/.../status/ を含むリンクの親要素のテキスト
  if (items.length === 0) {
    $('a[href*="x.com"][href*="/status/"]').each((_, el) => {
      const $link = $(el);
      const statusUrl = $link.attr('href') ?? fallbackSearchUrl('');
      const $parent = $link.closest('div[class*="Tweet"], article, [class*="tweet"]');
      if ($parent.length) {
        const fullText = $parent.first().text().replace(/\s+/g, ' ').trim();
        const lines = fullText.split(/\s{2,}|\n/);
        for (const line of lines) {
          const t = line.trim();
          if (t.length >= 15 && t.length <= 400 && !t.includes('@')) {
            const url = statusUrl && (statusUrl.includes('x.com') || statusUrl.includes('twitter.com'))
              ? statusUrl
              : fallbackSearchUrl(t);
            addIfNew(t, url);
          }
        }
      }
    });
  }

  // さらにフォールバック: ページ内テキストから検索ハッシュタグを含むブロックを抽出
  if (items.length < 5) {
    const hashtagPlain = searchHashtag.replace(/^#/, '');
    const bodyText = $('body').text();
    const blocks = bodyText.split(/\n|\s{3,}/).map((b) => b.replace(/\s+/g, ' ').trim());
    for (const block of blocks) {
      if (
        block.length >= 20 &&
        block.length <= 400 &&
        (block.includes(searchHashtag) || block.includes(hashtagPlain))
      ) {
        const url = fallbackSearchUrl(block);
        addIfNew(block, url);
      }
    }
  }

  return items.slice(0, 10); // 最大10件
}

/** ブラックリストに含まれるか（含まれたら除外対象） */
function hasBlacklistKeyword(text: string): boolean {
  return BLACKLIST_KEYWORDS.some((kw) => text.includes(kw));
}

/** ホワイトリストに1つ以上含まれるか（通販・購買に直結） */
function hasWhitelistKeyword(text: string): boolean {
  return WHITELIST_KEYWORDS.some((kw) => text.includes(kw));
}

export async function GET(req: Request) {
  // セキュリティチェック（他cronと同様）
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_API_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 放送番組の自動判定（Asia/Tokyo）
  const targetHashtag = getTargetHashtag();
  if (!targetHashtag) {
    return NextResponse.json({
      message: '現在放送中の四天王番組はありません',
    });
  }

  const query = encodeURIComponent(targetHashtag);
  const url = `${YAHOO_REALTIME_URL}?p=${query}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });

    if (!res.ok) {
      console.error('trend-monitor: Yahoo fetch failed', res.status);
      return NextResponse.json(
        { error: `Yahoo fetch failed: ${res.status}` },
        { status: 502 }
      );
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const rawItems = extractTweetTexts($, targetHashtag);

    if (rawItems.length === 0) {
      return NextResponse.json({
        status: 'ok',
        message: 'ツイートを抽出できませんでした（HTML構造の変更の可能性）',
        extracted_count: 0,
      });
    }

    // 1. ノイズ除去（URL・@ユーザーID）→ 正規化（テキストのみ、urlは維持）
    const cleaned: TweetItem[] = rawItems
      .map((item) => ({ text: removeNoise(item.text), url: item.url }))
      .filter((item) => item.text.length > 0);

    // 2. ブラックリスト除外（実店舗・オフライン = ネット通販で買えないもの）
    const filteredByBlacklist = cleaned.filter((item) => !hasBlacklistKeyword(item.text));

    // 3. ホワイトリスト必須（通販・お取り寄せに直結するキーワードが1つ以上）
    const filteredByWhitelist = filteredByBlacklist.filter((item) =>
      hasWhitelistKeyword(item.text)
    );

    // 4. 超・厳密な重複排除（先頭30文字での一致判定、短い方の先頭一致も検出）
    const PREFIX_LEN = 30;
    const uniqueTweets: TweetItem[] = [];
    for (const item of filteredByWhitelist) {
      const p = item.text.slice(0, PREFIX_LEN);
      const isDuplicate = uniqueTweets.some((existing) => {
        const pEx = existing.text.slice(0, PREFIX_LEN);
        return p === pEx || p.startsWith(pEx) || pEx.startsWith(p);
      });
      if (!isDuplicate) uniqueTweets.push(item);
    }
    const topTweets = uniqueTweets.slice(0, 5);

    // 通販・お取り寄せ対象が0件の場合はDiscord送信をスキップ
    if (uniqueTweets.length === 0) {
      return NextResponse.json({
        status: 'ok',
        message: '通販・お取り寄せ可能な商品の実況コメントは検出されませんでした',
        extracted_count: 0,
      });
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl?.trim()) {
      console.warn('trend-monitor: DISCORD_WEBHOOK_URL is not set');
      return NextResponse.json({
        status: 'ok',
        message: '通販・お取り寄せ対象検出済みだが、DISCORD_WEBHOOK_URLが未設定のため通知スキップ',
        extracted_count: uniqueTweets.length,
      });
    }

    const COMMENT_MAX_LEN = 90; // スマホ視認性のため80〜100文字程度

    const discordPayload = {
      embeds: [
        {
          title: '🚨 トレンド急上昇検知！',
          description:
            `**${targetHashtag}** で通販可能な商品を検出しました。`,
          color: 16729344,
          fields: topTweets.map((item, i) => {
            const truncated =
              item.text.length > COMMENT_MAX_LEN
                ? `${item.text.substring(0, COMMENT_MAX_LEN)}...`
                : item.text;
            return {
              name: `💬 実況コメント ${i + 1}`,
              value: `${truncated}\n\n[🔗 元のポストを確認する](${item.url})`,
            };
          }),
        },
      ],
    };

    const discordRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
    });

    if (!discordRes.ok) {
      console.error('trend-monitor: Discord webhook failed', discordRes.status);
      return NextResponse.json(
        { error: `Discord notification failed: ${discordRes.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      status: 'notified',
      message: 'Discordに通知を送信しました',
      extracted_count: uniqueTweets.length,
    });
  } catch (e) {
    console.error('trend-monitor error:', e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'trend-monitor 実行中にエラーが発生しました',
      },
      { status: 500 }
    );
  }
}
