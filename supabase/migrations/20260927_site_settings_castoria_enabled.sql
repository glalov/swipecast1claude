-- Castoria kill switch column (client reads site_settings.castoria_enabled; false hides the assistant).
alter table public.site_settings add column if not exists castoria_enabled boolean not null default true;
