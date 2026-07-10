CREATE SEQUENCE IF NOT EXISTS "NeedQuote_orderNumber_seq";
ALTER TABLE "NeedQuote" ADD COLUMN "orderNumber" INTEGER;
ALTER TABLE "NeedQuote" ADD CONSTRAINT "NeedQuote_orderNumber_key" UNIQUE ("orderNumber");
