-- The Cook County Clerk's own district assignments per part ("split")
-- of each suburban precinct, from scripts/build-clerk-precincts.ts. The
-- Worker uses them instead of the boundary maps for the layers they cover,
-- because the maps can disagree with the Clerk near district edges.

create table public.clerk_precinct_splits (
  precinct_id text not null,
  split text not null,
  -- [{ "ocdId": "...", "layer": "state house" }, ...]
  districts jsonb not null,
  -- Layers the list is complete for (see ClerkSplit in src/shared/cook.ts).
  covers jsonb not null,
  primary key (precinct_id, split)
);

alter table public.clerk_precinct_splits enable row level security;

-- Same as before, plus the precinct's Clerk splits.
create or replace function public.districts_at(p_lat double precision, p_lng double precision)
returns jsonb
language sql stable
set search_path = ''
as $$
  with point as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326) as geom
  ),
  precinct as (
    select p.id, p.name from public.precincts p, point
    where extensions.st_contains(p.geom, point.geom)
    limit 1
  )
  select jsonb_build_object(
    'precinct', (select jsonb_build_object('id', id, 'name', name) from precinct),
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object('ocdId', d.ocd_id, 'layer', d.layer, 'required', d.required))
      from public.districts d, point
      where extensions.st_contains(d.geom, point.geom)
    ), '[]'::jsonb),
    'clerkSplits', coalesce((
      select jsonb_agg(jsonb_build_object('split', s.split, 'districts', s.districts, 'covers', s.covers) order by s.split)
      from public.clerk_precinct_splits s join precinct on s.precinct_id = precinct.id
    ), '[]'::jsonb)
  )
$$;

create or replace function public.reset_lookup_data()
returns void
language sql
set search_path = ''
as $$
  truncate public.address_points, public.districts, public.precincts, public.contests,
    public.unplaced_contests, public.clerk_precinct_splits
$$;

revoke execute on function public.districts_at(double precision, double precision) from public, anon, authenticated;
revoke execute on function public.reset_lookup_data() from public, anon, authenticated;
grant execute on function public.districts_at(double precision, double precision) to service_role;
grant execute on function public.reset_lookup_data() to service_role;
