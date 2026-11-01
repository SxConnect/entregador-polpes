import { FastifyInstance } from "fastify";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { resolveStoreLogo } from "./storeRoutes.js";

function maskCourierName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] || "Entregador";
  return `${parts[0]} ${parts[1][0]}.`;
}

function maskPlate(plate?: string | null): string | null {
  if (!plate || plate.length < 5) return null;
  const clean = plate.trim();
  return `${clean.slice(0, 3)}***${clean.slice(-1)}`;
}

export async function trackingRoutes(app: FastifyInstance) {
  // ── API Pública de Rastreio (Sem Autenticação, Proteção LGPD) ─────────
  app.get("/api/v1/tracking/:tracking_token", async (request, reply) => {
    const { tracking_token } = request.params as { tracking_token: string };

    const delivery = await prisma.delivery.findUnique({
      where: { tracking_token },
      include: {
        store: { select: { id: true, nome: true, core_store_id: true, settings: true } },
        courier: { select: { id: true, nome: true, veiculo: true, placa: true } },
      },
    });

    if (!delivery) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entrega não encontrada ou token inválido.",
      });
    }

    // Expiração do link após conclusão (+24 horas)
    if (delivery.status === "entregue" && delivery.entregue_em) {
      const horasDesdeEntrega = (Date.now() - delivery.entregue_em.getTime()) / (1000 * 60 * 60);
      if (horasDesdeEntrega > 24) {
        return reply.status(410).send({
          statusCode: 410,
          error: "Gone",
          expired: true,
          status: "entregue",
          message: "Este link de rastreamento expirou após a conclusão da entrega.",
        });
      }
    }

    // Busca última localização do entregador se a corrida estiver em andamento
    let courierLocation = null;
    if (["coletado", "em_rota"].includes(delivery.status) && delivery.courier_id) {
      const loc = await prisma.courierLocation.findFirst({
        where: { courier_id: delivery.courier_id },
        orderBy: { timestamp: "desc" },
      });

      if (loc) {
        courierLocation = {
          lat: loc.lat,
          lng: loc.lng,
          precisao: loc.precisao,
          timestamp: loc.timestamp,
        };
      }
    }

    const endereco = (delivery.endereco_entrega as Record<string, any>) || {};
    const storeSettings = (delivery.store.settings as Record<string, any>) || {};

    return reply.send({
      valid: true,
      status: delivery.status,
      core_order_id: delivery.core_order_id,
      store: {
        id: delivery.store.id,
        nome: delivery.store.nome,
        logo_url: resolveStoreLogo(delivery.store),
      },
      courier: delivery.courier
        ? {
            nome: maskCourierName(delivery.courier.nome),
            veiculo: delivery.courier.veiculo,
            placa: maskPlate(delivery.courier.placa),
          }
        : null,
      endereco_entrega: {
        logradouro: endereco.logradouro || "",
        numero: endereco.numero || "",
        bairro: endereco.bairro || "",
        cidade: endereco.cidade || "",
        lat: delivery.entrega_lat,
        lng: delivery.entrega_lng,
      },
      // Código de 4 dígitos é exibido em destaque para o cliente informar ao entregador
      codigo_confirmacao:
        delivery.status !== "entregue" && delivery.status !== "cancelado" && storeSettings.exigir_codigo_confirmacao !== false
          ? delivery.codigo_confirmacao
          : null,
      courier_location: courierLocation,
      timestamps: {
        criado_em: delivery.criado_em,
        atribuido_em: delivery.atribuido_em,
        aceito_em: delivery.aceito_em,
        coletado_em: delivery.coletado_em,
        em_rota_em: delivery.em_rota_em,
        entregue_em: delivery.entregue_em,
      },
    });
  });

  // ── Redirecionamento da URL Amigável /t/:tracking_token para o Frontend ─
  app.get("/t/:tracking_token", async (request, reply) => {
    const { tracking_token } = request.params as { tracking_token: string };
    return reply.redirect(`${env.PWA_BASE_URL}/t/${tracking_token}`);
  });
}
