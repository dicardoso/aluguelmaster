// Shared test harness: boots the real Express app in-process (optionally with the Vite dev
// middleware for browser tests) with Firebase auth stubbed and outbound mail captured, plus
// fixtures that can be swept from the database afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
export const FAKES = `${ROOT}/tests/fakes`;
// Screenshots, downloads and the persistent Chrome profile of the browser tests land here (gitignored).
export const OUT = `${ROOT}/tests/.output`;
fs.mkdirSync(OUT, { recursive: true });
export const MAIL_DOMAIN = 'e2e.locatto.local';
process.chdir(ROOT);
const req = createRequire(ROOT + '/package.json');
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
await imp('node_modules/dotenv/config.js');

// These tests create and delete rows in whatever DATABASE_URL points at, so refuse to run
// unless the environment says it's a non-production one.
{
  const dbUrl = process.env.DATABASE_URL ?? '';
  const prodHost = process.env.PRODUCTION_DATABASE_HOST;
  if (!['develop', 'local', 'test'].includes(process.env.APP_ENV ?? '')) {
    throw new Error(`Refusing to run: APP_ENV is "${process.env.APP_ENV ?? ''}" (tests need develop, local or test).`);
  }
  if (!dbUrl || (prodHost && dbUrl.includes(prodHost))) {
    throw new Error('Refusing to run: DATABASE_URL is missing or points at the production database.');
  }
}

export const unhandled: any[] = [];
export const mail: { to: string; subject: string; html: string }[] = [];

export const { prisma } = await imp('src/server/prisma.ts');
const nodemailer = req('nodemailer');
const admin = req('firebase-admin');

// Never send real mail: Settings in this DB holds live SMTP credentials.
nodemailer.createTransport = () => ({
  sendMail: async (o: any) => { mail.push({ to: o.to, subject: o.subject, html: o.html }); return { messageId: 'e2e' }; },
});

export const tokenFor = (p: { uid: string; email: string; name?: string; verified?: boolean }) =>
  'test.' + Buffer.from(JSON.stringify({ uid: p.uid, email: p.email, name: p.name, email_verified: p.verified ?? true })).toString('base64');

export async function startHarness(opts: { vite?: boolean; port?: number; keepUnhandledHandler?: boolean } = {}) {
  if (opts.keepUnhandledHandler !== false) process.on('unhandledRejection', (e) => { unhandled.push(e); });
  const { createApp } = await imp('src/server/app.ts');
  const app = createApp();
  admin.auth().verifyIdToken = async (t: string) => {
    if (!t.startsWith('test.')) throw new Error('bad token');
    const c = JSON.parse(Buffer.from(t.slice(5), 'base64').toString());
    return { uid: c.uid, email: c.email, name: c.name, email_verified: c.email_verified };
  };
  if (opts.vite) {
    const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href);
    const fakeMap: Record<string, string> = {
      'firebase/auth': `${FAKES}/firebase-auth.ts`,
      'firebase/storage': `${FAKES}/firebase-storage.ts`,
    };
    const vite = await createServer({
      root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), appType: 'spa',
      server: { middlewareMode: true, fs: { strict: false } },
      plugins: [{
        name: 'e2e-fake-firebase', enforce: 'pre',
        resolveId(id: string, importer?: string) {
          if (fakeMap[id]) return fakeMap[id];
          if (id.startsWith('.') && /\/firebase$/.test(id) && importer && !importer.includes('node_modules')) return `${FAKES}/firebase.ts`;
        },
      }],
    });
    app.use(vite.middlewares);
  }
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  return { app, server, url };
}

// ---- data fixtures: everything carries the e2e mail domain so it can be swept ----
export const run = Date.now().toString(36);
export const persona = (key: string, role: 'admin' | 'landlord' | 'tenant') => ({
  uid: `test_${run}_${key}`, email: `${key}.${run}@${MAIL_DOMAIN}`.toLowerCase(), name: `E2E ${key}`, role,
});
export async function createUser(p: ReturnType<typeof persona>, extra: any = {}) {
  return prisma.user.create({
    data: { id: p.uid, email: p.email, displayName: p.name, role: p.role, cpf: '000.000.000-00', address: 'Rua E2E, 1', ...extra },
  });
}

export async function sweep() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@' + MAIL_DOMAIN } }, select: { id: true } });
  const ids = users.map((u: any) => u.id);
  if (!ids.length) return 0;
  const contracts = await prisma.contract.findMany({
    where: { OR: [{ landlordUid: { in: ids } }, { tenantUid: { in: ids } }] }, select: { id: true },
  });
  const cids = contracts.map((c: any) => c.id);
  await prisma.payment.deleteMany({ where: { OR: [{ contractId: { in: cids } }, { tenantUid: { in: ids } }] } });
  await prisma.contract.deleteMany({ where: { id: { in: cids } } });
  await prisma.property.deleteMany({ where: { ownerUid: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

// Snapshots of pre-existing rows the tests might touch (settings, reminderSentAt on seed data)
export async function snapshot() {
  const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
  const contracts = await prisma.contract.findMany({ select: { id: true, reminderSentAt: true } });
  const payments = await prisma.payment.findMany({ select: { id: true, reminderSentAt: true } });
  return { settings, contracts, payments };
}
export async function restore(s: Awaited<ReturnType<typeof snapshot>>) {
  if (s.settings) { const { id, ...rest } = s.settings; await prisma.settings.update({ where: { id }, data: rest }); }
  else await prisma.settings.deleteMany({ where: { id: 'global' } });
  for (const c of s.contracts) await prisma.contract.updateMany({ where: { id: c.id }, data: { reminderSentAt: c.reminderSentAt } });
  for (const p of s.payments) await prisma.payment.updateMany({ where: { id: p.id }, data: { reminderSentAt: p.reminderSentAt } });
}

export function client(base: string, token?: string) {
  return async (method: string, p: string, body?: any, timeoutMs = 15000) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(base + p, {
        method, signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      return { status: r.status as number | string, json, text };
    } catch (e: any) {
      return { status: e.name === 'AbortError' ? 'HANG' : 'ERR', json: null, text: String(e) };
    } finally { clearTimeout(t); }
  };
}
