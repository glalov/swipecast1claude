-- 2026-11-16 (owner): new event stripe colours midnight + charcoal; red no longer handed out.
-- Applied live via SQL. Old values backed up in public.film_events_palette_backup_20261116.
alter table public.film_events drop constraint if exists film_events_palette_check;
alter table public.film_events add constraint film_events_palette_check check (palette = any (array['blue','red','green','navy','plum','amber','teal','midnight','charcoal']));
