import { readFileSync } from 'fs';
import { join } from 'path';

import { parseCsvRows, parseTestCsv } from '../testImport';

describe('parseTestCsv', () => {
  it('reads the template in docs/', () => {
    const csv = readFileSync(join(__dirname, '../../../docs/test-template.csv'), 'utf8');
    const { movements, errors } = parseTestCsv(csv);
    expect(errors).toEqual([]);
    expect(movements).toHaveLength(7);
    expect(movements[0]).toMatchObject({
      number: 1,
      markers: 'A X C',
      description: 'Enter in working trot, halt, salute, proceed in working trot',
      coefficient: 1,
      is_collective: false,
    });
    expect(movements[5]).toMatchObject({ description: 'Submission', coefficient: 2, is_collective: true });
    expect(movements[3].markers).toBeNull();
  });

  it('accepts any column order and fills missing numbers', () => {
    const { movements } = parseTestCsv('Movement,Coef\r\nTrack left,1\r\nHalt,2\r\n');
    expect(movements.map((m) => [m.number, m.description, m.coefficient])).toEqual([
      [1, 'Track left', 1],
      [2, 'Halt', 2],
    ]);
  });

  it('reports bad rows and keeps good ones', () => {
    const { movements, errors } = parseTestCsv('number,movement,coefficient\n1,Halt,1\n1,Again,1\n2,Trot,9\n3,,1');
    expect(movements).toHaveLength(1);
    expect(errors).toHaveLength(3);
  });

  it('requires a movement column', () => {
    expect(parseTestCsv('number,markers\n1,A').errors[0]).toMatch(/movement/);
  });
});

describe('parseCsvRows', () => {
  it('handles quotes, escaped quotes and newlines in fields', () => {
    expect(parseCsvRows('a,"b ""c""","d\ne"\n1,2,3')).toEqual([
      ['a', 'b "c"', 'd\ne'],
      ['1', '2', '3'],
    ]);
  });
});
