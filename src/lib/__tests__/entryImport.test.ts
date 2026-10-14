import { parseEntriesCsv } from '../entryImport';
import { combineDateTime } from '../format';

describe('parseEntriesCsv', () => {
  it('reads a draw with a header row in any column order', () => {
    const { entries, errors } = parseEntriesCsv('Time,Draw,Horse,Rider\n09:00,1,Biscuit,Rita Rider\n09:07,2,"Pickle, Jr",Ann Able\n', '2026-11-01');
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { rider_name: 'Rita Rider', horse_name: 'Biscuit', draw_order: 1, start_time: combineDateTime('2026-11-01', '09:00') },
      { rider_name: 'Ann Able', horse_name: 'Pickle, Jr', draw_order: 2, start_time: combineDateTime('2026-11-01', '09:07') },
    ]);
  });

  it('takes rider, horse, draw, time when there is no header', () => {
    const { entries } = parseEntriesCsv('Rita Rider,Biscuit,3\nAnn Able,Pickle', '2026-11-01');
    expect(entries.map((e) => [e.rider_name, e.draw_order])).toEqual([
      ['Rita Rider', 3],
      ['Ann Able', 4],
    ]);
  });

  it('skips incomplete rows and reports bad values', () => {
    const { entries, errors } = parseEntriesCsv('rider,horse,draw,time\nRita,,1,\nAnn,Pickle,x,25:00', '2026-11-01');
    expect(entries).toEqual([{ rider_name: 'Ann', horse_name: 'Pickle', draw_order: 1, start_time: null }]);
    expect(errors).toHaveLength(3);
  });

  it('needs both rider and horse columns', () => {
    expect(parseEntriesCsv('rider,draw\nRita,1', '2026-11-01').errors[0]).toMatch(/horse/);
  });
});

describe('combineDateTime', () => {
  it('builds a local time on the show date', () => {
    const iso = combineDateTime('2026-11-01', '9.30')!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 1, 9, 30]);
  });

  it('rejects impossible times', () => {
    expect(combineDateTime('2026-11-01', '24:00')).toBeNull();
    expect(combineDateTime('2026-11-01', 'soon')).toBeNull();
  });
});
