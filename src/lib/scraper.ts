import * as cheerio from 'cheerio';

export async function scrapePageText(url: string) {
  try {
    console.log(`Checking URL: ${url}`); // ログ追加

    const response = await fetch(url, {
      headers: {
        // 重要: これがないと大手サイトはブロックします
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    });

    if (!response.ok) {
      console.error(`Scrape failed: ${response.status} ${response.statusText}`);
      return { ok: false, error: `Status ${response.status}` };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // OGP画像の取得
    const ogImage = $('meta[property="og:image"]').attr('content') || null;

    // 不要な要素を削除 (ノイズ除去)
    $('script, style, nav, footer, header, iframe, noscript').remove();

    // 本文の抽出 (body全体からテキストを取得し、空白を整理)
    let text = $('body').text()
      .replace(/\s+/g, ' ') // 連続する空白を1つに
      .trim();

    // 文字数制限 (Geminiに渡すため、長すぎるとエラーになるので先頭5000文字程度にカット)
    if (text.length > 8000) {
      text = text.substring(0, 8000) + "...";
    }

    console.log(`Scrape success! Length: ${text.length}`); // ログ追加

    return { ok: true, text, ogImage };

  } catch (error) {
    console.error('Scrape Exception:', error);
    return { ok: false, error: String(error) };
  }
}

