-- Ballot lookup: local geocoding (Cook County address points), district and
-- precinct boundaries, and contests. Loaded by scripts/load-supabase.ts and
-- read only by the Cloudflare Worker with the secret key. Row-level security
-- is on for every table with no policies, so the public (anon) key can read
-- nothing; the functions are revoked from public roles as well.

create extension if not exists postgis with schema extensions;

-- One row per Cook County address point. street_key is `PREDIR|NAME` as
-- produced by streetKey() in src/shared/address.ts.
create table public.address_points (
  id bigint generated always as identity primary key,
  street_key text not null,
  number integer not null,
  street_type text,
  city text,
  zip text,
  lat double precision not null,
  lng double precision not null
);
create index address_points_street_number on public.address_points (street_key, number);

-- District boundaries, one row per district polygon (see scripts/lib/layers.ts).
create table public.districts (
  id bigint generated always as identity primary key,
  ocd_id text not null,
  layer text not null,
  required boolean not null,
  geom extensions.geometry(MultiPolygon, 4326) not null
);
create index districts_geom on public.districts using gist (geom);

-- Election precincts (Chicago and suburban Cook).
create table public.precincts (
  id text primary key,
  name text not null,
  geom extensions.geometry(MultiPolygon, 4326) not null
);
create index precincts_geom on public.precincts using gist (geom);

-- Contests as imported (src/shared/ballot.ts Contest objects in `data`).
create table public.contests (
  id text primary key,
  election_id text not null,
  district_id text not null,
  authority_id text not null,
  data jsonb not null
);
create index contests_lookup on public.contests (election_id, authority_id, district_id);

-- Contests an import couldn't place in a district yet, shown to voters as
-- possible gaps instead of being dropped silently.
create table public.unplaced_contests (
  id bigint generated always as identity primary key,
  election_id text not null,
  authority_id text not null,
  description text not null
);

alter table public.address_points enable row level security;
alter table public.districts enable row level security;
alter table public.precincts enable row level security;
alter table public.contests enable row level security;
alter table public.unplaced_contests enable row level security;

-- Address points on a street near a house number, for matchOnStreet().
create function public.street_points(p_street_key text, p_number integer, p_window integer default 200)
returns table (number integer, street_type text, city text, zip text, lat double precision, lng double precision)
language sql stable
set search_path = ''
as $$
  select a.number, a.street_type, a.city, a.zip, a.lat, a.lng
  from public.address_points a
  where a.street_key = p_street_key
    and a.number between p_number - p_window and p_number + p_window
$$;

-- The precinct and every district containing a point.
create function public.districts_at(p_lat double precision, p_lng double precision)
returns jsonb
language sql stable
set search_path = ''
as $$
  with point as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326) as geom
  )
  select jsonb_build_object(
    'precinct', (
      select jsonb_build_object('id', p.id, 'name', p.name) from public.precincts p, point
      where extensions.st_contains(p.geom, point.geom)
      limit 1
    ),
    'districts', coalesce((
      select jsonb_agg(jsonb_build_object('ocdId', d.ocd_id, 'layer', d.layer, 'required', d.required))
      from public.districts d, point
      where extensions.st_contains(d.geom, point.geom)
    ), '[]'::jsonb)
  )
$$;

-- Contests on one authority's ballot for a set of districts, plus that
-- authority's contests not yet placed in a district.
create function public.contests_for(p_election_id text, p_authority_id text, p_district_ids text[])
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'contests', coalesce((
      select jsonb_agg(c.data)
      from public.contests c
      where c.election_id = p_election_id
        and c.authority_id = p_authority_id
        and c.district_id = any (p_district_ids)
    ), '[]'::jsonb),
    'unplaced', coalesce((
      select jsonb_agg(u.description)
      from public.unplaced_contests u
      where u.election_id = p_election_id and u.authority_id = p_authority_id
    ), '[]'::jsonb)
  )
$$;

-- Empties the lookup tables before a reload (scripts/load-supabase.ts).
create function public.reset_lookup_data()
returns void
language sql
set search_path = ''
as $$
  truncate public.address_points, public.districts, public.precincts, public.contests, public.unplaced_contests
$$;

revoke execute on function public.street_points(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.districts_at(double precision, double precision) from public, anon, authenticated;
revoke execute on function public.contests_for(text, text, text[]) from public, anon, authenticated;
revoke execute on function public.reset_lookup_data() from public, anon, authenticated;
grant execute on function public.street_points(text, integer, integer) to service_role;
grant execute on function public.districts_at(double precision, double precision) to service_role;
grant execute on function public.contests_for(text, text, text[]) to service_role;
grant execute on function public.reset_lookup_data() to service_role;
