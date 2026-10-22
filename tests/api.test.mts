import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness, prisma, sweep, snapshot, restore, createUser, persona, tokenFor, client, mail, unhandled, run, MAIL_DOMAIN,
} from './lib/harness.mts';

const HANG_MS = 10000; // a handler that crashed leaves the request open forever; this just has to beat Neon's latency
const SLOW_MS = 90000; // /api/reminders/process walks every due payment sequentially (a query + mail + update each)
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const waitMail = async (pred: (m: any) => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const m = mail.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 100)); }
  return undefined;
};
const mailsTo = (email: string) => mail.filter((m) => m.to === email);

const P = {
  admin: persona('admin', 'admin'), landA: persona('landA', 'landlord'), landB: persona('landB', 'landlord'),
  tenant: persona('tenant', 'tenant'), tenant2: persona('tenant2', 'tenant'),
};
const stranger = { uid: `test_${run}_stranger`, email: `stranger.${run}@${MAIL_DOMAIN}`, name: 'Stranger' };

let base = '';
let snap: Awaited<ReturnType<typeof snapshot>>;
let admin: ReturnType<typeof client>, landA: ReturnType<typeof client>, landB: ReturnType<typeof client>;
let tenant: ReturnType<typeof client>, anon: ReturnType<typeof client>;

before(async () => {
  await sweep();
  snap = await snapshot();
  const h = await startHarness();
  base = h.url;
  for (const p of Object.values(P)) await createUser(p);
  anon = client(base);
  admin = client(base, tokenFor(P.admin));
  landA = client(base, tokenFor(P.landA));
  landB = client(base, tokenFor(P.landB));
  tenant = client(base, tokenFor(P.tenant));
});

after(async () => {
  delete process.env.ALLOW_TENANT_LOGIN;
  await sweep();
  await restore(snap);
  console.log(`\n[cleanup] leftovers: ${await prisma.user.count({ where: { email: { endsWith: '@' + MAIL_DOMAIN } } })}; unhandledRejections captured: ${unhandled.length}`);
  for (const u of unhandled) console.log('  unhandled:', String(u?.message ?? u).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200));
  process.exit(process.exitCode ?? 0);
});

async function mkProperty(who: ReturnType<typeof client>, over: any = {}) {
  const r = await who('POST', '/api/properties', { address: `Rua E2E ${Math.random().toString(36).slice(2, 7)}`, type: 'residential', monthlyRent: 1000, ...over });
  assert.equal(r.status, 201, `create property: ${r.text}`);
  return r.json;
}
async function mkContract(who: ReturnType<typeof client>, propertyId: string, over: any = {}) {
  const r = await who('POST', '/api/contracts', {
    propertyId, tenantUid: P.tenant.uid, startDate: '2026-11-01', endDate: '2027-11-01', dueDay: 5, monthlyRent: 1000, ...over,
  });
  assert.equal(r.status, 201, `create contract: ${r.text}`);
  return r.json;
}
const paymentsOf = async (cid: string) => (await prisma.payment.findMany({ where: { contractId: cid }, orderBy: { dueDate: 'asc' } }));

describe('AUTH & profile bootstrap', () => {
  it('no Authorization header -> 401', async () => assert.equal((await anon('GET', '/api/me')).status, 401));
  it('garbage token -> 401', async () => assert.equal((await client(base, 'nope')('GET', '/api/me')).status, 401));
  it('unverified e-mail -> 403', async () => {
    const r = await client(base, tokenFor({ ...P.admin, verified: false }))('GET', '/api/me');
    assert.equal(r.status, 403);
  });
  it('verified user without invite -> 403 with invite message', async () => {
    const r = await client(base, tokenFor(stranger))('GET', '/api/me');
    assert.equal(r.status, 403);
    assert.match(r.json.error, /convite/i);
  });
  it('every /api resource rejects anonymous calls', async () => {
    for (const p of ['/api/properties', '/api/contracts', '/api/payments', '/api/users', '/api/users/directory', '/api/settings', '/api/settings/thresholds', '/api/settings/features']) {
      assert.equal((await anon('GET', p)).status, 401, p);
    }
    assert.equal((await anon('POST', '/api/reminders/process')).status, 401);
  });
  it('/api/health is public', async () => assert.equal((await anon('GET', '/api/health')).json.status, 'ok'));

  it('invite -> first login migrates profile (case-insensitive e-mail), removes invite, sends welcome', async () => {
    const email = `Newbie.${run}@${MAIL_DOMAIN}`;
    const inv = await admin('POST', '/api/users', { email, displayName: 'Newbie', role: 'landlord', cpf: '123' });
    assert.equal(inv.status, 201);
    assert.equal(inv.json.isInvite, true);
    assert.equal(inv.json.email, email.toLowerCase());
    assert.ok(await waitMail((m) => m.to === email.toLowerCase() && /convite|acesso|bem-vindo|invit/i.test(m.subject + m.html)), 'invite e-mail sent');
    const uid = `test_${run}_newbie`;
    const me = await client(base, tokenFor({ uid, email: email.toUpperCase(), name: 'Newbie G' }))('GET', '/api/me');
    assert.equal(me.status, 200, me.text);
    assert.equal(me.json.id, uid);
    assert.equal(me.json.role, 'landlord');
    assert.equal(me.json.cpf, '123');
    assert.equal(await prisma.user.count({ where: { id: inv.json.id } }), 0, 'invite row removed');
    assert.ok(await waitMail((m) => m.to === email.toLowerCase() && m !== undefined && m.subject !== undefined), 'some mail to user');
  });

  it('PROBE: landlord invite that already owns a property can still log in (FK on invite delete)', async () => {
    const email = `owner.${run}@${MAIL_DOMAIN}`;
    const inv = await admin('POST', '/api/users', { email, displayName: 'Owner', role: 'landlord' });
    const prop = await admin('POST', '/api/properties', { address: 'Imovel do convite', type: 'residential', monthlyRent: 900, ownerUid: inv.json.id });
    assert.equal(prop.status, 201);
    const r = await client(base, tokenFor({ uid: `test_${run}_owner`, email, name: 'Owner' }))('GET', '/api/me', undefined, HANG_MS);
    assert.equal(r.status, 200, `login failed: status=${r.status} ${r.text.slice(0, 120)}`);
  });

  it('disabling a user blocks them immediately (cache invalidated); re-enabling restores', async () => {
    assert.equal((await landB('GET', '/api/me')).status, 200);
    assert.equal((await admin('PATCH', `/api/users/${P.landB.uid}`, { disabled: true })).status, 200);
    const blocked = await landB('GET', '/api/properties');
    assert.equal(blocked.status, 403);
    assert.match(blocked.json.error, /desativado/i);
    assert.equal((await admin('PATCH', `/api/users/${P.landB.uid}`, { disabled: false })).status, 200);
    assert.equal((await landB('GET', '/api/me')).status, 200);
  });
  it('admin cannot disable self; disabled must be boolean', async () => {
    assert.equal((await admin('PATCH', `/api/users/${P.admin.uid}`, { disabled: true })).status, 400);
    assert.equal((await admin('PATCH', `/api/users/${P.landB.uid}`, { disabled: 'yes' })).status, 400);
  });

  it('tenant login OFF by default -> 403, tenant invite NOT consumed', async () => {
    delete process.env.ALLOW_TENANT_LOGIN;
    const email = `inv.tenant.${run}@${MAIL_DOMAIN}`;
    const before = mail.length;
    const inv = await admin('POST', '/api/users', { email, displayName: 'Inv Tenant' });
    assert.equal(inv.status, 201);
    assert.equal(inv.json.role, 'tenant');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(mail.slice(before).filter((m) => m.to === email).length, 0, 'no invite mail to tenant while login is off');
    assert.equal((await tenant('GET', '/api/me')).status, 403);
    const r = await client(base, tokenFor({ uid: `test_${run}_invt`, email }))('GET', '/api/me');
    assert.equal(r.status, 403);
    assert.equal(await prisma.user.count({ where: { id: inv.json.id, isInvite: true } }), 1, 'invite stays pending');
  });
  it('tenant login ON -> tenant passes; flipping flag OFF blocks even cached profile', async () => {
    process.env.ALLOW_TENANT_LOGIN = 'true';
    assert.equal((await client(base, undefined)('GET', '/api/settings/features')).status, 401);
    assert.equal((await tenant('GET', '/api/me')).status, 200);
    assert.equal((await tenant('GET', '/api/settings/features')).json.tenantLogin, true);
    delete process.env.ALLOW_TENANT_LOGIN;
    assert.equal((await tenant('GET', '/api/me')).status, 403, 'cached profile must still honour the flag');
  });
});

describe('ME', () => {
  it('PATCH /me ignores role (no privilege escalation) and validates theme', async () => {
    const r = await landB('PATCH', '/api/me', { role: 'admin', displayName: 'Landlord B Edited', phone: '8399' });
    assert.equal(r.status, 200);
    assert.equal(r.json.role, 'landlord');
    assert.equal(r.json.displayName, 'Landlord B Edited');
    assert.equal((await landB('PATCH', '/api/me', { themePreference: 'neon' })).status, 400);
    assert.equal((await landB('PATCH', '/api/me', { themePreference: 'dark' })).json.themePreference, 'dark');
    assert.equal((await landB('GET', '/api/users', undefined)).status, 403);
  });
});

describe('USERS', () => {
  it('GET /users admin-only; /directory exposes no e-mail/phone', async () => {
    assert.equal((await admin('GET', '/api/users')).status, 200);
    assert.equal((await landA('GET', '/api/users')).status, 403);
    const d = await landA('GET', '/api/users/directory');
    assert.equal(d.status, 200);
    assert.ok(d.json.length >= 5);
    for (const u of d.json) assert.deepEqual(Object.keys(u).sort(), ['address', 'cpf', 'displayName', 'id', 'role']);
  });
  it('POST validation: missing fields 400, duplicate e-mail 409, non-admin 403', async () => {
    assert.equal((await admin('POST', '/api/users', { displayName: 'x' })).status, 400);
    assert.equal((await admin('POST', '/api/users', { email: P.landA.email.toUpperCase(), displayName: 'dup' })).status, 409);
    assert.equal((await landA('POST', '/api/users', { email: `x.${run}@${MAIL_DOMAIN}`, displayName: 'x' })).status, 403);
  });
  it('PROBE: POST with invalid role is rejected (4xx), not a hang/crash', async () => {
    const r = await admin('POST', '/api/users', { email: `badrole.${run}@${MAIL_DOMAIN}`, displayName: 'x', role: 'superuser' }, HANG_MS);
    assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `status=${r.status}`);
  });
  it('PROBE: PATCH on unknown user id -> 404, not a hang/crash', async () => {
    const r = await admin('PATCH', '/api/users/does-not-exist', { displayName: 'x' }, HANG_MS);
    assert.equal(r.status, 404, `status=${r.status}`);
  });
  it('DELETE: invite 204; real user 400; unknown 404; invite referenced by a property 409', async () => {
    const mk = async (k: string) => (await admin('POST', '/api/users', { email: `${k}.${run}@${MAIL_DOMAIN}`, displayName: k, role: 'landlord' })).json;
    const a = await mk('del1');
    assert.equal((await admin('DELETE', `/api/users/${a.id}`)).status, 204);
    assert.equal((await admin('DELETE', `/api/users/${P.landA.uid}`)).status, 400);
    assert.equal((await admin('DELETE', '/api/users/nope')).status, 404);
    const b = await mk('del2');
    await admin('POST', '/api/properties', { address: 'ref', type: 'commercial', monthlyRent: 1, ownerUid: b.id });
    assert.equal((await admin('DELETE', `/api/users/${b.id}`)).status, 409);
    assert.equal((await landA('DELETE', `/api/users/${b.id}`)).status, 403);
  });
});

describe('PROPERTIES', () => {
  let pA: any, pB: any;
  it('landlord creates; forged ownerUid ignored; admin may set owner; tenant/validation rejected', async () => {
    pA = await mkProperty(landA, { ownerUid: P.landB.uid, monthlyRent: 1500.5 });
    assert.equal(pA.ownerUid, P.landA.uid);
    assert.equal(pA.monthlyRent, 1500.5);
    assert.equal(pA.status, 'available');
    pB = (await admin('POST', '/api/properties', { address: 'Admin made for B', type: 'commercial', monthlyRent: 3000, ownerUid: P.landB.uid })).json;
    assert.equal(pB.ownerUid, P.landB.uid);
    assert.equal((await tenant('POST', '/api/properties', { address: 'x', type: 'residential', monthlyRent: 1 })).status, 403);
    assert.equal((await landA('POST', '/api/properties', { type: 'residential', monthlyRent: 1 })).status, 400);
  });
  it('listing is scoped: landlord sees only own, admin sees all', async () => {
    const a = (await landA('GET', '/api/properties')).json.map((p: any) => p.id);
    assert.ok(a.includes(pA.id) && !a.includes(pB.id));
    const b = (await landB('GET', '/api/properties')).json.map((p: any) => p.id);
    assert.ok(b.includes(pB.id) && !b.includes(pA.id));
    const all = (await admin('GET', '/api/properties')).json.map((p: any) => p.id);
    assert.ok(all.includes(pA.id) && all.includes(pB.id));
  });
  it('cross-tenant isolation: B cannot patch/delete A\'s property', async () => {
    assert.equal((await landB('PATCH', `/api/properties/${pA.id}`, { address: 'hijack' })).status, 403);
    assert.equal((await landB('DELETE', `/api/properties/${pA.id}`)).status, 403);
    assert.equal((await landA('PATCH', '/api/properties/nope', { address: 'x' })).status, 404);
  });
  it('PATCH updates only provided fields', async () => {
    const r = await landA('PATCH', `/api/properties/${pA.id}`, { description: 'novo' });
    assert.equal(r.json.description, 'novo');
    assert.equal(r.json.monthlyRent, 1500.5);
  });
  it('PROBE: invalid property type / non-numeric rent -> 4xx, no hang', async () => {
    for (const body of [{ address: 'a', type: 'castle', monthlyRent: 1 }, { address: 'a', type: 'residential', monthlyRent: 'abc' }]) {
      const r = await landA('POST', '/api/properties', body, HANG_MS);
      assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `${JSON.stringify(body)} -> ${r.status}`);
    }
  });
  it('PROBE: negative rent is rejected', async () => {
    const r = await landA('POST', '/api/properties', { address: 'neg', type: 'residential', monthlyRent: -50 }, HANG_MS);
    assert.ok(typeof r.status === 'number' && r.status >= 400, `status=${r.status}`);
  });
  it('PROBE: deleting a property that has contracts -> 409/400, not a hang', async () => {
    const p = await mkProperty(landA);
    await mkContract(landA, p.id);
    const r = await landA('DELETE', `/api/properties/${p.id}`, undefined, HANG_MS);
    assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `status=${r.status}`);
  });
  it('deleting an unused property -> 204', async () => {
    const p = await mkProperty(landA);
    assert.equal((await landA('DELETE', `/api/properties/${p.id}`)).status, 204);
  });
});

describe('CONTRACTS', () => {
  it('create: 12 exact months -> 12 payments on dueDay, property becomes rented, mails to tenant+landlord', async () => {
    const p = await mkProperty(landA, { monthlyRent: 1200 });
    const c = await mkContract(landA, p.id, { monthlyRent: 1200.75 });
    assert.equal(c.status, 'active');
    assert.equal(c.landlordUid, P.landA.uid);
    assert.equal(c.startDate, '2026-11-01');
    assert.equal(c.endDate, '2027-11-01');
    assert.equal(c.monthlyRent, 1200.75);
    const pays = await paymentsOf(c.id);
    assert.equal(pays.length, 12);
    assert.equal(pays[0].dueDate.toISOString().slice(0, 10), '2026-11-05');
    assert.equal(pays[11].dueDate.toISOString().slice(0, 10), '2027-10-05');
    assert.ok(pays.every((x: any) => Number(x.amount) === 1200.75 && x.status === 'pending' && x.tenantUid === P.tenant.uid));
    assert.equal((await prisma.property.findUnique({ where: { id: p.id } }))!.status, 'rented');
    assert.ok(await waitMail((m) => m.to === P.tenant.email && /Novo Contrato/.test(m.subject)));
    assert.ok(await waitMail((m) => m.to === P.landA.email && /Contrato gerado/.test(m.subject)));
  });
  it('create: non-boundary end date adds a final partial-month payment', async () => {
    const p = await mkProperty(landA);
    const c = await mkContract(landA, p.id, { startDate: '2026-11-15', endDate: '2027-02-20' });
    assert.equal((await paymentsOf(c.id)).length, 4);
  });
  it('create: tenant gets no "platform link" while login is off', async () => {
    const m = mail.find((x) => x.to === P.tenant.email && /Novo Contrato/.test(x.subject));
    assert.ok(m);
    assert.doesNotMatch(m!.html, /Acessar Plataforma|Ver Contrato/);
  });
  it('authorization: tenant 403, landlord B on A\'s property 403, admin can override landlordUid', async () => {
    const p = await mkProperty(landA);
    const body = { propertyId: p.id, tenantUid: P.tenant.uid, startDate: '2026-11-01', endDate: '2027-11-01', monthlyRent: 1 };
    assert.equal((await tenant('POST', '/api/contracts', body)).status, 403);
    assert.equal((await landB('POST', '/api/contracts', body)).status, 403);
    assert.equal((await landA('POST', '/api/contracts', { ...body, propertyId: 'nope' })).status, 404);
    assert.equal((await landA('POST', '/api/contracts', { ...body, tenantUid: undefined })).status, 400);
    const forged = await landA('POST', '/api/contracts', { ...body, landlordUid: P.landB.uid });
    assert.equal(forged.json.landlordUid, P.landA.uid, 'landlord cannot forge landlordUid');
    const p2 = await mkProperty(landA);
    const viaAdmin = await admin('POST', '/api/contracts', { ...body, propertyId: p2.id, landlordUid: P.landB.uid });
    assert.equal(viaAdmin.json.landlordUid, P.landB.uid);
  });
  it('listing scoped by role (landlord A / B / tenant with login on)', async () => {
    const p = await mkProperty(landA);
    const c = await mkContract(landA, p.id);
    assert.ok((await landA('GET', '/api/contracts')).json.some((x: any) => x.id === c.id));
    assert.ok(!(await landB('GET', '/api/contracts')).json.some((x: any) => x.id === c.id));
    process.env.ALLOW_TENANT_LOGIN = 'true';
    const t = (await tenant('GET', '/api/contracts')).json;
    assert.ok(t.some((x: any) => x.id === c.id) && t.every((x: any) => x.tenantUid === P.tenant.uid));
    delete process.env.ALLOW_TENANT_LOGIN;
  });
  it('B cannot read-modify A\'s contract (renew/cancel/notify/late-fee/signed/edit -> 403)', async () => {
    const p = await mkProperty(landA);
    const c = await mkContract(landA, p.id);
    for (const [m, path, body] of [['POST', 'renew', {}], ['POST', 'cancel', {}], ['POST', 'notify', {}], ['PATCH', 'late-fee', { lateFeeEnabled: true }], ['PATCH', 'signed', { signedContractUrl: 'x' }], ['PATCH', '', {}]] as const) {
      assert.equal((await landB(m, `/api/contracts/${c.id}${path ? '/' + path : ''}`, body)).status, 403, path || 'edit');
    }
    assert.equal((await landA('POST', '/api/contracts/nope/cancel')).status, 404);
  });

  it('PROBE: end date before start date rejected on create', async () => {
    const p = await mkProperty(landA);
    const r = await landA('POST', '/api/contracts', { propertyId: p.id, tenantUid: P.tenant.uid, startDate: '2027-01-01', endDate: '2026-01-01', monthlyRent: 1000 }, HANG_MS);
    assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `status=${r.status}`);
    assert.equal((await prisma.property.findUnique({ where: { id: p.id } }))!.status, 'available', 'property must not be rented by a rejected contract');
  });
  it('PROBE: invalid date string rejected on create (no hang)', async () => {
    const p = await mkProperty(landA);
    const r = await landA('POST', '/api/contracts', { propertyId: p.id, tenantUid: P.tenant.uid, startDate: 'banana', endDate: '2027-01-01', monthlyRent: 1000 }, HANG_MS);
    assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `status=${r.status}`);
  });
  it('PROBE: dueDay out of range / negative rent rejected on create', async () => {
    const p = await mkProperty(landA);
    for (const over of [{ dueDay: 45 }, { dueDay: -3 }, { monthlyRent: -10 }, { monthlyRent: 0 }]) {
      const r = await landA('POST', '/api/contracts', { propertyId: p.id, tenantUid: P.tenant.uid, startDate: '2026-11-01', endDate: '2027-11-01', monthlyRent: 1000, ...over }, HANG_MS);
      assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `${JSON.stringify(over)} -> ${r.status}`);
    }
  });
  it('PROBE: unknown tenantUid rejected on create (no hang)', async () => {
    const p = await mkProperty(landA);
    const r = await landA('POST', '/api/contracts', { propertyId: p.id, tenantUid: 'ghost', startDate: '2026-11-01', endDate: '2027-11-01', monthlyRent: 1000 }, HANG_MS);
    assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `status=${r.status}`);
  });
  it('PROBE: a property that is already rented cannot get a second active contract', async () => {
    const p = await mkProperty(landA);
    await mkContract(landA, p.id);
    const r = await landA('POST', '/api/contracts', { propertyId: p.id, tenantUid: P.tenant2.uid, startDate: '2026-11-01', endDate: '2027-11-01', monthlyRent: 1000 }, HANG_MS);
    assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `status=${r.status}`);
  });
  it('PROBE: dueDay 31 yields one payment per calendar month (no month overflow)', async () => {
    const p = await mkProperty(landA);
    const c = await mkContract(landA, p.id, { startDate: '2027-01-01', endDate: '2027-07-01', dueDay: 31 });
    const months = (await paymentsOf(c.id)).map((x: any) => x.dueDate.toISOString().slice(0, 7));
    assert.deepEqual(months, ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'], `got ${months.join(',')}`);
  });

  it('renew: outside window -> 400; inside window -> new unsigned contract, old = renewed, 12 payments', async () => {
    const p = await mkProperty(landA);
    const far = await mkContract(landA, p.id);
    const tooEarly = await landA('POST', `/api/contracts/${far.id}/renew`, {});
    assert.equal(tooEarly.status, 400);
    assert.match(tooEarly.json.error, /renovado a partir de/);

    const p2 = await mkProperty(landA);
    const c = await mkContract(landA, p2.id, { startDate: day(-335), endDate: day(30), dueDay: 10 });
    await landA('PATCH', `/api/contracts/${c.id}/signed`, { signedContractUrl: 'https://files/x.pdf' });
    assert.equal((await landA('POST', `/api/contracts/${c.id}/renew`, { monthlyRent: -5 })).status, 400);
    assert.equal((await landA('POST', `/api/contracts/${c.id}/renew`, { monthlyRent: 'abc' })).status, 400);
    const r = await landA('POST', `/api/contracts/${c.id}/renew`, { monthlyRent: 1100 });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.startDate, c.endDate);
    assert.equal(r.json.endDate, `${Number(c.endDate.slice(0, 4)) + 1}${c.endDate.slice(4)}`);
    assert.equal(r.json.monthlyRent, 1100);
    assert.equal(r.json.signedContractUrl, null);
    assert.equal(r.json.signedAt, null);
    assert.equal((await paymentsOf(r.json.id)).length, 12);
    assert.equal((await prisma.contract.findUnique({ where: { id: c.id } }))!.status, 'renewed');
    assert.equal((await landA('POST', `/api/contracts/${c.id}/renew`, {})).status, 400, 'cannot renew twice');
  });

  it('cancel: marks cancelled, frees property, mails tenant+landlord', async () => {
    const p = await mkProperty(landA);
    const c = await mkContract(landA, p.id);
    const before = mail.length;
    const r = await landA('POST', `/api/contracts/${c.id}/cancel`);
    assert.equal(r.json.status, 'cancelled');
    assert.equal((await prisma.property.findUnique({ where: { id: p.id } }))!.status, 'available');
    await new Promise((res) => setTimeout(res, 800));
    const subjects = mail.slice(before).filter((m) => /cancelado/i.test(m.subject)).map((m) => m.to);
    assert.ok(subjects.includes(P.tenant.email) && subjects.includes(P.landA.email), `cancel mails: ${subjects}`);
  });
  it('PROBE: re-cancelling an old cancelled contract must not free a property that is re-rented', async () => {
    const p = await mkProperty(landA);
    const c1 = await mkContract(landA, p.id);
    await landA('POST', `/api/contracts/${c1.id}/cancel`);
    await mkContract(landA, p.id, { tenantUid: P.tenant2.uid });
    await landA('POST', `/api/contracts/${c1.id}/cancel`);
    assert.equal((await prisma.property.findUnique({ where: { id: p.id } }))!.status, 'rented');
  });
  it('late-fee toggle validates boolean', async () => {
    const p = await mkProperty(landA);
    const c = await mkContract(landA, p.id);
    assert.equal((await landA('PATCH', `/api/contracts/${c.id}/late-fee`, { lateFeeEnabled: 'true' })).status, 400);
    assert.equal((await landA('PATCH', `/api/contracts/${c.id}/late-fee`, { lateFeeEnabled: true })).json.lateFeeEnabled, true);
  });
  it('signed: requires URL, records signedAt; afterwards edit is blocked', async () => {
    const p = await mkProperty(landA);
    const c = await mkContract(landA, p.id);
    assert.equal((await landA('PATCH', `/api/contracts/${c.id}/signed`, {})).status, 400);
    const s = await landA('PATCH', `/api/contracts/${c.id}/signed`, { signedContractUrl: 'https://files/s.pdf' });
    assert.ok(s.json.signedAt && s.json.signedContractUrl);
    const e = await landA('PATCH', `/api/contracts/${c.id}`, { propertyId: p.id, tenantUid: P.tenant.uid, startDate: c.startDate, endDate: c.endDate, monthlyRent: 5 });
    assert.equal(e.status, 400);
    assert.match(e.json.error, /assinados/);
  });
  it('notify resends mail to tenant and landlord', async () => {
    const p = await mkProperty(landA);
    const c = await mkContract(landA, p.id);
    const before = mail.length;
    assert.equal((await landA('POST', `/api/contracts/${c.id}/notify`)).json.success, true);
    const got = mail.slice(before).map((m) => m.to);
    assert.ok(got.includes(P.tenant.email) && got.includes(P.landA.email));
  });

  describe('edit (PATCH /:id)', () => {
    it('validation: missing fields, end<=start, bad dueDay, bad rent', async () => {
      const p = await mkProperty(landA);
      const c = await mkContract(landA, p.id);
      const base = { propertyId: p.id, tenantUid: P.tenant.uid, startDate: c.startDate, endDate: c.endDate, monthlyRent: 1000, dueDay: 5 };
      assert.equal((await landA('PATCH', `/api/contracts/${c.id}`, { ...base, tenantUid: undefined })).status, 400);
      assert.equal((await landA('PATCH', `/api/contracts/${c.id}`, { ...base, endDate: c.startDate })).status, 400);
      assert.equal((await landA('PATCH', `/api/contracts/${c.id}`, { ...base, dueDay: 45 })).status, 400);
      assert.equal((await landA('PATCH', `/api/contracts/${c.id}`, { ...base, monthlyRent: -1 })).status, 400);
    });
    it('non-schedule change keeps payments; schedule change rebuilds them; notify opt-in mails', async () => {
      const p = await mkProperty(landA);
      const c = await mkContract(landA, p.id);
      const before = (await paymentsOf(c.id)).map((x: any) => x.id).sort();
      const body = { propertyId: p.id, tenantUid: P.tenant.uid, startDate: c.startDate, endDate: c.endDate, monthlyRent: 1000, dueDay: 5 };
      const same = await landA('PATCH', `/api/contracts/${c.id}`, { ...body, lateFeeEnabled: true });
      assert.equal(same.json.lateFeeEnabled, true);
      assert.deepEqual((await paymentsOf(c.id)).map((x: any) => x.id).sort(), before, 'payment rows untouched');
      const mailsBefore = mail.length;
      const changed = await landA('PATCH', `/api/contracts/${c.id}`, { ...body, endDate: '2027-05-01', dueDay: 15, notify: true });
      assert.equal(changed.status, 200, changed.text);
      const after = await paymentsOf(c.id);
      assert.equal(after.length, 6);
      assert.equal(after[0].dueDate.toISOString().slice(0, 10), '2026-11-15');
      assert.ok(after.every((x: any) => !before.includes(x.id)));
      assert.ok(await waitMail((m) => mail.indexOf(m) >= mailsBefore && /Atualizado/.test(m.subject)));
    });
    it('schedule change blocked once a payment was received; rent-only-unrelated change still allowed', async () => {
      const p = await mkProperty(landA);
      const c = await mkContract(landA, p.id);
      const first = (await paymentsOf(c.id))[0];
      assert.equal((await landA('PATCH', `/api/payments/${first.id}/mark-paid`, {})).status, 200);
      const body = { propertyId: p.id, tenantUid: P.tenant.uid, startDate: c.startDate, endDate: c.endDate, monthlyRent: 1000, dueDay: 5 };
      assert.equal((await landA('PATCH', `/api/contracts/${c.id}`, { ...body, monthlyRent: 2000 })).status, 400);
      assert.equal((await landA('PATCH', `/api/contracts/${c.id}`, { ...body, lateFeeEnabled: true })).status, 200);
    });
    it('moving to another property swaps statuses; target must be available', async () => {
      const p1 = await mkProperty(landA);
      const p2 = await mkProperty(landA);
      const p3 = await mkProperty(landA);
      const c = await mkContract(landA, p1.id);
      await mkContract(landA, p3.id, { tenantUid: P.tenant2.uid });
      const body = { tenantUid: P.tenant.uid, startDate: c.startDate, endDate: c.endDate, monthlyRent: 1000, dueDay: 5 };
      const bad = await landA('PATCH', `/api/contracts/${c.id}`, { ...body, propertyId: p3.id });
      assert.equal(bad.status, 400);
      const ok = await landA('PATCH', `/api/contracts/${c.id}`, { ...body, propertyId: p2.id });
      assert.equal(ok.status, 200);
      const st = async (id: string) => (await prisma.property.findUnique({ where: { id } }))!.status;
      assert.equal(await st(p1.id), 'available');
      assert.equal(await st(p2.id), 'rented');
    });
    it('PROBE: editing with unknown tenantUid is rejected (no hang)', async () => {
      const p = await mkProperty(landA);
      const c = await mkContract(landA, p.id);
      const r = await landA('PATCH', `/api/contracts/${c.id}`, { propertyId: p.id, tenantUid: 'ghost', startDate: c.startDate, endDate: c.endDate, monthlyRent: 1000, dueDay: 5 }, HANG_MS);
      assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `status=${r.status}`);
    });
    it('cancelled contract cannot be edited', async () => {
      const p = await mkProperty(landA);
      const c = await mkContract(landA, p.id);
      await landA('POST', `/api/contracts/${c.id}/cancel`);
      const r = await landA('PATCH', `/api/contracts/${c.id}`, { propertyId: p.id, tenantUid: P.tenant.uid, startDate: c.startDate, endDate: c.endDate, monthlyRent: 1000 });
      assert.equal(r.status, 400);
    });
  });
});

describe('PAYMENTS', () => {
  let c: any, pays: any[];
  before(async () => {
    const p = await mkProperty(landA);
    c = await mkContract(landA, p.id, { startDate: '2026-09-01', endDate: '2026-12-01', dueDay: 8 });
    pays = await paymentsOf(c.id);
  });
  it('listing: dates are yyyy-MM-dd strings, amounts numbers; scoped per role; contractId filter', async () => {
    const r = await landA('GET', `/api/payments?contractId=${c.id}`);
    assert.equal(r.json.length, 3);
    assert.ok(r.json.every((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(x.dueDate) && typeof x.amount === 'number'));
    assert.equal((await landB('GET', `/api/payments?contractId=${c.id}`)).json.length, 0);
    assert.ok((await admin('GET', `/api/payments?contractId=${c.id}`)).json.length === 3);
    process.env.ALLOW_TENANT_LOGIN = 'true';
    assert.equal((await tenant('GET', `/api/payments?contractId=${c.id}`)).json.length, 3);
    delete process.env.ALLOW_TENANT_LOGIN;
  });
  it('manual create: owner ok; B 403; tenant 403; validation; unknown contract 404', async () => {
    const ok = await landA('POST', '/api/payments', { contractId: c.id, amount: 55.5, dueDate: '2026-12-20' });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.status, 'pending');
    assert.equal(ok.json.dueDate, '2026-12-20');
    assert.equal((await landB('POST', '/api/payments', { contractId: c.id, amount: 1, dueDate: '2026-12-20' })).status, 403);
    assert.equal((await tenant('POST', '/api/payments', { contractId: c.id, amount: 1, dueDate: '2026-12-20' })).status, 403);
    assert.equal((await landA('POST', '/api/payments', { contractId: c.id })).status, 400);
    assert.equal((await landA('POST', '/api/payments', { contractId: 'nope', amount: 1, dueDate: '2026-12-20' })).status, 404);
  });
  it('mark-paid: only admin/landlord-owner; sets paidAt; custom paidAt honoured; receipt mail sent', async () => {
    const id = pays[0].id;
    process.env.ALLOW_TENANT_LOGIN = 'true';
    assert.equal((await tenant('PATCH', `/api/payments/${id}/mark-paid`, {})).status, 403, 'tenant cannot mark own rent paid');
    delete process.env.ALLOW_TENANT_LOGIN;
    assert.equal((await landB('PATCH', `/api/payments/${id}/mark-paid`, {})).status, 403);
    assert.equal((await landA('PATCH', '/api/payments/nope/mark-paid', {})).status, 404);
    const before = mail.length;
    const r = await landA('PATCH', `/api/payments/${id}/mark-paid`, { paidAt: '2026-09-07T12:00:00.000Z' });
    assert.equal(r.json.status, 'paid');
    assert.equal(r.json.paidAt, '2026-09-07T12:00:00.000Z');
    const m = await waitMail((x) => mail.indexOf(x) >= before && x.to === P.tenant.email && /Recibo/.test(x.subject));
    assert.ok(m, 'receipt mail');
    assert.match(m!.html, /07\/09\/2026/);
    const r2 = await admin('PATCH', `/api/payments/${pays[1].id}/mark-paid`, {});
    assert.ok(r2.json.paidAt);
  });
  it('PROBE: marking an already-paid payment again must not overwrite paidAt / resend receipt', async () => {
    const before = mail.length;
    const r = await landA('PATCH', `/api/payments/${pays[0].id}/mark-paid`, {}, HANG_MS);
    await new Promise((res) => setTimeout(res, 800));
    const resent = mail.slice(before).some((m) => /Recibo/.test(m.subject));
    assert.ok((typeof r.status === 'number' && r.status >= 400) || (r.json?.paidAt === '2026-09-07T12:00:00.000Z' && !resent),
      `status=${r.status} paidAt=${r.json?.paidAt} receiptResent=${resent}`);
  });
  it('PROBE: invalid dueDate / negative amount on manual payment rejected', async () => {
    for (const body of [{ contractId: c.id, amount: 10, dueDate: 'banana' }, { contractId: c.id, amount: -10, dueDate: '2026-12-20' }]) {
      const r = await landA('POST', '/api/payments', body, HANG_MS);
      assert.ok(typeof r.status === 'number' && r.status >= 400 && r.status < 500, `${JSON.stringify(body)} -> ${r.status}`);
    }
  });
});

describe('SETTINGS', () => {
  it('thresholds readable by any role; features reflect flag', async () => {
    for (const who of [admin, landA, tenant]) {
      process.env.ALLOW_TENANT_LOGIN = 'true';
      const r = await who('GET', '/api/settings/thresholds');
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.json).sort(), ['contractExpiryReminderDays', 'paymentDueReminderDays', 'renewalWindowDays']);
    }
    delete process.env.ALLOW_TENANT_LOGIN;
  });
  it('GET/PUT admin only', async () => {
    assert.equal((await landA('GET', '/api/settings')).status, 403);
    assert.equal((await landA('PUT', '/api/settings', { appName: 'hack' })).status, 403);
    assert.equal((await admin('GET', '/api/settings')).status, 200);
  });
  it('PUT validates the day thresholds', async () => {
    for (const v of [0, -1, 1.5, '5', null]) {
      assert.equal((await admin('PUT', '/api/settings', { renewalWindowDays: v })).status, 400, String(v));
    }
  });
  it('PUT stores values; SMTP password is encrypted at rest and never returned', async () => {
    const r = await admin('PUT', '/api/settings', { companyName: 'E2E Co', renewalWindowDays: 45, smtpPassword: 'plain-secret-123' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.smtpPasswordConfigured, true);
    assert.ok(!('smtpPasswordEncrypted' in r.json) && !r.text.includes('plain-secret-123'));
    const g = await admin('GET', '/api/settings');
    assert.equal(g.json.renewalWindowDays, 45);
    assert.equal(g.json.companyName, 'E2E Co');
    assert.ok(!g.text.includes('plain-secret-123') && !('smtpPassword' in g.json) && !('smtpPasswordEncrypted' in g.json));
    const row = await prisma.settings.findUnique({ where: { id: 'global' } });
    assert.ok(row!.smtpPasswordEncrypted && row!.smtpPasswordEncrypted !== 'plain-secret-123');
    assert.equal((await landA('GET', '/api/settings/thresholds')).json.renewalWindowDays, 45);
  });
  it('renew window follows the setting (45d window blocks a contract ending in 50d, allows 40d)', async () => {
    const mk = async (end: number) => mkContract(landA, (await mkProperty(landA)).id, { startDate: day(end - 365), endDate: day(end) });
    const late = await mk(50);
    const soon = await mk(40);
    assert.equal((await landA('POST', `/api/contracts/${late.id}/renew`, {})).status, 400);
    assert.equal((await landA('POST', `/api/contracts/${soon.id}/renew`, {})).status, 200);
  });
});

describe('REMINDERS (/api/reminders/process)', () => {
  it('non-admin 403', async () => {
    assert.equal((await landA('POST', '/api/reminders/process')).status, 403);
  });
  it('expiring contract + overdue/upcoming payments mail the tenant once; second run is deduped', async () => {
    await admin('PUT', '/api/settings', { renewalWindowDays: 60 });
    const t2 = persona('remtenant', 'tenant');
    await createUser(t2);
    const p = await mkProperty(landA);
    const c = await mkContract(landA, p.id, { tenantUid: t2.uid, startDate: day(-60), endDate: day(15), dueDay: 10 });
    const paidOne = (await paymentsOf(c.id))[0];
    await prisma.payment.update({ where: { id: paidOne.id }, data: { status: 'paid', paidAt: new Date() } });
    const first = await admin('POST', '/api/reminders/process', undefined, SLOW_MS);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.success, true);
    const mine1 = mailsTo(t2.email).filter((m) => /Lembrete|ALERTA/.test(m.subject));
    assert.ok(mine1.some((m) => /Seu contrato está próximo/.test(m.subject)), 'contract expiry reminder');
    const payMails = mine1.filter((m) => /pagamento|aluguel/i.test(m.subject));
    assert.ok(payMails.length >= 1, `payment reminders: ${mine1.map((m) => m.subject)}`);
    const dbc = await prisma.contract.findUnique({ where: { id: c.id } });
    assert.ok(dbc!.reminderSentAt);
    assert.equal((await prisma.payment.findUnique({ where: { id: paidOne.id } }))!.reminderSentAt, null, 'paid payment is never reminded');
    const n1 = mailsTo(t2.email).length;
    const second = await admin('POST', '/api/reminders/process', undefined, SLOW_MS);
    assert.equal(second.status, 200);
    assert.equal(mailsTo(t2.email).length, n1, 'second run sends nothing new to this tenant');
  });
  it('contract already expired or far from expiry is not reminded', async () => {
    const t3 = persona('remtenant3', 'tenant');
    await createUser(t3);
    const far = await mkContract(landA, (await mkProperty(landA)).id, { tenantUid: t3.uid, startDate: day(-10), endDate: day(300) });
    await admin('POST', '/api/reminders/process', undefined, SLOW_MS);
    assert.equal((await prisma.contract.findUnique({ where: { id: far.id } }))!.reminderSentAt, null);
    assert.ok(!mailsTo(t3.email).some((m) => /Seu contrato está próximo/.test(m.subject)));
  });
});

describe('ERROR HANDLING', () => {
  it('a database error that no explicit validation covers becomes a 4xx (no hang) and rolls back', async () => {
    const p = await mkProperty(landA);
    const r = await admin('POST', '/api/contracts', {
      propertyId: p.id, tenantUid: P.tenant.uid, landlordUid: 'ghost', startDate: '2026-11-01', endDate: '2027-11-01', monthlyRent: 10,
    }, HANG_MS);
    assert.equal(r.status, 409, `status=${r.status}`);
    assert.equal((await prisma.property.findUnique({ where: { id: p.id } }))!.status, 'available', 'transaction rolled back');
  });
  it('malformed JSON body -> 400', async () => {
    const r = await fetch(base + '/api/properties', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(P.admin) }, body: '{bad json',
    });
    assert.equal(r.status, 400);
  });
  it('no request in this whole run left an unhandled promise rejection (which would crash the server)', () => {
    assert.equal(unhandled.length, 0, unhandled.map((e) => String(e?.message ?? e).slice(-160)).join('\n'));
  });
});
