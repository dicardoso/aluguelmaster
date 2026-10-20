-- Display name changed to "Locatto" (from "AluguelMaster", or "Contrato Fácil" if the previous migration was applied).
ALTER TABLE "settings" ALTER COLUMN "appName" SET DEFAULT 'Locatto';
UPDATE "settings" SET "appName" = 'Locatto' WHERE "appName" IN ('AluguelMaster', 'Contrato Fácil');
