-- 管理画面での識別用に title（商品名・管理用メモ）カラムを追加

alter table topic_queue
  add column if not exists title text;
