import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth, loadProfile, requireRole, invalidateProfileCache, AuthedRequest } from '../auth.js';
import { sendInviteEmail } from '../mailer.js';
import { tenantLoginEnabled } from '../features.js';

const router = Router();
const ROLES = ['admin', 'landlord', 'tenant'];

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

  if (role !== undefined && !ROLES.includes(role)) {
    res.status(400).json({ error: 'Nível de acesso inválido.' });
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
  // A tenant record is just a contract counterpart while tenant login is off — telling them
  // they "can already access the platform" would be wrong.
  if (invite.role !== 'tenant' || tenantLoginEnabled()) {
    sendInviteEmail(normalizedEmail, displayName).catch((error) => {
      console.error('Failed to send invite email:', error);
    });
  }

  res.status(201).json(invite);
});

router.patch('/:id', requireRole('admin'), async (req: AuthedRequest, res) => {
  const { displayName, role, phone, cpf, address, disabled } = req.body ?? {};

  if (disabled !== undefined && typeof disabled !== 'boolean') {
    res.status(400).json({ error: 'disabled must be a boolean' });
    return;
  }
  if (role !== undefined && !ROLES.includes(role)) {
    res.status(400).json({ error: 'Nível de acesso inválido.' });
    return;
  }
  // An admin locking themselves out would leave nobody able to undo it from the UI.
  if (disabled === true && req.params.id === req.profile!.id) {
    res.status(400).json({ error: 'Você não pode desativar o próprio acesso.' });
    return;
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true, disabled: true, isInvite: true } });
  if (!target) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }
  // Demoting or disabling an active admin must leave at least one other active admin.
  const losesAdmin =
    target.role === 'admin' && !target.isInvite && !target.disabled &&
    ((role !== undefined && role !== 'admin') || disabled === true);
  if (losesAdmin) {
    const otherAdmins = await prisma.user.count({
      where: { role: 'admin', isInvite: false, disabled: false, id: { not: target.id } },
    });
    if (otherAdmins === 0) {
      res.status(400).json({ error: 'Deve existir pelo menos um administrador ativo.' });
      return;
    }
  }

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(displayName !== undefined && { displayName }),
      ...(role !== undefined && { role }),
      ...(phone !== undefined && { phone }),
      ...(cpf !== undefined && { cpf }),
      ...(address !== undefined && { address }),
      ...(disabled !== undefined && { disabled }),
    },
  });
  invalidateProfileCache(updated.id);
  res.json(updated);
});

// Revokes a pending invite. Only invites can be deleted: a user who already logged in is
// referenced by contracts/payments, so their access is revoked with `disabled` instead.
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }
  if (!target.isInvite) {
    res.status(400).json({ error: 'Apenas convites pendentes podem ser excluídos. Desative o acesso do usuário.' });
    return;
  }

  try {
    await prisma.user.delete({ where: { id: target.id } });
  } catch {
    // The invite is already referenced (e.g. a contract was created for this pre-registered tenant).
    res.status(409).json({ error: 'Este convite já está vinculado a contratos ou imóveis e não pode ser excluído.' });
    return;
  }
  res.status(204).end();
});

export default router;
