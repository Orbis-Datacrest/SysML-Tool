import crypto from "node:crypto";

export const now = () => new Date().toISOString();
export const addDays = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
export const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();
export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export function validatePassword(password) {
  const value = String(password ?? "");
  if (value.length < 6) return "Password must be at least 6 characters.";
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) return "Password must include uppercase, lowercase, and numeric characters.";
  return "";
}

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

function apiKeyEncryptionMaster() {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("API_KEY_ENCRYPTION_SECRET must be configured in production.");
  return crypto.createHash("sha256").update(secret ?? "local-dev-secret").digest();
}

export function encryptSecret(secret) {
  const master = apiKeyEncryptionMaster();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(value) {
  const [ivText, tagText, encryptedText, ...extra] = String(value ?? "").split(".");
  if (!ivText || !tagText || encryptedText === undefined || extra.length) throw new Error("Stored API key is invalid.");
  try {
    const master = apiKeyEncryptionMaster();
    const decipher = crypto.createDecipheriv("aes-256-gcm", master, Buffer.from(ivText, "base64"));
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored API key could not be decrypted.");
  }
}
