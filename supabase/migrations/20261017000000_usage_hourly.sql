-- Anonymous usage counts, kept by the hour. The Worker counts events in
-- Cloudflare Workers Analytics Engine (worker/events.ts) and, once a day,
-- copies the hourly totals here through record_usage_hourly()
-- (worker/rollup.ts), since Analytics Engine keeps them for about three months.
--
-- Rows are totals only: an event name, up to three labels (a page, a level of
-- government, an area, a yes/no flag; see src/shared/metrics.ts), how many
-- times it happened and the sums of its numbers. Nothing here tells one
-- visitor from another: no address, IP address, pick or identifier.

create table public.usage_hourly (
  hour timestamptz not null,
  event text not null check (char_length(event) between 1 and 20),
  a text not null default '' check (char_length(a) <= 120),
  b text not null default '' check (char_length(b) <= 120),
  c text not null default '' check (char_length(c) <= 120),
  -- How many times the event happened in the hour.
  n double precision not null,
  -- Sums of the event's numbers (seconds, races by level; see metrics.ts).
  d1 double precision not null default 0,
  d2 double precision not null default 0,
  d3 double precision not null default 0,
  d4 double precision not null default 0,
  d5 double precision not null default 0,
  d6 double precision not null default 0,
  d7 double precision not null default 0,
  d8 double precision not null default 0,
  updated_at timestamptz not null default now(),
  primary key (hour, event, a, b, c)
);

create index usage_hourly_event_hour_idx on public.usage_hourly (event, hour);

alter table public.usage_hourly enable row level security;

-- Stores a batch of hourly totals. A row for an hour already stored replaces
-- it, so a repeated run never counts twice. Returns the rows written.
create function public.record_usage_hourly(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written integer;
begin
  insert into public.usage_hourly
    (hour, event, a, b, c, n, d1, d2, d3, d4, d5, d6, d7, d8)
  select
    to_timestamp((r->>'hour')::double precision),
    r->>'event',
    coalesce(r->>'a', ''),
    coalesce(r->>'b', ''),
    coalesce(r->>'c', ''),
    (r->>'n')::double precision,
    coalesce((r->'d'->>0)::double precision, 0),
    coalesce((r->'d'->>1)::double precision, 0),
    coalesce((r->'d'->>2)::double precision, 0),
    coalesce((r->'d'->>3)::double precision, 0),
    coalesce((r->'d'->>4)::double precision, 0),
    coalesce((r->'d'->>5)::double precision, 0),
    coalesce((r->'d'->>6)::double precision, 0),
    coalesce((r->'d'->>7)::double precision, 0)
  from jsonb_array_elements(p_rows) as r
  on conflict (hour, event, a, b, c) do update
    set n = excluded.n,
        d1 = excluded.d1, d2 = excluded.d2, d3 = excluded.d3,
        d4 = excluded.d4, d5 = excluded.d5, d6 = excluded.d6,
        d7 = excluded.d7, d8 = excluded.d8,
        updated_at = now();
  get diagnostics written = row_count;
  return written;
end
$$;

revoke execute on function public.record_usage_hourly(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_usage_hourly(jsonb)
  to service_role;
