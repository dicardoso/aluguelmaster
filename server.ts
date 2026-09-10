import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import admin from "firebase-admin";
import fs from "fs";
import meRouter from "./src/server/routes/me";
import propertiesRouter from "./src/server/routes/properties";
import contractsRouter from "./src/server/routes/contracts";
import paymentsRouter from "./src/server/routes/payments";
import usersRouter from "./src/server/routes/users";
import settingsRouter from "./src/server/routes/settings";
import { prisma } from "./src/server/prisma";
import { sendMail } from "./src/server/mailer";
import { requireAuth, loadProfile, requireRole } from "./src/server/auth";
import { formatCurrency } from "./src/lib/format";

async function startServer() {
  const app = express();
  const PORT = 9999;

  app.use(express.json());

  // Initialize Firebase Admin (still needed to verify Google Sign-In ID tokens)
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

  app.use('/api/me', meRouter);
  app.use('/api/properties', propertiesRouter);
  app.use('/api/contracts', contractsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/settings', settingsRouter);

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/email/contract-notification", requireAuth, loadProfile, async (req, res) => {
    const { to, subject, body } = req.body;
    try {
      await sendMail({ to, subject, html: body });
      res.json({ success: true, message: "Email sent successfully" });
    } catch (error) {
      console.error("Error sending email:", error);
      res.status(500).json({ success: false, error: "Failed to send email" });
    }
  });

  app.post("/api/reminders/process", requireAuth, loadProfile, requireRole('admin'), async (req, res) => {
    try {
      const now = new Date();

      const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
      const appName = settings?.appName || 'Equipe AluguelMaster';
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(now.getDate() + 30);

      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(now.getDate() + 3);

      const results = {
        contracts: 0,
        payments: 0,
        errors: [] as string[]
      };

      // 1. Process Contracts (Expiring in 30 days)
      const activeContracts = await prisma.contract.findMany({ where: { status: 'active' } });

      for (const contract of activeContracts) {
        const endDate = contract.endDate;

        // If expiring in less than 30 days and no reminder sent in last 30 days
        if (endDate <= thirtyDaysFromNow && endDate > now) {
          const lastReminder = contract.reminderSentAt;
          if (!lastReminder || (now.getTime() - lastReminder.getTime() > 25 * 24 * 60 * 60 * 1000)) {
            const tenant = await prisma.user.findUnique({ where: { id: contract.tenantUid } });

            if (tenant?.email) {
              const subject = `Lembrete: Seu contrato está próximo do vencimento`;
              const body = `
                <h2>Olá ${tenant.displayName},</h2>
                <p>Seu contrato de aluguel está previsto para encerrar em <b>${endDate.toLocaleDateString('pt-BR')}</b>.</p>
                <p>Por favor, entre em contato com o proprietário para discutir a renovação ou os próximos passos.</p>
                <br/>
                <p>Atenciosamente,<br/>${appName}</p>
              `;

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

      // 2. Process Payments (Due in 3 days or Overdue)
      const duePayments = await prisma.payment.findMany({ where: { status: { in: ['pending', 'overdue'] } } });

      for (const payment of duePayments) {
        const dueDate = payment.dueDate;

        // If due in less than 3 days or already overdue
        if (dueDate <= threeDaysFromNow) {
          const lastReminder = payment.reminderSentAt;
          // Send reminder if none sent today
          if (!lastReminder || (now.toDateString() !== lastReminder.toDateString())) {
            const tenant = await prisma.user.findUnique({ where: { id: payment.tenantUid } });

            if (tenant?.email) {
              const isOverdue = dueDate < now;
              const subject = isOverdue
                ? `ALERTA: Pagamento de aluguel ATRASADO`
                : `Lembrete: Vencimento de aluguel em breve`;

              const body = `
                <h2>Olá ${tenant.displayName},</h2>
                <p>Este é um lembrete sobre o pagamento do seu aluguel no valor de <b>${formatCurrency(Number(payment.amount))}</b>.</p>
                <p>Data de vencimento: <b>${dueDate.toLocaleDateString('pt-BR')}</b>.</p>
                ${isOverdue ? '<p style="color: red; font-weight: bold;">Seu pagamento está ATRASADO. Por favor, regularize o quanto antes.</p>' : ''}
                <p>Ignore este e-mail caso já tenha realizado o pagamento.</p>
                <br/>
                <p>Atenciosamente,<br/>${appName}</p>
              `;

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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
