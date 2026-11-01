import { Store, Courier } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    store?: Store;
    courier?: Courier;
  }
}
