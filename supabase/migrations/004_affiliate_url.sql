-- スクレイピング用URLと記事内ボタン用URLを分離するため、affiliate_url を追加
-- Supabase Dashboard > SQL Editor で実行するか、`supabase db push` で適用してください。

-- topic_queue: アフィリエイトリンク（記事内ボタン用）を任意で保持
alter table topic_queue
  add column if not exists affiliate_url text;

-- promo_threads: 記事内「商品を見る」ボタンのリンク先（なければ source_url を使用）
alter table promo_threads
  add column if not exists affiliate_url text;
