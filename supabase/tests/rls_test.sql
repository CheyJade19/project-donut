-- Scenario checks for roles and row level security. Run after auth_stub.sql
-- and the migrations (see supabase/tests/run.sh). Any failed check raises.

-- Supabase grants these by default; plain Postgres needs them spelled out.
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

create or replace function pg_temp.act_as(who uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), false);
end $$;

create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', label; end if;
  raise notice 'ok: %', label;
end $$;

-- Users sign up with roles in their metadata.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'org@example.com',    '{"full_name":"Olive Organiser","roles":["rider"]}'),
  ('00000000-0000-0000-0000-00000000000b', 'judge@example.com',  '{"full_name":"Jude Judge","roles":["judge"]}'),
  ('00000000-0000-0000-0000-00000000000c', 'scribe@example.com', '{"full_name":"Sam Scribe","roles":["scribe"]}'),
  ('00000000-0000-0000-0000-00000000000d', 'rider@example.com',  '{"full_name":"Rita Rider"}'),
  ('00000000-0000-0000-0000-00000000000e', 'other@example.com',  '{"full_name":"Otto Other","roles":["rider","bogus"]}');

select pg_temp.expect(
  (select roles from profiles where id = '00000000-0000-0000-0000-00000000000b') = '{judge}',
  'profile created with requested role');
select pg_temp.expect(
  (select roles from profiles where id = '00000000-0000-0000-0000-00000000000d') = '{rider}',
  'profile defaults to rider');
select pg_temp.expect(
  (select roles from profiles where id = '00000000-0000-0000-0000-00000000000e') = '{rider}',
  'unknown roles are ignored');

set role authenticated;

-- Organiser creates a club, a test, a show, a class, judge + entry.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into clubs (id, name) values ('10000000-0000-0000-0000-000000000001', 'Riverside Pony Club');
select pg_temp.expect(public.is_club_organiser('10000000-0000-0000-0000-000000000001'),
  'club creator becomes organiser');
select pg_temp.expect((select 'organiser' = any (roles) from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'club creator gets organiser role on profile');

insert into test_templates (id, club_id, name, level, arena_size)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        'Prelim Test 1', 'Prelim', '20x40');
insert into test_movements (id, test_id, number, markers, description, coefficient, is_collective) values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 'A X C', 'Enter working trot, halt, salute', 1, false),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 2, 'C', 'Track right', 1, false),
  ('21000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 3, null, 'Paces', 2, true);

insert into shows (id, club_id, name, show_date) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Spring Dressage', '2026-11-01');
insert into arenas (id, show_id, name) values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Arena 1');
insert into classes (id, show_id, arena_id, test_id, name) values
  ('32000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   '31000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Prelim Open');
insert into class_judges (id, class_id, judge_id, scribe_id, position) values
  ('33000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', 'C');
insert into entries (id, class_id, rider_id, rider_name, horse_name, draw_order) values
  ('34000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000d', 'Rita Rider', 'Biscuit', 1);

-- A non-organiser cannot change the show or the club's tests.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
update shows set name = 'Hacked' where id = '30000000-0000-0000-0000-000000000001';
update test_movements set coefficient = 5 where test_id = '20000000-0000-0000-0000-000000000001';
select pg_temp.expect((select name from shows where id = '30000000-0000-0000-0000-000000000001') = 'Spring Dressage',
  'non-organiser cannot edit show');
select pg_temp.expect((select max(coefficient) from test_movements where test_id = '20000000-0000-0000-0000-000000000001') = 2,
  'non-organiser cannot edit club test');
select pg_temp.expect((select count(*) from test_templates) = 1, 'test library readable by everyone');

-- Anyone can add a personal test to the library.
insert into test_templates (id, name) values ('20000000-0000-0000-0000-000000000002', 'My practice test');
select pg_temp.expect((select created_by from test_templates where id = '20000000-0000-0000-0000-000000000002')
  = '00000000-0000-0000-0000-00000000000e', 'personal test owned by creator');

-- Scribe fills in the sheet.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
insert into score_sheets (id, entry_id, class_judge_id) values
  ('40000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001');
insert into movement_scores (sheet_id, movement_id, mark, comment) values
  ('40000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 6.5, 'Crooked halt'),
  ('40000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000002', 7, null),
  ('40000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000003', 7.5, 'Lovely rhythm');
update score_sheets set errors_of_course = 1 where id = '40000000-0000-0000-0000-000000000001';

do $$ begin
  insert into movement_scores (sheet_id, movement_id, mark)
  values ('40000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 6.3);
  raise exception 'FAILED: non half-mark accepted';
exception when check_violation then raise notice 'ok: marks must be whole or half';
end $$;

do $$ begin
  update score_sheets set status = 'signed' where id = '40000000-0000-0000-0000-000000000001';
  raise exception 'FAILED: scribe signed sheet';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: scribe cannot sign';
end $$;

-- Rider cannot see the sheet until results are published.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect((select count(*) from score_sheets) = 0, 'rider cannot see unpublished sheet');
select pg_temp.expect((select count(*) from movement_scores) = 0, 'rider cannot see unpublished marks');

-- Judge signs.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
update score_sheets set status = 'signed' where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.expect((select signed_at is not null from score_sheets where id = '40000000-0000-0000-0000-000000000001'),
  'judge can sign');

-- Signed sheets are locked for the scribe.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
update movement_scores set mark = 10 where sheet_id = '40000000-0000-0000-0000-000000000001';
select pg_temp.expect((select max(mark) from movement_scores) = 7.5, 'signed sheet locked for scribe');

-- Organiser publishes; rider now sees marks and comments.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update classes set results_published = true where id = '32000000-0000-0000-0000-000000000001';

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect((select count(*) from movement_scores) = 3, 'rider sees published marks');

-- Other riders still cannot see someone else's sheet.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect((select count(*) from score_sheets) = 0, 'other rider cannot see sheet');

-- Totals: 6.5 + 7 + 7.5*2 = 28.5 of 40, one error of course = 2 penalty.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect(
  (select raw_points = 28.5 and max_points = 40 and error_penalty = 2 and not is_eliminated
     from score_sheet_totals where sheet_id = '40000000-0000-0000-0000-000000000001'),
  'sheet totals');

reset role;
