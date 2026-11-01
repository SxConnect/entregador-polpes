import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import {
  generateApiKey,
  hashApiKey,
  generateInviteToken,
  generateConfirmationCode,
} from "../src/utils/crypto.js";
import { FastifyInstance } from "fastify";

describe("Etapa 2: Lojas, Entregadores, Convites e Multi-Tenant", () => {
  let app: FastifyInstance;
  let store1ApiKey: string;
  let store1Id: string;
  let store2ApiKey: string;
  let store2Id: string;
  let courier1Id: string;
  let inviteToken1: string;

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
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("1. Utilitários Criptográficos", () => {
    it("deve gerar API key no formato epk_live_...", () => {
      const key = generateApiKey();
      expect(key.startsWith("epk_live_")).toBe(true);
      expect(key.length).toBeGreaterThan(30);
    });

    it("deve calcular SHA-256 consistente da API key", () => {
      const key = "epk_live_teste123";
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("deve gerar código de confirmação numérico de 4 dígitos", () => {
      const code = generateConfirmationCode();
      expect(code).toMatch(/^\d{4}$/);
    });

    it("deve gerar token de convite seguro", () => {
      const token = generateInviteToken();
      expect(token).toHaveLength(40);
    });
  });

  describe("2. Provisionamento e Autenticação de Lojas", () => {
    it("deve rejeitar acesso a rota protegida sem API key (401)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/settings",
      });
      expect(res.statusCode).toBe(401);
    });

    it("deve rejeitar acesso com API key inválida (401)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/settings",
        headers: { "x-store-api-key": "epk_live_chave_falsa_123" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("deve provisionar a Loja 1 (Polpês) e retornar a API key em texto puro", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/stores/provision",
        payload: {
          core_store_id: "polpes_core_01",
          nome: "Polpê's Açaí e Sorvetes",
          webhook_url: "https://polpes.com.br/api/webhooks/deliveries",
          webhook_secret: "secret_hmac_polpes_123",
          settings: {
            valor_padrao_corrida: 8.5,
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.store_id).toBeDefined();
      expect(body.api_key).toMatch(/^epk_live_/);
      expect(body.core_store_id).toBe("polpes_core_01");

      store1Id = body.store_id;
      store1ApiKey = body.api_key;
    });

    it("deve acessar /api/v1/store/settings com a API key no header X-Store-API-Key", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/store/settings",
        headers: { "x-store-api-key": store1ApiKey },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.store_id).toBe(store1Id);
      expect(body.nome).toBe("Polpê's Açaí e Sorvetes");
      expect(body.settings.valor_padrao_corrida).toBe(8.5);
    });

    it("deve permitir atualizar configurações e settings da Loja 1", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/store/settings",
        headers: { "x-store-api-key": store1ApiKey },
        payload: {
          settings: {
            valor_padrao_corrida: 9.0,
            exigir_codigo_confirmacao: true,
            msg_padrao_rastreio: "Seu açaí Polpês está a caminho!",
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.settings.valor_padrao_corrida).toBe(9.0);
      expect(body.settings.msg_padrao_rastreio).toBe("Seu açaí Polpês está a caminho!");
    });

    it("deve provisionar a Loja 2 (Outra Loja) para testes de multi-tenancy", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/stores/provision",
        payload: {
          core_store_id: "loja_parceira_02",
          nome: "Hamburgueria do Bairro",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      store2Id = body.store_id;
      store2ApiKey = body.api_key;
      expect(store2Id).not.toBe(store1Id);
    });
  });

  describe("3. CRUD de Entregadores e Isolamento Multi-Tenant", () => {
    it("deve cadastrar um entregador próprio na Loja 1 com convite", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/couriers",
        headers: { "x-store-api-key": store1ApiKey },
        payload: {
          nome: "Carlos Eduardo",
          telefone: "21988887777",
          veiculo: "moto",
          placa: "RIO2A18",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.courier.id).toBeDefined();
      expect(body.courier.nome).toBe("Carlos Eduardo");
      expect(body.courier.telefone).toBe("5521988887777");
      expect(body.invite.token).toBeDefined();
      expect(body.invite.invite_url).toContain(body.invite.token);

      courier1Id = body.courier.id;
      inviteToken1 = body.invite.token;
    });

    it("Loja 1 deve listar Carlos Eduardo", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/couriers",
        headers: { "x-store-api-key": store1ApiKey },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.couriers).toHaveLength(1);
      expect(body.couriers[0].id).toBe(courier1Id);
      expect(body.couriers[0].invite.token).toBe(inviteToken1);
    });

    it("ISOLAMENTO: Loja 2 NÃO deve ver o entregador da Loja 1", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/couriers",
        headers: { "x-store-api-key": store2ApiKey },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.couriers).toHaveLength(0); // Lista vazia para a Loja 2!
    });

    it("ISOLAMENTO: Loja 2 NÃO pode obter detalhes do entregador da Loja 1 (404)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/couriers/${courier1Id}`,
        headers: { "x-store-api-key": store2ApiKey },
      });

      expect(res.statusCode).toBe(404);
    });

    it("Loja 1 pode atualizar dados do entregador", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/couriers/${courier1Id}`,
        headers: { "x-store-api-key": store1ApiKey },
        payload: {
          veiculo: "bicicleta",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().veiculo).toBe("bicicleta");
    });

    it("Loja 1 pode gerar/reenviar um novo convite para o entregador", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/couriers/${courier1Id}/invites`,
        headers: { "x-store-api-key": store1ApiKey },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.token).toBeDefined();
      expect(body.token).not.toBe(inviteToken1); // Novo token único

      inviteToken1 = body.token; // Usaremos o novo token para o onboarding
    });
  });

  describe("4. Onboarding do Entregador (Convite, LGPD e JWT)", () => {
    it("deve consultar convite público e retornar dados da loja e entregador", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/invites/${inviteToken1}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.valid).toBe(true);
      expect(body.store.nome).toBe("Polpê's Açaí e Sorvetes");
      expect(body.courier.nome).toBe("Carlos Eduardo");
      expect(body.requires_lgpd).toBe(true);
    });

    it("deve rejeitar aceite de convite sem consentimento LGPD (400)", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/invites/${inviteToken1}/accept`,
        payload: {
          consentimento_lgpd: false,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("deve aceitar convite com consentimento LGPD, ativar entregador e emitir JWT", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/invites/${inviteToken1}/accept`,
        payload: {
          consentimento_lgpd: true,
          consentimento_versao: "1.0-2026",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.token).toBeDefined(); // JWT gerado
      expect(body.courier.status).toBe("online");
      expect(body.courier.consentimento_lgpd_em).toBeDefined();
    });

    it("deve rejeitar reutilização do mesmo convite após ser aceito (410 Gone)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/invites/${inviteToken1}`,
      });

      expect(res.statusCode).toBe(410);
      expect(res.json().already_used).toBe(true);
    });
  });
});
