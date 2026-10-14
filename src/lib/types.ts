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
