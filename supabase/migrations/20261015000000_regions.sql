-- More than one area in the lookup tables. Every row is tagged with the
-- region it was loaded for (`il-cook`, `ca-la`), so one area can be reloaded
-- without touching another. Existing rows and callers default to `il-cook`,
-- so a Worker that doesn't pass a region keeps working unchanged.
--
-- Districts and precincts are still found by location alone (areas don't
-- overlap); street names repeat across areas, so street_points filters by
-- region.

begin;

alter table public.address_points add column region text not null default 'il-cook';
alter table public.districts add column region text not null default 'il-cook';
alter table public.precincts add column region text not null default 'il-cook';
alter table public.contests add column region text not null default 'il-cook';
alter table public.unplaced_contests add column region text not null default 'il-cook';
alter table public.clerk_precinct_splits add column region text not null default 'il-cook';

create index address_points_region_street_number
  on public.address_points (region, street_key, number);
drop index public.address_points_street_number;

-- Same as before, limited to one region. The old three-argument version is
-- dropped so calls with named arguments resolve to this one.
drop function public.street_points(text, integer, integer);
create function public.street_points(
  p_street_key text,
  p_number integer,
  p_window integer default 200,
  p_region text default 'il-cook'
)
returns table (number integer, street_type text, city text, zip text, lat double precision, lng double precision)
language sql stable
set search_path = ''
as $$
  select a.number, a.street_type, a.city, a.zip, a.lat, a.lng
  from public.address_points a
  where a.region = p_region
    and a.street_key = p_street_key
    and a.number between p_number - p_window and p_number + p_window
$$;

-- Deletes up to p_limit rows of one region from each lookup table and
-- returns how many it deleted; the loader calls it until it returns 0.
-- Batches keep each call under the API's statement timeout.
drop function public.reset_lookup_data();
create function public.reset_lookup_batch(p_region text, p_limit integer default 50000)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted integer := 0;
  n integer;
begin
  delete from public.address_points where id in (
    select id from public.address_points where region = p_region limit p_limit);
  get diagnostics n = row_count; deleted := deleted + n;
  delete from public.districts where id in (
    select id from public.districts where region = p_region limit greatest(p_limit / 100, 1));
  get diagnostics n = row_count; deleted := deleted + n;
  delete from public.precincts where id in (
    select id from public.precincts where region = p_region limit greatest(p_limit / 10, 1));
  get diagnostics n = row_count; deleted := deleted + n;
  delete from public.contests where region = p_region;
  get diagnostics n = row_count; deleted := deleted + n;
  delete from public.unplaced_contests where region = p_region;
  get diagnostics n = row_count; deleted := deleted + n;
  delete from public.clerk_precinct_splits where region = p_region;
  get diagnostics n = row_count; deleted := deleted + n;
  return deleted;
end
$$;

revoke execute on function public.street_points(text, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.reset_lookup_batch(text, integer) from public, anon, authenticated;
grant execute on function public.street_points(text, integer, integer, text) to service_role;
grant execute on function public.reset_lookup_batch(text, integer) to service_role;

commit;

notify pgrst, 'reload schema';
