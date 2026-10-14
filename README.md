# eq ScoreBoard (project-donut)

Scoreboard app for equestrian competition tracking. Dressage first: judges,
scribes and riders use digital test sheets instead of paper.

Built with [Expo](https://expo.dev) (React Native + TypeScript, one codebase
for iOS, Android and web) and [Supabase](https://supabase.com) (Postgres,
auth, realtime).

## Roles

| Role | What they do |
| --- | --- |
| Organiser | Runs a club: shows, arenas, classes, which test each class rides, judges and scribes, entries. Anyone who creates a club becomes its organiser. |
| Judge | Has a profile, browses the test library, sees their arena and test for the day, signs off score sheets. |
| Scribe | Enters marks (0 to 10, half marks) and comments for each movement next to the judge. |
| Rider | Sees their marks and each judge's comments once the organiser publishes results. |

People can hold several roles (a judge who also rides, for example).

## Status

**Phase 1: foundations** (done)

- App scaffold with sign up, sign in and profiles with roles.
- Database schema with row level security: clubs, shows, arenas, classes,
  judges and scribes per class, entries, test templates and movements, score
  sheets and movement marks, plus a totals view.
- Test library: browse and search tests, add them by hand, or upload a CSV.

**Phase 2: scoring** (this branch)

- Organiser screens: create a club, shows, arenas and classes; pick each
  class's test; put judges (by position) and scribes on the panel; add riders
  one by one or load the draw from a CSV (`rider,horse,draw,time`); withdraw
  riders; publish results.
- Scribe scoring screen for tablets: one movement at a time with big 0 to 10
  buttons plus a half mark, comments with one-tap common remarks, collective
  marks, errors of course, other deductions, and a live total and percentage.
- Works with no signal: every tap is saved on the device and uploaded when
  the connection comes back. A badge shows what is still waiting. If two
  devices edit the same sheet, the newest edit to each mark wins.
- Judge review and sign-off: the scribe sends the sheet to the judge, who
  signs it (one at a time or all at once) on their own login. Signed sheets
  are locked; only an organiser can reopen one.

Next: Phase 3
(live leaderboard, rider results, PDF sheets), Phase 4 (pilot show, store
release). Later: showjumping and eventing.

## Getting started

1. Install Node 22, then `npm install`.
2. Create a Supabase project and run the migration in
   `supabase/migrations/` (SQL editor, or `supabase db push` with the
   Supabase CLI).
3. Copy `.env.example` to `.env` and fill in the project URL and anon key
   from Supabase (Settings > API).
4. `npm start`, then open the app in Expo Go on your phone or press `w` for
   the web version.

## Uploading tests

Tests can be typed in on the "Add a test" screen or uploaded as a CSV with
one row per movement. Collective marks are rows with `collective` set to
`yes`. See [docs/test-template.csv](docs/test-template.csv):

```csv
number,markers,movement,directives,coefficient,collective
1,A X C,"Enter in working trot, halt, salute",Straightness; quality of halt,1,no
4,,Paces,Freedom and regularity,1,yes
```

Only the `movement` column is required. Coefficients default to 1, maximum
marks to 10, and missing numbers are filled in order. Error of course
penalties are set per test (default 2 then 4 points, third error eliminates).

Tests already used in a show are locked so existing score sheets stay valid.

## Checks

```bash
npm run typecheck   # TypeScript
npm test            # scoring, offline queue and CSV import unit tests
PGURL=postgres://postgres:postgres@localhost:5432 npm run test:db
                    # applies migrations to a scratch Postgres and checks the
                    # access rules and sheet saving/signing
PGURL=postgres://postgres:postgres@localhost:5432 npm run test:e2e
                    # a whole show day through the app's own data code,
                    # served by PostgREST like Supabase does (downloads
                    # PostgREST the first time)
```

CI runs all four on every pull request.
