import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAuth, loadProfile, requireRole, AuthedRequest } from '../auth.js';
import { serializeProperty } from '../serialize.js';

const router = Router();

const TYPES = ['residential', 'commercial'];
const STATUSES = ['available', 'rented', 'maintenance'];
const isPositiveNumber = (v: unknown) => typeof v === 'number' ? Number.isFinite(v) && v > 0 : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0;

// Returns an error message for an invalid field, or null. Only checks fields that are present.
function validatePropertyFields({ type, monthlyRent, status }: any): string | null {
  if (type !== undefined && !TYPES.includes(type)) return 'Tipo de imóvel inválido.';
  if (status !== undefined && !STATUSES.includes(status)) return 'Status do imóvel inválido.';
  if (monthlyRent !== undefined && !isPositiveNumber(monthlyRent)) return 'Valor de aluguel inválido.';
  return null;
}

router.use(requireAuth, loadProfile);

router.get('/', async (req: AuthedRequest, res) => {
  const properties = await prisma.property.findMany({
    where: req.profile!.role === 'admin' ? {} : { ownerUid: req.profile!.id },
    orderBy: { address: 'asc' },
  });
  res.json(properties.map(serializeProperty));
});

router.post('/', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const { address, type, description, monthlyRent, status } = req.body ?? {};

  if (!address || !type || monthlyRent === undefined) {
    res.status(400).json({ error: 'address, type and monthlyRent are required' });
    return;
  }
  const invalid = validatePropertyFields(req.body);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }

  // A landlord can only ever create properties for themselves — the client-supplied
  // ownerUid is ignored for anyone but admin, closing the old Firestore-rules gap
  // where a landlord could forge another user's ownerUid.
  const ownerUid = req.profile!.role === 'admin' && req.body.ownerUid ? req.body.ownerUid : req.profile!.id;

  const property = await prisma.property.create({
    data: { address, type, description: description || '', monthlyRent, status: status || 'available', ownerUid },
  });
  res.status(201).json(serializeProperty(property));
});

async function loadOwnedProperty(req: AuthedRequest, res: any) {
  const property = await prisma.property.findUnique({ where: { id: req.params.id } });
  if (!property) {
    res.status(404).json({ error: 'Property not found' });
    return null;
  }
  if (req.profile!.role !== 'admin' && property.ownerUid !== req.profile!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return property;
}

router.patch('/:id', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const existing = await loadOwnedProperty(req, res);
  if (!existing) return;

  const { address, type, description, monthlyRent, status } = req.body ?? {};
  const invalid = validatePropertyFields(req.body ?? {});
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const updated = await prisma.property.update({
    where: { id: existing.id },
    data: {
      ...(address !== undefined && { address }),
      ...(type !== undefined && { type }),
      ...(description !== undefined && { description }),
      ...(monthlyRent !== undefined && { monthlyRent }),
      ...(status !== undefined && { status }),
    },
  });
  res.json(serializeProperty(updated));
});

router.delete('/:id', requireRole('admin', 'landlord'), async (req: AuthedRequest, res) => {
  const existing = await loadOwnedProperty(req, res);
  if (!existing) return;

  if (await prisma.contract.count({ where: { propertyId: existing.id } })) {
    res.status(409).json({ error: 'Este imóvel possui contratos e não pode ser excluído.' });
    return;
  }

  await prisma.property.delete({ where: { id: existing.id } });
  res.status(204).end();
});

export default router;
