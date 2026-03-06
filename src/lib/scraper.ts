import * as cheerio from 'cheerio';

/** YouTube URLかどうかを判定する */
function isYouTubeUrl(url: string): boolean {
  try {
    const lower = url.toLowerCase();
    return lower.includes('youtube.com') || lower.includes('youtu.be');
  } catch {
    return false;
  }
}

/** YouTube専用: og:title と description を取得して結合した「YouTube動画情報」を返す */
async function scrapeYouTubeMetadata(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    });

    if (!response.ok) {
      return { ok: false as const, error: `Status ${response.status}` };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr('content')?.replace(/\s+/g, ' ').trim() || '';
    const description =
      $('meta[name="description"]').attr('content')?.replace(/\s+/g, ' ').trim() ||
      $('meta[property="og:description"]').attr('content')?.replace(/\s+/g, ' ').trim() ||
      '';
    const ogImage = $('meta[property="og:image"]').attr('content') || null;

    const combinedText = [title, description].filter(Boolean).join('\n\n');
    const text = combinedText || '（タイトル・概要欄を取得できませんでした）';

    console.log(`YouTube scrape success! title=${title.length} chars, description=${description.length} chars`);

    return {
      ok: true as const,
      text,
      ogImage,
      isYouTube: true as const,
      youtubeTitle: title,
      youtubeDescription: description
    };
  } catch (error) {
    console.error('YouTube scrape Exception:', error);
    return { ok: false as const, error: String(error) };
  }
}

export async function scrapePageText(url: string) {
  try {
    console.log(`Checking URL: ${url}`); // ログ追加

    // YouTube URL の場合は専用処理に分岐
    if (isYouTubeUrl(url)) {
      return scrapeYouTubeMetadata(url);
    }

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

    // メタディスクリプション (最優先で取得)
    const metaDescription =
      $('meta[name="description"]').attr('content')?.replace(/\s+/g, ' ').trim() ||
      '';

    // OGP画像の取得
    const ogImage = $('meta[property="og:image"]').attr('content') || null;

    // 不要な要素を削除 (ノイズ徹底除去)
    $(
      [
        'script',
        'style',
        'nav',
        'footer',
        'header',
        'iframe',
        'noscript',
        'aside',
        '[role="navigation"]',
        '[role="banner"]',
        '[role="contentinfo"]',
        '.breadcrumb',
        '.breadcrumbs',
        '.global-header',
        '.globalHeader',
        '.global-footer',
        '.globalFooter',
        '.side',
        '.sidebar',
        '#sidebar',
        '#header',
        '#footer',
        '#nav',
        '.header',
        '.footer',
        '.nav',
        '.pagination',
        '.pager',
        '.sns',
        '.sns-share',
        '.social',
        '.menu',
        '.global-nav',
        '.g-nav',
        '.l-nav',
        '.cart',
        '.basket',
      ].join(', ')
    ).remove();

    // ECサイト特有の商品説明に使われがちなクラスからテキストを優先抽出
    const productClassSelectors = [
      '.catch_copy',
      '.catchcopy',
      '.item_desc',
      '.item-desc',
      '.item_description',
      '.item-description',
      '.item_detail',
      '.item-detail',
      '.sales_desc',
      '.sales-description',
      '.item_name',
      '.item-name',
      '.product-description',
      '.productDescription',
      '.product-detail',
      '.product_detail',
      '.product-info',
      '.product_info',
      '.item-info',
      '.item_info',
      '.productSpec',
      '.product-spec',
      '.spec',
      '.specs',
      '.description',
      '.detail',
      '.details',
    ];

    const productTextSet = new Set<string>();

    for (const selector of productClassSelectors) {
      $(selector).each((_, el) => {
        const t = $(el)
          .text()
          .replace(/\s+/g, ' ')
          .trim();
        if (t) {
          productTextSet.add(t);
        }
      });
    }

    // 重複を除いた商品説明テキストを結合
    const productText = Array.from(productTextSet).join('\n\n');

    // フォールバック用: それでも情報が足りない場合はbody全体から取得
    let fallbackBodyText = '';
    if (!metaDescription && !productText) {
      fallbackBodyText = $('body')
        .text()
        .replace(/\s+/g, ' ')
        .trim();
    }

    // 最終的にAIに渡すテキストを組み立て
    let combinedTextParts: string[] = [];
    if (metaDescription) combinedTextParts.push(metaDescription);
    if (productText) combinedTextParts.push(productText);
    if (!combinedTextParts.length && fallbackBodyText) {
      combinedTextParts.push(fallbackBodyText);
    }

    let combinedText = combinedTextParts.join('\n\n');

    // 文字数制限 (Geminiに渡すため、長すぎるとエラーになるので先頭8000文字程度にカット)
    if (combinedText.length > 8000) {
      combinedText = combinedText.substring(0, 8000) + '...';
    }

    console.log(
      `Scrape success! meta=${metaDescription.length} chars, product=${productText.length} chars, total=${combinedText.length} chars`
    );

    return { ok: true, text: combinedText, ogImage };

  } catch (error) {
    console.error('Scrape Exception:', error);
    return { ok: false, error: String(error) };
  }
}

