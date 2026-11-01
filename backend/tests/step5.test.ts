import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { FastifyInstance } from "fastify";

describe("Etapa 5: Rastreamento Público do Cliente (/t/:tracking_token)", () => {
  let app: FastifyInstance;
  let storeApiKey: string;
  let courierId: string;
  let courierJwt: string;
  let deliveryId: string;
  let trackingToken: string;
  let codigoConfirmacao: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Limpa dados para isolamento
    await prisma.deliveryEvent.deleteMany();
    await prisma.delivery.deleteMany();
    await prisma.courierLocation.deleteMany();
    await prisma.courierInvite.deleteMany();
    await prisma.courierStoreLink.deleteMany();
    await prisma.courier.deleteMany();
    await prisma.store.deleteMany();

    // 1. Cria loja Polpês
    const storeRes = await app.inject({
      method: "POST",
      url: "/api/v1/stores/provision",
      payload: {
        core_store_id: "polpes_tracking_test",
        nome: "Polpê's Rastreio",
      },
    });
    storeApiKey = storeRes.json().api_key;

    // 2. Cadastra entregador "Roberto da Silva"
    const courierRes = await app.inject({
      method: "POST",
      url: "/api/v1/couriers",
      headers: { "x-store-api-key": storeApiKey },
      payload: {
        nome: "Roberto da Silva",
        telefone: "21966665555",
        veiculo: "moto",
        placa: "BRA1A23",
      },
    });
    const courierData = courierRes.json();
    courierId = courierData.courier.id;

    // Aceita convite
    const acceptRes = await app.inject({
      method: "POST",
      url: `/api/v1/invites/${courierData.invite.token}/accept`,
      payload: { consentimento_lgpd: true },
    });
    courierJwt = acceptRes.json().token;

    // 3. Cria entrega atribuída a Roberto
    const deliveryRes = await app.inject({
      method: "POST",
      url: "/api/v1/deliveries",
      headers: { "x-store-api-key": storeApiKey },
      payload: {
        core_order_id: "pedido_rastreio_101",
        endereco_retirada: { logradouro: "Loja Polpes", numero: "10" },
        endereco_entrega: {
          logradouro: "Rua Barata Ribeiro",
          numero: "200",
          bairro: "Copacabana",
          cidade: "Rio de Janeiro",
        },
        cliente_nome: "Ana Beatriz",
        cliente_telefone: "21988881234",
        courier_id: courierId,
      },
    });
    const delData = deliveryRes.json().delivery;
    deliveryId = delData.id;
    trackingToken = delData.tracking_token;
    codigoConfirmacao = delData.codigo_confirmacao;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("deve retornar 404 para token de rastreio inexistente", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tracking/token_inexistente_123",
    });
    expect(res.statusCode).toBe(404);
  });

  it("deve consultar dados públicos de rastreio sanitizados (LGPD)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracking/${trackingToken}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.status).toBe("atribuido");
    expect(body.store.nome).toBe("Polpê's Rastreio");
    expect(body.store.logo_url).toContain("logo-polpes.png");

    // Validação de privacidade LGPD do entregador:
    expect(body.courier.nome).toBe("Roberto d."); // Sobrenome abreviado
    expect(body.courier.placa).toBe("BRA***3"); // Placa mascarada
    expect(body.courier.telefone).toBeUndefined(); // Telefone NUNCA exposto ao público

    // Código de 4 dígitos em destaque para informar na entrega
    expect(body.codigo_confirmacao).toBe(codigoConfirmacao);
  });

  it("deve incluir coordenadas de telemetria após o entregador iniciar rota", async () => {
    // 1. Entregador aceita e inicia rota
    await app.inject({
      method: "POST",
      url: `/api/v1/courier/deliveries/${deliveryId}/accept`,
      headers: { authorization: `Bearer ${courierJwt}` },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/courier/deliveries/${deliveryId}/pickup`,
      headers: { authorization: `Bearer ${courierJwt}` },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/courier/deliveries/${deliveryId}/start-route`,
      headers: { authorization: `Bearer ${courierJwt}` },
    });

    // 2. Entregador envia posição GPS
    await app.inject({
      method: "POST",
      url: "/api/v1/courier/location",
      headers: { authorization: `Bearer ${courierJwt}` },
      payload: { lat: -22.9711, lng: -43.1822, precisao: 5 },
    });

    // 3. Cliente consulta o rastreio
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracking/${trackingToken}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("em_rota");
    expect(body.courier_location).toBeDefined();
    expect(body.courier_location.lat).toBe(-22.9711);
    expect(body.courier_location.lng).toBe(-43.1822);
  });

  it("deve ocultar o código de 4 dígitos após a entrega ser concluída", async () => {
    // Finaliza a entrega
    await app.inject({
      method: "POST",
      url: `/api/v1/courier/deliveries/${deliveryId}/complete`,
      headers: { authorization: `Bearer ${courierJwt}` },
      payload: { codigo_confirmacao: codigoConfirmacao },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracking/${trackingToken}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("entregue");
    expect(body.codigo_confirmacao).toBeNull(); // Não precisa mais do código após entregue
  });

  it("deve redirecionar rota amigável /t/:token para o PWA", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/t/${trackingToken}`,
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain(`/t/${trackingToken}`);
  });
});
