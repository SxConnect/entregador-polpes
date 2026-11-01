import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../config/prisma.js";
import { hashApiKey } from "../utils/crypto.js";

export async function authStore(request: FastifyRequest, reply: FastifyReply) {
  const headerKey = request.headers["x-store-api-key"] as string | undefined;
  const authHeader = request.headers.authorization;

  let rawKey = headerKey;
  if (!rawKey && authHeader?.startsWith("Bearer ")) {
    rawKey = authHeader.substring(7);
  }

  if (!rawKey || !rawKey.trim()) {
    return reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "Cabeçalho X-Store-API-Key não fornecido.",
    });
  }

  const hash = hashApiKey(rawKey);
  const store = await prisma.store.findFirst({
    where: {
      api_key_hash: hash,
      ativo: true,
    },
  });

  if (!store) {
    return reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "API Key inválida ou loja inativa.",
    });
  }

  request.store = store;
}
