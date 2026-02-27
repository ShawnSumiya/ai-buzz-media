-- 楽天アフィリエイトのテキストのみHTMLタグ（<a href="...">...</a>）から抽出した
-- 公式商品説明を保持するための affiliate_text カラムを追加

alter table topic_queue
  add column if not exists affiliate_text text;
