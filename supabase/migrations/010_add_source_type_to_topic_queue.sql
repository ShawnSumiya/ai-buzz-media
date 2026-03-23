-- topic_queue にソース種別カラムを追加（'youtube' | 'trend'）
alter table topic_queue
  add column if not exists source_type text default 'youtube';
