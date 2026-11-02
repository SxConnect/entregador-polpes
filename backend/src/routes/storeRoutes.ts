import { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { prisma } from "../config/prisma.js";
import { authStore } from "../middlewares/authStore.js";
import { generateApiKey, hashApiKey } from "../utils/crypto.js";

export function resolveStoreLogo(store?: { core_store_id?: string; nome?: string; settings?: any } | null): string {
  if (!store) return "/uploads/logos/logo-polpes.png";
  const settings = (store.settings as Record<string, any>) || {};
  if (settings.pwa_logo_url) {
    return settings.pwa_logo_url;
  }
  // Se for a Polpes, usa o logo específico da Polpes
  const coreId = (store.core_store_id || "").toLowerCase();
  const storeNome = (store.nome || "").toLowerCase();
  const isPolpes = coreId.includes("polpes") || storeNome.includes("polpe");
  if (isPolpes) {
    return "/uploads/logos/logo-polpes.png";
  }
  // Fallback genérico para qualquer outra loja (Logo Pluga)
  return "/uploads/logos/logo-default.png";
}

const provisionSchema = z.object({
  core_store_id: z.string().min(1, "core_store_id é obrigatório"),
  nome: z.string().min(1, "nome é obrigatório"),
  webhook_url: z.string().url("webhook_url deve ser uma URL válida").optional().nullable(),
  webhook_secret: z.string().optional().nullable(),
  settings: z.record(z.any()).optional().nullable(),
});

const updateSettingsSchema = z.object({
  nome: z.string().min(1).optional(),
  webhook_url: z.string().url("webhook_url deve ser uma URL válida").optional().nullable(),
  webhook_secret: z.string().optional().nullable(),
  settings: z.object({
    valor_padrao_corrida: z.number().nonnegative().optional(),
    tempo_aceite_segundos: z.number().int().positive().optional(),
    exigir_codigo_confirmacao: z.boolean().optional(),
    exigir_foto: z.boolean().optional(),
    msg_padrao_rastreio: z.string().optional(),
  }).partial().optional(),
});

export async function storeRoutes(app: FastifyInstance) {
  // ── Provisionamento de Loja (Chamado pelo Core ao ativar o módulo) ──────
  app.post("/api/v1/stores/provision", async (request, reply) => {
    const parsed = provisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Dados de provisionamento inválidos",
        issues: parsed.error.format(),
      });
    }

    const { core_store_id, nome, webhook_url, webhook_secret, settings } = parsed.data;
    const rawApiKey = generateApiKey();
    const apiKeyHash = hashApiKey(rawApiKey);

    const defaultSettings = {
      valor_padrao_corrida: 7.0,
      tempo_aceite_segundos: 60,
      exigir_codigo_confirmacao: true,
      exigir_foto: false,
      msg_padrao_rastreio: "Seu pedido está a caminho! Acompanhe o entregador pelo link:",
      ...(settings || {}),
    };

    // Upsert loja pelo core_store_id
    const existing = await prisma.store.findUnique({
      where: { core_store_id },
    });

    let store;
    let isCreated = false;

    if (existing) {
      store = await prisma.store.update({
        where: { id: existing.id },
        data: {
          nome,
          api_key_hash: apiKeyHash,
          webhook_url: webhook_url ?? existing.webhook_url,
          webhook_secret: webhook_secret ?? existing.webhook_secret,
          settings: { ...((existing.settings as object) || {}), ...defaultSettings },
          ativo: true,
        },
      });
    } else {
      store = await prisma.store.create({
        data: {
          core_store_id,
          nome,
          api_key_hash: apiKeyHash,
          webhook_url,
          webhook_secret,
          settings: defaultSettings,
          ativo: true,
        },
      });
      isCreated = true;
    }

    // Toda loja nova recebe automaticamente uma unidade padrão ("Matriz")
    const existingDefaultBranch = await prisma.branch.findFirst({
      where: { store_id: store.id, is_default: true },
    });

    if (!existingDefaultBranch) {
      await prisma.branch.create({
        data: {
          store_id: store.id,
          core_branch_id: "matriz",
          nome: "Matriz",
          is_default: true,
          ativo: true,
          endereco_retirada: {
            logradouro: "Endereço Principal",
            numero: "",
            bairro: "",
            cidade: "",
          },
        },
      });
    }

    return reply.status(isCreated ? 201 : 200).send({
      store_id: store.id,
      core_store_id: store.core_store_id,
      nome: store.nome,
      api_key: rawApiKey, // Exibido apenas nesta chamada!
      webhook_secret: store.webhook_secret,
      created: isCreated,
    });
  });

  // ── Obter Configurações da Loja ──────────────────────────────────────
  app.get("/api/v1/store/settings", { preHandler: [authStore] }, async (request, reply) => {
    const store = request.store!;

    return reply.send({
      store_id: store.id,
      core_store_id: store.core_store_id,
      nome: store.nome,
      webhook_url: store.webhook_url,
      webhook_configured: Boolean(store.webhook_secret),
      settings: store.settings || {},
      logo_url: resolveStoreLogo(store),
      criado_em: store.criado_em,
    });
  });

  // ── Upload de Logo Personalizado para o PWA da Loja ──────────────────
  app.post("/api/v1/store/logo", { preHandler: [authStore] }, async (request, reply) => {
    const store = request.store!;
    const file = await request.file();

    if (!file) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Nenhum arquivo enviado.",
      });
    }

    const allowedMimes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!allowedMimes.includes(file.mimetype)) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Formato inválido. Envie uma imagem PNG, JPG ou WebP.",
      });
    }

    const ext = path.extname(file.filename || ".png") || ".png";
    const fileName = `store_${store.id}_${Date.now()}${ext}`;
    const uploadDir = path.resolve(process.cwd(), "uploads/logos");
    fs.mkdirSync(uploadDir, { recursive: true });
    const targetPath = path.join(uploadDir, fileName);

    await pipeline(file.file, fs.createWriteStream(targetPath));

    const pwaLogoUrl = `/uploads/logos/${fileName}`;
    const currentSettings = (store.settings as Record<string, any>) || {};
    const updatedSettings = { ...currentSettings, pwa_logo_url: pwaLogoUrl };

    await prisma.store.update({
      where: { id: store.id },
      data: { settings: updatedSettings },
    });

    return reply.send({
      success: true,
      pwa_logo_url: pwaLogoUrl,
      message: "Logo do PWA atualizado com sucesso!",
    });
  });

  // ── Remover Logo Personalizado (Volta ao Padrão) ─────────────────────
  app.delete("/api/v1/store/logo", { preHandler: [authStore] }, async (request, reply) => {
    const store = request.store!;
    const currentSettings = (store.settings as Record<string, any>) || {};
    const { pwa_logo_url, ...restSettings } = currentSettings;

    const updated = await prisma.store.update({
      where: { id: store.id },
      data: { settings: restSettings },
    });

    return reply.send({
      success: true,
      logo_url: resolveStoreLogo(updated),
      message: "Logo personalizado removido. Restaurado o logo padrão.",
    });
  });

  // ── Marca Pública da Loja (Para PWA e Rastreio do Cliente) ───────────
  app.get("/api/v1/store/public-brand", async (request, reply) => {
    const query = request.query as { store_id?: string; core_store_id?: string };

    let store = null;
    if (query.store_id) {
      store = await prisma.store.findUnique({ where: { id: query.store_id } });
    } else if (query.core_store_id) {
      store = await prisma.store.findUnique({ where: { core_store_id: query.core_store_id } });
    } else {
      // Default: primeira loja ativa
      store = await prisma.store.findFirst({ where: { ativo: true } });
    }

    if (!store) {
      return reply.send({
        nome: "Polpê's Açaí",
        logo_url: "/logo-polpes.png",
      });
    }

    return reply.send({
      store_id: store.id,
      core_store_id: store.core_store_id,
      nome: store.nome,
      logo_url: resolveStoreLogo(store),
    });
  });

  // ── Atualizar Configurações da Loja ──────────────────────────────────
  app.put("/api/v1/store/settings", { preHandler: [authStore] }, async (request, reply) => {
    const store = request.store!;
    const parsed = updateSettingsSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Dados de configuração inválidos",
        issues: parsed.error.format(),
      });
    }

    const { nome, webhook_url, webhook_secret, settings } = parsed.data;

    const currentSettings = (store.settings as object) || {};
    const newSettings = settings ? { ...currentSettings, ...settings } : currentSettings;

    const updated = await prisma.store.update({
      where: { id: store.id },
      data: {
        nome: nome ?? store.nome,
        webhook_url: webhook_url !== undefined ? webhook_url : store.webhook_url,
        webhook_secret: webhook_secret !== undefined ? webhook_secret : store.webhook_secret,
        settings: newSettings,
      },
    });

    return reply.send({
      store_id: updated.id,
      core_store_id: updated.core_store_id,
      nome: updated.nome,
      webhook_url: updated.webhook_url,
      webhook_configured: Boolean(updated.webhook_secret),
      settings: updated.settings,
    });
  });
}
