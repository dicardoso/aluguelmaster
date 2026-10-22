import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { requireAuth, loadProfile, requireRole, AuthedRequest } from '../auth.js';
import { serializeContract } from '../serialize.js';
import { sendMail, emailLayout, emailDetailsTable } from '../mailer.js';
import { formatCurrency } from '../../lib/format.js';
import { tenantLoginEnabled } from '../features.js';

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

function formatContractPeriod(contract: { startDate: Date; endDate: Date }) {
  return `${contract.startDate.toISOString().slice(0, 10).split('-').reverse().join('/')} até ${contract.endDate.toISOString().slice(0, 10).split('-').reverse().join('/')}`;
}

async function sendContractEmail(
  contract: { propertyId: string; tenantUid: string; landlordUid: string; monthlyRent: any; dueDay: number; startDate: Date; endDate: Date },
  type: 'new' | 'renew' | 'update',
) {
  const [tenant, landlord, property, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: contract.tenantUid } }),
    prisma.user.findUnique({ where: { id: contract.landlordUid } }),
    prisma.property.findUnique({ where: { id: contract.propertyId } }),
    prisma.settings.findUnique({ where: { id: 'global' } }),
  ]);

  const appName = settings?.appName || 'Locatto';
  const appUrl = process.env.APP_URL || '';
  const actionLabel = type === 'new' ? 'gerado' : type === 'renew' ? 'renovado' : 'atualizado';
  const details = emailDetailsTable([
    ['Valor Mensal', formatCurrency(Number(contract.monthlyRent))],
    ['Vencimento', `Todo dia ${contract.dueDay || 10}`],
    ['Período', formatContractPeriod(contract)],
  ]);

  if (tenant?.email) {
    const subject = type === 'new'
      ? `Novo Contrato de Locação - ${property?.address}`
      : type === 'renew'
        ? `Renovação de Contrato de Locação - ${property?.address}`
        : `Contrato de Locação Atualizado - ${property?.address}`;

    const html = emailLayout({
      appName,
      heading: type === 'new'
        ? 'Seu contrato foi gerado 📄'
        : type === 'renew' ? 'Seu contrato foi renovado 🔄' : 'Seu contrato foi atualizado ✏️',
      bodyHtml: `
        <p>Seu contrato de locação para o imóvel em <strong>${property?.address}</strong> foi ${actionLabel} com sucesso.</p>
        ${details}
        <p>${tenantLoginEnabled()
          ? (type === 'update'
            ? 'Os dados acima já refletem a versão corrigida. Acesse a plataforma para baixar o contrato atualizado e conferir seus pagamentos.'
            : 'Você pode acessar a plataforma para baixar o contrato completo e gerenciar seus pagamentos.')
          : (type === 'update'
            ? 'Os dados acima já refletem a versão corrigida. Entre em contato com o proprietário para receber o contrato atualizado.'
            : 'Entre em contato com o proprietário para receber o contrato completo.')}</p>
      `,
      ...(tenantLoginEnabled() ? { ctaLabel: 'Ver Contrato', ctaUrl: appUrl || undefined } : {}),
    });

    try {
      await sendMail({ to: tenant.email, subject, html });
    } catch (error) {
      console.error('Contract email error (tenant):', error);
    }
  }

  if (landlord?.email) {
    const html = emailLayout({
      appName,
      heading: `Contrato ${actionLabel} ✅`,
      bodyHtml: `
        <p>O contrato de locação do imóvel em <strong>${property?.address}</strong> com o inquilino <strong>${tenant?.displayName || 'N/A'}</strong> foi ${actionLabel} com sucesso.</p>
        ${details}
        <p>Acesse a plataforma para ver os detalhes completos e o histórico de pagamentos.</p>
      `,
      ctaLabel: 'Ver Contrato',
      ctaUrl: appUrl || undefined,
    });

    try {
      await sendMail({ to: landlord.email, subject: `Contrato ${actionLabel} - ${property?.address}`, html });
    } catch (error) {
      console.error('Contract email error (landlord):', error);
    }
  }
}

async function sendContractCancelledEmail(contract: { propertyId: string; tenantUid: string; landlordUid: string }) {
  const [tenant, landlord, property, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: contract.tenantUid } }),
    prisma.user.findUnique({ where: { id: contract.landlordUid } }),
    prisma.property.findUnique({ where: { id: contract.propertyId } }),
    prisma.settings.findUnique({ where: { id: 'global' } }),
  ]);

  const appName = settings?.appName || 'Locatto';
  const appUrl = process.env.APP_URL || '';
  const recipients = [tenant, landlord].filter((u): u is NonNullable<typeof u> => !!u?.email);

  for (const recipient of recipients) {
    const html = emailLayout({
      appName,
      heading: 'Contrato cancelado',
      bodyHtml: `
        <p>O contrato de locação do imóvel em <strong>${property?.address}</strong> foi cancelado.</p>
        <p>O imóvel foi marcado como disponível na plataforma.</p>
      `,
      // The platform link is pointless to a tenant while they can't sign in.
      ...(recipient.role !== 'tenant' || tenantLoginEnabled() ? { ctaLabel: 'Acessar Plataforma', ctaUrl: appUrl || undefined } : {}),
    });

    try {
      await sendMail({ to: recipient.email, subject: `Contrato cancelado - ${property?.address}`, html });
    } catch (error) {
      console.error('Contract cancellation email error:', error);
    }
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

  sendContractCancelledEmail(updated).catch((error) => console.error('Failed to send cancellation email:', error));

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

// Corrects a contract that hasn't been signed yet (e.g. a typo made at creation) so the
// PDF can be regenerated. Once a signed copy is attached the terms are frozen — the
// signed file would no longer match the data. Email notification is opt-in (`notify`).
router.patch('/:id', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const existing = await loadAccessibleContract(req, res);
  if (!existing) return;

  if (existing.signedContractUrl) {
    res.status(400).json({ error: 'Contratos já assinados não podem ser editados.' });
    return;
  }
  if (existing.status !== 'active') {
    res.status(400).json({ error: 'Apenas contratos ativos podem ser editados.' });
    return;
  }

  const { propertyId, tenantUid, landlordUid, startDate, endDate, dueDay, monthlyRent, lateFeeEnabled, notify } = req.body ?? {};

  if (!propertyId || !tenantUid || !startDate || !endDate || monthlyRent === undefined) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const newStart = new Date(startDate);
  const newEnd = new Date(endDate);
  if (Number.isNaN(newStart.getTime()) || Number.isNaN(newEnd.getTime()) || newEnd <= newStart) {
    res.status(400).json({ error: 'A data de término deve ser posterior à data de início.' });
    return;
  }
  const newDueDay = Number(dueDay) || 10;
  if (!Number.isInteger(newDueDay) || newDueDay < 1 || newDueDay > 31) {
    res.status(400).json({ error: 'Dia de vencimento inválido.' });
    return;
  }
  const newRent = Number(monthlyRent);
  if (!Number.isFinite(newRent) || newRent <= 0) {
    res.status(400).json({ error: 'Valor de aluguel inválido.' });
    return;
  }

  const propertyChanged = propertyId !== existing.propertyId;
  let newProperty = null;
  if (propertyChanged) {
    newProperty = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!newProperty) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }
    if (req.profile!.role !== 'admin' && newProperty.ownerUid !== req.profile!.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (newProperty.status !== 'available') {
      res.status(400).json({ error: 'O imóvel selecionado não está disponível.' });
      return;
    }
  }

  const effectiveLandlordUid = req.profile!.role === 'admin' && landlordUid
    ? landlordUid
    : newProperty?.ownerUid ?? existing.landlordUid;

  // The payment schedule is derived from these fields; if any changed it must be rebuilt.
  const scheduleChanged =
    tenantUid !== existing.tenantUid ||
    newStart.getTime() !== existing.startDate.getTime() ||
    newEnd.getTime() !== existing.endDate.getTime() ||
    newDueDay !== existing.dueDay ||
    newRent !== Number(existing.monthlyRent);

  if (scheduleChanged) {
    const paidCount = await prisma.payment.count({ where: { contractId: existing.id, status: 'paid' } });
    if (paidCount > 0) {
      res.status(400).json({
        error: 'Este contrato já possui pagamentos recebidos, então inquilino, datas, vencimento e valor não podem mais ser alterados.',
      });
      return;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const contract = await tx.contract.update({
      where: { id: existing.id },
      data: {
        propertyId,
        tenantUid,
        landlordUid: effectiveLandlordUid,
        startDate: newStart,
        endDate: newEnd,
        dueDay: newDueDay,
        monthlyRent: newRent,
        lateFeeEnabled: !!lateFeeEnabled,
        // A new end date means the "expiring soon" reminder may need to fire again.
        ...(newEnd.getTime() !== existing.endDate.getTime() ? { reminderSentAt: null } : {}),
      },
    });
    if (propertyChanged) {
      await tx.property.update({ where: { id: existing.propertyId }, data: { status: 'available' } });
      await tx.property.update({ where: { id: propertyId }, data: { status: 'rented' } });
    }
    if (scheduleChanged) {
      await tx.payment.deleteMany({ where: { contractId: existing.id } });
      await createPaymentsForContract(tx, contract);
    }
    return contract;
  });

  if (notify === true) {
    sendContractEmail(updated, 'update').catch((error) => console.error('Failed to send contract email:', error));
  }

  res.json(serializeContract(updated));
});

export default router;
