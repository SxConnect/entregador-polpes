import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authStore } from "../middlewares/authStore.js";
import { resolveSettings } from "../services/settingsService.js";

const enderecoRetiradaSchema = z.object({
  logradouro: z.string().min(1, "Logradouro é obrigatório"),
  numero: z.string().optional().default(""),
  bairro: z.string().optional().default(""),
  cidade: z.string().optional().default(""),
  complemento: z.string().optional().default(""),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
});

const createBranchSchema = z.object({
  core_branch_id: z.string().optional().nullable(),
  nome: z.string().min(1, "Nome da unidade é obrigatório"),
  endereco_retirada: enderecoRetiradaSchema.optional(),
  telefone: z.string().optional().nullable(),
  is_default: z.boolean().optional().default(false),
  settings: z.record(z.any()).optional().nullable(),
});

const updateBranchSchema = z.object({
  core_branch_id: z.string().optional().nullable(),
  nome: z.string().min(1).optional(),
  endereco_retirada: enderecoRetiradaSchema.optional(),
  telefone: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
  is_default: z.boolean().optional(),
  settings: z.record(z.any()).optional().nullable(),
});

export async function branchRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authStore);

  // ── Listar Unidades / Filiais da Loja ────────────────────────────────
  app.get("/api/v1/branches", async (request, reply) => {
    const store = request.store!;
    const { ativo } = request.query as { ativo?: string };

    const where: any = { store_id: store.id };
    if (ativo !== undefined) {
      where.ativo = ativo === "true";
    }

    const branches = await prisma.branch.findMany({
      where,
      include: {
        _count: {
          select: {
            deliveries: true,
            courier_links: true,
          },
        },
      },
      orderBy: [{ is_default: "desc" }, { criado_em: "asc" }],
    });

    return reply.send({
      branches: branches.map((b) => ({
        id: b.id,
        core_branch_id: b.core_branch_id,
        nome: b.nome,
        endereco_retirada: b.endereco_retirada,
        telefone: b.telefone,
        ativo: b.ativo,
        is_default: b.is_default,
        settings: b.settings || {},
        total_entregas: b._count.deliveries,
        total_entregadores_vinculados: b._count.courier_links,
      })),
      total: branches.length,
    });
  });

  // ── Criar Nova Unidade / Filial ──────────────────────────────────────
  app.post("/api/v1/branches", async (request, reply) => {
    const store = request.store!;
    const parsed = createBranchSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Dados da filial inválidos",
        issues: parsed.error.format(),
      });
    }

    const { core_branch_id, nome, endereco_retirada, telefone, is_default, settings } =
      parsed.data;

    // Se marcado como padrão, desmarca outras unidades
    if (is_default) {
      await prisma.branch.updateMany({
        where: { store_id: store.id },
        data: { is_default: false },
      });
    }

    const defaultAddress = endereco_retirada || {
      logradouro: "Endereço da Unidade",
      numero: "",
      bairro: "",
      cidade: "",
    };

    const branch = await prisma.branch.create({
      data: {
        store_id: store.id,
        core_branch_id: core_branch_id ?? null,
        nome,
        endereco_retirada: defaultAddress,
        telefone,
        is_default,
        ativo: true,
        settings: settings || {},
      },
    });

    return reply.status(201).send({ branch });
  });

  // ── Obter Detalhes da Unidade com Resolução de Configurações ─────────
  app.get("/api/v1/branches/:id", async (request, reply) => {
    const store = request.store!;
    const { id } = request.params as { id: string };

    const branch = await prisma.branch.findFirst({
      where: { id, store_id: store.id },
      include: {
        _count: {
          select: { deliveries: true },
        },
      },
    });

    if (!branch) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Unidade não encontrada.",
      });
    }

    const effectiveSettings = await resolveSettings(store.id, branch.id);

    return reply.send({
      branch,
      effective_settings: effectiveSettings,
    });
  });

  // ── Atualizar Unidade / Filial ────────────────────────────────────────
  app.put("/api/v1/branches/:id", async (request, reply) => {
    const store = request.store!;
    const { id } = request.params as { id: string };

    const parsed = updateBranchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Dados de atualização inválidos",
        issues: parsed.error.format(),
      });
    }

    const branch = await prisma.branch.findFirst({
      where: { id, store_id: store.id },
    });

    if (!branch) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Unidade não encontrada.",
      });
    }

    const { core_branch_id, nome, endereco_retirada, telefone, ativo, is_default, settings } =
      parsed.data;

    // Se marcar como padrão, desmarca as demais
    if (is_default) {
      await prisma.branch.updateMany({
        where: { store_id: store.id, id: { not: branch.id } },
        data: { is_default: false },
      });
    }

    const updated = await prisma.branch.update({
      where: { id: branch.id },
      data: {
        core_branch_id: core_branch_id !== undefined ? core_branch_id : branch.core_branch_id,
        nome: nome ?? branch.nome,
        endereco_retirada: (endereco_retirada ?? branch.endereco_retirada) as any,
        telefone: telefone !== undefined ? telefone : branch.telefone,
        ativo: ativo !== undefined ? ativo : branch.ativo,
        is_default: is_default !== undefined ? is_default : branch.is_default,
        settings: (settings !== undefined ? settings : branch.settings) as any,
      },
    });

    return reply.send({ branch: updated });
  });

  // ── Desativar Unidade / Filial ────────────────────────────────────────
  app.delete("/api/v1/branches/:id", async (request, reply) => {
    const store = request.store!;
    const { id } = request.params as { id: string };

    const branch = await prisma.branch.findFirst({
      where: { id, store_id: store.id },
    });

    if (!branch) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Unidade não encontrada.",
      });
    }

    if (branch.is_default) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Não é permitido excluir a unidade padrão da loja. Defina outra unidade como padrão primeiro.",
      });
    }

    // Inativa a unidade
    await prisma.branch.update({
      where: { id: branch.id },
      data: { ativo: false },
    });

    return reply.send({ success: true, message: "Unidade desativada com sucesso." });
  });
}
