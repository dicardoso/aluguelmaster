import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import { startHarness, prisma, sweep, snapshot, restore, createUser, persona, tokenFor, mail, MAIL_DOMAIN, run, OUT } from '../lib/harness.mts';

const SP = OUT;
const SHOTS = `${SP}/shots-flows`;
fs.mkdirSync(SHOTS, { recursive: true });

await sweep();
const snap = await snapshot();
const h = await startHarness({ vite: true });
const P = { admin: persona('admin', 'admin'), landA: persona('landA', 'landlord'), tenant: persona('tenant', 'tenant') };
for (const p of Object.values(P)) await createUser(p);

const browser = await chromium.launch();
const results: { name: string; ok: boolean; note?: string }[] = [];
const consoleErrors = new Map<string, Set<string>>();
let currentStep = '';

async function newPage(p: typeof P.admin | null, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  if (p) await ctx.addInitScript((t) => { if (!localStorage.getItem('e2e_token') && !localStorage.getItem('e2e_loggedout')) localStorage.setItem('e2e_token', t); }, tokenFor(p));
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const key = currentStep || 'init';
    if (!consoleErrors.has(key)) consoleErrors.set(key, new Set());
    consoleErrors.get(key)!.add(m.text().slice(0, 140));
  });
  page.on('pageerror', (e) => {
    const key = currentStep || 'init';
    if (!consoleErrors.has(key)) consoleErrors.set(key, new Set());
    consoleErrors.get(key)!.add('pageerror: ' + e.message.slice(0, 140));
  });
  return page;
}

async function step(name: string, page: Page, fn: () => Promise<void>) {
  currentStep = name;
  try { await fn(); results.push({ name, ok: true }); }
  catch (e: any) {
    results.push({ name, ok: false, note: String(e.message).split('\n')[0].slice(0, 220) });
    await page.screenshot({ path: `${SHOTS}/FAIL-${name.replace(/\W+/g, '_').slice(0, 40)}.png`, fullPage: true }).catch(() => {});
  }
}
const field = (page: Page, label: string) =>
  page.locator(`xpath=//label[contains(normalize-space(.), "${label}")]/following-sibling::*[self::input or self::select or self::textarea][1]`).first();
const toast = (page: Page, text: RegExp | string) => page.locator('[data-sonner-toast]').filter({ hasText: text }).first().waitFor({ timeout: 8000 });
const shot = (page: Page, n: string) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const goto = async (page: Page, p: string) => { await page.goto(h.url + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(300); };

try {
  // ---------- LANDLORD ----------
  const L = await newPage(P.landA);
  await step('landlord: create property via modal', L, async () => {
    await goto(L, '/properties');
    await L.getByRole('button', { name: /Novo Imóvel/ }).click();
    await field(L, 'Endereço Completo').fill('Rua do Teste E2E, 42 - Centro');
    await field(L, 'Aluguel Mensal').fill('2500');
    await field(L, 'Descrição').fill('Criado pelo Playwright');
    await shot(L, 'prop-modal');
    await L.getByRole('button', { name: 'Salvar Imóvel' }).click();
    await toast(L, /cadastrado com sucesso/);
    await L.getByText('Rua do Teste E2E, 42').first().waitFor();
    const row = await prisma.property.findFirst({ where: { address: { contains: 'Rua do Teste E2E, 42' } } });
    if (!row || row.ownerUid !== P.landA.uid || Number(row.monthlyRent) !== 2500) throw new Error('DB row wrong: ' + JSON.stringify(row));
  });
  await step('landlord: search filters property list', L, async () => {
    await L.getByPlaceholder(/Buscar por endereço/).fill('zzz-no-match');
    await L.waitForTimeout(400);
    if (await L.getByText('Rua do Teste E2E, 42').count()) throw new Error('filter did not hide row');
    await L.getByPlaceholder(/Buscar por endereço/).fill('Teste E2E');
    await L.getByText('Rua do Teste E2E, 42').first().waitFor({ timeout: 3000 });
  });
  await step('landlord: edit property', L, async () => {
    await L.getByPlaceholder(/Buscar por endereço/).fill('');
    await L.getByTitle('Editar').first().click();
    await field(L, 'Aluguel Mensal').fill('2600');
    await L.getByRole('button', { name: 'Salvar Imóvel' }).click();
    await toast(L, /atualizado com sucesso/);
    const row = await prisma.property.findFirst({ where: { address: { contains: 'Rua do Teste E2E, 42' } } });
    if (Number(row!.monthlyRent) !== 2600) throw new Error('rent not updated');
  });

  await step('landlord: create contract via modal (tenant record, 12 months)', L, async () => {
    await goto(L, '/contracts');
    await L.getByRole('button', { name: 'Novo Contrato' }).last().click();
    const prop = await prisma.property.findFirst({ where: { address: { contains: 'Rua do Teste E2E, 42' } } });
    await field(L, 'Imóvel').selectOption(prop!.id);
    await field(L, 'Inquilino').selectOption(P.tenant.uid);
    await field(L, 'Data Início').fill('2026-11-01');
    await field(L, 'Data Término').fill('2027-11-01');
    await field(L, 'Dia de Vencimento').fill('7');
    await shot(L, 'contract-modal');
    await L.getByRole('button', { name: 'Criar Contrato' }).click();
    await toast(L, /gerados com sucesso/);
    const c = await prisma.contract.findFirst({ where: { propertyId: prop!.id } });
    if (!c) throw new Error('contract not in DB');
    const n = await prisma.payment.count({ where: { contractId: c.id } });
    if (n !== 12) throw new Error(`expected 12 payments, got ${n}`);
    if (Number(c.monthlyRent) !== 2600) throw new Error(`rent should default from property (2600), got ${c.monthlyRent}`);
  });
  await step('landlord: contract PDF downloads and is a valid PDF', L, async () => {
    const [dl] = await Promise.all([L.waitForEvent('download', { timeout: 15000 }), L.getByTitle('Baixar PDF').first().click()]);
    const p = `${SP}/dl-contract.pdf`;
    await dl.saveAs(p);
    const buf = fs.readFileSync(p);
    if (!buf.subarray(0, 5).toString().startsWith('%PDF') || buf.length < 5000) throw new Error(`bad pdf size=${buf.length}`);
  });
  await step('landlord: attach signed contract (upload) -> edit becomes unavailable', L, async () => {
    await L.getByTitle('Mais ações').first().click();
    await shot(L, 'contract-actions-menu');
    const items = await L.locator('.fixed.z-50 button').allTextContents();
    const attach = L.locator('.fixed.z-50 button').filter({ hasText: /assinad/i }).first();
    if (!(await attach.count())) throw new Error('no signed-upload item in menu: ' + items.join(' | '));
    const [chooser] = await Promise.all([L.waitForEvent('filechooser'), attach.click()]);
    fs.writeFileSync(`${SP}/signed.pdf`, '%PDF-1.4 e2e');
    await chooser.setFiles(`${SP}/signed.pdf`);
    await toast(L, /anexado com sucesso/);
    const c = await prisma.contract.findFirst({ where: { landlordUid: P.landA.uid } });
    if (!c?.signedContractUrl) throw new Error('signedContractUrl not saved');
  });
  await step('landlord: renew is blocked far from expiry (UI or API error)', L, async () => {
    await L.reload({ waitUntil: 'networkidle' });
    await L.getByTitle('Mais ações').first().click();
    const renew = L.locator('.fixed.z-50 button').filter({ hasText: /Renovar/ }).first();
    const disabled = await renew.isDisabled();
    await shot(L, 'renew-menu');
    if (!disabled) {
      await renew.click();
      await L.getByRole('button', { name: 'Renovar', exact: true }).click();
      await toast(L, /só pode ser renovado|Erro/);
    }
  });
  await step('landlord: payments page lists 12, mark one paid via "Dar Baixa"', L, async () => {
    await goto(L, '/payments');
    await shot(L, 'payments');
    await L.getByRole('button', { name: 'Dar Baixa' }).first().click();
    await L.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await toast(L, /baixado com sucesso/);
    const paid = await prisma.payment.count({ where: { status: 'paid', tenantUid: P.tenant.uid } });
    if (paid !== 1) throw new Error(`expected 1 paid, got ${paid}`);
    const m = mail.find((x) => x.to === P.tenant.email && /Recibo/.test(x.subject));
    if (!m) throw new Error('receipt e-mail not captured');
  });
  await step('landlord: receipt PDF downloads', L, async () => {
    await L.reload({ waitUntil: 'networkidle' });
    const btn = L.getByTitle('Baixar Comprovante').first();
    const [dl] = await Promise.all([L.waitForEvent('download', { timeout: 15000 }), btn.click()]);
    await dl.saveAs(`${SP}/dl-receipt.pdf`);
    if (!fs.readFileSync(`${SP}/dl-receipt.pdf`).subarray(0, 5).toString().startsWith('%PDF')) throw new Error('not a pdf');
  });
  await step('landlord: CSV export downloads', L, async () => {
    const [dl] = await Promise.all([L.waitForEvent('download', { timeout: 10000 }), L.getByRole('button', { name: /Exportar CSV/ }).click()]);
    await dl.saveAs(`${SP}/dl-payments.csv`);
    const t = fs.readFileSync(`${SP}/dl-payments.csv`, 'utf8');
    if (t.split('\n').length < 3) throw new Error('csv too short: ' + t.slice(0, 80));
  });
  await step('landlord: manual charge (Gerar Cobrança)', L, async () => {
    await L.getByRole('button', { name: 'Gerar Cobrança' }).first().click();
    const c = await prisma.contract.findFirst({ where: { landlordUid: P.landA.uid } });
    await field(L, 'Contrato').selectOption(c!.id);
    await field(L, 'Valor (R$)').fill('99.9');
    await field(L, 'Data de Vencimento').fill('2026-12-25');
    await L.getByRole('button', { name: 'Gerar Cobrança' }).last().click();
    await L.getByRole('button', { name: 'Gerar Cobrança', exact: true }).last().click().catch(() => {});
    await toast(L, /Cobrança gerada/);
  });
  await step('landlord: theme toggle persists (dark class + DB)', L, async () => {
    await L.getByTitle('Tema Escuro').click();
    await L.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await L.waitForTimeout(500);
    const u = await prisma.user.findUnique({ where: { id: P.landA.uid } });
    if (u!.themePreference !== 'dark') throw new Error('theme not saved: ' + u!.themePreference);
    await shot(L, 'dark-theme-payments');
    await L.reload({ waitUntil: 'networkidle' });
    if (!(await L.evaluate(() => document.documentElement.classList.contains('dark')))) throw new Error('dark lost after reload');
  });
  await step('landlord: profile edit saves', L, async () => {
    await goto(L, '/profile');
    await shot(L, 'profile');
    await field(L, 'Nome Completo').fill('E2E Landlord Renamed');
    await L.getByRole('button', { name: /Salvar/ }).first().click();
    await toast(L, /sucesso|atualizado|salvo/i);
    const u = await prisma.user.findUnique({ where: { id: P.landA.uid } });
    if (u!.displayName !== 'E2E Landlord Renamed') throw new Error('name not saved: ' + u!.displayName);
  });
  await step('landlord: logout returns to /login', L, async () => {
    await L.getByRole('button', { name: /Sair/ }).click();
    await L.waitForURL(/\/login/, { timeout: 5000 });
    await L.evaluate(() => localStorage.setItem('e2e_loggedout', '1'));
  });
  await step('login page: "entrar com Google" button signs in (stubbed popup)', L, async () => {
    await L.evaluate((t) => localStorage.setItem('e2e_login_token', t), tokenFor(P.landA));
    await shot(L, 'login');
    await L.getByRole('button').first().click();
    await L.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8000 });
  });

  // ---------- ADMIN ----------
  const A = await newPage(P.admin);
  await step('admin: invite a landlord (Users page)', A, async () => {
    await goto(A, '/users');
    await shot(A, 'users');
    await A.getByRole('button', { name: /Novo Usuário|Adicionar|Convidar|Pré-cadastro/i }).first().click();
    await field(A, 'E-mail').fill(`invitee.${run}@${MAIL_DOMAIN}`);
    await field(A, 'Nome Completo').fill('Convidado E2E');
    await field(A, 'Nível de Acesso').selectOption('landlord');
    await A.getByRole('button', { name: 'Cadastrar Usuário' }).click();
    await A.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await toast(A, /Convite\/Pré-cadastro realizado/);
    const row = await prisma.user.findUnique({ where: { email: `invitee.${run}@${MAIL_DOMAIN}` } });
    if (!row?.isInvite) throw new Error('invite row missing');
  });
  await step('admin: duplicate invite shows API error toast', A, async () => {
    await A.getByRole('button', { name: /Novo Usuário|Adicionar|Convidar|Pré-cadastro/i }).first().click();
    await field(A, 'E-mail').fill(`invitee.${run}@${MAIL_DOMAIN}`);
    await field(A, 'Nome Completo').fill('Dup');
    await A.getByRole('button', { name: 'Cadastrar Usuário' }).click();
    await A.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await toast(A, /já está cadastrado/);
    await A.keyboard.press('Escape');
  });
  await step('admin: revoke (delete) pending invite', A, async () => {
    await A.reload({ waitUntil: 'networkidle' });
    const row = A.locator('tr, [class*="group"]').filter({ hasText: 'Convidado E2E' }).first();
    await row.hover();
    await row.getByTitle('Excluir convite').click();
    await A.getByRole('button', { name: 'Excluir', exact: true }).click();
    await toast(A, /Convite excluído/);
    if (await prisma.user.count({ where: { email: `invitee.${run}@${MAIL_DOMAIN}` } })) throw new Error('invite still in DB');
  });
  await step('admin: disable then re-enable a user', A, async () => {
    await A.reload({ waitUntil: 'networkidle' });
    const row = A.locator('tr, [class*="group"]').filter({ hasText: 'E2E tenant' }).first();
    await row.hover();
    await row.getByTitle('Desativar acesso').click();
    await A.getByRole('button', { name: 'Desativar', exact: true }).click();
    await toast(A, /Acesso desativado/);
    if (!(await prisma.user.findUnique({ where: { id: P.tenant.uid } }))!.disabled) throw new Error('not disabled in DB');
    await A.waitForTimeout(500);
    await row.hover();
    await row.getByTitle('Reativar acesso').click();
    await A.getByRole('button', { name: 'Reativar', exact: true }).click();
    await toast(A, /Acesso reativado/);
  });
  await step('admin: settings save + persists after reload', A, async () => {
    await goto(A, '/settings');
    await shot(A, 'settings');
    await field(A, 'Nome da Empresa').fill('Empresa E2E Ltda');
    await A.getByRole('button', { name: 'Salvar Configurações' }).click();
    await toast(A, /salvas com sucesso/);
    await A.reload({ waitUntil: 'networkidle' });
    const v = await field(A, 'Nome da Empresa').inputValue();
    if (v !== 'Empresa E2E Ltda') throw new Error('value after reload: ' + v);
    const pw = A.locator('input[type="password"]').first();
    if (await pw.count() && (await pw.inputValue()) !== '') throw new Error('SMTP password leaked into the form');
  });
  await step('admin: dashboard shows data without NaN/undefined/[object]', A, async () => {
    await goto(A, '/');
    const txt = await A.locator('body').innerText();
    for (const bad of ['NaN', 'undefined', '[object', 'Invalid Date', 'null']) if (txt.includes(bad)) throw new Error('found "' + bad + '" on dashboard');
  });
  await step('admin: global search finds property', A, async () => {
    await A.getByPlaceholder(/Busca global/).fill('Teste E2E');
    await A.waitForTimeout(600);
    await shot(A, 'global-search');
    const t = await A.locator('body').innerText();
    if (!/Rua do Teste E2E/.test(t)) throw new Error('search result not shown');
  });

  // ---------- MOBILE ----------
  const M = await newPage(P.landA, { width: 390, height: 844 });
  for (const route of ['/', '/properties', '/contracts', '/payments']) {
    await step(`mobile 390px: ${route} has no horizontal overflow`, M, async () => {
      await goto(M, route);
      await shot(M, 'mobile' + (route === '/' ? '-home' : route.replace('/', '-')));
      const over = await M.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (over.sw > over.cw + 1) throw new Error(`scrollWidth ${over.sw} > ${over.cw}`);
    });
  }

  // ---------- TENANT LOGIN BLOCKED ----------
  delete process.env.ALLOW_TENANT_LOGIN;
  const T = await newPage(P.tenant);
  await step('tenant (login off): sees error toast and is sent to /login', T, async () => {
    await goto(T, '/');
    await toast(T, /inquilinos à plataforma ainda não está disponível/);
    await T.waitForURL(/\/login/, { timeout: 5000 });
  });
} finally {
  await browser.close();
  console.log('\n===== E2E FLOWS =====');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? '\n        -> ' + r.note : ''}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  console.log('\n===== console errors by step =====');
  for (const [k, v] of consoleErrors) console.log(`[${k}]\n   ` + [...v].join('\n   '));
  await sweep();
  await restore(snap);
  console.log('\n[cleanup] done');
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
