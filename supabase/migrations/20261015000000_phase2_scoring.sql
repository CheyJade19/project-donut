-- Phase 2: scribe scoring with offline sync, judge sign-off.
--
-- Tablets save whole sheets through save_score_sheet(), which is safe to
-- retry: the sheet is found by (entry, judge) rather than by an id the device
-- made up, and each mark carries the time it was entered on the device so an
-- older queued edit never overwrites a newer one from another device.

alter table public.score_sheets
  add column signed_by uuid references public.profiles (id),
  add column client_updated_at timestamptz;

alter table public.movement_scores
  add column client_updated_at timestamptz;

-- Record who signed, and clear the signature if an organiser reopens a sheet.
create or replace function public.guard_sheet_signing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cj public.class_judges;
begin
  if new.status = 'signed' and (tg_op = 'INSERT' or old.status is distinct from 'signed') then
    select * into cj from public.class_judges where id = new.class_judge_id;
    if auth.uid() is distinct from cj.judge_id
       and not public.is_club_organiser(public.class_club(cj.class_id)) then
      raise exception 'Only the judge can sign this score sheet';
    end if;
    new.signed_at = coalesce(new.signed_at, now());
    new.signed_by = auth.uid();
  elsif new.status <> 'signed' then
    new.signed_at = null;
    new.signed_by = null;
  end if;
  return new;
end;
$$;

-- Saves one sheet and its marks in a single transaction.
--
-- sheet = {
--   entry_id, class_judge_id, status ('draft' | 'submitted' | 'signed'),
--   errors_of_course, other_deductions, eliminated, general_comment,
--   client_updated_at,
--   marks: [{ movement_id, mark, comment, client_updated_at }]
-- }
--
-- Runs with the caller's rights, so the usual row level security applies:
-- only the class judge, their scribe or a club organiser can save, and a
-- signed sheet is locked except for organisers.
create function public.save_score_sheet(sheet jsonb)
returns public.score_sheets
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry uuid := (sheet ->> 'entry_id')::uuid;
  v_judge uuid := (sheet ->> 'class_judge_id')::uuid;
  v_status public.sheet_status := coalesce(sheet ->> 'status', 'draft')::public.sheet_status;
  v_stamp timestamptz := coalesce((sheet ->> 'client_updated_at')::timestamptz, now());
  existing public.score_sheets;
  result public.score_sheets;
  v_id uuid;
begin
  select * into existing from public.score_sheets
   where entry_id = v_entry and class_judge_id = v_judge;

  -- A retry of a signature that already went through.
  if existing.status = 'signed' and v_status = 'signed' then
    return existing;
  end if;

  -- No RETURNING below: the read policy looks the sheet up by id, which a
  -- statement cannot see in its own new rows.
  if existing.id is null then
    v_id := gen_random_uuid();
    insert into public.score_sheets
      (id, entry_id, class_judge_id, status, errors_of_course, other_deductions, eliminated,
       general_comment, client_updated_at)
    values
      (v_id, v_entry, v_judge, 'draft',
       coalesce((sheet ->> 'errors_of_course')::int, 0),
       coalesce((sheet ->> 'other_deductions')::numeric, 0),
       coalesce((sheet ->> 'eliminated')::boolean, false),
       sheet ->> 'general_comment',
       v_stamp);
  else
    v_id := existing.id;
    -- Marks go in before the sheet is signed, so open it for writing first.
    -- Header fields only change when this edit is the newer one.
    update public.score_sheets s
       set status = case when s.status = 'signed' then 'submitted' else s.status end,
           errors_of_course = case when s.client_updated_at is null or v_stamp >= s.client_updated_at
                                   then coalesce((sheet ->> 'errors_of_course')::int, 0) else s.errors_of_course end,
           other_deductions = case when s.client_updated_at is null or v_stamp >= s.client_updated_at
                                   then coalesce((sheet ->> 'other_deductions')::numeric, 0) else s.other_deductions end,
           eliminated = case when s.client_updated_at is null or v_stamp >= s.client_updated_at
                             then coalesce((sheet ->> 'eliminated')::boolean, false) else s.eliminated end,
           general_comment = case when s.client_updated_at is null or v_stamp >= s.client_updated_at
                                  then sheet ->> 'general_comment' else s.general_comment end,
           client_updated_at = greatest(s.client_updated_at, v_stamp)
     where s.id = existing.id;

    -- Row level security skips the row instead of raising.
    if not found then
      raise exception 'This score sheet is signed and locked'
        using errcode = '42501';
    end if;
  end if;

  insert into public.movement_scores as ms (sheet_id, movement_id, mark, comment, client_updated_at)
  select v_id,
         (m ->> 'movement_id')::uuid,
         (m ->> 'mark')::numeric,
         nullif(m ->> 'comment', ''),
         coalesce((m ->> 'client_updated_at')::timestamptz, v_stamp)
    from jsonb_array_elements(coalesce(sheet -> 'marks', '[]'::jsonb)) as m
  on conflict (sheet_id, movement_id) do update
     set mark = excluded.mark,
         comment = excluded.comment,
         client_updated_at = excluded.client_updated_at
   where ms.client_updated_at is null or excluded.client_updated_at >= ms.client_updated_at;

  -- Signing is checked by guard_sheet_signing (judge or organiser only).
  update public.score_sheets
     set status = v_status
   where id = v_id and status is distinct from v_status;

  select * into result from public.score_sheets where id = v_id;
  return result;
end;
$$;
