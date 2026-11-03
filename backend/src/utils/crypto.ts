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

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password.trim(), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, key] = storedHash.split(":");
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, "hex");
    const derivedKey = crypto.scryptSync(password.trim(), salt, 64);
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}
