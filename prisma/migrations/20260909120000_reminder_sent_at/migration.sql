-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
