-- PostgREST roles and the grants Supabase sets up by default, for the
-- end-to-end tests on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'authenticator' noinherit;
  end if;
end $$;
grant anon, authenticated to authenticator;
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
