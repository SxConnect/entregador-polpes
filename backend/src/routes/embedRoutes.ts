import { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { authStore } from "../middlewares/authStore.js";

export async function embedRoutes(app: FastifyInstance) {
  // ── Gerar Token Embed de Curta Duração (Chamado pelo Core para iframe) ──
  app.post("/api/v1/store/embed-token", { preHandler: [authStore] }, async (request, reply) => {
    const store = request.store!;

    // Token assinado válido por 2 horas para embutir via iframe
    const embedToken = app.jwt.sign(
      {
        store_id: store.id,
        core_store_id: store.core_store_id,
        scope: "embed_panel",
      },
      {
        expiresIn: "2h",
      }
    );

    const embedUrl = `${env.PWA_BASE_URL}/embed/painel?token=${embedToken}`;

    return reply.send({
      embed_token: embedToken,
      embed_url: embedUrl,
      expires_in_seconds: 7200,
    });
  });

  // ── Rota Direta /embed/painel (Redireciona para o Frontend com Query) ───
  app.get("/embed/painel", async (request, reply) => {
    const query = request.url.split("?")[1] || "";
    const redirectUrl = `${env.PWA_BASE_URL}/embed/painel${query ? `?${query}` : ""}`;
    return reply.redirect(redirectUrl);
  });
}
