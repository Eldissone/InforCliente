-- Área Financeira: documento físico da fatura (PDF/imagem) e origem do
-- preenchimento automático por IA (Gemini).

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "documentPath" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "documentName" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "documentMimeType" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "documentSize" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "documentUploadedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "documentUploadedBy" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "scanSource" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "scanModel" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "scanRaw" JSONB;

CREATE INDEX IF NOT EXISTS "Invoice_documentPath_idx" ON "Invoice"("documentPath");
