import { InvoiceStatus } from "@prisma/client";
import { prisma } from "./db";
import { getRegisteredInvoices, postInvoice, InvoicePayload } from "./accountingApi";

// Maps the API's documented error codes to our status enum. Anything unmapped
// (UNAUTHORIZED, NOT_FOUND, or a genuinely unexpected code) falls back to
// FAILED_VALIDATION but keeps the real code in apiErrorCode - that fallback
// firing at all would mean a bug in this integration, not a data problem.
const STATUS_BY_ERROR_CODE: Record<string, InvoiceStatus> = {
  PARTNER_NOT_FOUND: "FAILED_PARTNER",
  DUPLICATE_INVOICE: "FAILED_DUPLICATE",
  AMOUNT_MISMATCH: "FAILED_AMOUNT",
  UNKNOWN_TAX_CODE: "FAILED_VALIDATION",
  DUE_DATE_BEFORE_ISSUE_DATE: "FAILED_VALIDATION",
  VALIDATION_ERROR: "FAILED_VALIDATION",
};

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function runRegistration() {
  // Fetched once per run, this is the live, independent source of truth -
  // catches an invoice already registered in the accounting system that our
  // own local DB doesn't know about (e.g. local DB reset). Domain 4's DB
  // constraint already prevents two rows in *our* DB from colliding; this is
  // the second, different layer.
  const registered = await getRegisteredInvoices();
  const registeredKeys = new Set(registered.map((r) => `${r.partner_code}:${r.invoice_number}`));

  const invoices = await prisma.invoice.findMany({
    where: { status: "EXTRACTED", partnerCode: { not: null } },
    include: { lines: true },
  });

  for (const invoice of invoices) {
    const key = `${invoice.partnerCode}:${invoice.invoiceNumber}`;

    if (registeredKeys.has(key)) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "SKIPPED_DUPLICATE",
          reviewReason: `Already registered per live GET /invoices check (${key})`,
        },
      });
      console.log(`  ${invoice.fileName}: SKIPPED_DUPLICATE - already registered live`);
      continue;
    }

    const payload: InvoicePayload = {
      partner_code: invoice.partnerCode!,
      invoice_number: invoice.invoiceNumber!,
      issue_date: toDateOnly(invoice.issueDate!),
      due_date: toDateOnly(invoice.dueDate!),
      currency: "JPY",
      lines: invoice.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unitPrice,
        amount: line.amount,
        tax_code: line.taxCode,
      })),
      subtotal: invoice.subtotal!,
      tax_amount: invoice.taxAmount!,
      total_amount: invoice.totalAmount!,
    };

    const result = await postInvoice(payload);

    if (result.success && result.data) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "REGISTERED", accountingId: result.data.accounting_id },
      });
      console.log(`  ${invoice.fileName}: REGISTERED as ${result.data.accounting_id}`);
      registeredKeys.add(key);
      continue;
    }

    const errorCode = result.error?.code ?? "UNKNOWN";
    const status = STATUS_BY_ERROR_CODE[errorCode] ?? "FAILED_VALIDATION";
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status, apiErrorCode: errorCode, apiErrorMessage: result.error?.message ?? null },
    });
    console.log(`  ${invoice.fileName}: ${status} - ${errorCode}: ${result.error?.message}`);
  }
}
