import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { signHmacSha256 } from "../src/utils/crypto.js";
import {
  canTransition,
  assertValidTransition,
} from "../src/services/deliveryStateMachine.js";
import { FastifyInstance } from "fastify";

describe("Etapa 3: Entregas, Máquina de Estados, Código de 4 Dígitos e Webhooks", () => {
  let app: FastifyInstance;
  let storeApiKey: string;
  let storeId: string;
  let courierId: string;
  let courierJwt: string;
  let deliveryId: string;
  let codigoConfirmacao: string;
  const webhookSecret = "segredo_hmac_super_confiavel_123";

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Limpa dados de teste
    await prisma.deliveryEvent.deleteMany();
    await prisma.delivery.deleteMany();
    await prisma.courierLocation.deleteMany();
    await prisma.courierInvite.deleteMany();
    await prisma.courierStoreLink.deleteMany();
    await prisma.courier.deleteMany();
    await prisma.store.deleteMany();

    // 1. Cria loja com webhook configurado
    const storeRes = await app.inject({
      method: "POST",
      url: "/api/v1/stores/provision",
      payload: {
        core_store_id: "polpes_step3_store",
        nome: "Polpes Delivery",
        webhook_url: "https://httpbin.org/post",
        webhook_secret: webhookSecret,
        settings: {
          valor_padrao_corrida: 10.0,
          exigir_codigo_confirmacao: true,
        },
      },
    });
    const storeData = storeRes.json();
    storeId = storeData.store_id;
    storeApiKey = storeData.api_key;

    // 2. Cadastra entregador
    const courierRes = await app.inject({
      method: "POST",
      url: "/api/v1/couriers",
      headers: { "x-store-api-key": storeApiKey },
      payload: {
        nome: "Marcos Entregador",
        telefone: "21977776666",
        veiculo: "moto",
      },
    });
    const courierData = courierRes.json();
    courierId = courierData.courier.id;
    const token = courierData.invite.token;

    // 3. Entregador aceita convite com LGPD e recebe JWT
    const acceptRes = await app.inject({
      method: "POST",
      url: `/api/v1/invites/${token}/accept`,
      payload: { consentimento_lgpd: true },
    });
    courierJwt = acceptRes.json().token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("1. Regras da Máquina de Estados (Unitário)", () => {
    it("deve permitir transições válidas de fluxo completo", () => {
      expect(canTransition("pendente", "atribuido")).toBe(true);
      expect(canTransition("atribuido", "aceito")).toBe(true);
      expect(canTransition("aceito", "coletado")).toBe(true);
      expect(canTransition("coletado", "em_rota")).toBe(true);
      expect(canTransition("em_rota", "entregue")).toBe(true);
    });

    it("deve permitir cancelamento a partir de estados intermediários", () => {
      expect(canTransition("pendente", "cancelado")).toBe(true);
      expect(canTransition("atribuido", "cancelado")).toBe(true);
      expect(canTransition("aceito", "cancelado")).toBe(true);
      expect(canTransition("em_rota", "cancelado")).toBe(true);
    });

    it("deve bloquear transições inválidas (ex: pular direto de pendente para entregue)", () => {
      expect(canTransition("pendente", "entregue")).toBe(false);
      expect(() => assertValidTransition("pendente", "entregue")).toThrowError(
        /Transição de status inválida/
      );
    });

    it("deve bloquear transições a partir de estados terminais (entregue/cancelado)", () => {
      expect(canTransition("entregue", "coletado")).toBe(false);
      expect(canTransition("cancelado", "aceito")).toBe(false);
    });
  });

  describe("2. Criação de Entregas & Idempotência", () => {
    it("deve criar uma entrega com endereço e gerar código de 4 dígitos", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/deliveries",
        headers: { "x-store-api-key": storeApiKey },
        payload: {
          core_order_id: "pedido_polpes_001",
          endereco_retirada: {
            logradouro: "Rua do Açaí",
            numero: "100",
            cidade: "Rio de Janeiro",
          },
          endereco_entrega: {
            logradouro: "Av. Atlântica",
            numero: "1500",
            bairro: "Copacabana",
            cidade: "Rio de Janeiro",
            cep: "22021-001",
          },
          cliente_nome: "Maria Oliveira",
          cliente_telefone: "21999990000",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.delivery.id).toBeDefined();
      expect(body.delivery.status).toBe("pendente");
      expect(body.delivery.codigo_confirmacao).toMatch(/^\d{4}$/); // 4 dígitos!
      expect(body.delivery.tracking_token).toBeDefined();
      expect(body.tracking_url).toContain(body.delivery.tracking_token);
      expect(body.idempotent).toBe(false);

      deliveryId = body.delivery.id;
      codigoConfirmacao = body.delivery.codigo_confirmacao;
    });

    it("IDEMPOTÊNCIA: chamada repetida com mesmo core_order_id deve retornar 200 e a mesma entrega", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/deliveries",
        headers: { "x-store-api-key": storeApiKey },
        payload: {
          core_order_id: "pedido_polpes_001", // mesmo id
          endereco_retirada: { logradouro: "Rua do Açaí", numero: "100" },
          endereco_entrega: { logradouro: "Av. Atlântica", numero: "1500" },
          cliente_nome: "Maria Oliveira",
          cliente_telefone: "21999990000",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.delivery.id).toBe(deliveryId);
      expect(body.idempotent).toBe(true);
    });
  });

  describe("3. Atribuição e Validação de Vínculo Ativo (Toggle)", () => {
    it("deve bloquear atribuição se o vínculo do entregador estiver inativo (toggle desligado)", async () => {
      // Desativa toggle do entregador
      await app.inject({
        method: "PATCH",
        url: `/api/v1/couriers/${courierId}/toggle`,
        headers: { "x-store-api-key": storeApiKey },
        payload: { ativo: false },
      });

      // Tenta atribuir
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/deliveries/${deliveryId}/assign`,
        headers: { "x-store-api-key": storeApiKey },
        payload: { courier_id: courierId },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Entregador inativo ou não vinculado");
    });

    it("deve atribuir entrega com sucesso quando o toggle estiver ativo", async () => {
      // Reativa toggle
      await app.inject({
        method: "PATCH",
        url: `/api/v1/couriers/${courierId}/toggle`,
        headers: { "x-store-api-key": storeApiKey },
        payload: { ativo: true },
      });

      // Atribui
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/deliveries/${deliveryId}/assign`,
        headers: { "x-store-api-key": storeApiKey },
        payload: { courier_id: courierId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.delivery.status).toBe("atribuido");
      expect(body.delivery.courier.id).toBe(courierId);
    });
  });

  describe("4. Ciclo de Vida da Corrida pelo Entregador (PWA)", () => {
    it("entregador deve ver a corrida como ativa", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/courier/deliveries/active",
        headers: { authorization: `Bearer ${courierJwt}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.delivery).toBeDefined();
      expect(body.delivery.id).toBe(deliveryId);
      expect(body.delivery.status).toBe("atribuido");
      expect(body.delivery.exigir_codigo_confirmacao).toBe(true);
    });

    it("entregador aceita corrida (status -> aceito, courier -> em_corrida)", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/courier/deliveries/${deliveryId}/accept`,
        headers: { authorization: `Bearer ${courierJwt}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().delivery.status).toBe("aceito");

      // Verifica status do entregador
      const courier = await prisma.courier.findUnique({ where: { id: courierId } });
      expect(courier?.status).toBe("em_corrida");
    });

    it("entregador confirma coleta na loja (status -> coletado)", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/courier/deliveries/${deliveryId}/pickup`,
        headers: { authorization: `Bearer ${courierJwt}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().delivery.status).toBe("coletado");
    });

    it("entregador inicia trajeto até o cliente (status -> em_rota)", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/courier/deliveries/${deliveryId}/start-route`,
        headers: { authorization: `Bearer ${courierJwt}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().delivery.status).toBe("em_rota");
    });

    it("deve REJEITAR conclusão com código de 4 dígitos incorreto (400)", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/courier/deliveries/${deliveryId}/complete`,
        headers: { authorization: `Bearer ${courierJwt}` },
        payload: {
          codigo_confirmacao: "0000", // Código errado
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().invalid_code).toBe(true);
    });

    it("deve CONCLUIR entrega quando o código de 4 dígitos estiver correto", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/courier/deliveries/${deliveryId}/complete`,
        headers: { authorization: `Bearer ${courierJwt}` },
        payload: {
          codigo_confirmacao: codigoConfirmacao, // Código gerado correto
          lat: -22.9698,
          lng: -43.1869,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.delivery.status).toBe("entregue");
      expect(body.delivery.entregue_em).toBeDefined();

      // Entregador é liberado de volta para online
      const courier = await prisma.courier.findUnique({ where: { id: courierId } });
      expect(courier?.status).toBe("online");
    });

    it("após entrega concluída, /courier/deliveries/active deve retornar null", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/courier/deliveries/active",
        headers: { authorization: `Bearer ${courierJwt}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().delivery).toBeNull();
    });
  });

  describe("5. Assinatura HMAC-SHA256 para Webhooks", () => {
    it("deve gerar e verificar assinatura HMAC-SHA256 válida", () => {
      const secret = "meu_secret_123";
      const payload = JSON.stringify({ event: "delivery.completed", order_id: 123 });
      const timestamp = "1730000000000";

      const signature = signHmacSha256(secret, `${timestamp}.${payload}`);
      expect(signature).toBeDefined();
      expect(signature).toHaveLength(64); // SHA-256 hex string

      // Simula validação no receptor
      const expected = signHmacSha256(secret, `${timestamp}.${payload}`);
      expect(signature).toBe(expected);
    });
  });
});
