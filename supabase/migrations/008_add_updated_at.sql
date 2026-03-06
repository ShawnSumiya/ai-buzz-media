-- promo_threads に最終更新日時（updated_at）を追加
-- コメント追加時にこの日時が更新され、一覧のソート・表示に使用する

alter table promo_threads add column if not exists updated_at timestamptz;

-- 既存レコードは created_at で初期化（過去データの互換性）
update promo_threads set updated_at = created_at where updated_at is null;

-- 新規レコード用のデフォルト
alter table promo_threads alter column updated_at set default now();

-- ソート用インデックス
create index if not exists idx_promo_threads_updated_at on promo_threads (updated_at desc);
