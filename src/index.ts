import "dotenv/config";
import { prisma } from "./db";
import { runExtraction } from "./extract";

async function main() {
  await runExtraction();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
