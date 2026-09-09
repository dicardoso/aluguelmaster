// Prisma returns Decimal for money columns and Date objects for @db.Date columns.
// The client expects plain numbers and "yyyy-MM-dd" strings (as it did with Firestore),
// so bridge that here instead of touching every page's date/number handling.

// Postgres DATE has no timezone; Prisma reads/writes it as UTC midnight. Slicing the
// ISO string (always UTC) recovers the exact stored calendar date regardless of the
// server's local timezone — using date-fns `format` here would re-introduce an
// off-by-one-day bug on any server not running in UTC.
export const toDateOnlyString = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

export function serializeProperty(p: any) {
  return { ...p, monthlyRent: Number(p.monthlyRent) };
}

export function serializeContract(c: any) {
  return {
    ...c,
    monthlyRent: Number(c.monthlyRent),
    startDate: toDateOnlyString(c.startDate),
    endDate: toDateOnlyString(c.endDate),
    signedAt: c.signedAt ? new Date(c.signedAt).toISOString() : null,
    createdAt: new Date(c.createdAt).toISOString(),
  };
}

export function serializePayment(p: any) {
  return {
    ...p,
    amount: Number(p.amount),
    dueDate: toDateOnlyString(p.dueDate),
    paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}
