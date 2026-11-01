import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";

async function main() {
  const app = buildApp();

  try {
    await prisma.$connect();
    app.log.info("Conectado ao banco de dados PostgreSQL via Prisma.");

    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 entregador-polpes backend rodando em http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
