-- スレッドのテーマ・方向性（Context）を指定するための context カラムを追加
-- 管理画面から「追加指示」を入れ、AIプロンプトに反映する

alter table topic_queue
  add column if not exists context text;
