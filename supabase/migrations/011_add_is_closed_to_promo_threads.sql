-- スレッド終了（過去ログ化）フラグ。true のスレッドは Cron による自動コメント対象外とする。
alter table promo_threads
  add column if not exists is_closed boolean default false;

update promo_threads
set is_closed = false
where is_closed is null;

alter table promo_threads
  alter column is_closed set default false;

alter table promo_threads
  alter column is_closed set not null;

comment on column promo_threads.is_closed is 'true のとき終了済み（過去ログ）。自動追記 Cron は対象外。';
