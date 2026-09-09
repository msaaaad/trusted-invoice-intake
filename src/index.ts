import "dotenv/config";
import { prisma } from "./db";
import { runExtraction } from "./extract";
import { runNormalization } from "./normalize";
import { runPartnerResolution } from "./resolvePartner";

async function main() {
  await runExtraction();
  await runNormalization();
  await runPartnerResolution();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
