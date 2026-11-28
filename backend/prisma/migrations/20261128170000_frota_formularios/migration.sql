-- Formulários da Frota alinhados ao protótipo (v699): ficha técnica e fotografias da viatura, anexos, hora, peças, imobilização.
-- AlterTable
ALTER TABLE "FleetDocument" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "FleetDriver" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "photo" TEXT;

-- AlterTable
ALTER TABLE "FleetFuel" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "time" TEXT;

-- AlterTable
ALTER TABLE "FleetIncident" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "claimRef" TEXT,
ADD COLUMN     "immobilizes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "thirdParties" TEXT,
ADD COLUMN     "time" TEXT;

-- AlterTable
ALTER TABLE "FleetInsurance" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "FleetIntervention" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "parts" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "FleetVehicle" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "company" TEXT,
ADD COLUMN     "details" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "photos" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "tipologia" TEXT NOT NULL DEFAULT 'VIATURA';

