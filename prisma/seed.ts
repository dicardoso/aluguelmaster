import "dotenv/config";
import { prisma } from "../src/server/prisma";

// Sample users are seeded as "invite" placeholders (isInvite: true), the same
// mechanism POST /api/users uses — a real Firebase uid only exists after someone
// actually signs in with that email, at which point src/server/auth.ts's
// loadProfile() migrates the placeholder to the real uid automatically.
async function upsertInvite(data: {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "landlord" | "tenant";
  cpf?: string;
  address?: string;
  phone?: string;
}) {
  return prisma.user.upsert({
    where: { email: data.email },
    update: {},
    create: { ...data, isInvite: true },
  });
}

async function main() {
  const admin = await upsertInvite({
    id: "invite_seed_admin",
    email: "diogomescardoso@gmail.com",
    displayName: "Diogo Cardoso",
    role: "admin",
  });
  console.log(`Admin ready: ${admin.email} (${admin.id})`);

  const landlord = await upsertInvite({
    id: "invite_seed_landlord",
    email: "locador.exemplo@aluguelmaster.local",
    displayName: "Carlos Proprietário",
    role: "landlord",
    cpf: "111.111.111-11",
    address: "Rua das Palmeiras, 100, João Pessoa - PB",
  });

  const tenant = await upsertInvite({
    id: "invite_seed_tenant",
    email: "inquilino.exemplo@aluguelmaster.local",
    displayName: "Ana Inquilina",
    role: "tenant",
    cpf: "222.222.222-22",
    address: "Rua das Palmeiras, 200, João Pessoa - PB",
  });

  const property = await prisma.property.upsert({
    where: { id: "seed_property_1" },
    update: {},
    create: {
      id: "seed_property_1",
      address: "Av. Epitácio Pessoa, 500, Apto 302, João Pessoa - PB",
      type: "residential",
      description: "Apartamento de 2 quartos, próximo à praia, mobiliado.",
      ownerUid: landlord.id,
      monthlyRent: 1500,
      status: "rented",
    },
  });

  const today = new Date();
  const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear() + 1, startDate.getUTCMonth(), 1));

  const contract = await prisma.contract.upsert({
    where: { id: "seed_contract_1" },
    update: {},
    create: {
      id: "seed_contract_1",
      propertyId: property.id,
      landlordUid: landlord.id,
      tenantUid: tenant.id,
      startDate,
      endDate,
      dueDay: 10,
      monthlyRent: 1500,
      status: "active",
    },
  });

  const lastMonthDueDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 10));
  const thisMonthDueDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 10));

  await prisma.payment.upsert({
    where: { id: "seed_payment_paid" },
    update: {},
    create: {
      id: "seed_payment_paid",
      contractId: contract.id,
      tenantUid: tenant.id,
      amount: 1500,
      dueDate: lastMonthDueDate,
      paidAt: lastMonthDueDate,
      status: "paid",
    },
  });

  await prisma.payment.upsert({
    where: { id: "seed_payment_pending" },
    update: {},
    create: {
      id: "seed_payment_pending",
      contractId: contract.id,
      tenantUid: tenant.id,
      amount: 1500,
      dueDate: thisMonthDueDate,
      status: "pending",
    },
  });

  console.log("Seed complete: 1 property, 1 contract, 2 payments.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
