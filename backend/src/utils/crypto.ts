import crypto from "node:crypto";

export function generateApiKey(): string {
  const bytes = crypto.randomBytes(24).toString("hex");
  return `epk_live_${bytes}`;
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key.trim()).digest("hex");
}

export function generateInviteToken(): string {
  return crypto.randomBytes(20).toString("hex");
}

export function generateConfirmationCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export function signHmacSha256(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
