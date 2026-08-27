import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import CryptoJS from "crypto-js";

async function startServer() {
  const app = express();
  const PORT = 9999;

  app.use(express.json());

  // Initialize Firebase Admin
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

  const db = getFirestore(firebaseConfig.firestoreDatabaseId);

  // Email transporter (lazy initialization)
  let transporter: nodemailer.Transporter | null = null;

  const getTransporter = async () => {
    if (!transporter) {
      // Fetch settings from Firestore
      const settingsDoc = await db.collection('settings').doc('global').get();
      const settings = settingsDoc.data();
      
      if (!settings) {
        console.warn("No settings found in Firestore.");
        return null;
      }

      const { smtpHost, smtpPort, smtpUser, smtpPassword } = settings;

      if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
        console.warn("SMTP credentials not fully configured in Firestore settings. Emails will be logged to console only.");
        return null;
      }

      // Decrypt password
      const ENCRYPTION_KEY = process.env.VITE_ENCRYPTION_KEY || 'default-secret-key-12345';
      let decryptedPassword = smtpPassword;
      try {
        const bytes = CryptoJS.AES.decrypt(smtpPassword, ENCRYPTION_KEY);
        decryptedPassword = bytes.toString(CryptoJS.enc.Utf8);
      } catch (error) {
        console.error('Error decrypting SMTP password:', error);
      }

      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: parseInt(smtpPort) === 465,
        auth: {
          user: smtpUser,
          pass: decryptedPassword,
        },
      });
    }
    return transporter;
  };

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/email/contract-notification", async (req, res) => {
    const { to, subject, body } = req.body;
    const mailOptions = {
      from: process.env.SMTP_FROM || "no-reply@gestaoimobiliaria.com",
      to,
      subject,
      html: body,
    };

    const mailTransporter = await getTransporter();
    if (mailTransporter) {
      try {
        await mailTransporter.sendMail(mailOptions);
        res.json({ success: true, message: "Email sent successfully" });
      } catch (error) {
        console.error("Error sending email:", error);
        res.status(500).json({ success: false, error: "Failed to send email" });
      }
    } else {
      console.log("SIMULATED EMAIL SENT:");
      console.log("To:", to);
      console.log("Subject:", subject);
      console.log("Body:", body);
      res.json({ success: true, message: "Email simulated (check server logs)" });
    }
  });

  app.post("/api/reminders/process", async (req, res) => {
    try {
      const now = new Date();
      
      const settingsDoc = await db.collection('settings').doc('global').get();
      const settings = settingsDoc.data();
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
      const contractsSnapshot = await db.collection('contracts')
        .where('status', '==', 'active')
        .get();

      for (const doc of contractsSnapshot.docs) {
        const contract = doc.data();
        const endDate = new Date(contract.endDate);

        // If expiring in less than 30 days and no reminder sent in last 30 days
        if (endDate <= thirtyDaysFromNow && endDate > now) {
          const lastReminder = contract.reminderSentAt ? new Date(contract.reminderSentAt) : null;
          if (!lastReminder || (now.getTime() - lastReminder.getTime() > 25 * 24 * 60 * 60 * 1000)) {
            // Send email to landlord and tenant
            const tenantDoc = await db.collection('users').doc(contract.tenantUid).get();
            const tenant = tenantDoc.data();

            if (tenant?.email) {
              const subject = `Lembrete: Seu contrato está próximo do vencimento`;
              const body = `
                <h2>Olá ${tenant.displayName},</h2>
                <p>Seu contrato de aluguel está previsto para encerrar em <b>${endDate.toLocaleDateString('pt-BR')}</b>.</p>
                <p>Por favor, entre em contato com o proprietário para discutir a renovação ou os próximos passos.</p>
                <br/>
                <p>Atenciosamente,<br/>${appName}</p>
              `;

              const mailTransporter = await getTransporter();
              const mailOptions = {
                from: process.env.SMTP_FROM || "no-reply@gestaoimobiliaria.com",
                to: tenant.email,
                subject,
                html: body,
              };

              if (mailTransporter) {
                await mailTransporter.sendMail(mailOptions);
              } else {
                console.log("SIMULATED REMINDER EMAIL (Contract):", tenant.email);
              }

              await doc.ref.update({ reminderSentAt: now.toISOString() });
              results.contracts++;
            }
          }
        }
      }

      // 2. Process Payments (Due in 3 days or Overdue)
      const paymentsSnapshot = await db.collection('payments')
        .where('status', 'in', ['pending', 'overdue'])
        .get();

      for (const doc of paymentsSnapshot.docs) {
        const payment = doc.data();
        const dueDate = new Date(payment.dueDate);

        // If due in less than 3 days or already overdue
        if (dueDate <= threeDaysFromNow) {
          const lastReminder = payment.reminderSentAt ? new Date(payment.reminderSentAt) : null;
          // Send reminder if none sent today
          if (!lastReminder || (now.toDateString() !== lastReminder.toDateString())) {
            const tenantDoc = await db.collection('users').doc(payment.tenantUid).get();
            const tenant = tenantDoc.data();

            if (tenant?.email) {
              const isOverdue = dueDate < now;
              const subject = isOverdue
                ? `ALERTA: Pagamento de aluguel ATRASADO`
                : `Lembrete: Vencimento de aluguel em breve`;

              const body = `
                <h2>Olá ${tenant.displayName},</h2>
                <p>Este é um lembrete sobre o pagamento do seu aluguel no valor de <b>R$ ${payment.amount.toLocaleString('pt-BR')}</b>.</p>
                <p>Data de vencimento: <b>${dueDate.toLocaleDateString('pt-BR')}</b>.</p>
                ${isOverdue ? '<p style="color: red; font-weight: bold;">Seu pagamento está ATRASADO. Por favor, regularize o quanto antes.</p>' : ''}
                <p>Ignore este e-mail caso já tenha realizado o pagamento.</p>
                <br/>
                <p>Atenciosamente,<br/>${appName}</p>
              `;

              const mailTransporter = await getTransporter();
              const mailOptions = {
                from: process.env.SMTP_FROM || "no-reply@gestaoimobiliaria.com",
                to: tenant.email,
                subject,
                html: body,
              };

              if (mailTransporter) {
                await mailTransporter.sendMail(mailOptions);
              } else {
                console.log("SIMULATED REMINDER EMAIL (Payment):", tenant.email);
              }

              await doc.ref.update({ reminderSentAt: now.toISOString() });
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
