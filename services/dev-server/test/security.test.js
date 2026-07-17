import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret, hashPassword, isValidEmail, normalizeEmail, tenantIdForEmail, validatePassword, verifyPassword } from "../src/auth/security.js";

test("authentication primitives normalize and validate credentials", () => {
  assert.equal(normalizeEmail("  Engineer@Example.COM "), "engineer@example.com");
  assert.equal(isValidEmail("engineer@example.com"), true);
  assert.equal(validatePassword("short"), "Password must be at least 6 characters.");
  assert.match(validatePassword("long-enough"), /uppercase, lowercase, and numeric/);
  assert.equal(validatePassword("Long-enough1"), "");
});

test("tenant API keys round-trip through authenticated encryption", () => {
  const encrypted = encryptSecret("sk-example-secret-value");
  assert.notEqual(encrypted, "sk-example-secret-value");
  assert.equal(decryptSecret(encrypted), "sk-example-secret-value");
  const parts = encrypted.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.throws(() => decryptSecret(parts.join(".")), /could not be decrypted|invalid/);
});

test("password hashes verify safely and tenant identifiers are deterministic", () => {
  const password = "engineering-password";
  const credential = hashPassword(password);
  const user = { password_hash: credential.hash, password_salt: credential.salt };

  assert.equal(verifyPassword(password, user), true);
  assert.equal(verifyPassword("incorrect-password", user), false);
  assert.equal(tenantIdForEmail("engineer@example.com"), tenantIdForEmail("engineer@example.com"));
});
