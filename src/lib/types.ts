// Row shapes for the tables in supabase/migrations. Kept by hand for now;
// can be swapped for `supabase gen types typescript` output later.

export type AppRole = 'organiser' | 'judge' | 'scribe' | 'rider';

export const ROLE_LABELS: Record<AppRole, string> = {
  organiser: 'Organiser',
  judge: 'Judge',
  scribe: 'Scribe',
  rider: 'Rider',
};

export type Profile = {
  id: string;
  full_name: string;
  roles: AppRole[];
  judge_level: string | null;
  phone: string | null;
};

export type ArenaSize = '20x40' | '20x60';

export type TestTemplate = {
  id: string;
  club_id: string | null;
  name: string;
  code: string | null;
  level: string | null;
  discipline: string;
  arena_size: ArenaSize | null;
  error_penalties: number[];
  notes: string | null;
  created_by: string;
  created_at: string;
};

export type TestMovement = {
  id: string;
  test_id: string;
  number: number;
  markers: string | null;
  description: string;
  directive_ideas: string | null;
  coefficient: number;
  max_mark: number;
  is_collective: boolean;
};

/** A movement before it is saved (no ids yet). */
export type MovementDraft = Omit<TestMovement, 'id' | 'test_id'>;

export type ShowStatus = 'draft' | 'open' | 'live' | 'closed';
export type SheetStatus = 'draft' | 'submitted' | 'signed';
export type JudgePosition = 'C' | 'E' | 'H' | 'M' | 'B' | 'K' | 'F' | 'A';

export const JUDGE_POSITIONS: JudgePosition[] = ['C', 'E', 'H', 'M', 'B', 'K', 'F', 'A'];

export const SHOW_STATUS_LABELS: Record<ShowStatus, string> = {
  draft: 'Draft',
  open: 'Entries open',
  live: 'Live',
  closed: 'Closed',
};

export const SHEET_STATUS_LABELS: Record<SheetStatus, string> = {
  draft: 'In progress',
  submitted: 'With judge',
  signed: 'Signed',
};

export type Club = { id: string; name: string; created_by: string };

export type Show = {
  id: string;
  club_id: string;
  name: string;
  venue: string | null;
  show_date: string;
  status: ShowStatus;
};

export type Arena = { id: string; show_id: string; name: string; size: ArenaSize | null };

export type DressageClass = {
  id: string;
  show_id: string;
  arena_id: string | null;
  test_id: string;
  name: string;
  start_time: string | null;
  results_published: boolean;
  /** Everyone signed in sees placings as sheets are signed. */
  leaderboard_public: boolean;
  /** Riders' sheets go public automatically at this time. */
  results_publish_at: string | null;
  results_updated_at: string;
};

export type ClassJudge = {
  id: string;
  class_id: string;
  judge_id: string;
  scribe_id: string | null;
  position: JudgePosition;
};

export type Entry = {
  id: string;
  class_id: string;
  rider_id: string | null;
  rider_name: string;
  horse_name: string;
  draw_order: number | null;
  start_time: string | null;
  withdrawn: boolean;
};

export type MovementScore = {
  sheet_id: string;
  movement_id: string;
  mark: number | null;
  comment: string | null;
  client_updated_at: string | null;
};

export type ScoreSheet = {
  id: string;
  entry_id: string;
  class_judge_id: string;
  status: SheetStatus;
  errors_of_course: number;
  other_deductions: number;
  eliminated: boolean;
  general_comment: string | null;
  signed_at: string | null;
  signed_by: string | null;
  client_updated_at: string | null;
};
