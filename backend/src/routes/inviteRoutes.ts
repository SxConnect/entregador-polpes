import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";

const acceptInviteSchema = z.object({
  consentimento_lgpd: z.literal(true, {
    errorMap: () => ({ message: "O consentimento dos termos e LGPD é obrigatório para ativar a conta." }),
  }),
  consentimento_versao: z.string().default("1.0"),
});

export async function inviteRoutes(app: FastifyInstance) {
  // ── Validar Convite (Público / PWA) ──────────────────────────────────
  app.get("/api/v1/invites/:token", async (request, reply) => {
    const { token } = request.params as { token: string };

    const invite = await prisma.courierInvite.findUnique({
      where: { token },
      include: {
        courier: true,
        store: { select: { id: true, nome: true, core_store_id: true, settings: true } },
      },
    });

    if (!invite) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Convite não encontrado.",
      });
    }

    if (invite.usado_em) {
      return reply.status(410).send({
        statusCode: 410,
        error: "Gone",
        message: "Este convite já foi utilizado. Abra o aplicativo para acessar.",
        already_used: true,
      });
    }

    if (invite.expira_em < new Date()) {
      return reply.status(410).send({
        statusCode: 410,
        error: "Gone",
        message: "Este convite expirou. Solicite um novo link à loja.",
        expired: true,
      });
    }

    const { resolveStoreLogo } = await import("./storeRoutes.js");

    return reply.send({
      valid: true,
      courier: {
        id: invite.courier.id,
        nome: invite.courier.nome,
        telefone: invite.courier.telefone,
        veiculo: invite.courier.veiculo,
        placa: invite.courier.placa,
      },
      store: {
        id: invite.store.id,
        nome: invite.store.nome,
        logo_url: resolveStoreLogo(invite.store),
      },
      expira_em: invite.expira_em,
      requires_lgpd: !Boolean(invite.courier.consentimento_lgpd_em),
    });
  });

  // ── Aceitar Convite & Onboarding com LGPD (Gera JWT) ──────────────────
  app.post("/api/v1/invites/:token/accept", async (request, reply) => {
    const { token } = request.params as { token: string };

    const parsed = acceptInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Consentimento LGPD é obrigatório.",
        issues: parsed.error.format(),
      });
    }

    const { consentimento_versao } = parsed.data;

    const invite = await prisma.courierInvite.findUnique({
      where: { token },
      include: { courier: true, store: true },
    });

    if (!invite) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Convite não encontrado.",
      });
    }

    if (invite.usado_em) {
      return reply.status(410).send({
        statusCode: 410,
        error: "Gone",
        message: "Este convite já foi utilizado.",
      });
    }

    if (invite.expira_em < new Date()) {
      return reply.status(410).send({
        statusCode: 410,
        error: "Gone",
        message: "Este convite expirou.",
      });
    }

    const now = new Date();

    // Transação: marca convite usado, grava LGPD e ativa entregador
    const [updatedCourier] = await prisma.$transaction([
      prisma.courier.update({
        where: { id: invite.courier_id },
        data: {
          consentimento_lgpd_em: now,
          consentimento_versao,
          status: "online",
          ativo: true,
        },
      }),
      prisma.courierInvite.update({
        where: { id: invite.id },
        data: { usado_em: now },
      }),
      prisma.courierStoreLink.updateMany({
        where: {
          courier_id: invite.courier_id,
          store_id: invite.store_id,
        },
        data: { ativo: true },
      }),
    ]);

    // Emite token JWT de longa duração para o PWA do entregador
    const jwtToken = app.jwt.sign(
      {
        courier_id: updatedCourier.id,
        telefone: updatedCourier.telefone,
      },
      {
        expiresIn: env.COURIER_SESSION_EXPIRES_IN,
      }
    );

    return reply.send({
      success: true,
      token: jwtToken,
      courier: {
        id: updatedCourier.id,
        nome: updatedCourier.nome,
        telefone: updatedCourier.telefone,
        veiculo: updatedCourier.veiculo,
        status: updatedCourier.status,
        consentimento_lgpd_em: updatedCourier.consentimento_lgpd_em,
      },
      store: {
        id: invite.store.id,
        nome: invite.store.nome,
      },
    });
  });
}
