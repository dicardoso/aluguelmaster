import { Router } from 'express';
import CryptoJS from 'crypto-js';
import { prisma } from '../prisma.js';
import { requireAuth, loadProfile, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth, loadProfile);

// Alert/renewal day-thresholds only — no SMTP/company info — so any authenticated role
// can read them (the contract-renewal button needs this for landlords, not just admins).
router.get('/thresholds', async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
  res.json({
    contractExpiryReminderDays: settings?.contractExpiryReminderDays ?? 30,
    paymentDueReminderDays: settings?.paymentDueReminderDays ?? 3,
    renewalWindowDays: settings?.renewalWindowDays ?? 60,
  });
});

router.get('/', requireRole('admin'), async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
  const { smtpPasswordEncrypted, ...rest } = settings ?? { id: 'global' };
  res.json({ ...rest, smtpPasswordConfigured: !!smtpPasswordEncrypted });
});

router.put('/', requireRole('admin'), async (req, res) => {
  const {
    appName, companyName, supportEmail, smtpHost, smtpPort, smtpUser, smtpPassword, emailFrom,
    contractExpiryReminderDays, paymentDueReminderDays, renewalWindowDays,
  } = req.body ?? {};

  for (const [label, value] of [
    ['contractExpiryReminderDays', contractExpiryReminderDays],
    ['paymentDueReminderDays', paymentDueReminderDays],
    ['renewalWindowDays', renewalWindowDays],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      res.status(400).json({ error: `${label} deve ser um número inteiro positivo.` });
      return;
    }
  }

  const ENCRYPTION_KEY = process.env.SETTINGS_ENCRYPTION_KEY || 'default-secret-key-12345';
  const smtpPasswordEncrypted = smtpPassword
    ? CryptoJS.AES.encrypt(smtpPassword, ENCRYPTION_KEY).toString()
    : undefined;

  const settings = await prisma.settings.upsert({
    where: { id: 'global' },
    create: {
      id: 'global',
      appName: appName || 'AluguelMaster',
      companyName,
      supportEmail,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPasswordEncrypted,
      emailFrom,
      ...(contractExpiryReminderDays !== undefined && { contractExpiryReminderDays }),
      ...(paymentDueReminderDays !== undefined && { paymentDueReminderDays }),
      ...(renewalWindowDays !== undefined && { renewalWindowDays }),
    },
    update: {
      ...(appName !== undefined && { appName }),
      ...(companyName !== undefined && { companyName }),
      ...(supportEmail !== undefined && { supportEmail }),
      ...(smtpHost !== undefined && { smtpHost }),
      ...(smtpPort !== undefined && { smtpPort }),
      ...(smtpUser !== undefined && { smtpUser }),
      ...(smtpPasswordEncrypted !== undefined && { smtpPasswordEncrypted }),
      ...(emailFrom !== undefined && { emailFrom }),
      ...(contractExpiryReminderDays !== undefined && { contractExpiryReminderDays }),
      ...(paymentDueReminderDays !== undefined && { paymentDueReminderDays }),
      ...(renewalWindowDays !== undefined && { renewalWindowDays }),
    },
  });

  const { smtpPasswordEncrypted: _omit, ...rest } = settings;
  res.json({ ...rest, smtpPasswordConfigured: !!settings.smtpPasswordEncrypted });
});

export default router;
