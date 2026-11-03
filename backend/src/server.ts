import { execSync } from "node:child_process";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { hashApiKey } from "./utils/crypto.js";

async function ensureDatabaseReady() {
  try {
    console.log("🔄 Verificando e sincronizando schema do banco (Prisma db push)...");
    execSync("npx prisma db push --skip-generate", {
      stdio: "inherit",
      env: process.env,
    });
    console.log("✅ Schema do banco verificado com sucesso.");
  } catch (err) {
    console.warn("⚠️ Aviso ao sincronizar schema do banco:", err);
  }
}

async function ensureDefaultData() {
  try {
    // 1. Garante que exista a Loja Matriz Padrão
    let store = await prisma.store.findFirst({
      where: { ativo: true },
      orderBy: { criado_em: "asc" },
    });

    if (!store) {
      console.log("🌱 Inicializando loja padrão Polpê's...");
      store = await prisma.store.create({
        data: {
          core_store_id: "polpes_matriz",
          nome: "Polpê's Açaí e Sorvetes",
          api_key_hash: hashApiKey("epk_live_polpes_default_secret_key_123"),
          settings: {
            valor_padrao_corrida: 8.0,
            tempo_aceite_segundos: 60,
            exigir_codigo_confirmacao: true,
            exigir_foto: false,
          },
        },
      });
      console.log(`✅ Loja padrão criada: ${store.nome} (${store.id})`);
    }

    // 2. Garante que exista a Filial Matriz
    let branch = await prisma.branch.findFirst({
      where: { store_id: store.id },
    });

    if (!branch) {
      branch = await prisma.branch.create({
        data: {
          store_id: store.id,
          core_branch_id: "matriz",
          nome: "Matriz Copacabana",
          is_default: true,
          endereco_retirada: {
            logradouro: "Av. Atlântica",
            numero: "1200",
            bairro: "Copacabana",
            cidade: "Rio de Janeiro",
          },
        },
      });
      console.log(`✅ Filial padrão criada: ${branch.nome}`);
    }

    // 3. Garante o entregador inicial com o telefone 21 996984261
    const courierPhone = "5521996984261";
    let courier = await prisma.courier.findUnique({
      where: { telefone: courierPhone },
    });

    if (!courier) {
      console.log(`🌱 Cadastrando entregador inicial (${courierPhone})...`);
      courier = await prisma.courier.create({
        data: {
          nome: "Entregador Polpês",
          telefone: courierPhone,
          veiculo: "moto",
          ativo: true,
          status: "offline",
          consentimento_lgpd_em: new Date(),
          consentimento_versao: "1.0",
        },
      });

      await prisma.courierStoreLink.create({
        data: {
          courier_id: courier.id,
          store_id: store.id,
          tipo: "proprio",
          ativo: true,
          todas_unidades: true,
        },
      });
      console.log(`✅ Entregador inicial cadastrado e vinculado: ${courier.nome} (${courier.telefone})`);
    }
  } catch (err) {
    console.warn("⚠️ Aviso ao verificar dados iniciais:", err);
  }
}

async function main() {
  await ensureDatabaseReady();

  const app = buildApp();

  try {
    await prisma.$connect();
    app.log.info("Conectado ao banco de dados PostgreSQL via Prisma.");

    await ensureDefaultData();

    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 entregador-polpes backend rodando em http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
