import { Router } from 'express';
import CryptoJS from 'crypto-js';
import { prisma } from '../prisma';
import { requireAuth, loadProfile, requireRole } from '../auth';

const router = Router();

router.use(requireAuth, loadProfile, requireRole('admin'));

router.get('/', async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
  const { smtpPasswordEncrypted, ...rest } = settings ?? { id: 'global' };
  res.json({ ...rest, smtpPasswordConfigured: !!smtpPasswordEncrypted });
});

router.put('/', async (req, res) => {
  const { appName, companyName, supportEmail, smtpHost, smtpPort, smtpUser, smtpPassword, emailFrom } = req.body ?? {};

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
    },
  });

  const { smtpPasswordEncrypted: _omit, ...rest } = settings;
  res.json({ ...rest, smtpPasswordConfigured: !!settings.smtpPasswordEncrypted });
});

export default router;
