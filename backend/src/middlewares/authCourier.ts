import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../config/prisma.js";

interface CourierJwtPayload {
  courier_id: string;
  telefone: string;
}

export async function authCourier(request: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await request.jwtVerify<CourierJwtPayload>();
    if (!payload || !payload.courier_id) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Token inválido.",
      });
    }

    const courier = await prisma.courier.findUnique({
      where: {
        id: payload.courier_id,
        ativo: true,
      },
    });

    if (!courier) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Entregador não encontrado ou inativo.",
      });
    }

    request.courier = courier;
  } catch (err) {
    return reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "Sessão expirada ou token inválido.",
    });
  }
}
