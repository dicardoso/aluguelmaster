import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { requireAuth, loadProfile, requireRole, AuthedRequest } from '../auth.js';
import { serializeContract } from '../serialize.js';
import { sendMail } from '../mailer.js';
import { formatCurrency } from '../../lib/format.js';

const router = Router();

router.use(requireAuth, loadProfile);

function contractWhereForRole(profile: NonNullable<AuthedRequest['profile']>) {
  if (profile.role === 'admin') return {};
  if (profile.role === 'tenant') return { tenantUid: profile.id };
  return { landlordUid: profile.id };
}

router.get('/', async (req: AuthedRequest, res) => {
  const contracts = await prisma.contract.findMany({
    where: contractWhereForRole(req.profile!),
    orderBy: { createdAt: 'desc' },
  });
  res.json(contracts.map(serializeContract));
});

// Creates the monthly payment schedule for a contract's term. Includes a final
// partial-month payment when the term doesn't end on an exact month boundary
// (a bug in the old Firestore version, which silently dropped that last payment).
async function createPaymentsForContract(tx: Prisma.TransactionClient, contract: {
  id: string; tenantUid: string; monthlyRent: any; dueDay: number; startDate: Date; endDate: Date;
}) {
  const start = contract.startDate;
  const end = contract.endDate;
  const fullMonths =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  const lastFullMonthDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + fullMonths, start.getUTCDate()));
  const months = lastFullMonthDate < end ? fullMonths + 1 : fullMonths;

  const data = [];
  for (let i = 0; i < months; i++) {
    const dueDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, contract.dueDay || 10));
    data.push({
      contractId: contract.id,
      tenantUid: contract.tenantUid,
      amount: contract.monthlyRent,
      dueDate,
      status: 'pending' as const,
    });
  }
  if (data.length) {
    await tx.payment.createMany({ data });
  }
}

async function sendContractEmail(contract: { propertyId: string; tenantUid: string; monthlyRent: any; dueDay: number; startDate: Date; endDate: Date }, type: 'new' | 'renew') {
  const [tenant, property] = await Promise.all([
    prisma.user.findUnique({ where: { id: contract.tenantUid } }),
    prisma.property.findUnique({ where: { id: contract.propertyId } }),
  ]);
  if (!tenant?.email) return;

  const subject = type === 'new'
    ? `Novo Contrato de Locação - ${property?.address}`
    : `Renovação de Contrato de Locação - ${property?.address}`;

  const html = `
    <h1>Olá ${tenant.displayName},</h1>
    <p>Seu contrato de locação para o imóvel em <strong>${property?.address}</strong> foi ${type === 'new' ? 'gerado' : 'renovado'} com sucesso.</p>
    <p><strong>Detalhes:</strong></p>
    <ul>
      <li>Valor Mensal: ${formatCurrency(Number(contract.monthlyRent))}</li>
      <li>Vencimento: Todo dia ${contract.dueDay || 10}</li>
      <li>Período: ${contract.startDate.toISOString().slice(0, 10).split('-').reverse().join('/')} até ${contract.endDate.toISOString().slice(0, 10).split('-').reverse().join('/')}</li>
    </ul>
    <p>Você pode acessar a plataforma para baixar o contrato completo e gerenciar seus pagamentos.</p>
    <p>Atenciosamente,<br>Gestão Imobiliária</p>
  `;

  try {
    await sendMail({ to: tenant.email, subject, html });
  } catch (error) {
    console.error('Contract email error:', error);
  }
}

router.post('/', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const { propertyId, tenantUid, landlordUid, startDate, endDate, dueDay, monthlyRent, lateFeeEnabled } = req.body ?? {};

  if (!propertyId || !tenantUid || !startDate || !endDate || monthlyRent === undefined) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) {
    res.status(404).json({ error: 'Property not found' });
    return;
  }
  if (req.profile!.role !== 'admin' && property.ownerUid !== req.profile!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const effectiveLandlordUid = req.profile!.role === 'admin' && landlordUid ? landlordUid : property.ownerUid;

  const contract = await prisma.$transaction(async (tx) => {
    const created = await tx.contract.create({
      data: {
        propertyId,
        tenantUid,
        landlordUid: effectiveLandlordUid,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        dueDay: dueDay || 10,
        monthlyRent,
        status: 'active',
        lateFeeEnabled: !!lateFeeEnabled,
      },
    });
    await tx.property.update({ where: { id: propertyId }, data: { status: 'rented' } });
    await createPaymentsForContract(tx, created);
    return created;
  });

  sendContractEmail(contract, 'new').catch((error) => console.error('Failed to send contract email:', error));

  res.status(201).json(serializeContract(contract));
});

async function loadAccessibleContract(req: AuthedRequest, res: any) {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) {
    res.status(404).json({ error: 'Contract not found' });
    return null;
  }
  const isOwner = contract.landlordUid === req.profile!.id;
  if (req.profile!.role !== 'admin' && !(req.profile!.role === 'landlord' && isOwner)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return contract;
}

router.post('/:id/renew', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const existing = await loadAccessibleContract(req, res);
  if (!existing) return;

  if (existing.status !== 'active') {
    res.status(400).json({ error: 'Apenas contratos ativos podem ser renovados.' });
    return;
  }

  // A contract can only be renewed once it's close to expiring — renewing a contract
  // that just started made no sense and let stale double-renewals slip through.
  const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
  const renewalWindowDays = settings?.renewalWindowDays ?? 60;

  const daysUntilEnd = (existing.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysUntilEnd > renewalWindowDays) {
    res.status(400).json({
      error: `Este contrato só pode ser renovado a partir de ${renewalWindowDays} dias antes do vencimento (faltam ${Math.ceil(daysUntilEnd)} dias).`,
    });
    return;
  }

  const { monthlyRent } = req.body ?? {};
  let newMonthlyRent = existing.monthlyRent;
  if (monthlyRent !== undefined) {
    const parsed = Number(monthlyRent);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      res.status(400).json({ error: 'Valor de aluguel inválido.' });
      return;
    }
    newMonthlyRent = parsed as any;
  }

  const newStartDate = existing.endDate;
  const newEndDate = new Date(Date.UTC(
    newStartDate.getUTCFullYear() + 1, newStartDate.getUTCMonth(), newStartDate.getUTCDate()
  ));

  const newContract = await prisma.$transaction(async (tx) => {
    const created = await tx.contract.create({
      data: {
        propertyId: existing.propertyId,
        tenantUid: existing.tenantUid,
        landlordUid: existing.landlordUid,
        startDate: newStartDate,
        endDate: newEndDate,
        dueDay: existing.dueDay,
        monthlyRent: newMonthlyRent,
        status: 'active',
        lateFeeEnabled: existing.lateFeeEnabled,
        // Deliberately not copied: pdfUrl / signedAt / signedContractUrl — a renewed
        // contract is a new, unsigned document (a bug in the old Firestore version).
      },
    });
    await tx.contract.update({ where: { id: existing.id }, data: { status: 'renewed' } });
    await createPaymentsForContract(tx, created);
    return created;
  });

  sendContractEmail(newContract, 'renew').catch((error) => console.error('Failed to send contract email:', error));

  res.json(serializeContract(newContract));
});

router.post('/:id/cancel', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const existing = await loadAccessibleContract(req, res);
  if (!existing) return;

  const updated = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.contract.update({ where: { id: existing.id }, data: { status: 'cancelled' } });
    await tx.property.update({ where: { id: existing.propertyId }, data: { status: 'available' } });
    return cancelled;
  });

  res.json(serializeContract(updated));
});

router.post('/:id/notify', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const existing = await loadAccessibleContract(req, res);
  if (!existing) return;

  try {
    await sendContractEmail(existing, 'new');
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to resend contract email:', error);
    res.status(500).json({ success: false, error: 'Failed to send email' });
  }
});

router.patch('/:id/late-fee', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const existing = await loadAccessibleContract(req, res);
  if (!existing) return;

  const { lateFeeEnabled } = req.body ?? {};
  if (typeof lateFeeEnabled !== 'boolean') {
    res.status(400).json({ error: 'lateFeeEnabled must be a boolean' });
    return;
  }

  const updated = await prisma.contract.update({
    where: { id: existing.id },
    data: { lateFeeEnabled },
  });
  res.json(serializeContract(updated));
});

// Called after the client uploads the signed file straight to Firebase Storage —
// this just records the resulting URL against the contract.
router.patch('/:id/signed', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const existing = await loadAccessibleContract(req, res);
  if (!existing) return;

  const { signedContractUrl } = req.body ?? {};
  if (!signedContractUrl) {
    res.status(400).json({ error: 'signedContractUrl is required' });
    return;
  }

  const updated = await prisma.contract.update({
    where: { id: existing.id },
    data: { signedContractUrl, signedAt: new Date() },
  });
  res.json(serializeContract(updated));
});

export default router;
