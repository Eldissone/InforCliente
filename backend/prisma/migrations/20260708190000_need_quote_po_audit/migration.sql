-- Non-destructive: adds traceability columns to store who/when generated the
-- purchase order PDF and the unique document id printed in its footer.
ALTER TABLE "NeedQuote" ADD COLUMN IF NOT EXISTS "poDocumentId" TEXT;
ALTER TABLE "NeedQuote" ADD COLUMN IF NOT EXISTS "poIssuedBy" TEXT;
ALTER TABLE "NeedQuote" ADD COLUMN IF NOT EXISTS "poIssuedAt" TIMESTAMP(3);