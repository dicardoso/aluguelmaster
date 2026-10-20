-- AlterTable
ALTER TABLE "settings" ADD COLUMN "contractExpiryReminderDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "settings" ADD COLUMN "paymentDueReminderDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "settings" ADD COLUMN "renewalWindowDays" INTEGER NOT NULL DEFAULT 60;
