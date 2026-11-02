import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { authStore } from "../middlewares/authStore.js";
import { generateConfirmationCode } from "../utils/crypto.js";
import { assertValidTransition } from "../services/deliveryStateMachine.js";
import { dispatchStoreWebhook } from "../services/webhookService.js";
import { resolveSettings } from "../services/settingsService.js";

const createDeliverySchema = z.object({
  core_order_id: z.string().min(1, "core_order_id é obrigatório"),
  branch_id: z.string().uuid().optional().nullable(),
  core_branch_id: z.string().optional().nullable(),
  endereco_retirada: z
    .object({
      logradouro: z.string().min(1),
      numero: z.string().optional().default(""),
      bairro: z.string().optional().default(""),
      cidade: z.string().optional().default(""),
      complemento: z.string().optional().default(""),
      lat: z.number().optional().nullable(),
      lng: z.number().optional().nullable(),
    })
    .optional(),
  endereco_entrega: z.object({
    logradouro: z.string().min(1),
    numero: z.string().optional().default(""),
    bairro: z.string().optional().default(""),
    cidade: z.string().optional().default(""),
    complemento: z.string().optional().default(""),
    referencia: z.string().optional().default(""),
    cep: z.string().optional().default(""),
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
  }),
  cliente_nome: z.string().min(1, "cliente_nome é obrigatório"),
  cliente_telefone: z.string().min(8, "cliente_telefone é obrigatório"),
  valor_corrida: z.number().nonnegative().optional(),
  courier_id: z.string().uuid().optional().nullable(),
});

const assignCourierSchema = z.object({
  courier_id: z.string().uuid("courier_id inválido"),
});

const cancelDeliverySchema = z.object({
  motivo: z.string().optional(),
});

export async function deliveryStoreRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authStore);

  // ── Criar Entrega a partir de um Pedido do Core (Idempotente) ──────────
  app.post("/api/v1/deliveries", async (request, reply) => {
    const store = request.store!;
    const parsed = createDeliverySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Dados de entrega inválidos",
        issues: parsed.error.format(),
      });
    }

    const {
      core_order_id,
      branch_id,
      core_branch_id,
      endereco_retirada,
      endereco_entrega,
      cliente_nome,
      cliente_telefone,
      valor_corrida,
      courier_id,
    } = parsed.data;

    // 1. Resolve a Unidade (Filial/Matriz) de onde sai o pedido
    let targetBranch = null;
    if (branch_id) {
      targetBranch = await prisma.branch.findFirst({
        where: { id: branch_id, store_id: store.id, ativo: true },
      });
    } else if (core_branch_id) {
      targetBranch = await prisma.branch.findFirst({
        where: { core_branch_id, store_id: store.id, ativo: true },
      });
    } else {
      // Default: filial padrão (Matriz) ou primeira ativa
      targetBranch =
        (await prisma.branch.findFirst({
          where: { store_id: store.id, is_default: true, ativo: true },
        })) ||
        (await prisma.branch.findFirst({
          where: { store_id: store.id, ativo: true },
        }));
    }

    if (!targetBranch) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Nenhuma unidade (filial/matriz) ativa encontrada para esta loja.",
      });
    }

    // 2. Idempotência estrita: se a entrega já foi criada, devolve a existente
    const existing = await prisma.delivery.findUnique({
      where: {
        store_id_core_order_id: {
          store_id: store.id,
          core_order_id,
        },
      },
      include: {
        branch: { select: { id: true, nome: true, core_branch_id: true } },
        courier: { select: { id: true, nome: true, telefone: true, veiculo: true } },
      },
    });

    if (existing) {
      return reply.status(200).send({
        delivery: existing,
        tracking_url: `${env.TRACKING_BASE_URL}/${existing.tracking_token}`,
        idempotent: true,
      });
    }

    // 3. Validação do entregador, se atribuído na criação
    let initialStatus = "pendente";
    let atribuidoEm: Date | null = null;

    if (courier_id) {
      const link = await prisma.courierStoreLink.findFirst({
        where: {
          courier_id,
          store_id: store.id,
          ativo: true,
        },
      });

      if (!link) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Entregador inativo ou não vinculado a esta loja. Ative o vínculo antes de vincular pedidos.",
        });
      }

      // Validação de restrição por filial
      if (!link.todas_unidades) {
        const branchLink = await prisma.courierBranchLink.findFirst({
          where: { courier_id, branch_id: targetBranch.id, ativo: true },
        });
        if (!branchLink) {
          return reply.status(400).send({
            statusCode: 400,
            error: "Bad Request",
            message: "Este entregador está restrito a outras unidades e não pode receber pedidos desta filial.",
          });
        }
      }

      initialStatus = "atribuido";
      atribuidoEm = new Date();
    }

    // 4. Herança de configurações: Unidade > Loja > Padrão
    const effectiveSettings = await resolveSettings(store.id, targetBranch.id);
    const finalValor = valor_corrida ?? Number(effectiveSettings.valor_padrao_corrida || 7.0);

    // Endereço de retirada herdado da unidade caso não seja enviado no pedido
    const finalEnderecoRetirada = endereco_retirada || targetBranch.endereco_retirada || {
      logradouro: targetBranch.nome,
    };

    const codigoConfirmacao = generateConfirmationCode();
    const trackingToken = crypto.randomUUID();

    const delivery = await prisma.delivery.create({
      data: {
        store_id: store.id,
        branch_id: targetBranch.id,
        core_order_id,
        courier_id: courier_id ?? null,
        status: initialStatus,
        endereco_retirada: finalEnderecoRetirada,
        endereco_entrega,
        entrega_lat: endereco_entrega.lat ?? null,
        entrega_lng: endereco_entrega.lng ?? null,
        cliente_nome,
        cliente_telefone,
        valor_corrida: finalValor,
        codigo_confirmacao: codigoConfirmacao,
        tracking_token: trackingToken,
        atribuido_em: atribuidoEm,
      },
      include: {
        branch: { select: { id: true, nome: true, core_branch_id: true } },
        courier: { select: { id: true, nome: true, telefone: true, veiculo: true } },
      },
    });

    // Registra evento de auditoria
    await prisma.deliveryEvent.create({
      data: {
        delivery_id: delivery.id,
        store_id: store.id,
        status: initialStatus,
        autor_tipo: "loja",
        autor_id: store.id,
        payload: { core_order_id, branch_id: targetBranch.id, courier_id },
      },
    });

    const trackingUrl = `${env.TRACKING_BASE_URL}/${delivery.tracking_token}`;

    dispatchStoreWebhook(store.id, initialStatus === "atribuido" ? "delivery.assigned" : "delivery.created", {
      delivery_id: delivery.id,
      core_order_id: delivery.core_order_id,
      branch_id: delivery.branch_id,
      status: delivery.status,
      tracking_url: trackingUrl,
      courier: delivery.courier,
    });

    return reply.status(201).send({
      delivery,
      tracking_url: trackingUrl,
      idempotent: false,
    });
  });

  // ── Listar Entregas da Loja (Filtro por Filial, Status e Paginação) ───
  app.get("/api/v1/deliveries", async (request, reply) => {
    const store = request.store!;
    const query = request.query as {
      status?: string;
      branch_id?: string;
      courier_id?: string;
      limit?: string;
      offset?: string;
    };

    const where: any = { store_id: store.id };
    if (query.status) where.status = query.status;
    if (query.branch_id) where.branch_id = query.branch_id;
    if (query.courier_id) where.courier_id = query.courier_id;

    const limit = Math.min(Math.max(parseInt(query.limit || "50", 10), 1), 100);
    const offset = Math.max(parseInt(query.offset || "0", 10), 0);

    const [deliveries, total] = await Promise.all([
      prisma.delivery.findMany({
        where,
        include: {
          branch: { select: { id: true, nome: true, core_branch_id: true } },
          courier: { select: { id: true, nome: true, telefone: true, veiculo: true } },
        },
        orderBy: { criado_em: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.delivery.count({ where }),
    ]);

    return reply.send({
      deliveries: deliveries.map((d) => ({
        ...d,
        tracking_url: `${env.TRACKING_BASE_URL}/${d.tracking_token}`,
      })),
      total,
      limit,
      offset,
    });
  });

  // ── Obter Detalhes da Entrega com Eventos de Auditoria ────────────────
  app.get("/api/v1/deliveries/:id", async (request, reply) => {
    const store = request.store!;
    const { id } = request.params as { id: string };

    const delivery = await prisma.delivery.findFirst({
      where: { id, store_id: store.id },
      include: {
        branch: true,
        courier: { select: { id: true, nome: true, telefone: true, veiculo: true, placa: true } },
        events: { orderBy: { criado_em: "asc" } },
      },
    });

    if (!delivery) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entrega não encontrada nesta loja.",
      });
    }

    return reply.send({
      delivery,
      tracking_url: `${env.TRACKING_BASE_URL}/${delivery.tracking_token}`,
    });
  });

  // ── Atribuir Entregador Manualmente à Corrida (Com Validação de Filial) 
  app.post("/api/v1/deliveries/:id/assign", async (request, reply) => {
    const store = request.store!;
    const { id } = request.params as { id: string };

    const parsed = assignCourierSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "courier_id inválido",
      });
    }

    const { courier_id } = parsed.data;

    const delivery = await prisma.delivery.findFirst({
      where: { id, store_id: store.id },
    });

    if (!delivery) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entrega não encontrada.",
      });
    }

    try {
      assertValidTransition(delivery.status, "atribuido");
    } catch (err: any) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: err.message,
      });
    }

    // 1. Valida se o entregador tem vínculo ATIVO com esta loja (toggle)
    const link = await prisma.courierStoreLink.findFirst({
      where: {
        courier_id,
        store_id: store.id,
        ativo: true,
      },
      include: { courier: true },
    });

    if (!link) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Entregador inativo ou não vinculado a esta loja. Ative o vínculo antes de atribuir pedidos.",
      });
    }

    // 2. Valida restrição por unidade (se não atender a todas as unidades)
    if (!link.todas_unidades) {
      const branchLink = await prisma.courierBranchLink.findFirst({
        where: {
          courier_id,
          branch_id: delivery.branch_id,
          ativo: true,
        },
      });

      if (!branchLink) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Este entregador está restrito a outras unidades e não pode receber pedidos desta filial.",
        });
      }
    }

    const now = new Date();
    const updated = await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        courier_id,
        status: "atribuido",
        atribuido_em: now,
      },
      include: {
        branch: { select: { id: true, nome: true, core_branch_id: true } },
        courier: { select: { id: true, nome: true, telefone: true, veiculo: true } },
      },
    });

    await prisma.deliveryEvent.create({
      data: {
        delivery_id: delivery.id,
        store_id: store.id,
        status: "atribuido",
        autor_tipo: "loja",
        autor_id: store.id,
        payload: { courier_id, courier_nome: link.courier.nome, branch_id: delivery.branch_id },
      },
    });

    const trackingUrl = `${env.TRACKING_BASE_URL}/${updated.tracking_token}`;

    dispatchStoreWebhook(store.id, "delivery.assigned", {
      delivery_id: updated.id,
      core_order_id: updated.core_order_id,
      branch_id: updated.branch_id,
      status: updated.status,
      tracking_url: trackingUrl,
      courier: updated.courier,
    });

    return reply.send({
      delivery: updated,
      tracking_url: trackingUrl,
    });
  });

  // ── Cancelar Entrega pela Loja ────────────────────────────────────────
  app.post("/api/v1/deliveries/:id/cancel", async (request, reply) => {
    const store = request.store!;
    const { id } = request.params as { id: string };
    const { motivo } = (request.body as { motivo?: string }) || {};

    const delivery = await prisma.delivery.findFirst({
      where: { id, store_id: store.id },
    });

    if (!delivery) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entrega não encontrada.",
      });
    }

    try {
      assertValidTransition(delivery.status, "cancelado");
    } catch (err: any) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: err.message,
      });
    }

    const now = new Date();

    const [updated] = await prisma.$transaction([
      prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "cancelado",
          cancelado_em: now,
        },
        include: {
          courier: { select: { id: true, nome: true, telefone: true } },
        },
      }),
      prisma.deliveryEvent.create({
        data: {
          delivery_id: delivery.id,
          store_id: store.id,
          status: "cancelado",
          autor_tipo: "loja",
          autor_id: store.id,
          payload: { motivo: motivo || "Cancelado pela loja" },
        },
      }),
    ]);

    // Se o entregador estava em corrida, libera seu status para online
    if (delivery.courier_id) {
      await prisma.courier.update({
        where: { id: delivery.courier_id },
        data: { status: "online" },
      });
    }

    dispatchStoreWebhook(store.id, "delivery.status_changed", {
      delivery_id: updated.id,
      core_order_id: updated.core_order_id,
      status: "cancelado",
      motivo,
    });

    return reply.send({
      delivery: updated,
      message: "Entrega cancelada com sucesso.",
    });
  });
}

