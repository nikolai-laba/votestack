-- The sign-up table now holds VoteStack's email list. Each row says what the
-- person agreed to (scope):
--   'area'    only an email when VoteStack reaches their area (every sign-up
--             made before this change);
--   'updates' the email list: a few emails a year about new elections and
--             areas VoteStack covers, and big changes to the site.
-- source is where on the site they signed up, and updates_consented_at is
-- when they joined the list. Nothing else about a person is stored: no IP
-- address, name or street address.

alter table public.expansion_signups
  add column scope text not null default 'area'
    check (scope in ('area', 'updates')),
  add column source text
    check (
      source in ('profile', 'race', 'ballot', 'saved', 'about', 'banner', 'page')
    ),
  add column updates_consented_at timestamptz,
  add constraint expansion_signups_updates_consent_check
    check (scope = 'area' or updates_consented_at is not null);

-- Adds someone to the email list, or moves an earlier sign-up onto it. The
-- first source and consent date are kept; the ZIP code is the latest one.
-- Always returns true, so callers can't tell new and existing addresses apart.
create function public.submit_signup(p_email text, p_zip text, p_source text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.expansion_signups as s
    (email, zip, scope, source, updates_consented_at)
  values (lower(p_email), p_zip, 'updates', p_source, now())
  on conflict (email) do update
    set zip = excluded.zip,
        source = case when s.scope = 'area' then excluded.source else s.source end,
        updates_consented_at = coalesce(s.updates_consented_at, now()),
        scope = 'updates',
        updated_at = now();
  return true;
end
$$;

revoke execute on function public.submit_signup(text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_signup(text, text, text)
  to service_role;
