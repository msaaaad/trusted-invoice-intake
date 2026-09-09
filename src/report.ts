import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";

const OUTPUT_PATH = path.join(__dirname, "..", "data", "report.json");

export async function runReport() {
  const invoices = await prisma.invoice.findMany({
    orderBy: { fileName: "asc" },
    include: { lines: true },
  });

  const summary = new Map<string, number>();
  for (const invoice of invoices) {
    summary.set(invoice.status, (summary.get(invoice.status) ?? 0) + 1);
  }

  console.log("\n=== Summary ===");
  for (const [status, count] of summary) {
    console.log(`  ${status}: ${count}`);
  }

  console.log("\n=== Detail ===");
  for (const invoice of invoices) {
    const reason = invoice.reviewReason ?? invoice.apiErrorMessage ?? "-";
    console.log(
      `  ${invoice.fileName} | ${invoice.status} | partner=${invoice.partnerCode ?? "-"} ` +
        `| invoice#=${invoice.invoiceNumber ?? "-"} | total=${invoice.totalAmount ?? "-"} ` +
        `| accountingId=${invoice.accountingId ?? "-"} | ${reason}`,
    );
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(invoices, null, 2));
  console.log(`\nFull audit export written to ${OUTPUT_PATH}`);
}
