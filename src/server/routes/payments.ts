import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth, loadProfile, requireRole, AuthedRequest } from '../auth.js';
import { serializePayment } from '../serialize.js';
import { sendMail, emailLayout, emailDetailsTable, emailBadge } from '../mailer.js';
import { formatCurrency } from '../../lib/format.js';
import { tenantLoginEnabled } from '../features.js';

const router = Router();

async function sendPaymentReceiptEmail(payment: { tenantUid: string; amount: any; dueDate: Date; paidAt: Date | null }, propertyId: string) {
  const [tenant, property, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: payment.tenantUid } }),
    prisma.property.findUnique({ where: { id: propertyId } }),
    prisma.settings.findUnique({ where: { id: 'global' } }),
  ]);
  if (!tenant?.email) return;

  const appName = settings?.appName || 'Locatto';
  const appUrl = process.env.APP_URL || '';
  const paidAtStr = (payment.paidAt ?? new Date()).toISOString().slice(0, 10).split('-').reverse().join('/');
  const dueDateStr = payment.dueDate.toISOString().slice(0, 10).split('-').reverse().join('/');

  const html = emailLayout({
    appName,
    heading: 'Pagamento confirmado ✅',
    bodyHtml: `
      <p>Confirmamos o recebimento do pagamento do aluguel referente ao imóvel em <strong>${property?.address}</strong>.</p>
      ${emailBadge('Pago', 'green')}
      ${emailDetailsTable([
        ['Valor', formatCurrency(Number(payment.amount))],
        ['Vencimento', dueDateStr],
        ['Pago em', paidAtStr],
      ])}
      <p>${tenantLoginEnabled()
        ? 'Você pode acessar a plataforma para baixar o recibo completo.'
        : 'Entre em contato com o proprietário caso precise do recibo completo.'}</p>
    `,
    ...(tenantLoginEnabled() ? { ctaLabel: 'Ver Recibo', ctaUrl: appUrl || undefined } : {}),
  });

  try {
    await sendMail({ to: tenant.email, subject: `Recibo de Pagamento - ${property?.address}`, html });
  } catch (error) {
    console.error('Payment receipt email error:', error);
  }
}

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

  const parsedAmount = Number(amount);
  if (typeof amount === 'boolean' || amount === null || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    res.status(400).json({ error: 'Valor inválido.' });
    return;
  }
  const parsedDueDate = new Date(dueDate);
  if (Number.isNaN(parsedDueDate.getTime())) {
    res.status(400).json({ error: 'Data de vencimento inválida.' });
    return;
  }

  const payment = await prisma.payment.create({
    data: { contractId, tenantUid: contract.tenantUid, amount: parsedAmount, dueDate: parsedDueDate, status: 'pending' },
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

  // Re-marking would overwrite the original payment date and email the tenant a second receipt.
  if (existing.status === 'paid') {
    res.status(409).json({ error: 'Este pagamento já foi baixado.' });
    return;
  }

  const { paidAt } = req.body ?? {};
  if (paidAt && Number.isNaN(new Date(paidAt).getTime())) {
    res.status(400).json({ error: 'Data de pagamento inválida.' });
    return;
  }
  // Conditional on the status so a concurrent request that passed the check above can't
  // overwrite paidAt or send a second receipt.
  const { count } = await prisma.payment.updateMany({
    where: { id: existing.id, status: { not: 'paid' } },
    data: { status: 'paid', paidAt: paidAt ? new Date(paidAt) : new Date() },
  });
  if (count === 0) {
    res.status(409).json({ error: 'Este pagamento já foi baixado.' });
    return;
  }
  const updated = await prisma.payment.findUniqueOrThrow({ where: { id: existing.id } });

  sendPaymentReceiptEmail(updated, existing.contract.propertyId).catch((error) => {
    console.error('Failed to send payment receipt email:', error);
  });

  res.json(serializePayment(updated));
});

export default router;
