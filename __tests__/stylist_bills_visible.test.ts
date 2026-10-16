import { billsVisibleTo } from '../src/utils/stylistAccess';

const now = new Date(2026, 9, 15, 15, 0);
const at = (d: number, h = 10) => new Date(2026, 9, d, h, 0).toISOString();
const bills = [
  { id: 'mine-today', created_at: at(15), staff_id: 's1', staff_name: 'Ravi' },
  { id: 'mine-old', created_at: at(14), staff_id: 's1', staff_name: 'Ravi' },
  { id: 'other-today', created_at: at(15), staff_id: 's2', staff_name: 'Priya' },
  { id: 'pair-today', created_at: at(15), staff_id: null, staff_name: 'Priya & Ravi' },
];
const ids = (l: { id: string }[]) => l.map((b) => b.id);

describe('billsVisibleTo', () => {
  it('owners see everything', () => {
    expect(billsVisibleTo(bills, false, null, null, undefined, false, now)).toHaveLength(4);
  });
  it('stylists see only their own bills from today', () => {
    expect(ids(billsVisibleTo(bills, true, {}, 's1', 'Ravi', false, now))).toEqual(['mine-today', 'pair-today']);
  });
  it('full reports lifts the limit only for Reports and only with Reports on', () => {
    const p = { reports: true, reportsHistory: true };
    expect(billsVisibleTo(bills, true, p, 's1', 'Ravi', true, now)).toHaveLength(4);
    expect(billsVisibleTo(bills, true, p, 's1', 'Ravi', false, now)).toHaveLength(2);
    expect(billsVisibleTo(bills, true, { reportsHistory: true }, 's1', 'Ravi', true, now)).toHaveLength(2);
  });
});
