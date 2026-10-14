-- Phase 3: live leaderboard, rider results and publishing controls.
--
-- Organisers choose, per class:
--   leaderboard_public  everyone signed in sees placings and percentages as
--                       sheets are signed (no marks or comments);
--   results_published   riders see their own signed sheets, marks and
--                       comments (set now, or automatically at
--                       results_publish_at).
-- Organisers and the class's judges and scribes always see the leaderboard.

alter table public.classes
  add column leaderboard_public boolean not null default false,
  add column results_publish_at timestamptz,
  -- Bumped whenever the leaderboard changes, so apps listening for changes to
  -- this row (realtime) know to reload it.
  add column results_updated_at timestamptz not null default now();

-- Results are public once published, or once the scheduled time has passed.
create function public.class_results_public(target_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.results_published or (c.results_publish_at is not null and c.results_publish_at <= now())
       from public.classes c where c.id = target_class),
    false);
$$;

create function public.can_view_leaderboard(target_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_club_organiser(public.class_club(target_class))
      or exists (select 1 from public.class_judges cj
                  where cj.class_id = target_class and auth.uid() in (cj.judge_id, cj.scribe_id))
      or exists (select 1 from public.classes c
                  where c.id = target_class and c.leaderboard_public)
      or public.class_results_public(target_class);
$$;

-- Riders see only signed sheets, and only once results are public.
create or replace function public.can_read_sheet(target_sheet uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.score_sheets s
      join public.class_judges cj on cj.id = s.class_judge_id
      join public.entries e on e.id = s.entry_id
      join public.classes c on c.id = cj.class_id
     where s.id = target_sheet
       and (auth.uid() in (cj.judge_id, cj.scribe_id)
            or public.is_club_organiser(public.class_club(c.id))
            or (s.status = 'signed' and e.rider_id = auth.uid()
                and public.class_results_public(c.id)))
  );
$$;

-- ---------------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------------

-- One row per entry. Only signed sheets count. With several judges the
-- percentage is the average of the judges' percentages; ties are split on
-- collective marks, then share the placing. Eliminated (by any judge) and
-- withdrawn riders are not placed.
--
-- judges: [{ class_judge_id, position, judge_name, status, final_points,
--            percentage, eliminated }] in position order; the numbers are
-- null until that judge has signed.
create function public.class_leaderboard(target_class uuid)
returns table (
  entry_id uuid,
  draw_order int,
  rider_name text,
  horse_name text,
  rider_id uuid,
  withdrawn boolean,
  judges jsonb,
  judges_signed int,
  judges_total int,
  average_percentage numeric,
  total_points numeric,
  collective_points numeric,
  eliminated boolean,
  is_final boolean,
  place int
)
language sql
stable
security definer
set search_path = public
as $$
  with cls as (
    select c.id, c.test_id, t.error_penalties,
           (select sum(m.max_mark * m.coefficient) from test_movements m where m.test_id = c.test_id) as max_points
      from classes c join test_templates t on t.id = c.test_id
     where c.id = target_class and public.can_view_leaderboard(target_class)
  ),
  panel as (
    select cj.id, cj.position, coalesce(nullif(p.full_name, ''), 'Judge') as judge_name
      from class_judges cj join cls on cls.id = cj.class_id
      left join profiles p on p.id = cj.judge_id
  ),
  sheet as (
    select s.id, s.entry_id, s.class_judge_id, s.status,
           s.errors_of_course, s.other_deductions,
           coalesce(sum(ms.mark * m.coefficient), 0) as raw_points,
           coalesce(sum(ms.mark * m.coefficient) filter (where m.is_collective), 0) as collective_points,
           s.eliminated or s.errors_of_course > coalesce(array_length(cls.error_penalties, 1), 0) as eliminated,
           case when s.errors_of_course = 0
                  or s.errors_of_course > coalesce(array_length(cls.error_penalties, 1), 0) then 0
                else (select sum(p) from unnest(cls.error_penalties[1:s.errors_of_course]) as p)
           end as error_penalty,
           cls.max_points
      from score_sheets s
      join panel on panel.id = s.class_judge_id
      cross join cls
      left join movement_scores ms on ms.sheet_id = s.id
      left join test_movements m on m.id = ms.movement_id
     group by s.id, cls.error_penalties, cls.max_points
  ),
  scored as (
    select sheet.*,
           case when sheet.status <> 'signed' then null
                when sheet.eliminated then 0
                else greatest(0, sheet.raw_points - sheet.error_penalty - sheet.other_deductions) end as final_points
      from sheet
  ),
  scored_pct as (
    select scored.*,
           case when status <> 'signed' or eliminated or coalesce(max_points, 0) = 0 then null
                else round(final_points / max_points * 100, 3) end as percentage
      from scored
  ),
  per_entry as (
    select e.id as entry_id, e.draw_order, e.rider_name, e.horse_name, e.rider_id, e.withdrawn,
           coalesce(jsonb_agg(jsonb_build_object(
             'class_judge_id', panel.id,
             'position', panel.position,
             'judge_name', panel.judge_name,
             'status', coalesce(sp.status::text, 'not_started'),
             'final_points', sp.final_points,
             'percentage', sp.percentage,
             'eliminated', sp.status = 'signed' and sp.eliminated
           ) order by panel.position) filter (where panel.id is not null), '[]'::jsonb) as judges,
           count(sp.id) filter (where sp.status = 'signed')::int as judges_signed,
           count(panel.id)::int as judges_total,
           round(avg(sp.percentage) filter (where sp.status = 'signed' and not sp.eliminated), 3) as average_percentage,
           sum(sp.final_points) filter (where sp.status = 'signed') as total_points,
           avg(sp.collective_points) filter (where sp.status = 'signed') as collective_points,
           coalesce(bool_or(sp.eliminated) filter (where sp.status = 'signed'), false) as eliminated
      from entries e
      join cls on cls.id = e.class_id
      left join panel on true
      left join scored_pct sp on sp.entry_id = e.id and sp.class_judge_id = panel.id
     group by e.id
  )
  select pe.entry_id, pe.draw_order, pe.rider_name, pe.horse_name, pe.rider_id, pe.withdrawn,
         pe.judges, pe.judges_signed, pe.judges_total,
         case when pe.eliminated then null else pe.average_percentage end,
         pe.total_points,
         round(pe.collective_points, 3),
         pe.eliminated,
         pe.judges_total > 0 and pe.judges_signed = pe.judges_total,
         case when placeable then rank() over (
                partition by placeable
                order by pe.average_percentage desc, pe.collective_points desc)::int
         end as place
    from per_entry pe,
         lateral (select not pe.withdrawn and not pe.eliminated and pe.average_percentage is not null as placeable) x
   order by place nulls last, pe.withdrawn, pe.eliminated, pe.draw_order nulls last, pe.rider_name;
$$;

-- The signed-in rider's own placings in classes whose results are public.
create function public.my_results()
returns table (
  entry_id uuid,
  class_id uuid,
  place int,
  average_percentage numeric,
  eliminated boolean,
  is_final boolean,
  placed_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select lb.entry_id, c.id, lb.place, lb.average_percentage, lb.eliminated, lb.is_final,
         (select count(*) from public.class_leaderboard(c.id) all_rows where all_rows.place is not null)::int
    from public.classes c
    cross join lateral public.class_leaderboard(c.id) lb
   where public.class_results_public(c.id)
     and exists (select 1 from public.entries e where e.class_id = c.id and e.rider_id = auth.uid())
     and lb.rider_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Live updates
-- ---------------------------------------------------------------------------

-- Bump classes.results_updated_at whenever something on the leaderboard
-- changes: a sheet is signed or reopened, a signed sheet changes, or a rider
-- is withdrawn. Apps subscribe to the class row (riders and the public cannot
-- read unsigned sheets, so they cannot subscribe to the sheets themselves).
create function public.touch_class_results()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class uuid;
begin
  if tg_table_name = 'score_sheets' then
    if (tg_op <> 'DELETE' and new.status = 'signed') or (tg_op <> 'INSERT' and old.status = 'signed') then
      select class_id into v_class from class_judges
       where id = case when tg_op = 'DELETE' then old.class_judge_id else new.class_judge_id end;
    end if;
  elsif tg_table_name = 'entries' then
    if tg_op = 'UPDATE' and (new.withdrawn is distinct from old.withdrawn
                             or new.rider_name is distinct from old.rider_name
                             or new.horse_name is distinct from old.horse_name) then
      v_class := new.class_id;
    end if;
  end if;

  if v_class is not null then
    update classes set results_updated_at = now() where id = v_class;
  end if;
  return null;
end;
$$;

create trigger score_sheets_touch_results after insert or update or delete on public.score_sheets
  for each row execute function public.touch_class_results();
create trigger entries_touch_results after update on public.entries
  for each row execute function public.touch_class_results();

alter publication supabase_realtime add table public.classes;
