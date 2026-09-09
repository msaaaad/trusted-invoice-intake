import { prisma } from "./db";

const REIWA_ERA_START_YEAR = 2019; // 令和元年 (Reiwa 1) = 2019

const REIWA_PATTERN = /令和(\d+)年(\d+)月(\d+)日/;
const KANJI_PATTERN = /(\d{4})年(\d+)月(\d+)日/;
const SLASH_PATTERN = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

function parseJapaneseDate(raw: string): Date | null {
  const reiwa = REIWA_PATTERN.exec(raw);
  if (reiwa) {
    const year = REIWA_ERA_START_YEAR - 1 + Number(reiwa[1]);
    return new Date(Date.UTC(year, Number(reiwa[2]) - 1, Number(reiwa[3])));
  }

  const kanji = KANJI_PATTERN.exec(raw);
  if (kanji) {
    return new Date(Date.UTC(Number(kanji[1]), Number(kanji[2]) - 1, Number(kanji[3])));
  }

  const slash = SLASH_PATTERN.exec(raw.trim());
  if (slash) {
    return new Date(Date.UTC(Number(slash[1]), Number(slash[2]) - 1, Number(slash[3])));
  }

  return null;
}

interface RawDates {
  issueDateRaw?: string;
  dueDateRaw?: string;
}

export async function runNormalization() {
  const invoices = await prisma.invoice.findMany({ where: { status: "EXTRACTED" } });

  for (const invoice of invoices) {
    const raw = invoice.rawExtraction as RawDates | null;
    const issueDateRaw = raw?.issueDateRaw;
    const dueDateRaw = raw?.dueDateRaw;

    const issueDate = issueDateRaw ? parseJapaneseDate(issueDateRaw) : null;
    const dueDate = dueDateRaw ? parseJapaneseDate(dueDateRaw) : null;

    if (!issueDate || !dueDate) {
      const unparsed = [
        !issueDate ? `issueDateRaw="${issueDateRaw}"` : null,
        !dueDate ? `dueDateRaw="${dueDateRaw}"` : null,
      ]
        .filter(Boolean)
        .join(", ");

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "NEEDS_REVIEW", reviewReason: `Could not parse date(s): ${unparsed}` },
      });
      console.log(`  ${invoice.fileName}: NEEDS_REVIEW - could not parse ${unparsed}`);
      continue;
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { issueDate, dueDate },
    });
    console.log(
      `  ${invoice.fileName}: ${issueDate.toISOString().slice(0, 10)} -> ${dueDate.toISOString().slice(0, 10)}`,
    );
  }
}
