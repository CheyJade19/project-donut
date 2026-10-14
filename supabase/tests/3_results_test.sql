-- Phase 3 checks: the leaderboard (multi-judge averaging, ties, provisional,
-- eliminated and withdrawn riders), who can see it, publishing riders'
-- sheets now or at a set time, and the live-update stamp. Runs after the
-- earlier checks in the same session and reuses their users, test and helpers.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000f', 'judge2@example.com', '{"full_name":"Jill Judge","roles":["judge"]}'),
  ('00000000-0000-0000-0000-000000000010', 'rider2@example.com', '{"full_name":"Gail Rider"}'),
  ('00000000-0000-0000-0000-000000000011', 'rider3@example.com', '{"full_name":"Hal Rider"}');

set role authenticated;

-- Saves one judge's sheet with marks for movements 1, 2 and 3 (collective, x2).
create or replace function pg_temp.sheet(entry uuid, panel uuid, m1 numeric, m2 numeric, m3 numeric,
                                         errors int default 0, status text default 'signed')
returns void language plpgsql as $$
begin
  perform save_score_sheet(jsonb_build_object(
    'entry_id', entry, 'class_judge_id', panel, 'status', status, 'errors_of_course', errors,
    'marks', jsonb_build_array(
      jsonb_build_object('movement_id', '21000000-0000-0000-0000-000000000001', 'mark', m1),
      jsonb_build_object('movement_id', '21000000-0000-0000-0000-000000000002', 'mark', m2),
      jsonb_build_object('movement_id', '21000000-0000-0000-0000-000000000003', 'mark', m3))));
end $$;

-- Organiser sets up a two-judge class.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into classes (id, show_id, arena_id, test_id, name) values
  ('32000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001',
   '31000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Prelim Championship');
insert into class_judges (id, class_id, judge_id, scribe_id, position) values
  ('33000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', 'C'),
  ('33000000-0000-0000-0000-000000000004', '32000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-00000000000f', null, 'E');
insert into entries (id, class_id, rider_id, rider_name, horse_name, draw_order, withdrawn) values
  ('35000000-0000-0000-0000-00000000000a', '32000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000d', 'Rita Rider', 'Biscuit', 1, false),
  ('35000000-0000-0000-0000-00000000000b', '32000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000010', 'Gail Rider', 'Rocket', 2, false),
  ('35000000-0000-0000-0000-00000000000c', '32000000-0000-0000-0000-000000000003', null, 'Cara Calm', 'Pickle', 3, false),
  ('35000000-0000-0000-0000-00000000000d', '32000000-0000-0000-0000-000000000003', null, 'Dee Dawson', 'Toffee', 4, false),
  ('35000000-0000-0000-0000-00000000000e', '32000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000011', 'Hal Rider', 'Moss', 5, false),
  ('35000000-0000-0000-0000-00000000000f', '32000000-0000-0000-0000-000000000003', null, 'Fay Fall', 'Bramble', 6, false),
  ('35000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000003', null, 'Gus Gone', 'Hazel', 7, true);

\set cls '\'32000000-0000-0000-0000-000000000003\''
select results_updated_at as stamp_before from classes where id = :cls \gset

-- Judge at C (marks out of 40; movement 3 counts double).
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.sheet('35000000-0000-0000-0000-00000000000a', '33000000-0000-0000-0000-000000000003', 5, 5, 9);   -- 28 = 70%
select pg_temp.sheet('35000000-0000-0000-0000-00000000000b', '33000000-0000-0000-0000-000000000003', 6, 7, 6);   -- 25 = 62.5%
select pg_temp.sheet('35000000-0000-0000-0000-00000000000c', '33000000-0000-0000-0000-000000000003', 7, 7, 6);   -- 26 = 65%
select pg_temp.sheet('35000000-0000-0000-0000-00000000000d', '33000000-0000-0000-0000-000000000003', 7, 7, 6);   -- 26 = 65%
select pg_temp.sheet('35000000-0000-0000-0000-00000000000e', '33000000-0000-0000-0000-000000000003', 5, 5, 5);   -- 20 = 50%
select pg_temp.sheet('35000000-0000-0000-0000-00000000000f', '33000000-0000-0000-0000-000000000003', 6, 6, 6, 3); -- 3 errors: eliminated

-- Judge at E. Rider E's sheet is still with the judge (not signed).
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select pg_temp.sheet('35000000-0000-0000-0000-00000000000a', '33000000-0000-0000-0000-000000000004', 4, 4, 8);   -- 24 = 60%
select pg_temp.sheet('35000000-0000-0000-0000-00000000000b', '33000000-0000-0000-0000-000000000004', 8, 6, 7);   -- 28 = 70%
select pg_temp.sheet('35000000-0000-0000-0000-00000000000c', '33000000-0000-0000-0000-000000000004', 7, 7, 6);   -- 26 = 65%
select pg_temp.sheet('35000000-0000-0000-0000-00000000000d', '33000000-0000-0000-0000-000000000004', 7, 7, 6);   -- 26 = 65%
select pg_temp.sheet('35000000-0000-0000-0000-00000000000e', '33000000-0000-0000-0000-000000000004', 9, 9, 9, 0, 'submitted');
select pg_temp.sheet('35000000-0000-0000-0000-00000000000f', '33000000-0000-0000-0000-000000000004', 6, 6, 6);

select pg_temp.expect(
  (select results_updated_at > :'stamp_before'::timestamptz from classes where id = :cls),
  'signing a sheet bumps the class results stamp');

-- The judges see the leaderboard straight away.
create temp table lb as select * from class_leaderboard(:cls);
select pg_temp.expect((select count(*) from lb) = 7, 'leaderboard lists every entry');
select pg_temp.expect(
  (select place = 1 and average_percentage = 66.25 and total_points = 53 and is_final
     from lb where horse_name = 'Rocket'),
  'two judges are averaged: (62.5 + 70) / 2 = 66.25, 1st');
select pg_temp.expect(
  (select place = 2 and average_percentage = 65 and collective_points = 17 from lb where horse_name = 'Biscuit'),
  'a tie on 65% goes to the higher collective marks');
select pg_temp.expect(
  (select array_agg(place order by draw_order) = '{3,3}' from lb where horse_name in ('Pickle', 'Toffee')),
  'riders still tied after collective marks share the placing');
select pg_temp.expect(
  (select place = 5 and average_percentage = 50 and not is_final and judges_signed = 1 and judges_total = 2
     from lb where horse_name = 'Moss'),
  'a rider with only some sheets signed is shown provisionally on those');
select pg_temp.expect(
  (select (judges -> 1 ->> 'status') = 'submitted' and (judges -> 1 -> 'percentage') = 'null'::jsonb
     from lb where horse_name = 'Moss'),
  'an unsigned sheet shows its status but no score');
select pg_temp.expect(
  (select eliminated and place is null and average_percentage is null from lb where horse_name = 'Bramble'),
  'eliminated by any judge: not placed');
select pg_temp.expect(
  (select withdrawn and place is null from lb where horse_name = 'Hazel'),
  'withdrawn: not placed');
select pg_temp.expect(
  (select array_agg(horse_name order by ord) = '{Rocket,Biscuit,Pickle,Toffee,Moss,Bramble,Hazel}'
     from (select horse_name, row_number() over () as ord from class_leaderboard(:cls)) x),
  'leaderboard is in placing order, then riders still to score, eliminated, withdrawn');
select pg_temp.expect(
  (select judges -> 0 ->> 'judge_name' = 'Jude Judge' and judges -> 1 ->> 'position' = 'E'
          and (judges -> 1 ->> 'percentage')::numeric = 70
     from lb where horse_name = 'Rocket'),
  'each judge''s percentage is listed by position');
drop table lb;

-- Riders and the public see nothing until the organiser opens it up.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect((select count(*) from class_leaderboard(:cls)) = 0, 'leaderboard hidden from the public by default');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect((select count(*) from my_results() where class_id = :cls) = 0, 'no results for the rider before publishing');

-- Only an organiser can change publishing.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
update classes set leaderboard_public = true where id = :cls;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect((select count(*) from class_leaderboard(:cls)) = 0, 'a scribe cannot open the leaderboard');

-- Live scoreboard on: everyone sees placings, but not the sheets.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update classes set leaderboard_public = true where id = :cls;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect((select count(*) from class_leaderboard(:cls)) = 7, 'live scoreboard visible to everyone');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect(
  (select count(*) from score_sheets s join entries e on e.id = s.entry_id where e.class_id = :cls) = 0,
  'live scoreboard does not open the sheets');

-- Results scheduled for a time that has passed are public.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update classes set leaderboard_public = false, results_publish_at = now() + interval '1 hour' where id = :cls;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect(
  (select count(*) from score_sheets s join entries e on e.id = s.entry_id where e.class_id = :cls) = 0,
  'scheduled results stay hidden until the time');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update classes set results_publish_at = now() - interval '1 minute' where id = :cls;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect(
  (select count(*) from score_sheets s join entries e on e.id = s.entry_id where e.class_id = :cls) = 2,
  'rider sees both judges'' sheets once the scheduled time has passed');
select pg_temp.expect(
  (select count(*) from movement_scores ms join score_sheets s on s.id = ms.sheet_id
     join entries e on e.id = s.entry_id where e.class_id = :cls) = 6,
  'rider sees each judge''s marks');
select pg_temp.expect(
  (select place = 2 and average_percentage = 65 and is_final and placed_count = 5
     from my_results() where class_id = :cls),
  'my results: 2nd of 5 placed');
select pg_temp.expect((select count(*) from class_leaderboard(:cls)) = 7, 'published results show the leaderboard');

-- A provisional rider sees only the signed sheet.
select pg_temp.act_as('00000000-0000-0000-0000-000000000011');
select pg_temp.expect(
  (select array_agg(status) = '{signed}' from score_sheets s join entries e on e.id = s.entry_id where e.class_id = :cls),
  'riders never see an unsigned sheet');

-- Withdrawing a rider also bumps the stamp.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select results_updated_at as stamp_before from classes where id = :cls \gset
update entries set withdrawn = true where id = '35000000-0000-0000-0000-00000000000d';
select pg_temp.expect(
  (select results_updated_at > :'stamp_before'::timestamptz from classes where id = :cls),
  'withdrawing a rider bumps the class results stamp');
select pg_temp.expect(
  (select place from class_leaderboard(:cls) where horse_name = 'Moss') = 4,
  'placings close up after a withdrawal');

reset role;
