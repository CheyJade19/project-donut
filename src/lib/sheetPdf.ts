import { formatMark, formatPoints } from './format';
import { ordinal, type EntryResult } from './results';

const esc = (s: string | number | null | undefined) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pct = (n: number | null) => (n == null ? '–' : `${n.toFixed(3)}%`);

function longDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** File name for the PDF, like "Prelim-Open-Rita-Rider-Biscuit". */
export function sheetFileName(result: Pick<EntryResult, 'cls' | 'entry'>) {
  return [result.cls.name, result.entry.rider_name, result.entry.horse_name]
    .join(' ')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The rider's score sheets as a printable HTML document (turned into a PDF by
 * expo-print): a summary, then one page per judge with every movement's mark,
 * coefficient and comment, the collective marks, deductions and signature.
 * Only sheets the viewer can see and that are signed are printed as final.
 */
export function scoreSheetHtml(result: EntryResult, place?: { place: number | null; shared: boolean } | null): string {
  const { entry, cls, show, arena, test, movements, judges, combined } = result;
  const movementRows = movements.filter((m) => !m.is_collective);
  const collectiveRows = movements.filter((m) => m.is_collective);
  const visible = judges.filter((j) => j.sheet);

  const header = `
    <div class="head">
      <div>
        <div class="show">${esc(show.name)} · ${esc(longDate(show.show_date))}</div>
        <h1>${esc(entry.rider_name)} · ${esc(entry.horse_name)}</h1>
        <div class="muted">${esc([cls.name, arena?.name, test.code ? `${test.code} ${test.name}` : test.name].filter(Boolean).join(' · '))}${entry.draw_order != null ? ` · Draw ${entry.draw_order}` : ''}</div>
      </div>
    </div>`;

  const summary = `
    <table class="summary">
      <tr><th>Judge</th><th>Position</th><th>Points</th><th>Percentage</th><th>Status</th></tr>
      ${judges
        .map((j) => {
          const t = j.totals;
          const signed = j.sheet?.status === 'signed';
          return `<tr><td>${esc(j.judgeName)}</td><td>${esc(j.classJudge.position)}</td>
            <td>${signed && t ? (t.eliminated ? 'Elim' : `${formatPoints(t.finalPoints)} / ${formatPoints(t.maxPoints)}`) : '–'}</td>
            <td>${signed && t ? (t.eliminated ? 'Eliminated' : pct(t.percentage)) : '–'}</td>
            <td>${signed ? 'Signed' : j.sheet ? 'Not yet signed' : 'Not available'}</td></tr>`;
        })
        .join('')}
      <tr class="final"><td colspan="3">${judges.length > 1 ? 'Final score (average of judges)' : 'Final score'}</td>
        <td>${combined.eliminated ? 'Eliminated' : pct(combined.averagePercentage)}</td>
        <td>${place?.place != null ? `Placed ${ordinal(place.place, place.shared)}` : combined.signed < combined.total ? 'Provisional' : ''}</td></tr>
    </table>`;

  const judgePages = visible
    .map((j) => {
      const t = j.totals!;
      const sheet = j.sheet!;
      const row = (m: (typeof movements)[number]) => {
        const mark = j.marks[m.id]?.mark ?? null;
        return `<tr>
          <td class="n">${m.number}</td>
          <td class="mk">${esc(m.markers)}</td>
          <td>${esc(m.description)}</td>
          <td class="n">${formatMark(mark)}</td>
          <td class="n">${m.coefficient > 1 ? `×${m.coefficient}` : ''}</td>
          <td class="n">${mark == null ? '–' : formatPoints(mark * m.coefficient)}</td>
          <td class="c">${esc(j.marks[m.id]?.comment)}</td>
        </tr>`;
      };
      const table = (rows: typeof movements) => `
        <table class="marks">
          <tr><th>No.</th><th></th><th>Movement</th><th>Mark</th><th>Coef</th><th>Points</th><th>Remarks</th></tr>
          ${rows.map(row).join('')}
        </table>`;
      const signedLine =
        sheet.status === 'signed' && sheet.signed_at
          ? `Signed by ${esc(j.judgeName)} on ${esc(new Date(sheet.signed_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}`
          : 'Not yet signed by the judge';
      return `
        <section class="page">
          ${header}
          <h2>Judge at ${esc(j.classJudge.position)}: ${esc(j.judgeName)}</h2>
          ${table(movementRows)}
          ${collectiveRows.length ? `<h3>Collective marks</h3>${table(collectiveRows)}` : ''}
          <table class="totals">
            <tr><td>Points</td><td>${formatPoints(t.rawPoints)} / ${formatPoints(t.maxPoints)}</td></tr>
            ${sheet.errors_of_course ? `<tr><td>Errors of course (${sheet.errors_of_course})</td><td>${t.eliminated ? 'Eliminated' : `−${formatPoints(t.errorPenalty)}`}</td></tr>` : ''}
            ${sheet.other_deductions ? `<tr><td>Other deductions</td><td>−${formatPoints(sheet.other_deductions)}</td></tr>` : ''}
            <tr class="final"><td>Total</td><td>${t.eliminated ? 'Eliminated' : `${formatPoints(t.finalPoints)} · ${pct(t.percentage)}`}</td></tr>
          </table>
          ${sheet.general_comment ? `<div class="general"><strong>Judge's comments</strong><br/>${esc(sheet.general_comment).replace(/\n/g, '<br/>')}</div>` : ''}
          <div class="sign">${signedLine}</div>
        </section>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(sheetFileName(result))}</title>
<style>
  @page { margin: 14mm; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1B1B1B; font-size: 11px; margin: 0; }
  .page { page-break-before: always; }
  .head { border-bottom: 3px solid #1F4E3D; padding-bottom: 6px; margin-bottom: 10px; }
  .show { color: #1F4E3D; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
  h1 { font-size: 20px; margin: 2px 0; }
  h2 { font-size: 14px; margin: 10px 0 6px; color: #1F4E3D; }
  h3 { font-size: 12px; margin: 10px 0 4px; }
  .muted { color: #6B6B6B; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; background: #F6F4EF; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  th, td { border: 1px solid #DDD8CC; padding: 4px 6px; vertical-align: top; }
  td.n { text-align: center; white-space: nowrap; width: 36px; }
  td.mk { white-space: nowrap; width: 44px; color: #6B6B6B; }
  td.c { width: 34%; font-style: italic; }
  .summary td:nth-child(n+3) { text-align: center; }
  .totals { width: 50%; margin-left: auto; margin-top: 8px; }
  .totals td:last-child { text-align: right; }
  tr.final td { font-weight: 700; background: #F6F4EF; }
  .general { margin-top: 10px; padding: 8px; border: 1px solid #DDD8CC; border-radius: 4px; }
  .sign { margin-top: 14px; padding-top: 6px; border-top: 1px solid #1B1B1B; width: 60%; color: #6B6B6B; }
  .foot { margin-top: 16px; color: #6B6B6B; font-size: 9px; }
</style></head>
<body>
  <section>
    ${header}
    <h2>Result</h2>
    ${summary}
    ${visible.length === 0 ? '<p class="muted">No signed sheets yet.</p>' : ''}
    <div class="foot">Produced by eq ScoreBoard from the judges' signed digital sheets.</div>
  </section>
  ${judgePages}
</body></html>`;
}
