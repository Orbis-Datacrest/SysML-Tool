export function createAuthRouter({
  accessTokenDays, addDays, authContext, body, createId, createSession, db, ensureUserWorkspace,
  getUserByEmail, getUserById, hashPassword, isValidEmail, makeToken, makeVerificationCode,
  normalizeEmail, now, publicUser, rateLimit, send, sendPasswordResetEmail, sendVerificationEmail,
  tenantIdForEmail, upsertUser, validatePassword, verifyPassword
}) {
return async function handleAuthRoute(req, res, pathname) {

  if (pathname === "/api/auth/request-code" && req.method === "POST") {
    const limited = rateLimit(req, "auth-code");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) return send(res, 422, { error: "Enter a valid email address." });
    const wantsPassword = input.password !== undefined;
    let passwordCredential = {};
    if (wantsPassword) {
      const passwordError = validatePassword(input.password);
      if (passwordError) return send(res, 422, { error: passwordError });
      const { salt, hash } = hashPassword(input.password);
      passwordCredential = { password_salt: salt, password_hash: hash };
    }
    db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").run(now());
    const challenge = { id: createId("challenge"), email, code: makeVerificationCode(), purpose: wantsPassword ? "password_signup" : "email_login", expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), created_at: now(), ...passwordCredential };
    db.prepare(`
      INSERT INTO auth_challenges (id, email, code, purpose, password_hash, password_salt, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(challenge.id, challenge.email, challenge.code, challenge.purpose, challenge.password_hash ?? null, challenge.password_salt ?? null, challenge.expires_at, challenge.created_at);
    await sendVerificationEmail(email, challenge.code);
    return send(res, 200, { ok: true, message: "Verification code sent.", dev_code: process.env.NODE_ENV === "production" ? undefined : challenge.code });
  }

  if (pathname === "/api/auth/verify" && req.method === "POST") {
    const limited = rateLimit(req, "auth-verify");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const code = String(input.code ?? "").trim();
    const challenge = db.prepare("SELECT * FROM auth_challenges WHERE email = ? AND code = ? AND expires_at > ?").get(email, code, now());
    if (!challenge) return send(res, 401, { error: "Invalid or expired verification code." });

    const timestamp = now();
    let user = getUserByEmail(email);
    if (!user) {
      const invite = db.prepare("SELECT * FROM tenant_members WHERE email = ? ORDER BY created_at LIMIT 1").get(email);
      user = {
        id: createId("user"),
        email,
        tenant_id: invite?.tenant_id ?? tenantIdForEmail(email),
        role: invite?.role ?? "Owner",
        created_at: timestamp,
        verified_at: timestamp,
        password_hash: challenge.password_hash,
        password_salt: challenge.password_salt
      };
    } else {
      user = { ...user, verified_at: timestamp, password_hash: challenge.password_hash ?? user.password_hash, password_salt: challenge.password_salt ?? user.password_salt };
    }
    upsertUser(user);
    db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(challenge.id);
    ensureUserWorkspace(user);
    const session = createSession(user);
    return send(res, 200, { token: session.access_token, refreshToken: session.refresh_token, expires_at: session.expires_at, user: publicUser(user) });
  }

  if (pathname === "/api/auth/password-login" && req.method === "POST") {
    const limited = rateLimit(req, "password-login");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const user = getUserByEmail(input.email);
    if (!user || !verifyPassword(input.password ?? "", user)) return send(res, 401, { error: "Email or password is incorrect." });
    ensureUserWorkspace(user);
    const session = createSession(user);
    return send(res, 200, { token: session.access_token, refreshToken: session.refresh_token, expires_at: session.expires_at, user: publicUser(user) });
  }

  if (pathname === "/api/auth/request-password-reset" && req.method === "POST") {
    const limited = rateLimit(req, "password-reset");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const passwordError = validatePassword(input.password);
    if (!isValidEmail(email)) return send(res, 422, { error: "Enter a valid email address." });
    if (passwordError) return send(res, 422, { error: passwordError });
    const user = getUserByEmail(email);
    if (user) {
      const { salt, hash } = hashPassword(input.password);
      const reset = { id: createId("reset"), email, code: makeVerificationCode(), password_hash: hash, password_salt: salt, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), created_at: now() };
      db.prepare("INSERT INTO password_resets (id, email, code, password_hash, password_salt, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(reset.id, reset.email, reset.code, reset.password_hash, reset.password_salt, reset.expires_at, reset.created_at);
      await sendPasswordResetEmail(email, reset.code);
    }
    return send(res, 200, { ok: true, message: "If that email exists, a reset code has been sent." });
  }

  if (pathname === "/api/auth/confirm-password-reset" && req.method === "POST") {
    const limited = rateLimit(req, "password-reset-confirm");
    if (limited) return send(res, 429, limited, { "retry-after": String(limited.retryAfter) });
    const input = await body(req);
    const email = normalizeEmail(input.email);
    const code = String(input.code ?? "").trim();
    const reset = db.prepare("SELECT * FROM password_resets WHERE email = ? AND code = ? AND expires_at > ?").get(email, code, now());
    if (!reset) return send(res, 401, { error: "Invalid or expired reset code." });
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE email = ?").run(reset.password_hash, reset.password_salt, email);
    db.prepare("DELETE FROM password_resets WHERE id = ?").run(reset.id);
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/auth/refresh" && req.method === "POST") {
    const input = await body(req);
    const refreshToken = String(input.refreshToken ?? "");
    const session = db.prepare("SELECT * FROM sessions WHERE refresh_token = ? AND revoked_at IS NULL").get(refreshToken);
    if (!session || new Date(session.refresh_expires_at) <= new Date()) return send(res, 401, { error: "Refresh session expired." });
    const accessToken = makeToken();
    const expiresAt = addDays(accessTokenDays);
    db.prepare("UPDATE sessions SET access_token = ?, expires_at = ? WHERE id = ?").run(accessToken, expiresAt, session.id);
    const user = getUserById(session.user_id);
    return send(res, 200, { token: accessToken, refreshToken, expires_at: expiresAt, user: publicUser(user) });
  }

  if (pathname === "/api/auth/me" && req.method === "GET") {
    const { user } = authContext(req);
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE access_token = ?").run(now(), token);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "Authentication endpoint not found" });
};
}
