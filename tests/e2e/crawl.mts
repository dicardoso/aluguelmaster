import { chromium } from 'playwright';
import fs from 'node:fs';
import { startHarness, prisma, sweep, snapshot, restore, createUser, persona, tokenFor, client, OUT } from '../lib/harness.mts';

const SHOTS = `${OUT}/shots-crawl`;
fs.mkdirSync(SHOTS, { recursive: true });

await sweep();
const snap = await snapshot();
const h = await startHarness({ vite: true });
const P = { admin: persona('admin', 'admin'), landA: persona('landA', 'landlord'), tenant: persona('tenant', 'tenant') };
for (const p of Object.values(P)) await createUser(p);
const land = client(h.url, tokenFor(P.landA));
const prop = (await land('POST', '/api/properties', { address: 'Av. Teste E2E, 100', type: 'residential', monthlyRent: 1800, description: 'Apto de teste' })).json;
await land('POST', '/api/contracts', { propertyId: prop.id, tenantUid: P.tenant.uid, startDate: '2026-08-01', endDate: '2027-08-01', dueDay: 10, monthlyRent: 1800 });

const browser = await chromium.launch();
const report: string[] = [];
const routes = ['/', '/properties', '/contracts', '/payments', '/users', '/settings', '/profile'];

async function visit(label: string, p: typeof P.admin | null, flagTenant = false) {
  if (flagTenant) process.env.ALLOW_TENANT_LOGIN = 'true'; else delete process.env.ALLOW_TENANT_LOGIN;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (p) await ctx.addInitScript((t) => localStorage.setItem('e2e_token', t), tokenFor(p));
  const page = await ctx.newPage();
  const issues: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') issues.push(`console.error: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) issues.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  for (const route of routes) {
    await page.goto(h.url + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const name = `${label}${route === '/' ? '-home' : route.replace('/', '-')}`;
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    report.push(`${label} ${route} -> url=${new URL(page.url()).pathname} title="${(await page.locator('h1,h2').first().textContent().catch(() => '') || '').trim().slice(0, 50)}"`);
  }
  report.push(`   issues(${label}): ${issues.length ? '\n     ' + [...new Set(issues)].join('\n     ') : 'none'}`);
  await ctx.close();
}

try {
  await visit('anon', null);
  await visit('admin', P.admin);
  await visit('landlord', P.landA);
  await visit('tenant-off', P.tenant, false);
  await visit('tenant-on', P.tenant, true);
} finally {
  await browser.close();
  console.log(report.join('\n'));
  delete process.env.ALLOW_TENANT_LOGIN;
  await sweep();
  await restore(snap);
  process.exit(0);
}
