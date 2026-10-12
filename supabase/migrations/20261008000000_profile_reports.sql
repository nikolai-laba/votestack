-- "Report an error" on candidate profiles. The Worker (POST
-- /api/report) checks Cloudflare Turnstile and a rate limit, then stores the
-- report here through submit_profile_report(). Reports hold only what the
-- reader wrote about the profile: no IP address, email, name or street
-- address is ever stored. Maintainers read and triage them in the dashboard.

create table public.profile_reports (
  id bigint generated always as identity primary key,
  election_id text not null,
  profile_key text not null check (profile_key ~ '^[a-z0-9-]{1,80}$'),
  section text not null
    check (section in ('overview', 'money', 'endorsements', 'sources', 'other')),
  message text not null
    check (char_length(message) between 1 and 2000),
  -- An optional supporting link from the reader.
  source_url text
    check (
      source_url is null
      or (source_url ~ '^https?://' and char_length(source_url) <= 500)
    ),
  -- The published profile version the report was about.
  profile_version integer,
  status text not null default 'new'
    check (status in ('new', 'fixed', 'rejected', 'duplicate')),
  created_at timestamptz not null default now()
);

create index profile_reports_open_idx
  on public.profile_reports (election_id, profile_key)
  where status = 'new';

alter table public.profile_reports enable row level security;

-- Stores one report about a published profile and returns its id, or null
-- when there is no published profile with that key (nothing is stored then).
create function public.submit_profile_report(
  p_election_id text,
  p_key text,
  p_section text,
  p_message text,
  p_source_url text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_id bigint;
begin
  select p.version into v_version
  from public.profiles p
  where p.election_id = p_election_id
    and p.key = p_key
    and p.status = 'published';

  if not found then
    return null;
  end if;

  insert into public.profile_reports
    (election_id, profile_key, section, message, source_url, profile_version)
  values
    (p_election_id, p_key, p_section, p_message, p_source_url, v_version)
  returning id into v_id;

  return v_id;
end
$$;

revoke execute on function public.submit_profile_report(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_profile_report(text, text, text, text, text)
  to service_role;
