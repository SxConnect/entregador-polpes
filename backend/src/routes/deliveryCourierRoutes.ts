import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authCourier } from "../middlewares/authCourier.js";
import { assertValidTransition } from "../services/deliveryStateMachine.js";
import { dispatchStoreWebhook } from "../services/webhookService.js";

const completeDeliverySchema = z.object({
  codigo_confirmacao: z.string().optional(),
  foto_comprovante_url: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
});

const locationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  precisao: z.number().optional().nullable(),
});

export async function deliveryCourierRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authCourier);

  // ── Obter Corrida Ativa do Entregador ────────────────────────────────
  app.get("/api/v1/courier/deliveries/active", async (request, reply) => {
    const courier = request.courier!;

    const activeDelivery = await prisma.delivery.findFirst({
      where: {
        courier_id: courier.id,
        status: { in: ["atribuido", "aceito", "coletado", "em_rota"] },
      },
      include: {
        store: { select: { id: true, nome: true, settings: true } },
      },
    });

    if (!activeDelivery) {
      return reply.send({ delivery: null });
    }

    const settings = (activeDelivery.store.settings as Record<string, any>) || {};

    return reply.send({
      delivery: {
        ...activeDelivery,
        exigir_codigo_confirmacao: settings.exigir_codigo_confirmacao !== false,
        exigir_foto: Boolean(settings.exigir_foto),
      },
    });
  });

  // ── Histórico de Corridas do Entregador ──────────────────────────────
  app.get("/api/v1/courier/deliveries/history", async (request, reply) => {
    const courier = request.courier!;

    const deliveries = await prisma.delivery.findMany({
      where: {
        courier_id: courier.id,
        status: { in: ["entregue", "cancelado"] },
      },
      include: {
        store: { select: { id: true, nome: true } },
      },
      orderBy: { atualizado_em: "desc" },
      take: 50,
    });

    return reply.send({ deliveries });
  });

  // ── Entregador: Aceitar Corrida ───────────────────────────────────────
  app.post("/api/v1/courier/deliveries/:id/accept", async (request, reply) => {
    const courier = request.courier!;
    const { id } = request.params as { id: string };

    const delivery = await prisma.delivery.findFirst({
      where: { id, courier_id: courier.id },
    });

    if (!delivery) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Corrida não encontrada para este entregador.",
      });
    }

    try {
      assertValidTransition(delivery.status, "aceito");
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
          status: "aceito",
          aceito_em: now,
        },
      }),
      prisma.courier.update({
        where: { id: courier.id },
        data: { status: "em_corrida" },
      }),
      prisma.deliveryEvent.create({
        data: {
          delivery_id: delivery.id,
          store_id: delivery.store_id,
          status: "aceito",
          autor_tipo: "entregador",
          autor_id: courier.id,
        },
      }),
    ]);

    dispatchStoreWebhook(delivery.store_id, "delivery.status_changed", {
      delivery_id: updated.id,
      core_order_id: updated.core_order_id,
      status: "aceito",
      courier: { id: courier.id, nome: courier.nome, telefone: courier.telefone },
    });

    return reply.send({ delivery: updated });
  });

  // ── Entregador: Recusar Corrida ───────────────────────────────────────
  app.post("/api/v1/courier/deliveries/:id/reject", async (request, reply) => {
    const courier = request.courier!;
    const { id } = request.params as { id: string };

    const delivery = await prisma.delivery.findFirst({
      where: { id, courier_id: courier.id, status: "atribuido" },
    });

    if (!delivery) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Corrida atribuída não encontrada para recusar.",
      });
    }

    // Volta o status para pendente e desassocia o courier para a loja poder reatribuir
    const [updated] = await prisma.$transaction([
      prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "pendente",
          courier_id: null,
          atribuido_em: null,
        },
      }),
      prisma.courier.update({
        where: { id: courier.id },
        data: { status: "online" },
      }),
      prisma.deliveryEvent.create({
        data: {
          delivery_id: delivery.id,
          store_id: delivery.store_id,
          status: "recusado",
          autor_tipo: "entregador",
          autor_id: courier.id,
        },
      }),
    ]);

    dispatchStoreWebhook(delivery.store_id, "delivery.status_changed", {
      delivery_id: updated.id,
      core_order_id: updated.core_order_id,
      status: "recusado",
      previous_courier_id: courier.id,
    });

    return reply.send({ message: "Corrida recusada com sucesso." });
  });

  // ── Entregador: Confirmar Coleta na Loja (Coletou) ─────────────────────
  app.post("/api/v1/courier/deliveries/:id/pickup", async (request, reply) => {
    const courier = request.courier!;
    const { id } = request.params as { id: string };

    const delivery = await prisma.delivery.findFirst({
      where: { id, courier_id: courier.id },
    });

    if (!delivery) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Corrida não encontrada.",
      });
    }

    try {
      assertValidTransition(delivery.status, "coletado");
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
          status: "coletado",
          coletado_em: now,
        },
      }),
      prisma.deliveryEvent.create({
        data: {
          delivery_id: delivery.id,
          store_id: delivery.store_id,
          status: "coletado",
          autor_tipo: "entregador",
          autor_id: courier.id,
        },
      }),
    ]);

    dispatchStoreWebhook(delivery.store_id, "delivery.status_changed", {
      delivery_id: updated.id,
      core_order_id: updated.core_order_id,
      status: "coletado",
      courier: { id: courier.id, nome: courier.nome },
    });

    return reply.send({ delivery: updated });
  });

  // ── Entregador: Iniciar Rota de Entrega (A Caminho) ───────────────────
  app.post("/api/v1/courier/deliveries/:id/start-route", async (request, reply) => {
    const courier = request.courier!;
    const { id } = request.params as { id: string };

    const delivery = await prisma.delivery.findFirst({
      where: { id, courier_id: courier.id },
    });

    if (!delivery) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Corrida não encontrada.",
      });
    }

    try {
      assertValidTransition(delivery.status, "em_rota");
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
          status: "em_rota",
          em_rota_em: now,
        },
      }),
      prisma.deliveryEvent.create({
        data: {
          delivery_id: delivery.id,
          store_id: delivery.store_id,
          status: "em_rota",
          autor_tipo: "entregador",
          autor_id: courier.id,
        },
      }),
    ]);

    dispatchStoreWebhook(delivery.store_id, "delivery.status_changed", {
      delivery_id: updated.id,
      core_order_id: updated.core_order_id,
      status: "em_rota",
      courier: { id: courier.id, nome: courier.nome },
    });

    return reply.send({ delivery: updated });
  });

  // ── Entregador: Concluir Entrega (Código de 4 Dígitos & Foto) ─────────
  app.post("/api/v1/courier/deliveries/:id/complete", async (request, reply) => {
    const courier = request.courier!;
    const { id } = request.params as { id: string };

    const parsed = completeDeliverySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Dados de finalização inválidos",
      });
    }

    const { codigo_confirmacao, foto_comprovante_url, lat, lng } = parsed.data;

    const delivery = await prisma.delivery.findFirst({
      where: { id, courier_id: courier.id },
      include: { store: true },
    });

    if (!delivery) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Corrida não encontrada.",
      });
    }

    try {
      assertValidTransition(delivery.status, "entregue");
    } catch (err: any) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: err.message,
      });
    }

    const storeSettings = (delivery.store.settings as Record<string, any>) || {};

    // 1. Validação do código de 4 dígitos (conforme configuração da loja)
    const exigirCodigo = storeSettings.exigir_codigo_confirmacao !== false;
    if (exigirCodigo) {
      const codeClean = (codigo_confirmacao || "").trim();
      if (!codeClean || codeClean !== delivery.codigo_confirmacao) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Código de confirmação de 4 dígitos incorreto.",
          invalid_code: true,
        });
      }
    }

    // 2. Validação de foto (se exigida pela loja)
    const exigirFoto = Boolean(storeSettings.exigir_foto);
    if (exigirFoto && !foto_comprovante_url) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "A foto do comprovante de entrega é obrigatória por esta loja.",
        photo_required: true,
      });
    }

    const now = new Date();

    const [updated] = await prisma.$transaction([
      prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "entregue",
          entregue_em: now,
          foto_comprovante_url: foto_comprovante_url ?? null,
        },
      }),
      prisma.courier.update({
        where: { id: courier.id },
        data: { status: "online" },
      }),
      prisma.deliveryEvent.create({
        data: {
          delivery_id: delivery.id,
          store_id: delivery.store_id,
          status: "entregue",
          autor_tipo: "entregador",
          autor_id: courier.id,
          lat: lat ?? null,
          lng: lng ?? null,
          payload: { foto_comprovante_url },
        },
      }),
    ]);

    dispatchStoreWebhook(delivery.store_id, "delivery.completed", {
      delivery_id: updated.id,
      core_order_id: updated.core_order_id,
      status: "entregue",
      entregue_em: now.toISOString(),
      foto_comprovante_url,
      courier: { id: courier.id, nome: courier.nome },
    });

    return reply.send({
      success: true,
      delivery: updated,
    });
  });

  // ── Entregador: Transmissão de Geolocalização (GPS em Corrida) ────────
  app.post("/api/v1/courier/location", async (request, reply) => {
    const courier = request.courier!;
    const parsed = locationSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Coordenadas lat e lng inválidas",
      });
    }

    const { lat, lng, precisao } = parsed.data;

    // Registra telemetria de localização
    await prisma.courierLocation.create({
      data: {
        courier_id: courier.id,
        lat,
        lng,
        precisao: precisao ?? null,
      },
    });

    // Se o entregador estiver em corrida em rota, envia notificação de localização
    const activeDelivery = await prisma.delivery.findFirst({
      where: {
        courier_id: courier.id,
        status: { in: ["coletado", "em_rota"] },
      },
      select: { id: true, store_id: true, core_order_id: true },
    });

    if (activeDelivery) {
      dispatchStoreWebhook(activeDelivery.store_id, "courier.location", {
        delivery_id: activeDelivery.id,
        core_order_id: activeDelivery.core_order_id,
        courier_id: courier.id,
        lat,
        lng,
        precisao,
        timestamp: new Date().toISOString(),
      });
    }

    return reply.send({ ok: true });
  });
}
