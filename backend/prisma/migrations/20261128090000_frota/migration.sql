-- Frota (protótipo, área «frota»): viaturas, motoristas, abastecimentos, intervenções, ocorrências, documentos e seguros.
-- CreateTable
CREATE TABLE "FleetVehicle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "unit" TEXT NOT NULL DEFAULT 'KM',
    "fuel" TEXT,
    "tankCapacity" DECIMAL(10,2),
    "refConsumption" DECIMAL(10,2),
    "odometer" DECIMAL(14,1),
    "odometerAt" TIMESTAMP(3),
    "acquisitionValue" DECIMAL(16,2),
    "ownership" TEXT NOT NULL DEFAULT 'PROPRIA',
    "assignedTo" TEXT,
    "projectId" TEXT,
    "driverId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Operacional',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "maintenancePlans" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetDriver" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "licenseCategory" TEXT,
    "licenseExpiry" TIMESTAMP(3),
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Ativo',
    "department" TEXT,
    "projectId" TEXT,
    "personnelId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetDriver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetFuel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "odometer" DECIMAL(14,1),
    "liters" DECIMAL(10,2) NOT NULL,
    "pricePerLiter" DECIMAL(12,2),
    "amount" DECIMAL(16,2) NOT NULL,
    "fuelType" TEXT,
    "fullTank" BOOLEAN NOT NULL DEFAULT true,
    "station" TEXT,
    "paymentMethod" TEXT,
    "receipt" TEXT,
    "projectId" TEXT,
    "justification" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetFuel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetIntervention" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "odometer" DECIMAL(14,1),
    "type" TEXT NOT NULL,
    "system" TEXT,
    "description" TEXT NOT NULL,
    "supplierId" TEXT,
    "workshop" TEXT,
    "technician" TEXT,
    "entryDate" TIMESTAMP(3),
    "exitDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Concluída',
    "laborCost" DECIMAL(16,2),
    "partsCost" DECIMAL(16,2),
    "otherCost" DECIMAL(16,2),
    "warranty" TEXT,
    "nextAction" TEXT,
    "nextDate" TIMESTAMP(3),
    "nextOdometer" DECIMAL(14,1),
    "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "incidentId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetIntervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetIncident" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'Média',
    "location" TEXT,
    "description" TEXT NOT NULL,
    "action" TEXT,
    "responsible" TEXT,
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Aberta',
    "closedAt" TIMESTAMP(3),
    "estimatedCost" DECIMAL(16,2),
    "cost" DECIMAL(16,2),
    "insuranceClaim" BOOLEAN NOT NULL DEFAULT false,
    "injuries" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetDocument" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT,
    "entity" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "cost" DECIMAL(16,2),
    "situation" TEXT NOT NULL DEFAULT 'Em vigor',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetInsurance" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "supplierId" TEXT,
    "policyNumber" TEXT NOT NULL,
    "coverages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vehicleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "premium" DECIMAL(16,2),
    "periodicity" TEXT NOT NULL DEFAULT 'ANUAL',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FleetVehicle_code_key" ON "FleetVehicle"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FleetVehicle_plate_key" ON "FleetVehicle"("plate");

-- CreateIndex
CREATE INDEX "FleetVehicle_active_idx" ON "FleetVehicle"("active");

-- CreateIndex
CREATE INDEX "FleetVehicle_projectId_idx" ON "FleetVehicle"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetDriver_code_key" ON "FleetDriver"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FleetFuel_code_key" ON "FleetFuel"("code");

-- CreateIndex
CREATE INDEX "FleetFuel_vehicleId_date_idx" ON "FleetFuel"("vehicleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FleetIntervention_code_key" ON "FleetIntervention"("code");

-- CreateIndex
CREATE INDEX "FleetIntervention_vehicleId_date_idx" ON "FleetIntervention"("vehicleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FleetIncident_code_key" ON "FleetIncident"("code");

-- CreateIndex
CREATE INDEX "FleetIncident_vehicleId_date_idx" ON "FleetIncident"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "FleetIncident_status_idx" ON "FleetIncident"("status");

-- CreateIndex
CREATE INDEX "FleetDocument_vehicleId_type_idx" ON "FleetDocument"("vehicleId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "FleetInsurance_code_key" ON "FleetInsurance"("code");

-- CreateIndex
CREATE INDEX "FleetInsurance_endDate_idx" ON "FleetInsurance"("endDate");

-- AddForeignKey
ALTER TABLE "FleetVehicle" ADD CONSTRAINT "FleetVehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetFuel" ADD CONSTRAINT "FleetFuel_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetFuel" ADD CONSTRAINT "FleetFuel_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetIntervention" ADD CONSTRAINT "FleetIntervention_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetIncident" ADD CONSTRAINT "FleetIncident_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetIncident" ADD CONSTRAINT "FleetIncident_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "FleetDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetDocument" ADD CONSTRAINT "FleetDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
