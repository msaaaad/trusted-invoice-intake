import "dotenv/config";
import { prisma } from "./db";
import { runExtraction } from "./extract";
import { runNormalization } from "./normalize";

async function main() {
  await runExtraction();
  await runNormalization();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
