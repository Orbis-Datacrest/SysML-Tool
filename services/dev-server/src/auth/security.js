import crypto from "node:crypto";

export const now = () => new Date().toISOString();
export const addDays = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
export const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();
export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validatePassword = (password) => String(password ?? "").length < 8 ? "Password must be at least 8 characters." : "";

export function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("base64url") };
}

export function verifyPassword(password, user) {
  if (!user?.password_hash || !user?.password_salt) return false;
  const candidate = crypto.scryptSync(password, user.password_salt, 64);
  const stored = Buffer.from(user.password_hash, "base64url");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

export const makeVerificationCode = () => String(crypto.randomInt(100000, 1000000));
export const makeToken = () => crypto.randomBytes(32).toString("base64url");
export const tenantIdForEmail = (email) => `tenant_${crypto.createHash("sha1").update(email).digest("hex").slice(0, 12)}`;

export function encryptSecret(secret) {
  const master = crypto.createHash("sha256").update(process.env.API_KEY_ENCRYPTION_SECRET ?? "local-dev-secret").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}
