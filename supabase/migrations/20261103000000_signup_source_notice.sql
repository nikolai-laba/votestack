-- Sign-ups can come from the after-election notice under the header.
alter table public.expansion_signups
  drop constraint expansion_signups_source_check,
  add constraint expansion_signups_source_check check (
    source in ('profile', 'race', 'ballot', 'saved', 'about', 'banner', 'page', 'notice')
  );
