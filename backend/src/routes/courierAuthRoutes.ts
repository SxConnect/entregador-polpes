import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { authCourier } from "../middlewares/authCourier.js";

const courierLoginSchema = z.object({
  telefone: z.string().min(10, "Telefone inválido"),
});

const toggleStatusSchema = z.object({
  status: z.enum(["online", "offline"]),
});

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

export async function courierAuthRoutes(app: FastifyInstance) {
  // ── Login Direto do Entregador por Telefone (PWA) ────────────────────
  app.post("/api/v1/courier/auth/login", async (request, reply) => {
    const parsed = courierLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Número de telefone inválido.",
      });
    }

    const cleanPhone = normalizePhone(parsed.data.telefone);

    const courier = await prisma.courier.findUnique({
      where: { telefone: cleanPhone },
    });

    if (!courier || !courier.ativo) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: "Entregador não cadastrado ou inativo. Solicite um link de convite à loja.",
      });
    }

    if (!courier.consentimento_lgpd_em) {
      return reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: "É necessário acessar pelo link de convite para aceitar os termos de uso antes do primeiro login.",
        needs_invite: true,
      });
    }

    // Emite token JWT
    const token = app.jwt.sign(
      {
        courier_id: courier.id,
        telefone: courier.telefone,
      },
      {
        expiresIn: env.COURIER_SESSION_EXPIRES_IN,
      }
    );

    return reply.send({
      success: true,
      token,
      courier: {
        id: courier.id,
        nome: courier.nome,
        telefone: courier.telefone,
        veiculo: courier.veiculo,
        placa: courier.placa,
        status: courier.status,
      },
    });
  });

  // ── Obter Dados do Perfil do Entregador Autenticado ──────────────────
  app.get("/api/v1/courier/me", { preHandler: [authCourier] }, async (request, reply) => {
    const courier = request.courier!;

    // Busca lojas ativas vinculadas a este entregador
    const links = await prisma.courierStoreLink.findMany({
      where: { courier_id: courier.id, ativo: true },
      include: {
        store: { select: { id: true, nome: true } },
      },
    });

    return reply.send({
      courier: {
        id: courier.id,
        nome: courier.nome,
        telefone: courier.telefone,
        veiculo: courier.veiculo,
        placa: courier.placa,
        status: courier.status,
        consentimento_lgpd_em: courier.consentimento_lgpd_em,
      },
      stores: links.map((l) => ({
        id: l.store.id,
        nome: l.store.nome,
        tipo: l.tipo,
      })),
    });
  });

  // ── Alternar Status Online / Offline no PWA ──────────────────────────
  app.post("/api/v1/courier/status", { preHandler: [authCourier] }, async (request, reply) => {
    const courier = request.courier!;
    const parsed = toggleStatusSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Status inválido (use 'online' ou 'offline').",
      });
    }

    const { status } = parsed.data;

    // Se estiver em corrida, não permite ficar offline até concluir
    if (courier.status === "em_corrida" && status === "offline") {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Não é possível ficar offline com uma entrega em andamento. Conclua a corrida primeiro.",
      });
    }

    const updated = await prisma.courier.update({
      where: { id: courier.id },
      data: { status },
    });

    return reply.send({
      courier_id: updated.id,
      status: updated.status,
    });
  });
}
