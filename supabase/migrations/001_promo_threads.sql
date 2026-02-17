-- 企業向け・全自動商品盛り上げAIシステム: promo_threads テーブル
-- Supabase Dashboard > SQL Editor で実行してください。

create table if not exists promo_threads (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  source_url text,
  key_features text not null,
  cast_profiles jsonb not null default '[]',
  transcript jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- 一覧取得を created_at 降順で使いやすいように
create index if not exists idx_promo_threads_created_at on promo_threads (created_at desc);

-- RLS を有効化（必要に応じてポリシーを追加）
alter table promo_threads enable row level security;

-- 匿名キーで読み書きを許可する例（本番では適切なポリシーに変更）
create policy "Allow all for anon" on promo_threads
  for all using (true) with check (true);
