import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { authCourier } from "../middlewares/authCourier.js";
import { hashPassword, verifyPassword } from "../utils/crypto.js";

const courierLoginSchema = z.object({
  telefone: z.string().min(10, "Telefone inválido"),
  senha: z.string().min(1, "A senha é obrigatória"),
});

const registerPasswordSchema = z.object({
  telefone: z.string().min(10, "Telefone inválido"),
  senha: z.string().min(4, "A senha deve ter pelo menos 4 caracteres"),
  nome: z.string().min(2, "Nome deve ter pelo menos 2 caracteres").optional(),
  veiculo: z.enum(["moto", "bicicleta", "carro", "a_pe"]).default("moto").optional(),
  placa: z.string().optional().nullable(),
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
  // ── Login do Entregador com Telefone e Senha (PWA) ───────────────────
  app.post("/api/v1/courier/auth/login", async (request, reply) => {
    const parsed = courierLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Número de telefone e senha são obrigatórios.",
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
        message: "Entregador não cadastrado ou inativo. Use a opção 'Cadastrar Senha / Primeiro Acesso' ou solicite cadastro à loja.",
      });
    }

    // Se o entregador ainda não possui senha cadastrada
    if (!courier.senha_hash) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Needs Password Setup",
        needs_password_setup: true,
        message: "Você ainda não definiu uma senha de acesso. Use a opção 'Cadastrar Senha / Primeiro Acesso' para criar sua senha.",
      });
    }

    // Valida a senha informada
    const passwordValid = verifyPassword(parsed.data.senha, courier.senha_hash);
    if (!passwordValid) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Senha incorreta. Verifique e tente novamente.",
      });
    }

    // Se ainda não tiver aceitado LGPD, registra automaticamente no primeiro login com senha
    if (!courier.consentimento_lgpd_em) {
      await prisma.courier.update({
        where: { id: courier.id },
        data: {
          consentimento_lgpd_em: new Date(),
          consentimento_versao: "1.0",
        },
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

  // ── Cadastro / Definição de Senha do Entregador (Primeiro Acesso) ──────
  app.post("/api/v1/courier/auth/register-password", async (request, reply) => {
    const parsed = registerPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || "Dados inválidos";
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: issue,
      });
    }

    const cleanPhone = normalizePhone(parsed.data.telefone);
    const passwordHash = hashPassword(parsed.data.senha);

    let courier = await prisma.courier.findUnique({
      where: { telefone: cleanPhone },
    });

    if (courier) {
      // Atualiza senha do entregador existente
      courier = await prisma.courier.update({
        where: { id: courier.id },
        data: {
          senha_hash: passwordHash,
          ativo: true,
          status: "online",
          consentimento_lgpd_em: courier.consentimento_lgpd_em || new Date(),
          consentimento_versao: courier.consentimento_versao || "1.0",
          ...(parsed.data.nome && (!courier.nome || courier.nome === "Entregador") ? { nome: parsed.data.nome } : {}),
          ...(parsed.data.veiculo ? { veiculo: parsed.data.veiculo } : {}),
          ...(parsed.data.placa ? { placa: parsed.data.placa } : {}),
        },
      });
    } else {
      // Busca a primeira loja ativa para vincular automaticamente
      const defaultStore = await prisma.store.findFirst({
        where: { ativo: true },
        orderBy: { criado_em: "asc" },
      });

      courier = await prisma.courier.create({
        data: {
          nome: parsed.data.nome || "Entregador",
          telefone: cleanPhone,
          veiculo: parsed.data.veiculo || "moto",
          placa: parsed.data.placa || null,
          senha_hash: passwordHash,
          ativo: true,
          status: "online",
          consentimento_lgpd_em: new Date(),
          consentimento_versao: "1.0",
          ...(defaultStore
            ? {
                store_links: {
                  create: {
                    store_id: defaultStore.id,
                    tipo: "proprio",
                    ativo: true,
                    todas_unidades: true,
                  },
                },
              }
            : {}),
        },
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
      message: "Senha cadastrada com sucesso! Bem-vindo ao app.",
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
