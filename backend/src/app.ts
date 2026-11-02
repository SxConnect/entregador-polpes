import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import sensible from "@fastify/sensible";
import fs from "node:fs";
import path from "node:path";
import { env } from "./config/env.js";
import { storeRoutes } from "./routes/storeRoutes.js";
import { courierRoutes } from "./routes/courierRoutes.js";
import { inviteRoutes } from "./routes/inviteRoutes.js";
import { deliveryStoreRoutes } from "./routes/deliveryStoreRoutes.js";
import { deliveryCourierRoutes } from "./routes/deliveryCourierRoutes.js";
import { courierAuthRoutes } from "./routes/courierAuthRoutes.js";
import { trackingRoutes } from "./routes/trackingRoutes.js";
import { embedRoutes } from "./routes/embedRoutes.js";
import { branchRoutes } from "./routes/branchRoutes.js";

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

  app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB max
    },
  });

  const uploadsPath = path.resolve(process.cwd(), "uploads");
  app.register(fastifyStatic, {
    root: uploadsPath,
    prefix: "/uploads/",
    decorateReply: false,
  });

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
  app.register(courierAuthRoutes);
  app.register(trackingRoutes);
  app.register(embedRoutes);
  app.register(branchRoutes);

  // ── Servir PWA Estático e Roteamento SPA (Produção / Container) ─────
  const pwaDistContainer = path.resolve(process.cwd(), "pwa-dist");
  const pwaDistDev = path.resolve(process.cwd(), "../pwa/dist");
  const pwaPath = fs.existsSync(pwaDistContainer)
    ? pwaDistContainer
    : fs.existsSync(pwaDistDev)
    ? pwaDistDev
    : null;

  if (pwaPath && fs.existsSync(path.join(pwaPath, "index.html"))) {
    const indexHtml = fs.readFileSync(path.join(pwaPath, "index.html"), "utf-8");

    app.register(fastifyStatic, {
      root: pwaPath,
      prefix: "/",
      decorateReply: false,
    });

    app.get("/", async (_req, reply) => {
      return reply.type("text/html; charset=utf-8").send(indexHtml);
    });

    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url || "";
      if (url.startsWith("/api/") || url.startsWith("/uploads/")) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Recurso não encontrado",
        });
      }
      return reply.type("text/html; charset=utf-8").send(indexHtml);
    });
  }

  return app;
}
