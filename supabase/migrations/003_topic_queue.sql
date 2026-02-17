-- URL をキューしておくための「ネタ帳」テーブル
-- Supabase Dashboard > SQL Editor で実行するか、`supabase db push` で適用してください。

create table if not exists topic_queue (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  status text not null default 'pending', -- 'pending' | 'done'
  created_at timestamptz not null default now()
);

-- 古い pending から順に取り出すためのインデックス
create index if not exists idx_topic_queue_status_created_at
  on topic_queue (status, created_at asc);

-- RLS を有効化
alter table topic_queue enable row level security;

-- 匿名キーでの読み書きを許可（必要に応じて絞り込んでください）
create policy if not exists "Allow all for anon on topic_queue"
  on topic_queue
  for all
  using (true)
  with check (true);

