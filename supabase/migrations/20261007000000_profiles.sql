-- Candidate profiles. The profile pipeline keeps profiles as JSON in
-- git (content/profiles/) and publishes a copy here; the Worker serves only
-- published rows. `data` is a CandidateProfile (src/shared/profile.ts) and
-- `key` is profileKey(name). Profiles are not lookup data, so
-- reset_lookup_data() leaves this table alone.

create table public.profiles (
  election_id text not null,
  key text not null check (key ~ '^[a-z0-9-]{1,80}$'),
  status text not null check (status in ('published', 'flagged', 'withdrawn')),
  data jsonb not null,
  version integer not null,
  -- Hash of `data`, used as the HTTP ETag.
  content_hash text not null,
  generated_at timestamptz not null,
  published_at timestamptz,
  primary key (election_id, key)
);

alter table public.profiles enable row level security;

-- One published profile and its content hash, or null.
create function public.profile_get(p_election_id text, p_key text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('profile', p.data, 'contentHash', p.content_hash)
  from public.profiles p
  where p.election_id = p_election_id
    and p.key = p_key
    and p.status = 'published'
$$;

-- Keys of every published profile in an election, so the ballot can link them.
create function public.published_profile_keys(p_election_id text)
returns text[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(p.key order by p.key), '{}'::text[])
  from public.profiles p
  where p.election_id = p_election_id and p.status = 'published'
$$;

revoke execute on function public.profile_get(text, text) from public, anon, authenticated;
revoke execute on function public.published_profile_keys(text) from public, anon, authenticated;
grant execute on function public.profile_get(text, text) to service_role;
grant execute on function public.published_profile_keys(text) to service_role;
