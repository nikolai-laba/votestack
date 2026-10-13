-- "Tell me when VoteStack reaches my area" sign-ups. The Worker (POST
-- /api/notify) checks Cloudflare Turnstile and a rate limit, then stores the
-- sign-up here through submit_expansion_signup().
--
-- A sign-up is an email address and a ZIP code, nothing else: no IP address,
-- name or street address is ever stored. They are used only to tell people
-- when VoteStack covers their area and to count where people are asking
-- from. They are never shared, and are deleted on request.

create table public.expansion_signups (
  id bigint generated always as identity primary key,
  -- Stored in lowercase, so each address appears once.
  email text not null
    check (
      char_length(email) between 3 and 254
      and email = lower(email)
      and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    ),
  zip text not null check (zip ~ '^[0-9]{5}$'),
  -- For one-click unsubscribe links once messages are sent.
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index expansion_signups_email_idx
  on public.expansion_signups (email);
create unique index expansion_signups_unsubscribe_token_idx
  on public.expansion_signups (unsubscribe_token);
create index expansion_signups_zip_idx
  on public.expansion_signups (zip);

alter table public.expansion_signups enable row level security;

-- Stores a sign-up, or updates the ZIP code of an address that is already
-- signed up. Always returns true, so callers can't tell the two apart.
create function public.submit_expansion_signup(p_email text, p_zip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.expansion_signups (email, zip)
  values (lower(p_email), p_zip)
  on conflict (email) do update
    set zip = excluded.zip,
        updated_at = now();
  return true;
end
$$;

revoke execute on function public.submit_expansion_signup(text, text)
  from public, anon, authenticated;
grant execute on function public.submit_expansion_signup(text, text)
  to service_role;
