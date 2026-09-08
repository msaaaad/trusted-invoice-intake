-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('INGESTED', 'EXTRACTED', 'NEEDS_REVIEW', 'SKIPPED_DUPLICATE', 'REGISTERED', 'FAILED_PARTNER', 'FAILED_DUPLICATE', 'FAILED_AMOUNT', 'FAILED_VALIDATION');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "partnerNameRaw" TEXT,
    "partnerCode" TEXT,
    "invoiceNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "subtotal" INTEGER,
    "taxAmount" INTEGER,
    "totalAmount" INTEGER,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'INGESTED',
    "reviewReason" TEXT,
    "accountingId" TEXT,
    "apiErrorCode" TEXT,
    "apiErrorMessage" TEXT,
    "rawExtraction" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER,
    "unit" TEXT NOT NULL,
    "unitPrice" INTEGER,
    "amount" INTEGER NOT NULL,
    "taxCode" TEXT NOT NULL,

    CONSTRAINT "LineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_partnerCode_invoiceNumber_key" ON "Invoice"("partnerCode", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
