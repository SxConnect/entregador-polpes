import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { signHmacSha256 } from "../utils/crypto.js";

export interface WebhookDeliveryPayload {
  event: string;
  store_id: string;
  core_store_id: string;
  timestamp: string;
  data: Record<string, any>;
}

export async function sendWebhookWithRetry(
  url: string,
  secret: string,
  payload: WebhookDeliveryPayload,
  maxRetries: number = env.WEBHOOK_MAX_RETRIES,
  timeoutMs: number = env.WEBHOOK_TIMEOUT_MS
): Promise<boolean> {
  const jsonBody = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const signature = signHmacSha256(secret, `${timestamp}.${jsonBody}`);

  const headers = {
    "Content-Type": "application/json",
    "X-Hub-Signature-256": `sha256=${signature}`,
    "X-Timestamp": timestamp,
    "User-Agent": "EntregadorPolpes-Webhook/1.0",
  };

  let attempt = 0;
  let delay = 500;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: jsonBody,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status >= 200 && res.status < 300) {
        return true;
      }

      console.warn(
        `[Webhook] Falha no envio para ${url} (tentativa ${attempt}/${maxRetries}): HTTP ${res.status}`
      );
    } catch (err: any) {
      console.warn(
        `[Webhook] Erro no envio para ${url} (tentativa ${attempt}/${maxRetries}): ${err?.message || err}`
      );
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  console.error(`[Webhook] Esgotadas as tentativas de envio para ${url}`);
  return false;
}

export async function dispatchStoreWebhook(
  storeId: string,
  event: string,
  data: Record<string, any>
): Promise<void> {
  try {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        core_store_id: true,
        webhook_url: true,
        webhook_secret: true,
      },
    });

    if (!store || !store.webhook_url || !store.webhook_secret) {
      return;
    }

    const payload: WebhookDeliveryPayload = {
      event,
      store_id: store.id,
      core_store_id: store.core_store_id,
      timestamp: new Date().toISOString(),
      data,
    };

    // Dispara assincronamente sem bloquear a requisição principal
    sendWebhookWithRetry(store.webhook_url, store.webhook_secret, payload).catch((err) => {
      console.error("[Webhook] Erro em segundo plano:", err);
    });
  } catch (err) {
    console.error("[Webhook] Erro ao recuperar loja para webhook:", err);
  }
}
