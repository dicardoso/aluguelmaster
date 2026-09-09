import { Router } from 'express';
import { Theme } from '@prisma/client';
import { prisma } from '../prisma';
import { requireAuth, loadProfile, AuthedRequest } from '../auth';

const router = Router();

router.use(requireAuth, loadProfile);

router.get('/', (req: AuthedRequest, res) => {
  res.json(req.profile);
});

const VALID_THEMES: Theme[] = ['light', 'dark', 'system'];

// Self-service update — deliberately does NOT accept `role`. Only an admin (via /api/users)
// can change a user's role; this is what closes the privilege-escalation bug the old
// Firestore rules had (any user could set their own `role: 'admin'`).
router.patch('/', async (req: AuthedRequest, res) => {
  const { displayName, phone, cpf, address, themePreference } = req.body ?? {};

  if (themePreference !== undefined && !VALID_THEMES.includes(themePreference)) {
    res.status(400).json({ error: 'Invalid themePreference' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: req.profile!.id },
    data: {
      ...(displayName !== undefined && { displayName }),
      ...(phone !== undefined && { phone }),
      ...(cpf !== undefined && { cpf }),
      ...(address !== undefined && { address }),
      ...(themePreference !== undefined && { themePreference }),
    },
  });

  res.json(updated);
});

export default router;
