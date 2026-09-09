import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { extractInvoice, ExtractionResult } from "./gemini";

const INVOICES_DIR = path.join(__dirname, "..", "invoices");

const TAX_CODE_BY_RATE: Record<number, string> = { 10: "T10", 8: "T08" };

function mimeTypeFor(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  throw new Error(`Unsupported file type: ${fileName}`);
}

function toInvoiceFields(result: ExtractionResult) {
  return {
    partnerNameRaw: result.partnerNameRaw,
    invoiceNumber: result.invoiceNumber,
    subtotal: result.subtotal,
    taxAmount: result.taxAmount,
    totalAmount: result.totalAmount,
    status: "EXTRACTED" as const,
    rawExtraction: result as unknown as Prisma.InputJsonValue,
  };
}

export async function runExtraction() {
  const files = (await readdir(INVOICES_DIR))
    .filter((f) => !f.startsWith("."))
    .sort();

  for (const fileName of files) {
    const buffer = await readFile(path.join(INVOICES_DIR, fileName));
    const mimeType = mimeTypeFor(fileName);

    console.log(`Extracting ${fileName}...`);
    const result = await extractInvoice(buffer, mimeType);

    const invoice = await prisma.invoice.upsert({
      where: { fileName },
      create: { fileName, ...toInvoiceFields(result) },
      update: toInvoiceFields(result),
    });

    await prisma.lineItem.deleteMany({ where: { invoiceId: invoice.id } });
    await prisma.lineItem.createMany({
      data: result.lines.map((line) => ({
        invoiceId: invoice.id,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        amount: line.amount,
        taxCode: TAX_CODE_BY_RATE[line.taxRatePercent] ?? `UNKNOWN_${line.taxRatePercent}`,
      })),
    });

    const flag = result.extractionNotes.length > 0 ? ` [notes: ${result.extractionNotes.join(" | ")}]` : "";
    console.log(`  -> ${result.lines.length} lines, total ${result.totalAmount}${flag}`);
  }
}
