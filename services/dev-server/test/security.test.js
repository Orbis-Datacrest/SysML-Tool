import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, isValidEmail, normalizeEmail, tenantIdForEmail, validatePassword, verifyPassword } from "../src/auth/security.js";

test("authentication primitives normalize and validate credentials", () => {
  assert.equal(normalizeEmail("  Engineer@Example.COM "), "engineer@example.com");
  assert.equal(isValidEmail("engineer@example.com"), true);
  assert.equal(validatePassword("short"), "Password must be at least 6 characters.");
  assert.match(validatePassword("long-enough"), /uppercase, lowercase, and numeric/);
  assert.equal(validatePassword("Long-enough1"), "");
});

test("password hashes verify safely and tenant identifiers are deterministic", () => {
  const password = "engineering-password";
  const credential = hashPassword(password);
  const user = { password_hash: credential.hash, password_salt: credential.salt };

  assert.equal(verifyPassword(password, user), true);
  assert.equal(verifyPassword("incorrect-password", user), false);
  assert.equal(tenantIdForEmail("engineer@example.com"), tenantIdForEmail("engineer@example.com"));
});
