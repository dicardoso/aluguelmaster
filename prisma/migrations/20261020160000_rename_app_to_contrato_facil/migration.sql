-- Display name changed from "AluguelMaster" to "Contrato Fácil".
ALTER TABLE "settings" ALTER COLUMN "appName" SET DEFAULT 'Contrato Fácil';
UPDATE "settings" SET "appName" = 'Contrato Fácil' WHERE "appName" = 'AluguelMaster';
