import { Router } from 'express';
import { prisma } from '../prisma';
import { requireAuth, loadProfile, requireRole, AuthedRequest } from '../auth';
import { serializePayment } from '../serialize';

const router = Router();

router.use(requireAuth, loadProfile);

router.get('/', async (req: AuthedRequest, res) => {
  const profile = req.profile!;
  const roleFilter =
    profile.role === 'admin'
      ? {}
      : profile.role === 'tenant'
        ? { tenantUid: profile.id }
        : { contract: { landlordUid: profile.id } }; // landlord: only payments on contracts they own

  const { contractId } = req.query;
  const where = contractId ? { ...roleFilter, contractId: String(contractId) } : roleFilter;

  const payments = await prisma.payment.findMany({ where, orderBy: { dueDate: 'desc' } });
  res.json(payments.map(serializePayment));
});

router.post('/', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const { contractId, amount, dueDate } = req.body ?? {};
  if (!contractId || amount === undefined || !dueDate) {
    res.status(400).json({ error: 'contractId, amount and dueDate are required' });
    return;
  }

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) {
    res.status(404).json({ error: 'Contract not found' });
    return;
  }
  if (req.profile!.role !== 'admin' && contract.landlordUid !== req.profile!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const payment = await prisma.payment.create({
    data: { contractId, tenantUid: contract.tenantUid, amount, dueDate: new Date(dueDate), status: 'pending' },
  });
  res.status(201).json(serializePayment(payment));
});

// Tenants can no longer mark their own rent as paid — that was a real bug in the old
// Firestore rules (a client-side `updateDoc` was enough). Only admin/landlord can.
router.patch('/:id/mark-paid', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const existing = await prisma.payment.findUnique({ where: { id: req.params.id }, include: { contract: true } });
  if (!existing) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }
  if (req.profile!.role !== 'admin' && existing.contract.landlordUid !== req.profile!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { paidAt } = req.body ?? {};
  const updated = await prisma.payment.update({
    where: { id: existing.id },
    data: { status: 'paid', paidAt: paidAt ? new Date(paidAt) : new Date() },
  });
  res.json(serializePayment(updated));
});

export default router;
