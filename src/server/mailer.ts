import nodemailer from 'nodemailer';
import CryptoJS from 'crypto-js';
import { prisma } from './prisma.js';

let transporter: nodemailer.Transporter | null = null;
let transporterCacheKey = '';

async function getTransporter() {
  const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
  if (!settings?.smtpHost || !settings.smtpPort || !settings.smtpUser || !settings.smtpPasswordEncrypted) {
    return { transporter: null, settings };
  }

  const cacheKey = `${settings.smtpHost}:${settings.smtpPort}:${settings.smtpUser}:${settings.smtpPasswordEncrypted}`;
  if (transporter && transporterCacheKey === cacheKey) {
    return { transporter, settings };
  }

  const ENCRYPTION_KEY = process.env.SETTINGS_ENCRYPTION_KEY || 'default-secret-key-12345';
  let password = settings.smtpPasswordEncrypted;
  try {
    const bytes = CryptoJS.AES.decrypt(settings.smtpPasswordEncrypted, ENCRYPTION_KEY);
    password = bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Error decrypting SMTP password:', error);
  }

  transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpPort === 465,
    auth: { user: settings.smtpUser, pass: password },
  });
  transporterCacheKey = cacheKey;
  return { transporter, settings };
}

export async function sendMail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const { transporter: mailTransporter, settings } = await getTransporter();
  const from = settings?.emailFrom || process.env.SMTP_FROM || 'no-reply@gestaoimobiliaria.com';

  if (mailTransporter) {
    await mailTransporter.sendMail({ from, to, subject, html });
  } else {
    console.log('SIMULATED EMAIL SENT:', { to, subject });
  }
}

// Shared visual identity for every transactional email — mirrors the app's own look
// (blue-600 accent, rounded-2xl white card on a light gray page) so an email doesn't
// read as a different product than the app it came from. Table-based details block
// keeps decent rendering in Outlook's desktop engine, which ignores flex/grid entirely.
const BRAND_COLOR = '#2563eb';

export function emailLayout({ appName, heading, bodyHtml, ctaLabel, ctaUrl, footerNote }: {
  appName: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}) {
  const year = new Date().getFullYear();
  return `
<div style="background-color:#f3f4f6;padding:40px 16px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;">
    <table role="presentation" align="center" style="margin:0 auto 12px;">
      <tr>
        <td style="width:44px;height:44px;background-color:${BRAND_COLOR};border-radius:12px;text-align:center;vertical-align:middle;font-size:20px;">
          🏢
        </td>
      </tr>
    </table>
    <div style="text-align:center;font-size:17px;font-weight:700;color:#111827;margin-bottom:20px;">${appName}</div>

    <div style="background-color:#ffffff;border-radius:16px;border:1px solid #e5e7eb;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:19px;line-height:1.4;color:#111827;">${heading}</h1>
      <div style="font-size:14px;line-height:1.7;color:#374151;">${bodyHtml}</div>
      ${ctaUrl && ctaLabel ? `
      <div style="text-align:center;margin-top:28px;">
        <a href="${ctaUrl}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px;">${ctaLabel}</a>
      </div>` : ''}
    </div>

    ${footerNote ? `<p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:20px;">${footerNote}</p>` : ''}
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:8px;">&copy; ${year} ${appName}. Todos os direitos reservados.</p>
  </div>
</div>`;
}

export function emailDetailsTable(rows: Array<[string, string]>) {
  return `
<table role="presentation" style="width:100%;border-collapse:collapse;margin:18px 0;background-color:#f9fafb;border-radius:10px;">
  ${rows.map(([label, value], i) => `
  <tr>
    <td style="padding:10px 14px;font-size:13px;color:#6b7280;${i > 0 ? 'border-top:1px solid #eef0f2;' : ''}">${label}</td>
    <td style="padding:10px 14px;font-size:13px;color:#111827;font-weight:600;text-align:right;${i > 0 ? 'border-top:1px solid #eef0f2;' : ''}">${value}</td>
  </tr>`).join('')}
</table>`;
}

export function emailBadge(text: string, tone: 'blue' | 'green' | 'red' | 'amber' = 'blue') {
  const colors = {
    blue: { bg: '#eff6ff', fg: '#2563eb' },
    green: { bg: '#f0fdf4', fg: '#16a34a' },
    red: { bg: '#fef2f2', fg: '#dc2626' },
    amber: { bg: '#fffbeb', fg: '#d97706' },
  }[tone];
  return `<span style="display:inline-block;background-color:${colors.bg};color:${colors.fg};font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;">${text}</span>`;
}

export async function sendWelcomeEmail(to: string, name: string) {
  const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
  const appName = settings?.appName || 'AluguelMaster';
  const appUrl = process.env.APP_URL || '';

  const html = emailLayout({
    appName,
    heading: `Bem-vindo, ${name || 'Usuário'}! 👋`,
    bodyHtml: `
      <p>Seu cadastro foi realizado com sucesso. Estamos muito felizes em ter você conosco!</p>
      <p>${appName} é a sua plataforma completa para gestão inteligente de contratos de aluguel residencial e comercial.</p>
      <p>Acesse a plataforma para conferir seus contratos, recibos e muito mais.</p>
    `,
    ctaLabel: 'Acessar Plataforma',
    ctaUrl: appUrl || undefined,
    footerNote: 'Se você tiver alguma dúvida, não hesite em nos contatar.',
  });

  await sendMail({ to, subject: `Bem-vindo ao ${appName}!`, html });
}

export async function sendInviteEmail(to: string, name: string) {
  const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
  const appName = settings?.appName || 'AluguelMaster';
  const appUrl = process.env.APP_URL || '';

  const html = emailLayout({
    appName,
    heading: 'Você foi convidado! 🎉',
    bodyHtml: `
      <p>Olá <strong>${name || 'Usuário'}</strong>,</p>
      <p>Você foi cadastrado no ${appName} e já pode acessar a plataforma.</p>
      <p>Basta entrar com sua conta Google usando este mesmo e-mail (<strong>${to}</strong>) para ter acesso liberado automaticamente.</p>
    `,
    ctaLabel: 'Acessar Plataforma',
    ctaUrl: appUrl || undefined,
    footerNote: 'Se você não esperava este convite, pode ignorar este e-mail.',
  });

  await sendMail({ to, subject: `Você foi convidado para o ${appName}`, html });
}
