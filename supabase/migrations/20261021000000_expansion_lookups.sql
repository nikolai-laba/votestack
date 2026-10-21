-- Expansion signals from the ballot address form: when a voter types an
-- address we can't match, we keep the 5-digit ZIP code and whether it falls
-- inside a VoteStack region, nothing else. No email address, no IP address,
-- no street address is ever stored. Used to see which new areas have the
-- most voter interest.

create table public.expansion_lookups (
  id bigint generated always as identity primary key,
  zip text not null check (zip ~ '^[0-9]{5}$'),
  -- true when the ZIP's first two digits match a region VoteStack already
  -- covers (a coverage gap in a known area); false when they don't (an
  -- expansion signal from a new area).
  covered boolean not null,
  created_at timestamptz not null default now()
);

create index expansion_lookups_zip_idx
  on public.expansion_lookups (zip);
create index expansion_lookups_created_at_idx
  on public.expansion_lookups (created_at);

alter table public.expansion_lookups enable row level security;

-- Records one failed ballot lookup. Always returns true.
create function public.record_expansion_lookup(p_zip text, p_covered boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.expansion_lookups (zip, covered)
  values (p_zip, p_covered);
  return true;
end
$$;

revoke execute on function public.record_expansion_lookup(text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_expansion_lookup(text, boolean)
  to service_role;
