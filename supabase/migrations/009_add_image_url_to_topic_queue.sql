-- topic_queue にサムネイル画像URL用カラムを追加
-- キュー登録時に手動で指定した場合、自動取得（og:image）の代わりに使用される

alter table topic_queue
add column if not exists image_url text;
