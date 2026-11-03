import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword, verifyPassword } from "../src/utils/crypto.js";
import { FastifyInstance } from "fastify";

describe("Autenticação e Cadastro de Senha do Entregador", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("1. Funções de Criptografia de Senha", () => {
    it("deve gerar hash scrypt único e validar senha correta", () => {
      const password = "minhasenhasecreta123";
      const hash = hashPassword(password);

      expect(hash).toContain(":");
      expect(verifyPassword(password, hash)).toBe(true);
      expect(verifyPassword("senhaerrada", hash)).toBe(false);
    });

    it("não deve validar senha com hash corrompido", () => {
      expect(verifyPassword("123456", "hashinvalido")).toBe(false);
    });
  });

  describe("2. Cadastro de Senha e Login do Entregador", () => {
    const testPhone = "21996984261";
    const testPassword = "senhaForte@123";

    it("deve cadastrar nova senha para o entregador via primeiro acesso", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/courier/auth/register-password",
        payload: {
          telefone: testPhone,
          senha: testPassword,
          nome: "Silvano Entregador",
          veiculo: "moto",
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.token).toBeDefined();
      expect(data.courier.telefone).toBe("5521996984261");
      expect(data.courier.nome).toBe("Silvano Entregador");
    });

    it("deve fazer login com sucesso usando telefone e senha cadastrada", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/courier/auth/login",
        payload: {
          telefone: testPhone,
          senha: testPassword,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.token).toBeDefined();
      expect(data.courier.telefone).toBe("5521996984261");
    });

    it("deve rejeitar login com senha incorreta", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/courier/auth/login",
        payload: {
          telefone: testPhone,
          senha: "senhaIncorreta123",
        },
      });

      expect(res.statusCode).toBe(401);
      const data = JSON.parse(res.body);
      expect(data.error).toBe("Unauthorized");
      expect(data.message).toContain("Senha incorreta");
    });

    it("deve rejeitar cadastro com senha curta (< 4 caracteres)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/courier/auth/register-password",
        payload: {
          telefone: testPhone,
          senha: "12",
        },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.message).toContain("pelo menos 4 caracteres");
    });
  });
});
