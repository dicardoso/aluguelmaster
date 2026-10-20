import express from "express";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import meRouter from "./routes/me.js";
import propertiesRouter from "./routes/properties.js";
import contractsRouter from "./routes/contracts.js";
import paymentsRouter from "./routes/payments.js";
import usersRouter from "./routes/users.js";
import settingsRouter from "./routes/settings.js";
import { prisma } from "./prisma.js";
import { sendMail, emailLayout, emailDetailsTable, emailBadge } from "./mailer.js";
import { requireAuth, loadProfile, requireRole } from "./auth.js";
import { formatCurrency } from "../lib/format.js";

// Builds the Express app with every /api route wired up, independent of how the
// process is hosted (a long-lived `app.listen()` in local dev, or a single
// request/response cycle in a serverless function on Vercel).
export function createApp() {
  const app = express();

  app.use(express.json());

  // Initialize Firebase Admin (still needed to verify Google Sign-In ID tokens).
  // Guarded against re-initialization because a warm serverless instance can call
  // createApp() more than once.
  if (!admin.apps.length) {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    let firebaseConfig: any = {};
    if (fs.existsSync(configPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }

    if (firebaseConfig.projectId) {
      admin.initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }
  }

  app.use('/api/me', meRouter);
  app.use('/api/properties', propertiesRouter);
  app.use('/api/contracts', contractsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/settings', settingsRouter);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/reminders/process", requireAuth, loadProfile, requireRole('admin'), async (req, res) => {
    try {
      const now = new Date();

      const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
      const appName = settings?.appName || 'AluguelMaster';
      const appUrl = process.env.APP_URL || '';
      const contractExpiryReminderDays = settings?.contractExpiryReminderDays ?? 30;
      const paymentDueReminderDays = settings?.paymentDueReminderDays ?? 3;
      // Once a reminder fires, don't resend for most of the window — otherwise a tenant
      // would get emailed daily for the entire lead time. Kept proportional to the
      // configured window instead of a fixed 25 days so it still makes sense if an admin
      // shortens/lengthens it.
      const contractReminderDedupeDays = Math.max(1, contractExpiryReminderDays - 5);

      const contractExpiryThreshold = new Date();
      contractExpiryThreshold.setDate(now.getDate() + contractExpiryReminderDays);

      const paymentDueThreshold = new Date();
      paymentDueThreshold.setDate(now.getDate() + paymentDueReminderDays);

      const results = {
        contracts: 0,
        payments: 0,
        errors: [] as string[]
      };

      // 1. Process Contracts (Expiring within the configured window)
      const activeContracts = await prisma.contract.findMany({ where: { status: 'active' } });

      for (const contract of activeContracts) {
        const endDate = contract.endDate;

        // If expiring within the window and no reminder sent recently
        if (endDate <= contractExpiryThreshold && endDate > now) {
          const lastReminder = contract.reminderSentAt;
          if (!lastReminder || (now.getTime() - lastReminder.getTime() > contractReminderDedupeDays * 24 * 60 * 60 * 1000)) {
            const tenant = await prisma.user.findUnique({ where: { id: contract.tenantUid } });

            if (tenant?.email) {
              const subject = `Lembrete: Seu contrato está próximo do vencimento`;
              const body = emailLayout({
                appName,
                heading: 'Seu contrato está vencendo em breve ⏳',
                bodyHtml: `
                  <p>Seu contrato de aluguel está previsto para encerrar em <strong>${endDate.toLocaleDateString('pt-BR')}</strong>.</p>
                  <p>Por favor, entre em contato com o proprietário para discutir a renovação ou os próximos passos.</p>
                `,
                ctaLabel: 'Acessar Plataforma',
                ctaUrl: appUrl || undefined,
              });

              try {
                await sendMail({ to: tenant.email, subject, html: body });
              } catch (error) {
                console.error('Failed to send contract reminder:', error);
              }

              await prisma.contract.update({ where: { id: contract.id }, data: { reminderSentAt: now } });
              results.contracts++;
            }
          }
        }
      }

      // 2. Process Payments (Due within the configured window, or overdue)
      const duePayments = await prisma.payment.findMany({ where: { status: { in: ['pending', 'overdue'] } } });

      for (const payment of duePayments) {
        const dueDate = payment.dueDate;

        // If due within the window or already overdue
        if (dueDate <= paymentDueThreshold) {
          const lastReminder = payment.reminderSentAt;
          // Send reminder if none sent today
          if (!lastReminder || (now.toDateString() !== lastReminder.toDateString())) {
            const tenant = await prisma.user.findUnique({ where: { id: payment.tenantUid } });

            if (tenant?.email) {
              const isOverdue = dueDate < now;
              const subject = isOverdue
                ? `ALERTA: Pagamento de aluguel ATRASADO`
                : `Lembrete: Vencimento de aluguel em breve`;

              const body = emailLayout({
                appName,
                heading: isOverdue ? 'Pagamento em atraso ⚠️' : 'Seu aluguel vence em breve 🗓️',
                bodyHtml: `
                  <p>Este é um lembrete sobre o pagamento do seu aluguel no valor de <strong>${formatCurrency(Number(payment.amount))}</strong>.</p>
                  ${emailDetailsTable([
                    ['Vencimento', dueDate.toLocaleDateString('pt-BR')],
                    ['Status', isOverdue ? emailBadge('Atrasado', 'red') : emailBadge('Pendente', 'amber')],
                  ])}
                  ${isOverdue ? '<p style="color:#dc2626;font-weight:600;">Seu pagamento está atrasado. Por favor, regularize o quanto antes.</p>' : ''}
                  <p>Ignore este e-mail caso já tenha realizado o pagamento.</p>
                `,
                ctaLabel: 'Acessar Plataforma',
                ctaUrl: appUrl || undefined,
              });

              try {
                await sendMail({ to: tenant.email, subject, html: body });
              } catch (error) {
                console.error('Failed to send payment reminder:', error);
              }

              await prisma.payment.update({ where: { id: payment.id }, data: { reminderSentAt: now } });
              results.payments++;
            }
          }
        }
      }

      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Error processing reminders:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return app;
}
