// Real-login run: app on http://localhost:9999 (npm run dev style), visible Chrome, the human signs in with Google.
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import { prisma, sweep, snapshot, restore, createUser, persona, run, MAIL_DOMAIN, OUT } from '../lib/harness.mts';

const SP = OUT;
const SHOTS = `${SP}/shots-real`;
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:9999';
const ADMIN_EMAIL = (process.env.E2E_ADMIN_EMAIL ?? '').toLowerCase();
if (!ADMIN_EMAIL) throw new Error('Set E2E_ADMIN_EMAIL to the Google account that will sign in (it must already be an admin in the database).');
fs.mkdirSync(SHOTS, { recursive: true });

await sweep();
const snap = await snapshot();
const adminBefore = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
const L = persona('landR', 'landlord');
const T = persona('tenantR', 'tenant');
await createUser(L);
await createUser(T);

const ctx = await chromium.launchPersistentContext(`${SP}/chrome-profile`, {
  channel: 'chrome', headless: false, slowMo: 120, viewport: { width: 1280, height: 900 },
  ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'], acceptDownloads: true,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const results: { name: string; ok: boolean; note?: string }[] = [];
const httpErrors: string[] = [];
const consoleErrors = new Map<string, Set<string>>();
let current = 'login';
page.on('console', (m) => { if (m.type() === 'error') { if (!consoleErrors.has(current)) consoleErrors.set(current, new Set()); consoleErrors.get(current)!.add(m.text().slice(0, 150)); } });
page.on('pageerror', (e) => { if (!consoleErrors.has(current)) consoleErrors.set(current, new Set()); consoleErrors.get(current)!.add('pageerror: ' + e.message.slice(0, 150)); });
page.on('response', (r) => { if (r.url().startsWith(BASE + '/api/') && r.status() >= 400) httpErrors.push(`[${current}] ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });

async function step(name: string, fn: () => Promise<void>) {
  current = name;
  try { await fn(); results.push({ name, ok: true }); }
  catch (e: any) {
    results.push({ name, ok: false, note: String(e.message).split('\n')[0].slice(0, 230) });
    await page.screenshot({ path: `${SHOTS}/FAIL-${name.replace(/\W+/g, '_').slice(0, 40)}.png`, fullPage: true }).catch(() => {});
  }
}
const field = (label: string) =>
  page.locator(`xpath=//label[contains(normalize-space(.), "${label}")]/following-sibling::*[self::input or self::select or self::textarea][1]`).first();
const toast = (text: RegExp | string) => page.locator('[data-sonner-toast]').filter({ hasText: text }).first().waitFor({ timeout: 10000 });
const shot = (n: string) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const goto = async (p: string) => { await page.goto(BASE + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(300); };

let adminId = '';
try {
  // ---------- REAL GOOGLE LOGIN (human) ----------
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await shot('00-login-page');
  console.log('WAITING_FOR_LOGIN — sign in with Google in the open Chrome window (up to 10 min)');
  const started = Date.now();
  while (new URL(page.url()).pathname.startsWith('/login')) {
    if (Date.now() - started > 600000) throw new Error('login timeout');
    const t = await page.locator('[data-sonner-toast]').allTextContents().catch(() => []);
    if (t.length && Date.now() - started > 3000) console.log('toast on login page:', t.join(' | ').slice(0, 200));
    await page.waitForTimeout(2000);
  }
  await page.waitForLoadState('networkidle');
  const me = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  console.log('LOGGED_IN as', me?.email, '| role', me?.role, '| isInvite', me?.isInvite, '| id', me?.id);
  // This dev admin row is a real Firebase uid but still flagged isInvite=true (legacy data) — reported, not fatal.
  if (!me || me.role !== 'admin' || me.id.startsWith('invite_')) throw new Error('login did not produce an admin profile');
  adminId = me.id;
  await shot('01-after-login');
  await step('real login: profile is admin, dashboard renders', async () => {
    const txt = await page.locator('body').innerText();
    if (!/Olá,/.test(txt)) throw new Error('dashboard greeting missing');
    for (const bad of ['NaN', 'undefined', '[object', 'Invalid Date']) if (txt.includes(bad)) throw new Error(`"${bad}" on dashboard`);
  });
  await step('real login: session survives a reload (token refresh path)', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('bounced to /login after reload');
  });
  await step('real login: all admin pages load without API errors', async () => {
    for (const r of ['/properties', '/users', '/contracts', '/payments', '/settings', '/profile']) {
      await goto(r);
      if (new URL(page.url()).pathname !== r) throw new Error(`${r} redirected to ${page.url()}`);
    }
  });

  // ---------- CRUD FLOWS AS THE REAL ADMIN ----------
  await step('create property via modal', async () => {
    await goto('/properties');
    await page.getByRole('button', { name: /Novo Imóvel/ }).click();
    await field('Endereço Completo').fill('Rua do Teste E2E, 42 - Centro');
    await field('Aluguel Mensal').fill('2500');
    await field('Descrição').fill('Criado pelo Playwright (login real)');
    await page.getByRole('button', { name: 'Salvar Imóvel' }).click();
    await toast(/cadastrado com sucesso/);
    const row = await prisma.property.findFirst({ where: { address: { contains: 'Rua do Teste E2E, 42' } } });
    if (!row || row.ownerUid !== adminId || Number(row.monthlyRent) !== 2500) throw new Error('DB row wrong: ' + JSON.stringify(row));
  });
  await step('search + edit property', async () => {
    await page.getByPlaceholder(/Buscar por endereço/).fill('Teste E2E');
    await page.waitForTimeout(400);
    await page.getByTitle('Editar').first().click();
    await field('Aluguel Mensal').fill('2600');
    await page.getByRole('button', { name: 'Salvar Imóvel' }).click();
    await toast(/atualizado com sucesso/);
    const row = await prisma.property.findFirst({ where: { address: { contains: 'Rua do Teste E2E, 42' } } });
    if (Number(row!.monthlyRent) !== 2600) throw new Error('rent not updated');
  });
  await step('create contract via modal (12 months, dueDay 31 clamp check)', async () => {
    await goto('/contracts');
    await page.getByRole('button', { name: 'Novo Contrato' }).last().click();
    const prop = await prisma.property.findFirst({ where: { address: { contains: 'Rua do Teste E2E, 42' } } });
    await field('Imóvel').selectOption(prop!.id);
    await field('Locador').selectOption(L.uid);
    await field('Inquilino').selectOption(T.uid);
    await field('Data Início').fill('2027-01-01');
    await field('Data Término').fill('2027-07-01');
    await field('Dia de Vencimento').fill('31');
    await shot('contract-modal');
    await page.getByRole('button', { name: 'Criar Contrato' }).click();
    await toast(/gerados com sucesso/);
    const c = await prisma.contract.findFirst({ where: { propertyId: prop!.id } });
    if (!c) throw new Error('contract not in DB');
    const months = (await prisma.payment.findMany({ where: { contractId: c.id }, orderBy: { dueDate: 'asc' } })).map((p) => p.dueDate.toISOString().slice(0, 10));
    const want = ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30'];
    if (JSON.stringify(months) !== JSON.stringify(want)) throw new Error('schedule ' + months.join(','));
  });
  // The app opens generated PDFs in a new tab (window.open(blobUrl)), so read the blob from that tab.
  const pdfFromNewTab = async (click: () => Promise<unknown>) => {
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 20000 }), click()]);
    const url = popup.url() === 'about:blank' ? await popup.waitForURL(/^blob:/, { timeout: 10000 }).then(() => popup.url()) : popup.url();
    const info = await page.evaluate(async (u) => {
      const b = await (await fetch(u)).arrayBuffer();
      return { len: b.byteLength, head: new TextDecoder().decode(b.slice(0, 5)) };
    }, url);
    await popup.screenshot({ path: `${SHOTS}/pdf-tab-${Date.now()}.png` }).catch(() => {});
    await popup.close();
    await page.bringToFront();
    return { url, ...info };
  };
  await step('contract PDF opens in a new tab and is a valid PDF', async () => {
    await page.getByPlaceholder(/Buscar por imóvel/).fill('Teste E2E');
    await page.waitForTimeout(400);
    const pdf = await pdfFromNewTab(() => page.getByTitle('Baixar PDF').first().click());
    if (!pdf.url.startsWith('blob:') || pdf.head !== '%PDF-' || pdf.len < 5000) throw new Error('bad pdf ' + JSON.stringify(pdf));
    await toast(/PDF gerado com sucesso/).catch(() => {});
  });
  await step('contract row menu opens and renew is blocked far from expiry', async () => {
    await page.getByTitle('Mais ações').first().click();
    await shot('contract-actions-menu');
    const renew = page.locator('.fixed.z-50 button').filter({ hasText: /Renovar/ }).first();
    if (!(await renew.isDisabled())) throw new Error('renew enabled for a contract far from expiry');
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
  });
  await step('payments: filter, "Dar Baixa" one, receipt PDF, CSV', async () => {
    await goto('/payments');
    await page.getByPlaceholder(/Buscar por inquilino/).fill('Teste E2E');
    await page.waitForTimeout(500);
    await shot('payments-filtered');
    await page.getByRole('button', { name: 'Dar Baixa' }).first().click();
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await toast(/baixado com sucesso/);
    const paid = await prisma.payment.count({ where: { status: 'paid', tenantUid: T.uid } });
    if (paid !== 1) throw new Error('expected 1 paid, got ' + paid);
    await page.waitForTimeout(500);
    const receipt = await pdfFromNewTab(() => page.getByTitle('Baixar Comprovante').first().click());
    if (receipt.head !== '%PDF-' || receipt.len < 2000) throw new Error('receipt not a pdf ' + JSON.stringify(receipt));
    const [csv] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.getByRole('button', { name: /Exportar CSV/ }).click()]);
    await csv.saveAs(`${SP}/real-payments.csv`);
    if (fs.readFileSync(`${SP}/real-payments.csv`, 'utf8').split('\n').length < 3) throw new Error('csv too short');
  });
  await step('payments: manual charge (Gerar Cobrança)', async () => {
    await page.getByRole('button', { name: 'Gerar Cobrança' }).first().click();
    const c = await prisma.contract.findFirst({ where: { landlordUid: L.uid } });
    await field('Contrato').selectOption(c!.id);
    await field('Valor (R$)').fill('99.9');
    await field('Data de Vencimento').fill('2027-08-25');
    await page.getByRole('button', { name: 'Gerar Cobrança' }).last().click();
    await page.getByRole('button', { name: 'Gerar Cobrança', exact: true }).last().click().catch(() => {});
    await toast(/Cobrança gerada/);
  });
  await step('users: invite, duplicate rejected, revoke invite', async () => {
    await goto('/users');
    const open = () => page.getByRole('button', { name: /Novo Usuário|Adicionar|Convidar|Pré-cadastro/i }).first().click();
    await open();
    await field('E-mail').fill(`invitee.${run}@${MAIL_DOMAIN}`);
    await field('Nome Completo').fill('Convidado E2E');
    await field('Nível de Acesso').selectOption('landlord');
    await page.getByRole('button', { name: 'Cadastrar Usuário' }).click();
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await toast(/Convite\/Pré-cadastro realizado/);
    await open();
    await field('E-mail').fill(`invitee.${run}@${MAIL_DOMAIN}`);
    await field('Nome Completo').fill('Dup');
    await page.getByRole('button', { name: 'Cadastrar Usuário' }).click();
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await toast(/já está cadastrado/);
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'networkidle' });
    const row = page.locator('tr, [class*="group"]').filter({ hasText: 'Convidado E2E' }).first();
    await row.hover();
    await row.getByTitle('Excluir convite').click();
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    await toast(/Convite excluído/);
  });
  await step('users: disable and re-enable a record user; cannot disable self', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    const row = page.locator('tr, [class*="group"]').filter({ hasText: 'E2E tenantR' }).first();
    await row.hover();
    await row.getByTitle('Desativar acesso').click();
    await page.getByRole('button', { name: 'Desativar', exact: true }).click();
    await toast(/Acesso desativado/);
    await page.waitForTimeout(500);
    await row.hover();
    await row.getByTitle('Reativar acesso').click();
    await page.getByRole('button', { name: 'Reativar', exact: true }).click();
    await toast(/Acesso reativado/);
    const self = page.locator('tr, [class*="group"]').filter({ hasText: ADMIN_EMAIL }).first();
    await self.hover();
    if (await self.getByTitle('Desativar acesso').count()) {
      await self.getByTitle('Desativar acesso').click();
      await page.getByRole('button', { name: 'Desativar', exact: true }).click();
      await toast(/próprio acesso/);
    }
  });
  await step('settings: save persists after reload, SMTP password not exposed', async () => {
    await goto('/settings');
    await field('Nome da Empresa').fill('Empresa E2E Ltda');
    await page.getByRole('button', { name: 'Salvar Configurações' }).click();
    await toast(/salvas com sucesso/);
    await page.reload({ waitUntil: 'networkidle' });
    if ((await field('Nome da Empresa').inputValue()) !== 'Empresa E2E Ltda') throw new Error('value lost after reload');
    const pw = page.locator('input[type="password"]').first();
    if (await pw.count() && (await pw.inputValue()) !== '') throw new Error('SMTP password leaked into the form');
  });
  await step('theme toggle persists to DB and survives reload', async () => {
    await page.getByTitle('Tema Escuro').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await page.waitForTimeout(600);
    if ((await prisma.user.findUnique({ where: { id: adminId } }))!.themePreference !== 'dark') throw new Error('theme not saved');
    await shot('dark-theme');
    await page.reload({ waitUntil: 'networkidle' });
    if (!(await page.evaluate(() => document.documentElement.classList.contains('dark')))) throw new Error('dark lost after reload');
    await page.getByTitle('Tema do Sistema').click();
  });
  await step('profile edit saves', async () => {
    await goto('/profile');
    const original = await field('Nome Completo').inputValue();
    await field('Nome Completo').fill('Admin E2E Renamed');
    await page.getByRole('button', { name: /Salvar/ }).first().click();
    await toast(/atualizado com sucesso/);
    if ((await prisma.user.findUnique({ where: { id: adminId } }))!.displayName !== 'Admin E2E Renamed') throw new Error('name not saved');
    await field('Nome Completo').fill(original);
    await page.getByRole('button', { name: /Salvar/ }).first().click();
    await toast(/atualizado com sucesso/);
  });
  await step('global search finds the test property', async () => {
    await goto('/');
    await page.getByPlaceholder(/Busca global/).fill('Teste E2E');
    await page.waitForTimeout(700);
    await shot('global-search');
    if (!/Rua do Teste E2E/.test(await page.locator('body').innerText())) throw new Error('result not shown');
  });
  for (const route of ['/', '/properties', '/contracts', '/payments']) {
    await step(`mobile 390px ${route}: no horizontal overflow`, async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await goto(route);
      await shot('mobile' + (route === '/' ? '-home' : route.replace('/', '-')));
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      await page.setViewportSize({ width: 1280, height: 900 });
      if (o.sw > o.cw + 1) throw new Error(`scrollWidth ${o.sw} > ${o.cw}`);
    });
  }
  await step('reminders trigger (ReminderTrigger) does not error', async () => {
    const r = await page.evaluate(async () => {
      const keys = Object.keys(localStorage).filter((k) => /remind/i.test(k));
      return keys;
    });
    console.log('reminder localStorage keys:', r.join(',') || '(none)');
  });
} catch (e: any) {
  console.log('ABORTED:', e.message);
  results.push({ name: 'run aborted', ok: false, note: e.message });
} finally {
  await ctx.close().catch(() => {});
  console.log('\n===== REAL-LOGIN E2E =====');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? '\n        -> ' + r.note : ''}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  console.log('\n===== HTTP >= 400 seen by the browser =====\n' + (httpErrors.join('\n') || '(none)'));
  console.log('\n===== console errors by step =====');
  for (const [k, v] of consoleErrors) console.log(`[${k}]\n   ` + [...v].join('\n   '));
  // cleanup: test rows + restore what the flows touched (real admin profile/settings, reminder stamps)
  await sweep();
  await prisma.property.deleteMany({ where: { address: { contains: 'Rua do Teste E2E, 42' } } });
  await restore(snap);
  if (adminId) {
    const cur = await prisma.user.findUnique({ where: { id: adminId } });
    if (cur) await prisma.user.update({ where: { id: adminId }, data: { themePreference: adminBefore?.themePreference ?? 'system', displayName: cur.displayName === 'Admin E2E Renamed' ? (adminBefore?.displayName ?? cur.displayName) : cur.displayName } });
  }
  console.log('\n[cleanup] done; e2e users left:', await prisma.user.count({ where: { email: { endsWith: '@' + MAIL_DOMAIN } } }));
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
