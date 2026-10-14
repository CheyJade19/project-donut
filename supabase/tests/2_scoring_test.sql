-- Phase 2 checks: saving sheets from the scribe tablet (retries, offline
-- edits arriving late, two devices), and judge sign-off. Runs after
-- 1_rls_test.sql in the same session and reuses its users, test and helpers.

set role authenticated;

-- Organiser sets up a second class with two riders.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into classes (id, show_id, arena_id, test_id, name) values
  ('32000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001',
   '31000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Prelim Novice');
insert into class_judges (id, class_id, judge_id, scribe_id, position) values
  ('33000000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', 'C');
insert into entries (id, class_id, rider_name, horse_name, draw_order) values
  ('34000000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000002', 'Ann Able', 'Pickle', 1),
  ('34000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000002', 'Ben Bold', 'Rocket', 2);

-- Scribe saves a sheet. Saving the same thing again (a retry after a dropped
-- connection) leaves exactly one sheet with the same marks.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select save_score_sheet('{
  "entry_id": "34000000-0000-0000-0000-000000000002",
  "class_judge_id": "33000000-0000-0000-0000-000000000002",
  "status": "draft",
  "client_updated_at": "2026-11-01T09:00:00Z",
  "marks": [
    {"movement_id": "21000000-0000-0000-0000-000000000001", "mark": 6.5, "comment": "Crooked halt", "client_updated_at": "2026-11-01T09:00:00Z"},
    {"movement_id": "21000000-0000-0000-0000-000000000002", "mark": 7, "client_updated_at": "2026-11-01T09:00:00Z"}
  ]
}'::jsonb);
select save_score_sheet('{
  "entry_id": "34000000-0000-0000-0000-000000000002",
  "class_judge_id": "33000000-0000-0000-0000-000000000002",
  "status": "draft",
  "client_updated_at": "2026-11-01T09:00:00Z",
  "marks": [
    {"movement_id": "21000000-0000-0000-0000-000000000001", "mark": 6.5, "comment": "Crooked halt", "client_updated_at": "2026-11-01T09:00:00Z"},
    {"movement_id": "21000000-0000-0000-0000-000000000002", "mark": 7, "client_updated_at": "2026-11-01T09:00:00Z"}
  ]
}'::jsonb);
select pg_temp.expect(
  (select count(*) from score_sheets where entry_id = '34000000-0000-0000-0000-000000000002') = 1,
  'retried save keeps one sheet');
select pg_temp.expect(
  (select count(*) from movement_scores ms join score_sheets s on s.id = ms.sheet_id
    where s.entry_id = '34000000-0000-0000-0000-000000000002') = 2,
  'retried save keeps one mark per movement');

-- The judge corrects movement 2 on their own device at 09:05.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select save_score_sheet('{
  "entry_id": "34000000-0000-0000-0000-000000000002",
  "class_judge_id": "33000000-0000-0000-0000-000000000002",
  "status": "draft",
  "client_updated_at": "2026-11-01T09:05:00Z",
  "errors_of_course": 1,
  "marks": [
    {"movement_id": "21000000-0000-0000-0000-000000000002", "mark": 7.5, "client_updated_at": "2026-11-01T09:05:00Z"}
  ]
}'::jsonb);

-- The scribe's tablet was offline and now uploads an older edit (09:02) of
-- movement 2 plus the collective mark. The judge's newer mark must survive.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select save_score_sheet('{
  "entry_id": "34000000-0000-0000-0000-000000000002",
  "class_judge_id": "33000000-0000-0000-0000-000000000002",
  "status": "submitted",
  "client_updated_at": "2026-11-01T09:02:00Z",
  "errors_of_course": 0,
  "marks": [
    {"movement_id": "21000000-0000-0000-0000-000000000002", "mark": 5, "client_updated_at": "2026-11-01T09:02:00Z"},
    {"movement_id": "21000000-0000-0000-0000-000000000003", "mark": 8, "comment": "Lovely rhythm", "client_updated_at": "2026-11-01T09:02:00Z"}
  ]
}'::jsonb);
select pg_temp.expect(
  (select mark from movement_scores where movement_id = '21000000-0000-0000-0000-000000000002'
      and sheet_id = (select id from score_sheets where entry_id = '34000000-0000-0000-0000-000000000002')) = 7.5,
  'older offline edit does not overwrite a newer mark');
select pg_temp.expect(
  (select mark from movement_scores where movement_id = '21000000-0000-0000-0000-000000000003'
      and sheet_id = (select id from score_sheets where entry_id = '34000000-0000-0000-0000-000000000002')) = 8,
  'older upload still adds marks nobody else touched');
select pg_temp.expect(
  (select errors_of_course = 1 and status = 'submitted' from score_sheets
    where entry_id = '34000000-0000-0000-0000-000000000002'),
  'older header edit keeps the newer errors of course; status still moves to submitted');

-- Marks must still be whole or half.
do $$ begin
  perform save_score_sheet('{
    "entry_id": "34000000-0000-0000-0000-000000000003",
    "class_judge_id": "33000000-0000-0000-0000-000000000002",
    "marks": [{"movement_id": "21000000-0000-0000-0000-000000000001", "mark": 6.3}]
  }'::jsonb);
  raise exception 'FAILED: save accepted a 6.3';
exception when check_violation then raise notice 'ok: save rejects marks that are not whole or half';
end $$;
select pg_temp.expect(
  (select count(*) from score_sheets where entry_id = '34000000-0000-0000-0000-000000000003') = 0,
  'rejected save leaves nothing behind');

-- Scribes cannot sign, even through the save function.
do $$ begin
  perform save_score_sheet('{
    "entry_id": "34000000-0000-0000-0000-000000000002",
    "class_judge_id": "33000000-0000-0000-0000-000000000002",
    "status": "signed"
  }'::jsonb);
  raise exception 'FAILED: scribe signed through save_score_sheet';
exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: scribe cannot sign through save';
end $$;

-- Someone who is not on the panel cannot write a sheet.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
do $$ begin
  perform save_score_sheet('{
    "entry_id": "34000000-0000-0000-0000-000000000003",
    "class_judge_id": "33000000-0000-0000-0000-000000000002",
    "marks": []
  }'::jsonb);
  raise exception 'FAILED: outsider created a sheet';
exception when insufficient_privilege then raise notice 'ok: outsider cannot create a sheet';
end $$;

-- Judge signs; signing again (a retry) is harmless.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select save_score_sheet('{
  "entry_id": "34000000-0000-0000-0000-000000000002",
  "class_judge_id": "33000000-0000-0000-0000-000000000002",
  "status": "signed",
  "client_updated_at": "2026-11-01T09:10:00Z",
  "errors_of_course": 1,
  "general_comment": "Promising pair",
  "marks": []
}'::jsonb);
select save_score_sheet('{
  "entry_id": "34000000-0000-0000-0000-000000000002",
  "class_judge_id": "33000000-0000-0000-0000-000000000002",
  "status": "signed",
  "client_updated_at": "2026-11-01T09:10:00Z",
  "marks": []
}'::jsonb);
select pg_temp.expect(
  (select status = 'signed' and signed_by = '00000000-0000-0000-0000-00000000000b' and signed_at is not null
          and general_comment = 'Promising pair'
     from score_sheets where entry_id = '34000000-0000-0000-0000-000000000002'),
  'judge signs and the signature is recorded');

-- Once signed, a late upload from the scribe is refused, not silently lost.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
do $$ begin
  perform save_score_sheet('{
    "entry_id": "34000000-0000-0000-0000-000000000002",
    "class_judge_id": "33000000-0000-0000-0000-000000000002",
    "status": "submitted",
    "client_updated_at": "2026-11-01T09:20:00Z",
    "marks": [{"movement_id": "21000000-0000-0000-0000-000000000001", "mark": 10, "client_updated_at": "2026-11-01T09:20:00Z"}]
  }'::jsonb);
  raise exception 'FAILED: scribe changed a signed sheet';
exception when insufficient_privilege then raise notice 'ok: signed sheet refuses late scribe upload';
end $$;
select pg_temp.expect(
  (select mark from movement_scores where movement_id = '21000000-0000-0000-0000-000000000001'
      and sheet_id = (select id from score_sheets where entry_id = '34000000-0000-0000-0000-000000000002')) = 6.5,
  'signed marks unchanged');

-- Totals for the signed sheet: 6.5 + 7.5 + 8*2 = 30 of 40, less 2 for one error.
select pg_temp.expect(
  (select raw_points = 30 and max_points = 40 and error_penalty = 2
     from score_sheet_totals t join score_sheets s on s.id = t.sheet_id
    where s.entry_id = '34000000-0000-0000-0000-000000000002'),
  'signed sheet totals');

-- An organiser can reopen a signed sheet, which clears the signature.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update score_sheets set status = 'submitted' where entry_id = '34000000-0000-0000-0000-000000000002';
select pg_temp.expect(
  (select signed_at is null and signed_by is null from score_sheets
    where entry_id = '34000000-0000-0000-0000-000000000002'),
  'reopening clears the signature');

reset role;
