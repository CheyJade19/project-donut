-- Phase 1 foundations: profiles and roles, clubs, the dressage test library,
-- shows/classes/arenas, entries, and digital score sheets.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('organiser', 'judge', 'scribe', 'rider');
create type public.show_status as enum ('draft', 'open', 'live', 'closed');
create type public.sheet_status as enum ('draft', 'submitted', 'signed');
-- Standard dressage judge positions around the arena.
create type public.judge_position as enum ('C', 'E', 'H', 'M', 'B', 'K', 'F', 'A');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  -- Which parts of the app this person uses. Organiser rights over a specific
  -- club come from club_members, not from this list.
  roles public.app_role[] not null default '{rider}',
  judge_level text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create a profile whenever someone signs up. Sign-up metadata may carry
-- full_name and roles (judge, scribe, rider; organiser is granted per club).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested public.app_role[];
begin
  select coalesce(array_agg(r::public.app_role), '{rider}')
    into requested
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data -> 'roles', '[]'::jsonb)) as r
   where r in ('judge', 'scribe', 'rider', 'organiser');

  insert into public.profiles (id, full_name, roles)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), requested);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Clubs and membership
-- ---------------------------------------------------------------------------

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (club_id, user_id, role)
);

create function public.is_club_organiser(target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
     where club_id = target_club and user_id = auth.uid() and role = 'organiser'
  );
$$;

-- Whoever creates a club becomes its first organiser.
create function public.handle_new_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.club_members (club_id, user_id, role)
  values (new.id, new.created_by, 'organiser');
  update public.profiles
     set roles = array_append(roles, 'organiser')
   where id = new.created_by and not ('organiser' = any (roles));
  return new;
end;
$$;

create trigger on_club_created
  after insert on public.clubs
  for each row execute function public.handle_new_club();

-- ---------------------------------------------------------------------------
-- Test library
-- ---------------------------------------------------------------------------

create table public.test_templates (
  id uuid primary key default gen_random_uuid(),
  -- Null club means a personal test owned by its creator.
  club_id uuid references public.clubs (id) on delete set null,
  name text not null,
  code text,
  level text,
  discipline text not null default 'dressage',
  arena_size text check (arena_size in ('20x40', '20x60')),
  -- Penalty for the 1st, 2nd, ... error of course; one more error eliminates.
  error_penalties numeric[] not null default '{2,4}',
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger test_templates_touch before update on public.test_templates
  for each row execute function public.touch_updated_at();

create table public.test_movements (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.test_templates (id) on delete cascade,
  number int not null check (number > 0),
  markers text,
  description text not null,
  directive_ideas text,
  coefficient int not null default 1 check (coefficient between 1 and 5),
  max_mark numeric not null default 10 check (max_mark > 0),
  is_collective boolean not null default false,
  unique (test_id, number)
);

create function public.can_edit_test(target_test uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.test_templates t
     where t.id = target_test
       and (t.created_by = auth.uid()
            or (t.club_id is not null and public.is_club_organiser(t.club_id)))
  );
$$;

-- ---------------------------------------------------------------------------
-- Shows, arenas, classes, judges
-- ---------------------------------------------------------------------------

create table public.shows (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  venue text,
  show_date date not null,
  status public.show_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table public.arenas (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows (id) on delete cascade,
  name text not null,
  size text check (size in ('20x40', '20x60'))
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows (id) on delete cascade,
  arena_id uuid references public.arenas (id) on delete set null,
  test_id uuid not null references public.test_templates (id),
  name text not null,
  start_time timestamptz,
  results_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.class_judges (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  judge_id uuid not null references public.profiles (id),
  scribe_id uuid references public.profiles (id),
  position public.judge_position not null default 'C',
  unique (class_id, judge_id),
  unique (class_id, position)
);

create function public.class_club(target_class uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.club_id from public.classes c join public.shows s on s.id = c.show_id
   where c.id = target_class;
$$;

-- ---------------------------------------------------------------------------
-- Entries and score sheets
-- ---------------------------------------------------------------------------

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  -- Set when the rider has an account; rider_name always holds the display name.
  rider_id uuid references public.profiles (id),
  rider_name text not null,
  horse_name text not null,
  draw_order int,
  start_time timestamptz,
  withdrawn boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.score_sheets (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  class_judge_id uuid not null references public.class_judges (id) on delete cascade,
  status public.sheet_status not null default 'draft',
  errors_of_course int not null default 0 check (errors_of_course >= 0),
  other_deductions numeric not null default 0 check (other_deductions >= 0),
  eliminated boolean not null default false,
  general_comment text,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, class_judge_id)
);

create trigger score_sheets_touch before update on public.score_sheets
  for each row execute function public.touch_updated_at();

create table public.movement_scores (
  sheet_id uuid not null references public.score_sheets (id) on delete cascade,
  movement_id uuid not null references public.test_movements (id) on delete cascade,
  -- Half marks allowed.
  mark numeric check (mark >= 0 and mark <= 10 and mod(mark * 2, 1) = 0),
  comment text,
  updated_at timestamptz not null default now(),
  primary key (sheet_id, movement_id)
);

create trigger movement_scores_touch before update on public.movement_scores
  for each row execute function public.touch_updated_at();

-- Only the judge (or a club organiser) can sign a sheet; scribes prepare it.
create function public.guard_sheet_signing()
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
  end if;
  return new;
end;
$$;

create trigger score_sheets_guard_signing before insert or update on public.score_sheets
  for each row execute function public.guard_sheet_signing();

-- A mark must be for a movement of the test the class is riding.
create function public.check_movement_matches_test()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
      from public.score_sheets s
      join public.class_judges cj on cj.id = s.class_judge_id
      join public.classes c on c.id = cj.class_id
      join public.test_movements m on m.test_id = c.test_id
     where s.id = new.sheet_id and m.id = new.movement_id
  ) then
    raise exception 'Movement does not belong to this class''s test';
  end if;
  return new;
end;
$$;

create trigger movement_scores_match_test before insert or update on public.movement_scores
  for each row execute function public.check_movement_matches_test();

-- Who may write a sheet: its judge or scribe while unsigned, or a club organiser.
create function public.can_write_sheet(target_sheet uuid)
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
     where s.id = target_sheet
       and ((s.status <> 'signed' and auth.uid() in (cj.judge_id, cj.scribe_id))
            or public.is_club_organiser(public.class_club(cj.class_id)))
  );
$$;

-- Who may read a sheet: its judge, scribe, club organisers, and the rider
-- once the class results are published.
create function public.can_read_sheet(target_sheet uuid)
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
            or (c.results_published and e.rider_id = auth.uid()))
  );
$$;

-- Totals per sheet: raw points, maximum, penalties and percentage.
create view public.score_sheet_totals
with (security_invoker = true)
as
select
  s.id as sheet_id,
  s.entry_id,
  s.class_judge_id,
  s.status,
  coalesce(sum(ms.mark * m.coefficient), 0) as raw_points,
  (select sum(m2.max_mark * m2.coefficient)
     from public.test_movements m2
    where m2.test_id = c.test_id) as max_points,
  case
    when s.errors_of_course = 0 then 0
    when s.errors_of_course <= coalesce(array_length(t.error_penalties, 1), 0)
      then (select sum(p) from unnest(t.error_penalties[1:s.errors_of_course]) as p)
    else null
  end as error_penalty,
  s.other_deductions,
  (s.eliminated
   or s.errors_of_course > coalesce(array_length(t.error_penalties, 1), 0)) as is_eliminated
from public.score_sheets s
join public.class_judges cj on cj.id = s.class_judge_id
join public.classes c on c.id = cj.class_id
join public.test_templates t on t.id = c.test_id
left join public.movement_scores ms on ms.sheet_id = s.id
left join public.test_movements m on m.id = ms.movement_id
group by s.id, c.test_id, t.error_penalties;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.test_templates enable row level security;
alter table public.test_movements enable row level security;
alter table public.shows enable row level security;
alter table public.arenas enable row level security;
alter table public.classes enable row level security;
alter table public.class_judges enable row level security;
alter table public.entries enable row level security;
alter table public.score_sheets enable row level security;
alter table public.movement_scores enable row level security;

-- Profiles: everyone signed in can see names (needed for draws and results);
-- you can only edit your own.
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);
create policy "profiles self update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Clubs
create policy "clubs readable" on public.clubs
  for select to authenticated using (true);
create policy "clubs create" on public.clubs
  for insert to authenticated with check (created_by = auth.uid());
create policy "clubs organiser update" on public.clubs
  for update to authenticated using (public.is_club_organiser(id));

create policy "members readable" on public.club_members
  for select to authenticated using (true);
create policy "members organiser manage" on public.club_members
  for all to authenticated
  using (public.is_club_organiser(club_id))
  with check (public.is_club_organiser(club_id));

-- Test library: readable by everyone signed in; edited by its creator or the
-- owning club's organisers.
create policy "tests readable" on public.test_templates
  for select to authenticated using (true);
create policy "tests create" on public.test_templates
  for insert to authenticated
  with check (created_by = auth.uid()
              and (club_id is null or public.is_club_organiser(club_id)));
create policy "tests update" on public.test_templates
  for update to authenticated
  using (public.can_edit_test(id))
  with check (club_id is null or public.is_club_organiser(club_id) or created_by = auth.uid());
create policy "tests delete" on public.test_templates
  for delete to authenticated using (public.can_edit_test(id));

create policy "movements readable" on public.test_movements
  for select to authenticated using (true);
create policy "movements manage" on public.test_movements
  for all to authenticated
  using (public.can_edit_test(test_id))
  with check (public.can_edit_test(test_id));

-- Show structure: readable by everyone signed in; managed by club organisers.
create policy "shows readable" on public.shows
  for select to authenticated using (true);
create policy "shows manage" on public.shows
  for all to authenticated
  using (public.is_club_organiser(club_id))
  with check (public.is_club_organiser(club_id));

create policy "arenas readable" on public.arenas
  for select to authenticated using (true);
create policy "arenas manage" on public.arenas
  for all to authenticated
  using (public.is_club_organiser((select club_id from public.shows where id = show_id)))
  with check (public.is_club_organiser((select club_id from public.shows where id = show_id)));

create policy "classes readable" on public.classes
  for select to authenticated using (true);
create policy "classes manage" on public.classes
  for all to authenticated
  using (public.is_club_organiser((select club_id from public.shows where id = show_id)))
  with check (public.is_club_organiser((select club_id from public.shows where id = show_id)));

create policy "class judges readable" on public.class_judges
  for select to authenticated using (true);
create policy "class judges manage" on public.class_judges
  for all to authenticated
  using (public.is_club_organiser(public.class_club(class_id)))
  with check (public.is_club_organiser(public.class_club(class_id)));

create policy "entries readable" on public.entries
  for select to authenticated using (true);
create policy "entries manage" on public.entries
  for all to authenticated
  using (public.is_club_organiser(public.class_club(class_id)))
  with check (public.is_club_organiser(public.class_club(class_id)));

-- Score sheets
create policy "sheets read" on public.score_sheets
  for select to authenticated using (public.can_read_sheet(id));
create policy "sheets create" on public.score_sheets
  for insert to authenticated
  with check (exists (
    select 1 from public.class_judges cj
     where cj.id = class_judge_id
       and (auth.uid() in (cj.judge_id, cj.scribe_id)
            or public.is_club_organiser(public.class_club(cj.class_id)))
  ));
create policy "sheets update" on public.score_sheets
  for update to authenticated
  using (public.can_write_sheet(id))
  with check (exists (
    select 1 from public.class_judges cj
     where cj.id = class_judge_id
       and (auth.uid() in (cj.judge_id, cj.scribe_id)
            or public.is_club_organiser(public.class_club(cj.class_id)))
  ));

create policy "scores read" on public.movement_scores
  for select to authenticated using (public.can_read_sheet(sheet_id));
create policy "scores write" on public.movement_scores
  for all to authenticated
  using (public.can_write_sheet(sheet_id))
  with check (public.can_write_sheet(sheet_id));

-- Live updates for score sheets and marks (used by the leaderboard in Phase 3).
alter publication supabase_realtime add table public.score_sheets, public.movement_scores;
