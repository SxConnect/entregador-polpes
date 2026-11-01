import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16).default("jwt_secret_dev_entregador_polpes_min_32_chars"),
  COURIER_SESSION_EXPIRES_IN: z.string().default("30d"),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().default(8000),
  WEBHOOK_MAX_RETRIES: z.coerce.number().default(5),
  LOCATION_RETENTION_DAYS: z.coerce.number().default(30),
  PWA_BASE_URL: z.string().default("http://localhost:5173"),
  TRACKING_BASE_URL: z.string().default("http://localhost:4000/t"),
});

export const env = envSchema.parse(process.env);
