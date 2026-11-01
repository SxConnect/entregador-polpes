import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
    },
  });

  app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.register(sensible);

  // Healthcheck endpoint
  app.get("/health", async () => {
    return { status: "ok", service: "entregador-polpes", timestamp: new Date().toISOString() };
  });

  return app;
}
