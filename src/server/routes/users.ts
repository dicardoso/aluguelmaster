import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth, loadProfile, requireRole, invalidateProfileCache, AuthedRequest } from '../auth.js';

const router = Router();

router.use(requireAuth, loadProfile);

// Full listing (email, phone, role, invite status) — admin only. This is the data the
// old Firestore rules let ANY authenticated user read for ANY other user; now it's
// scoped to admins, who are the only ones with a legitimate reason to see it.
router.get('/', requireRole('admin'), async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(users);
});

// Minimal cross-reference data any authenticated user can read — needed so a tenant can
// see their landlord's name/CPF on a contract PDF, or a landlord can see a tenant's name
// on a receipt. Deliberately omits email, phone, createdAt and invite status.
router.get('/directory', async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, displayName: true, cpf: true, address: true, role: true },
  });
  res.json(users);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { email, displayName, role, phone, cpf, address } = req.body ?? {};

  if (!email || !displayName) {
    res.status(400).json({ error: 'email and displayName are required' });
    return;
  }

  const normalizedEmail = String(email).toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    return;
  }

  const invite = await prisma.user.create({
    data: {
      id: `invite_${Date.now()}`,
      email: normalizedEmail,
      displayName,
      role: role || 'tenant',
      phone: phone || '',
      cpf: cpf || '',
      address: address || '',
      isInvite: true,
    },
  });
  res.status(201).json(invite);
});

router.patch('/:id', requireRole('admin'), async (req: AuthedRequest, res) => {
  const { displayName, role, phone, cpf, address } = req.body ?? {};

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(displayName !== undefined && { displayName }),
      ...(role !== undefined && { role }),
      ...(phone !== undefined && { phone }),
      ...(cpf !== undefined && { cpf }),
      ...(address !== undefined && { address }),
    },
  });
  invalidateProfileCache(updated.id);
  res.json(updated);
});

export default router;
