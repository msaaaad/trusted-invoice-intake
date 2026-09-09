import { prisma } from "./db";
import { getPartners, Partner } from "./accountingApi";

function buildLookup(partners: Partner[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const partner of partners) {
    map.set(partner.name.trim(), partner.partner_code);
    for (const alias of partner.aliases) {
      map.set(alias.trim(), partner.partner_code);
    }
  }
  return map;
}

export async function runPartnerResolution() {
  const partners = await getPartners();
  const lookup = buildLookup(partners);

  const invoices = await prisma.invoice.findMany({
    where: { status: "EXTRACTED" },
    orderBy: { fileName: "asc" },
  });

  for (const invoice of invoices) {
    const rawName = invoice.partnerNameRaw?.trim();
    const partnerCode = rawName ? lookup.get(rawName) : undefined;

    if (!partnerCode) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "NEEDS_REVIEW",
          reviewReason: `Unknown supplier: "${invoice.partnerNameRaw}" not found in partner master`,
        },
      });
      console.log(`  ${invoice.fileName}: NEEDS_REVIEW - unknown supplier "${invoice.partnerNameRaw}"`);
      continue;
    }

    // Assigning partnerCode is what completes the (partnerCode, invoiceNumber) pair the
    // DB's unique constraint guards. Check for a collision here rather than let the write
    // throw - this is where the duplicate-invoice case actually surfaces in practice, not
    // at the later dedupe/registration stage originally planned.
    if (invoice.invoiceNumber) {
      const duplicateOf = await prisma.invoice.findFirst({
        where: { partnerCode, invoiceNumber: invoice.invoiceNumber, id: { not: invoice.id } },
      });
      if (duplicateOf) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "SKIPPED_DUPLICATE",
            reviewReason: `Duplicate of ${duplicateOf.fileName} (same partner ${partnerCode} + invoice number ${invoice.invoiceNumber})`,
          },
        });
        console.log(`  ${invoice.fileName}: SKIPPED_DUPLICATE - duplicate of ${duplicateOf.fileName}`);
        continue;
      }
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { partnerCode },
    });
    console.log(`  ${invoice.fileName}: "${invoice.partnerNameRaw}" -> ${partnerCode}`);
  }
}
