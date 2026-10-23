import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const U = (p: string) => import(new URL('../src/' + p, import.meta.url).href);
const { calculateLateFee } = await U('lib/lateFee.ts');
const { toDateOnlyString, serializeContract, serializePayment, serializeProperty } = await U('server/serialize.ts');
const fmt = await U('lib/format.ts');

describe('calculateLateFee', () => {
  const ref = new Date('2026-10-31T00:00:00Z');
  it('not late: no fee, total = amount', () => {
    assert.deepEqual(calculateLateFee(1000, '2026-10-31', ref), { daysLate: 0, fine: 0, interest: 0, total: 1000 });
    assert.deepEqual(calculateLateFee(1000, '2026-11-05', ref), { daysLate: 0, fine: 0, interest: 0, total: 1000 });
  });
  it('1 day late: 2% fine + 1/30 of 1% interest', () => {
    const r = calculateLateFee(1000, '2026-10-30', ref);
    assert.equal(r.daysLate, 1);
    assert.equal(r.fine, 20);
    assert.ok(Math.abs(r.interest - 1000 * 0.01 / 30) < 1e-9);
  });
  it('30 days late: interest is exactly 1% of amount', () => {
    const r = calculateLateFee(2000, '2026-10-01', ref);
    assert.equal(r.daysLate, 30);
    assert.ok(Math.abs(r.interest - 20) < 1e-9);
    assert.ok(Math.abs(r.total - 2060) < 1e-9);
  });
  it('late fee is a calendar-day concept: same instant a few hours after due date is not a full day', () => {
    assert.equal(calculateLateFee(100, '2026-10-30', new Date('2026-10-30T23:59:00Z')).daysLate, 0);
  });
});

describe('serialize', () => {
  for (const tz of ['UTC', 'America/Sao_Paulo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    it(`toDateOnlyString keeps the stored calendar day under TZ=${tz}`, () => {
      process.env.TZ = tz;
      assert.equal(toDateOnlyString(new Date('2026-11-01T00:00:00.000Z')), '2026-11-01');
      assert.equal(toDateOnlyString(new Date('2027-02-28T00:00:00.000Z')), '2027-02-28');
    });
  }
  it('Decimal-like money -> number, dates -> ISO strings, null signedAt preserved', () => {
    const dec = { toString: () => '1200.75', valueOf: () => 1200.75 };
    const c = serializeContract({ monthlyRent: dec, startDate: new Date('2026-11-01'), endDate: new Date('2027-11-01'), signedAt: null, createdAt: new Date('2026-10-22T10:00:00Z') });
    assert.equal(c.monthlyRent, 1200.75);
    assert.equal(c.signedAt, null);
    assert.equal(c.createdAt, '2026-10-22T10:00:00.000Z');
    const p = serializePayment({ amount: dec, dueDate: new Date('2026-11-05'), paidAt: new Date('2026-11-06T12:00:00Z'), createdAt: new Date() });
    assert.equal(p.dueDate, '2026-11-05');
    assert.equal(p.paidAt, '2026-11-06T12:00:00.000Z');
    assert.equal(serializeProperty({ monthlyRent: '99.90' }).monthlyRent, 99.9);
  });
});

describe('format helpers', () => {
  it('formatCurrency renders pt-BR BRL', () => {
    const s = fmt.formatCurrency(1234.5);
    assert.match(s.replace(/\s/g, ' '), /R\$ ?1\.234,50/);
  });
});

const { forwardAsyncErrors } = await U('server/errors.ts');

describe('forwardAsyncErrors', () => {
  const mkStack = () => [{ handle: async () => { throw new Error('boom'); } }];

  it('forwards a rejected async handler to next()', async () => {
    const stack = mkStack();
    forwardAsyncErrors(stack);
    const err = await new Promise((resolve) => (stack[0].handle as any)({}, {}, resolve));
    assert.equal((err as Error).message, 'boom');
  });
  it('is idempotent: re-running over the same (module-singleton) router does not re-wrap', () => {
    const stack = mkStack();
    forwardAsyncErrors(stack);
    const once = stack[0].handle;
    forwardAsyncErrors(stack);
    forwardAsyncErrors(stack);
    assert.equal(stack[0].handle, once);
  });
});
