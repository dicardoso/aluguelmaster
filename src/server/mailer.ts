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

export async function sendWelcomeEmail(to: string, name: string) {
  const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
  const appName = settings?.appName || 'AluguelMaster';
  const appUrl = process.env.APP_URL || '';

  const subject = `Bem-vindo ao ${appName}!`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #2563eb; text-align: center;">Bem-vindo ao ${appName}!</h2>
      <p>Olá <strong>${name || 'Usuário'}</strong>,</p>
      <p>Seu cadastro foi realizado com sucesso. Estamos muito felizes em ter você conosco!</p>
      <p>${appName} é a sua plataforma completa para gestão inteligente de contratos de aluguel residencial e comercial.</p>
      <p>Acesse a plataforma para conferir seus contratos, recibos e muito mais.</p>
      ${appUrl ? `<div style="text-align: center; margin: 30px 0;">
        <a href="${appUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Acessar Plataforma</a>
      </div>` : ''}
      <p style="color: #666; font-size: 14px; text-align: center;">Se você tiver alguma dúvida, não hesite em nos contatar.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #999; font-size: 12px; text-align: center;">&copy; ${new Date().getFullYear()} ${appName}. Todos os direitos reservados.</p>
    </div>
  `;

  await sendMail({ to, subject, html });
}
