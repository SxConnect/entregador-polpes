import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { authStore } from "../middlewares/authStore.js";
import { generateInviteToken } from "../utils/crypto.js";

const courierSchema = z.object({
  nome: z.string().min(2, "Nome é obrigatório (mínimo 2 caracteres)"),
  telefone: z.string().min(10, "Telefone deve conter DDD e número"),
  veiculo: z.enum(["moto", "bicicleta", "carro", "a_pe"]).default("moto"),
  placa: z.string().optional().nullable(),
});

const updateCourierSchema = z.object({
  nome: z.string().min(2).optional(),
  veiculo: z.enum(["moto", "bicicleta", "carro", "a_pe"]).optional(),
  placa: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
});

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

export async function courierRoutes(app: FastifyInstance) {
  // Todas as rotas abaixo são protegidas pela API key da loja (Multi-Tenant)
  app.addHook("preHandler", authStore);

  // ── Listar Entregadores da Loja ──────────────────────────────────────
  // ?disponiveis=true: filtra apenas vínculos ativos para atribuição de pedidos
  app.get("/api/v1/couriers", async (request, reply) => {
    const storeId = request.store!.id;
    const { disponiveis } = request.query as { disponiveis?: string };

    const links = await prisma.courierStoreLink.findMany({
      where: {
        store_id: storeId,
        ...(disponiveis === "true" ? { ativo: true } : {}),
      },
      include: {
        courier: {
          include: {
            invites: {
              where: {
                store_id: storeId,
                usado_em: null,
                expira_em: { gt: new Date() },
              },
              orderBy: { criado_em: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { criado_em: "desc" },
    });

    const couriers = links.map((link) => {
      const activeInvite = link.courier.invites[0];
      return {
        id: link.courier.id,
        nome: link.courier.nome,
        telefone: link.courier.telefone,
        veiculo: link.courier.veiculo,
        placa: link.courier.placa,
        status: link.courier.status,
        ativo: link.ativo,
        consentimento_lgpd_em: link.courier.consentimento_lgpd_em,
        link_tipo: link.tipo,
        vinculado_em: link.criado_em,
        invite: activeInvite
          ? {
              token: activeInvite.token,
              invite_url: `${env.PWA_BASE_URL}/convite/${activeInvite.token}`,
              expira_em: activeInvite.expira_em,
            }
          : null,
      };
    });

    return reply.send({ couriers });
  });

  // ── Cadastrar / Vincular Entregador Próprio ───────────────────────────
  app.post("/api/v1/couriers", async (request, reply) => {
    const storeId = request.store!.id;
    const parsed = courierSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Dados do entregador inválidos",
        issues: parsed.error.format(),
      });
    }

    const { nome, telefone, veiculo, placa } = parsed.data;
    const cleanPhone = normalizePhone(telefone);

    // 1. Upsert na entidade global do entregador (por telefone)
    const courier = await prisma.courier.upsert({
      where: { telefone: cleanPhone },
      update: {
        nome,
        veiculo,
        placa: placa ?? undefined,
        ativo: true,
      },
      create: {
        nome,
        telefone: cleanPhone,
        veiculo,
        placa,
        status: "offline",
        ativo: true,
      },
    });

    // 2. Vínculo com a loja autenticada (Multi-tenant)
    const link = await prisma.courierStoreLink.upsert({
      where: {
        courier_id_store_id: {
          courier_id: courier.id,
          store_id: storeId,
        },
      },
      update: {
        ativo: true,
        tipo: "proprio",
      },
      create: {
        courier_id: courier.id,
        store_id: storeId,
        tipo: "proprio",
        ativo: true,
      },
    });

    // 3. Gera convite para onboarding no PWA (expira em 7 dias)
    const inviteToken = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await prisma.courierInvite.create({
      data: {
        token: inviteToken,
        courier_id: courier.id,
        store_id: storeId,
        expira_em: expiresAt,
      },
    });

    const inviteUrl = `${env.PWA_BASE_URL}/convite/${inviteToken}`;

    return reply.status(201).send({
      courier: {
        id: courier.id,
        nome: courier.nome,
        telefone: courier.telefone,
        veiculo: courier.veiculo,
        placa: courier.placa,
        status: courier.status,
      },
      link: {
        id: link.id,
        tipo: link.tipo,
        ativo: link.ativo,
      },
      invite: {
        token: invite.token,
        invite_url: inviteUrl,
        expira_em: invite.expira_em,
      },
    });
  });

  // ── Obter Detalhes do Entregador ─────────────────────────────────────
  app.get("/api/v1/couriers/:id", async (request, reply) => {
    const storeId = request.store!.id;
    const { id } = request.params as { id: string };

    const link = await prisma.courierStoreLink.findFirst({
      where: {
        courier_id: id,
        store_id: storeId,
      },
      include: {
        courier: {
          include: {
            invites: {
              where: { store_id: storeId },
              orderBy: { criado_em: "desc" },
              take: 1,
            },
            deliveries: {
              where: { store_id: storeId },
              select: { id: true, status: true, valor_corrida: true, entregue_em: true },
            },
          },
        },
      },
    });

    if (!link) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entregador não encontrado nesta loja.",
      });
    }

    const courier = link.courier;
    const completedDeliveries = courier.deliveries.filter((d) => d.status === "entregue");
    const activeDeliveries = courier.deliveries.filter((d) =>
      ["aceito", "coletado", "em_rota"].includes(d.status)
    );

    const latestInvite = courier.invites[0];

    return reply.send({
      id: courier.id,
      nome: courier.nome,
      telefone: courier.telefone,
      veiculo: courier.veiculo,
      placa: courier.placa,
      status: courier.status,
      ativo: link.ativo,
      consentimento_lgpd_em: courier.consentimento_lgpd_em,
      consentimento_versao: courier.consentimento_versao,
      stats: {
        total_entregas: completedDeliveries.length,
        entregas_em_andamento: activeDeliveries.length,
      },
      invite: latestInvite && !latestInvite.usado_em && latestInvite.expira_em > new Date()
        ? {
            token: latestInvite.token,
            invite_url: `${env.PWA_BASE_URL}/convite/${latestInvite.token}`,
            expira_em: latestInvite.expira_em,
          }
        : null,
    });
  });

  // ── Atualizar Entregador na Loja ──────────────────────────────────────
  app.put("/api/v1/couriers/:id", async (request, reply) => {
    const storeId = request.store!.id;
    const { id } = request.params as { id: string };

    const parsed = updateCourierSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Dados de atualização inválidos",
        issues: parsed.error.format(),
      });
    }

    const link = await prisma.courierStoreLink.findFirst({
      where: { courier_id: id, store_id: storeId },
    });

    if (!link) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entregador não vinculado a esta loja.",
      });
    }

    const { nome, veiculo, placa, ativo } = parsed.data;

    // Atualiza vínculo
    if (ativo !== undefined) {
      await prisma.courierStoreLink.update({
        where: { id: link.id },
        data: { ativo },
      });
    }

    // Atualiza dados cadastrais
    const updatedCourier = await prisma.courier.update({
      where: { id },
      data: {
        nome: nome ?? undefined,
        veiculo: veiculo ?? undefined,
        placa: placa !== undefined ? placa : undefined,
      },
    });

    return reply.send({
      id: updatedCourier.id,
      nome: updatedCourier.nome,
      telefone: updatedCourier.telefone,
      veiculo: updatedCourier.veiculo,
      placa: updatedCourier.placa,
      status: updatedCourier.status,
      ativo: ativo !== undefined ? ativo : link.ativo,
    });
  });

  // ── Alternar Vínculo Ativo/Inativo (Toggle) ──────────────────────────
  app.patch("/api/v1/couriers/:id/toggle", async (request, reply) => {
    const storeId = request.store!.id;
    const { id } = request.params as { id: string };
    const body = (request.body as { ativo?: boolean }) || {};

    const link = await prisma.courierStoreLink.findFirst({
      where: { courier_id: id, store_id: storeId },
    });

    if (!link) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entregador não vinculado a esta loja.",
      });
    }

    const novoStatus = typeof body.ativo === "boolean" ? body.ativo : !link.ativo;

    const updatedLink = await prisma.courierStoreLink.update({
      where: { id: link.id },
      data: { ativo: novoStatus },
      include: { courier: true },
    });

    return reply.send({
      courier_id: id,
      nome: updatedLink.courier.nome,
      ativo: updatedLink.ativo,
      message: updatedLink.ativo
        ? "Vínculo ativado. O entregador agora pode receber pedidos."
        : "Vínculo desativado. O entregador não aparecerá para vincular pedidos.",
    });
  });

  // ── Desvincular Entregador da Loja ────────────────────────────────────
  app.delete("/api/v1/couriers/:id", async (request, reply) => {
    const storeId = request.store!.id;
    const { id } = request.params as { id: string };

    const link = await prisma.courierStoreLink.findFirst({
      where: { courier_id: id, store_id: storeId },
    });

    if (!link) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entregador não vinculado a esta loja.",
      });
    }

    // Desativa o link da loja sem apagar o cadastro global do entregador
    await prisma.courierStoreLink.update({
      where: { id: link.id },
      data: { ativo: false },
    });

    return reply.send({ success: true, message: "Entregador desvinculado com sucesso." });
  });

  // ── Reenviar / Gerar Novo Convite para Entregador ─────────────────────
  app.post("/api/v1/couriers/:id/invites", async (request, reply) => {
    const storeId = request.store!.id;
    const { id } = request.params as { id: string };

    const link = await prisma.courierStoreLink.findFirst({
      where: { courier_id: id, store_id: storeId, ativo: true },
      include: { courier: true },
    });

    if (!link) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entregador ativo não encontrado nesta loja.",
      });
    }

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await prisma.courierInvite.create({
      data: {
        token,
        courier_id: id,
        store_id: storeId,
        expira_em: expiresAt,
      },
    });

    const inviteUrl = `${env.PWA_BASE_URL}/convite/${token}`;

    return reply.status(201).send({
      courier_id: id,
      nome: link.courier.nome,
      telefone: link.courier.telefone,
      token: invite.token,
      invite_url: inviteUrl,
      expira_em: invite.expira_em,
    });
  });
}
