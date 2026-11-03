import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { hashApiKey } from "../src/utils/crypto.js";
import { FastifyInstance } from "fastify";

describe("Múltiplas Entregas em Lote e Rota Multi-Paradas", () => {
  let app: FastifyInstance;
  let storeApiKey: string;
  let storeId: string;
  let courierId: string;
  let courierJwt: string;
  let deliveryId1: string;
  let deliveryId2: string;
  let deliveryId3: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const storeRes = await app.inject({
      method: "POST",
      url: "/api/v1/stores/provision",
      payload: {
        core_store_id: "store_multi_test",
        nome: "Polpês Multi Store",
        settings: {
          valor_padrao_corrida: 8.0,
        },
      },
    });
    const storeData = storeRes.json();
    storeId = storeData.store_id;
    storeApiKey = storeData.api_key;

    // Garante que a filial tenha coordenadas
    await prisma.branch.updateMany({
      where: { store_id: storeId },
      data: {
        endereco_retirada: {
          logradouro: "Av Atlântica",
          numero: "1000",
          cidade: "Rio de Janeiro",
          lat: -22.971,
          lng: -43.182,
        },
      },
    });

    const courier = await prisma.courier.create({
      data: {
        nome: "Entregador Multi",
        telefone: "5521998877665",
        ativo: true,
        status: "online",
        store_links: {
          create: {
            store_id: storeId,
            ativo: true,
            todas_unidades: true,
          },
        },
      },
    });
    courierId = courier.id;

    courierJwt = app.jwt.sign({ courier_id: courierId, telefone: courier.telefone });

    // Cria 3 entregas em locais diferentes
    // 1. Copacabana (perto da loja, ~0.5 km)
    const res1 = await app.inject({
      method: "POST",
      url: "/api/v1/deliveries",
      headers: { "x-store-api-key": storeApiKey },
      payload: {
        core_order_id: "order_multi_1",
        endereco_entrega: {
          logradouro: "Rua Barata Ribeiro",
          numero: "200",
          lat: -22.969,
          lng: -43.181,
        },
        cliente_nome: "Cliente 1 (Mais Perto)",
        cliente_telefone: "21999990001",
        valor_corrida: 7.0,
      },
    });
    deliveryId1 = JSON.parse(res1.body).delivery.id;

    // 2. Ipanema (médio, ~2.5 km)
    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/deliveries",
      headers: { "x-store-api-key": storeApiKey },
      payload: {
        core_order_id: "order_multi_2",
        endereco_entrega: {
          logradouro: "Rua Visconde de Pirajá",
          numero: "300",
          lat: -22.984,
          lng: -43.204,
        },
        cliente_nome: "Cliente 2 (Médio)",
        cliente_telefone: "21999990002",
        valor_corrida: 10.0,
      },
    });
    deliveryId2 = JSON.parse(res2.body).delivery.id;

    // 3. Leblon (mais distante, ~4.5 km)
    const res3 = await app.inject({
      method: "POST",
      url: "/api/v1/deliveries",
      headers: { "x-store-api-key": storeApiKey },
      payload: {
        core_order_id: "order_multi_3",
        endereco_entrega: {
          logradouro: "Av Ataulfo de Paiva",
          numero: "800",
          lat: -22.986,
          lng: -43.225,
        },
        cliente_nome: "Cliente 3 (Mais Distante)",
        cliente_telefone: "21999990003",
        valor_corrida: 14.0,
      },
    });
    deliveryId3 = JSON.parse(res3.body).delivery.id;
  });

  afterAll(async () => {
    await prisma.deliveryEvent.deleteMany({ where: { store_id: storeId } });
    await prisma.delivery.deleteMany({ where: { store_id: storeId } });
    await prisma.courierStoreLink.deleteMany({ where: { store_id: storeId } });
    await prisma.courier.deleteMany({ where: { id: courierId } });
    await prisma.branch.deleteMany({ where: { store_id: storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await app.close();
    await prisma.$disconnect();
  });

  it("1. Loja deve atribuir lote de 3 entregas para o mesmo entregador via batch-assign", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/deliveries/batch-assign",
      headers: { "x-store-api-key": storeApiKey },
      payload: {
        delivery_ids: [deliveryId1, deliveryId2, deliveryId3],
        courier_id: courierId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.success).toBe(true);
    expect(data.atribuidas).toBe(3);
  });

  it("2. Entregador deve listar as 3 entregas ordenadas da mais próxima até a mais distante", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/courier/deliveries/active",
      headers: { authorization: `Bearer ${courierJwt}` },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);

    expect(data.total_entregas).toBe(3);
    expect(data.deliveries).toHaveLength(3);
    expect(data.valor_total_lote).toBe(31.0); // 7 + 10 + 14

    // Parada 1 deve ser Cliente 1 (mais perto)
    expect(data.deliveries[0].cliente_nome).toBe("Cliente 1 (Mais Perto)");
    expect(data.deliveries[0].ordem_parada).toBe(1);
    expect(data.deliveries[0].is_mais_distante).toBe(false);

    // Parada 3 deve ser Cliente 3 e estar marcada como mais distante
    expect(data.deliveries[2].cliente_nome).toBe("Cliente 3 (Mais Distante)");
    expect(data.deliveries[2].ordem_parada).toBe(3);
    expect(data.deliveries[2].is_mais_distante).toBe(true);
    expect(data.mais_distante.cliente_nome).toBe("Cliente 3 (Mais Distante)");

    // URL do Google Maps deve conter origem, waypoints e destino final mais distante
    expect(data.rota_google_maps_url).toContain("google.com/maps/dir");
    expect(data.rota_google_maps_url).toContain("waypoints=");
  });

  it("3. Entregador pode aceitar o lote completo de uma só vez (batch-accept)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/courier/deliveries/batch-accept",
      headers: { authorization: `Bearer ${courierJwt}` },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.success).toBe(true);
    expect(data.count).toBe(3);

    // Verifica que todas estão com status aceito
    const active = await app.inject({
      method: "GET",
      url: "/api/v1/courier/deliveries/active",
      headers: { authorization: `Bearer ${courierJwt}` },
    });
    const list = JSON.parse(active.body).deliveries;
    expect(list.every((d: any) => d.status === "aceito")).toBe(true);
  });

  it("4. Entregador pode coletar o lote na loja e iniciar a rota (batch-pickup e batch-start-route)", async () => {
    const pickupRes = await app.inject({
      method: "POST",
      url: "/api/v1/courier/deliveries/batch-pickup",
      headers: { authorization: `Bearer ${courierJwt}` },
    });
    expect(pickupRes.statusCode).toBe(200);

    const routeRes = await app.inject({
      method: "POST",
      url: "/api/v1/courier/deliveries/batch-start-route",
      headers: { authorization: `Bearer ${courierJwt}` },
    });
    expect(routeRes.statusCode).toBe(200);

    const active = await app.inject({
      method: "GET",
      url: "/api/v1/courier/deliveries/active",
      headers: { authorization: `Bearer ${courierJwt}` },
    });
    const list = JSON.parse(active.body).deliveries;
    expect(list.every((d: any) => d.status === "em_rota")).toBe(true);
  });

  it("5. Finalizar 1 entrega do lote mantém o entregador em corrida até a última ser finalizada", async () => {
    const delivery1 = await prisma.delivery.findUnique({ where: { id: deliveryId1 } });

    // Finaliza entrega 1 com código
    const compRes = await app.inject({
      method: "POST",
      url: `/api/v1/courier/deliveries/${deliveryId1}/complete`,
      headers: { authorization: `Bearer ${courierJwt}` },
      payload: { codigo_confirmacao: delivery1?.codigo_confirmacao },
    });
    expect(compRes.statusCode).toBe(200);

    // Courier deve continuar em_corrida porque ainda restam 2 entregas ativas
    const courierState = await prisma.courier.findUnique({ where: { id: courierId } });
    expect(courierState?.status).toBe("em_corrida");

    // Consulta ativas deve retornar agora 2 entregas
    const active = await app.inject({
      method: "GET",
      url: "/api/v1/courier/deliveries/active",
      headers: { authorization: `Bearer ${courierJwt}` },
    });
    const list = JSON.parse(active.body).deliveries;
    expect(list).toHaveLength(2);
  });
});
