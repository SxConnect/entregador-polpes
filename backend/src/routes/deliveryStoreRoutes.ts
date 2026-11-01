import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { authStore } from "../middlewares/authStore.js";
import { generateConfirmationCode } from "../utils/crypto.js";
import { assertValidTransition } from "../services/deliveryStateMachine.js";
import { dispatchStoreWebhook } from "../services/webhookService.js";

const createDeliverySchema = z.object({
  core_order_id: z.string().min(1, "core_order_id é obrigatório"),
  endereco_retirada: z.object({
    logradouro: z.string().min(1),
    numero: z.string().optional().default(""),
    bairro: z.string().optional().default(""),
    cidade: z.string().optional().default(""),
    complemento: z.string().optional().default(""),
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
  }),
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
      endereco_retirada,
      endereco_entrega,
      cliente_nome,
      cliente_telefone,
      valor_corrida,
      courier_id,
    } = parsed.data;

    // Idempotência estrita: se a entrega já foi criada para esse core_order_id, devolve a existente
    const existing = await prisma.delivery.findUnique({
      where: {
        store_id_core_order_id: {
          store_id: store.id,
          core_order_id,
        },
      },
      include: {
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

    // Se courier_id foi passado, valida se tem vínculo ATIVO com esta loja (toggle)
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

      initialStatus = "atribuido";
      atribuidoEm = new Date();
    }

    const storeSettings = (store.settings as Record<string, any>) || {};
    const finalValor = valor_corrida ?? Number(storeSettings.valor_padrao_corrida || 7.0);
    const codigoConfirmacao = generateConfirmationCode();
    const trackingToken = crypto.randomUUID();

    const delivery = await prisma.delivery.create({
      data: {
        store_id: store.id,
        core_order_id,
        courier_id: courier_id ?? null,
        status: initialStatus,
        endereco_retirada,
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
        payload: { core_order_id, courier_id },
      },
    });

    const trackingUrl = `${env.TRACKING_BASE_URL}/${delivery.tracking_token}`;

    // Dispara webhook para o Core
    dispatchStoreWebhook(store.id, initialStatus === "atribuido" ? "delivery.assigned" : "delivery.created", {
      delivery_id: delivery.id,
      core_order_id: delivery.core_order_id,
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

  // ── Listar Entregas da Loja (Filtros e Paginação) ──────────────────────
  app.get("/api/v1/deliveries", async (request, reply) => {
    const store = request.store!;
    const query = request.query as {
      status?: string;
      courier_id?: string;
      limit?: string;
      offset?: string;
    };

    const where: any = { store_id: store.id };
    if (query.status) where.status = query.status;
    if (query.courier_id) where.courier_id = query.courier_id;

    const limit = Math.min(Math.max(parseInt(query.limit || "50", 10), 1), 100);
    const offset = Math.max(parseInt(query.offset || "0", 10), 0);

    const [deliveries, total] = await Promise.all([
      prisma.delivery.findMany({
        where,
        include: {
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

  // ── Atribuir Entregador Manualmente à Corrida ─────────────────────────
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

    // Valida se o entregador tem vínculo ATIVO com esta loja (toggle)
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

    const now = new Date();
    const updated = await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        courier_id,
        status: "atribuido",
        atribuido_em: now,
      },
      include: {
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
        payload: { courier_id, courier_nome: link.courier.nome },
      },
    });

    const trackingUrl = `${env.TRACKING_BASE_URL}/${updated.tracking_token}`;

    dispatchStoreWebhook(store.id, "delivery.assigned", {
      delivery_id: updated.id,
      core_order_id: updated.core_order_id,
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
