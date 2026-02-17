-- promo_threads に OGP 画像URL用カラムを追加
-- Supabase Dashboard > SQL Editor で実行するか、supabase db push で適用してください。

alter table promo_threads
add column if not exists og_image_url text;
