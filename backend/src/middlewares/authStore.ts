import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../config/prisma.js";
import { hashApiKey } from "../utils/crypto.js";

export async function authStore(request: FastifyRequest, reply: FastifyReply) {
  // 1. Suporte a Token Embed de Curta Duração (via query ?token=... ou header X-Embed-Token)
  const embedToken =
    (request.query as Record<string, string>)?.token ||
    (request.headers["x-embed-token"] as string | undefined);

  if (embedToken) {
    try {
      const decoded = request.server.jwt.verify<{ store_id: string; scope: string }>(embedToken);
      if (decoded && decoded.store_id) {
        const store = await prisma.store.findUnique({
          where: { id: decoded.store_id, ativo: true },
        });
        if (store) {
          request.store = store;
          return;
        }
      }
    } catch {
      // Continua para checar API key permanente
    }
  }

  // 2. Autenticação por API Key Permanente (Header X-Store-API-Key ou Bearer)
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
      message: "Cabeçalho X-Store-API-Key ou token embed não fornecido.",
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
