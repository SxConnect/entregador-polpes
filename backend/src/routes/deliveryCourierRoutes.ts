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

function extractCoords(obj: any, fallbackLat?: number | null, fallbackLng?: number | null): { lat: number; lng: number } | null {
  if (fallbackLat && fallbackLng) return { lat: fallbackLat, lng: fallbackLng };
  if (!obj || typeof obj !== "object") return null;
  const lat = typeof obj.lat === "number" ? obj.lat : parseFloat(obj.lat);
  const lng = typeof obj.lng === "number" ? obj.lng : parseFloat(obj.lng);
  if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
    return { lat, lng };
  }
  return null;
}

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function buildGoogleMapsMultiStopUrl(originAddress: any, deliveries: any[]): string {
  if (deliveries.length === 0) return "";

  const formatAddr = (addr: any) => {
    if (!addr) return "";
    if (typeof addr.lat === "number" && typeof addr.lng === "number" && addr.lat !== 0) {
      return `${addr.lat},${addr.lng}`;
    }
    const parts = [addr.logradouro, addr.numero, addr.bairro, addr.cidade].filter(Boolean);
    return encodeURIComponent(parts.join(", "));
  };

  const originStr = formatAddr(originAddress);
  const lastDelivery = deliveries[deliveries.length - 1];
  const destStr = formatAddr(lastDelivery.endereco_entrega);

  if (deliveries.length === 1) {
    return `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destStr}&travelmode=two_wheeler`;
  }

  const waypointStrs = deliveries
    .slice(0, deliveries.length - 1)
    .map((d) => formatAddr(d.endereco_entrega))
    .filter(Boolean);

  return `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destStr}&waypoints=${waypointStrs.join("|")}&travelmode=two_wheeler`;
}

export async function deliveryCourierRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authCourier);

  // ── Obter Corridas Ativas do Entregador (Suporte a Múltiplas Entregas / Rota Multi-Paradas) ──
  app.get("/api/v1/courier/deliveries/active", async (request, reply) => {
    const courier = request.courier!;

    const activeDeliveries = await prisma.delivery.findMany({
      where: {
        courier_id: courier.id,
        status: { in: ["atribuido", "aceito", "coletado", "em_rota"] },
      },
      include: {
        store: { select: { id: true, nome: true, settings: true } },
        branch: { select: { id: true, nome: true, endereco_retirada: true } },
      },
      orderBy: { criado_em: "asc" },
    });

    if (activeDeliveries.length === 0) {
      return reply.send({ delivery: null, deliveries: [], total_entregas: 0 });
    }

    // Identifica a origem (endereço de retirada da filial/loja)
    const baseOrigin = activeDeliveries[0].endereco_retirada as any;
    const originCoords = extractCoords(baseOrigin) || { lat: -22.9711, lng: -43.1822 }; // Fallback RJ

    // Calcula a distância da loja para cada entrega
    const deliveriesWithDistance = activeDeliveries.map((d) => {
      const settings = (d.store.settings as Record<string, any>) || {};
      const destCoords = extractCoords(d.endereco_entrega as any, d.entrega_lat, d.entrega_lng);
      const dist = destCoords
        ? calculateDistanceKm(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng)
        : null;

      return {
        ...d,
        distancia_loja_km: dist !== null ? Math.round(dist * 10) / 10 : null,
        exigir_codigo_confirmacao: settings.exigir_codigo_confirmacao !== false,
        exigir_foto: Boolean(settings.exigir_foto),
      };
    });

    // Ordena as entregas da mais próxima até a mais distante da loja
    const sortedDeliveries = [...deliveriesWithDistance].sort((a, b) => {
      if (a.distancia_loja_km !== null && b.distancia_loja_km !== null) {
        return a.distancia_loja_km - b.distancia_loja_km;
      }
      return 0;
    });

    // Marca a ordem de parada (1, 2, 3...) e indica a mais distante
    const maxIndex = sortedDeliveries.length - 1;
    const stops = sortedDeliveries.map((d, index) => ({
      ...d,
      ordem_parada: index + 1,
      is_mais_distante: index === maxIndex && sortedDeliveries.length > 1,
    }));

    const rotaGoogleMapsUrl = buildGoogleMapsMultiStopUrl(baseOrigin, stops);
    const valorTotalLote = stops.reduce((acc, d) => acc + (Number(d.valor_corrida) || 0), 0);

    return reply.send({
      delivery: stops[0] || null, // Retrocompatibilidade para quem usa .delivery
      deliveries: stops,          // Lista completa de todas as entregas do lote
      total_entregas: stops.length,
      valor_total_lote: valorTotalLote,
      mais_distante: stops[maxIndex] || null,
      rota_google_maps_url: rotaGoogleMapsUrl,
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

    // Verifica se ainda existem outras entregas em andamento neste lote
    const remainingCount = await prisma.delivery.count({
      where: {
        courier_id: courier.id,
        id: { not: delivery.id },
        status: { in: ["atribuido", "aceito", "coletado", "em_rota"] },
      },
    });

    const nextCourierStatus = remainingCount > 0 ? "em_corrida" : "online";

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
        data: { status: nextCourierStatus },
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

  // ── Entregador: Aceitar Todas as Corridas Atribuídas (Lote) ───────────
  app.post("/api/v1/courier/deliveries/batch-accept", async (request, reply) => {
    const courier = request.courier!;
    const now = new Date();

    const pendingDeliveries = await prisma.delivery.findMany({
      where: {
        courier_id: courier.id,
        status: "atribuido",
      },
    });

    if (pendingDeliveries.length === 0) {
      return reply.send({ success: true, count: 0 });
    }

    await prisma.$transaction([
      prisma.delivery.updateMany({
        where: {
          courier_id: courier.id,
          status: "atribuido",
        },
        data: {
          status: "aceito",
          aceito_em: now,
        },
      }),
      prisma.courier.update({
        where: { id: courier.id },
        data: { status: "em_corrida" },
      }),
    ]);

    for (const d of pendingDeliveries) {
      prisma.deliveryEvent.create({
        data: {
          delivery_id: d.id,
          store_id: d.store_id,
          status: "aceito",
          autor_tipo: "entregador",
          autor_id: courier.id,
        },
      }).catch(() => {});

      dispatchStoreWebhook(d.store_id, "delivery.status_changed", {
        delivery_id: d.id,
        core_order_id: d.core_order_id,
        status: "aceito",
        courier: { id: courier.id, nome: courier.nome },
      });
    }

    return reply.send({ success: true, count: pendingDeliveries.length });
  });

  // ── Entregador: Coletar Todas as Corridas Aceitas na Loja (Lote) ──────
  app.post("/api/v1/courier/deliveries/batch-pickup", async (request, reply) => {
    const courier = request.courier!;
    const now = new Date();

    const acceptedDeliveries = await prisma.delivery.findMany({
      where: {
        courier_id: courier.id,
        status: "aceito",
      },
    });

    if (acceptedDeliveries.length === 0) {
      return reply.send({ success: true, count: 0 });
    }

    await prisma.delivery.updateMany({
      where: {
        courier_id: courier.id,
        status: "aceito",
      },
      data: {
        status: "coletado",
        coletado_em: now,
      },
    });

    for (const d of acceptedDeliveries) {
      prisma.deliveryEvent.create({
        data: {
          delivery_id: d.id,
          store_id: d.store_id,
          status: "coletado",
          autor_tipo: "entregador",
          autor_id: courier.id,
        },
      }).catch(() => {});

      dispatchStoreWebhook(d.store_id, "delivery.status_changed", {
        delivery_id: d.id,
        core_order_id: d.core_order_id,
        status: "coletado",
        courier: { id: courier.id, nome: courier.nome },
      });
    }

    return reply.send({ success: true, count: acceptedDeliveries.length });
  });

  // ── Entregador: Iniciar Rota do Lote de Entregas ───────────────────────
  app.post("/api/v1/courier/deliveries/batch-start-route", async (request, reply) => {
    const courier = request.courier!;
    const now = new Date();

    const collectedDeliveries = await prisma.delivery.findMany({
      where: {
        courier_id: courier.id,
        status: { in: ["aceito", "coletado"] },
      },
    });

    if (collectedDeliveries.length === 0) {
      return reply.send({ success: true, count: 0 });
    }

    await prisma.delivery.updateMany({
      where: {
        courier_id: courier.id,
        status: { in: ["aceito", "coletado"] },
      },
      data: {
        status: "em_rota",
        em_rota_em: now,
      },
    });

    for (const d of collectedDeliveries) {
      prisma.deliveryEvent.create({
        data: {
          delivery_id: d.id,
          store_id: d.store_id,
          status: "em_rota",
          autor_tipo: "entregador",
          autor_id: courier.id,
        },
      }).catch(() => {});

      dispatchStoreWebhook(d.store_id, "delivery.status_changed", {
        delivery_id: d.id,
        core_order_id: d.core_order_id,
        status: "em_rota",
        courier: { id: courier.id, nome: courier.nome },
      });
    }

    return reply.send({ success: true, count: collectedDeliveries.length });
  });
}
