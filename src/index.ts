import "dotenv/config";
import { prisma } from "./db";
import { runExtraction } from "./extract";
import { runNormalization } from "./normalize";
import { runPartnerResolution } from "./resolvePartner";
import { runVerification } from "./verify";
import { runRegistration } from "./register";
import { runReport } from "./report";

async function main() {
  await runExtraction();
  await runNormalization();
  await runPartnerResolution();
  await runVerification();
  await runRegistration();
  await runReport();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
