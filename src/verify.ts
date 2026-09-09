import { prisma } from "./db";

// Same rate literals the accounting API uses (accounting_api.py: TAX_RATES).
// Kept as plain floats on purpose, not integer-safe math - JS and Python both
// use IEEE754 doubles, so `Math.floor(subtotal * 0.10)` here produces the exact
// same result as the API's own `math.floor(subtotal * 0.10)`. "Fixing" this
// with integer division would make our prediction diverge from what the live
// API actually computes, which defeats the point of predicting it.
const TAX_RATES: Record<string, number> = { T10: 0.1, T08: 0.08 };

export async function runVerification() {
  const invoices = await prisma.invoice.findMany({
    where: { status: "EXTRACTED" },
    include: { lines: true },
  });

  for (const invoice of invoices) {
    const problems: string[] = [];

    for (const line of invoice.lines) {
      if (!line.unit.trim()) {
        problems.push(`line "${line.description}" is missing a required unit`);
      }
      if (!(line.taxCode in TAX_RATES)) {
        problems.push(`line "${line.description}" has an unrecognized tax code "${line.taxCode}"`);
      }
    }

    if (invoice.issueDate && invoice.dueDate && invoice.dueDate < invoice.issueDate) {
      problems.push("due date is before issue date");
    }

    const expectedSubtotal = invoice.lines.reduce((sum, line) => sum + line.amount, 0);
    if (invoice.subtotal !== expectedSubtotal) {
      problems.push(`subtotal mismatch: expected ${expectedSubtotal}, extracted ${invoice.subtotal}`);
    }

    const subtotalByCode = new Map<string, number>();
    for (const line of invoice.lines) {
      if (line.taxCode in TAX_RATES) {
        subtotalByCode.set(line.taxCode, (subtotalByCode.get(line.taxCode) ?? 0) + line.amount);
      }
    }
    let expectedTax = 0;
    for (const [code, subtotal] of subtotalByCode) {
      expectedTax += Math.floor(subtotal * TAX_RATES[code]);
    }
    if (invoice.taxAmount !== expectedTax) {
      problems.push(`tax mismatch: expected ${expectedTax}, extracted ${invoice.taxAmount}`);
    }

    const expectedTotal = expectedSubtotal + expectedTax;
    if (invoice.totalAmount !== expectedTotal) {
      problems.push(`total mismatch: expected ${expectedTotal}, extracted ${invoice.totalAmount}`);
    }

    if (problems.length > 0) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "NEEDS_REVIEW", reviewReason: problems.join("; ") },
      });
      console.log(`  ${invoice.fileName}: NEEDS_REVIEW - ${problems.join("; ")}`);
      continue;
    }

    console.log(`  ${invoice.fileName}: verified OK`);
  }
}
