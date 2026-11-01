import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import { env } from "./config/env.js";
import { storeRoutes } from "./routes/storeRoutes.js";
import { courierRoutes } from "./routes/courierRoutes.js";
import { inviteRoutes } from "./routes/inviteRoutes.js";
import { deliveryStoreRoutes } from "./routes/deliveryStoreRoutes.js";
import { deliveryCourierRoutes } from "./routes/deliveryCourierRoutes.js";

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

  app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  // Healthcheck endpoint
  app.get("/health", async () => {
    return { status: "ok", service: "entregador-polpes", timestamp: new Date().toISOString() };
  });

  // Register domain routes
  app.register(storeRoutes);
  app.register(courierRoutes);
  app.register(inviteRoutes);
  app.register(deliveryStoreRoutes);
  app.register(deliveryCourierRoutes);

  return app;
}
