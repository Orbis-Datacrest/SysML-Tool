import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { keepFocusInDialog, trapTabKey } from "./dialogFocus.js";

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

registerMfe("auth-session", (element, { state, api, bus }) => {
  let mode = "login";
  let modalOpen = false;
  let email = "";
  let password = "";
  let passwordConfirmation = "";
  let message = "";
  let messageKind = "error";
  let devCode = "";
  let logoutConfirmationOpen = false;
  let restoreFocusTo = null;
  let releaseModalFocus = () => {};

  const titles = { login: "Log in", signup: "Create your account", signupVerify: "Verify your email", forgot: "Forgot password", resetVerify: "Verify and reset password" };
  const description = () => ({
    login: "Use the email and password for your verified account.",
    signup: "Choose your password, then verify the code sent to your email.",
    signupVerify: `Enter the six-digit verification code sent to ${email}.`,
    forgot: "Enter the email for your verified account to receive a reset code.",
    resetVerify: `Enter the code sent to ${email}, then choose a new password.`
  })[mode];

  function setMode(nextMode) {
    mode = nextMode;
    message = "";
    messageKind = "error";
    devCode = "";
    password = "";
    passwordConfirmation = "";
    render();
  }

  function showError(error) {
    const detail = error?.message ?? String(error);
    message = detail === "Authentication endpoint not found"
      ? "The authentication server is out of date. Restart the development server, then try again."
      : detail;
    messageKind = "error";
    devCode = "";
    render();
  }

  function completeLogin(result) {
    modalOpen = false;
    message = "";
    devCode = "";
    bus.emit("auth:login", result);
    bus.emit("toast", `Signed in as ${result.user.email}`);
  }

  function authForm() {
    if (mode === "login") return `
      <form id="login-form" novalidate>
        <label for="login-email">Email address</label><input id="login-email" type="email" value="${escapeHtml(email)}" autocomplete="email" required>
        <label for="login-password">Password</label><input id="login-password" type="password" autocomplete="current-password" required>
        <button class="primary" type="submit">Log In</button>
      </form>
      <button id="forgot-password" class="auth-link" type="button">Forgot Password?</button>
      <p class="auth-switch">New to SysML Studio? <button id="switch-signup" class="auth-link" type="button">Sign Up</button></p>`;
    if (mode === "signup") return `
      <form id="signup-form" novalidate>
        <label for="signup-email">Email address</label><input id="signup-email" type="email" value="${escapeHtml(email)}" autocomplete="email" required>
        <label for="signup-password">Password</label><input id="signup-password" type="password" autocomplete="new-password" aria-describedby="password-rules" required>
        <small id="password-rules" class="password-rules">At least 10 characters with uppercase, lowercase, and a number.</small>
        <label for="signup-confirm">Confirm password</label><input id="signup-confirm" type="password" autocomplete="new-password" required>
        <button class="primary" type="submit">Send Verification Code</button>
      </form>
      <p class="auth-switch">Already registered? <button id="switch-login" class="auth-link" type="button">Log In</button></p>`;
    if (mode === "signupVerify") return `
      <form id="signup-verify-form" novalidate>
        <label for="signup-code">Verification code</label><input id="signup-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code" required>
        <button class="primary" type="submit">Verify and Create Account</button>
      </form>
      <button id="restart-signup" class="auth-link" type="button">Change email or password</button>`;
    if (mode === "forgot") return `
      <form id="forgot-form" novalidate>
        <label for="forgot-email">Email address</label><input id="forgot-email" type="email" value="${escapeHtml(email)}" autocomplete="email" required>
        <button class="primary" type="submit">Send Reset Code</button>
      </form>
      <button id="back-login" class="auth-link" type="button">Back to Log In</button>`;
    return `
      <form id="reset-form" novalidate>
        <label for="reset-code">Reset code</label><input id="reset-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code" required>
        <label for="reset-password">New password</label><input id="reset-password" type="password" autocomplete="new-password" aria-describedby="reset-password-rules" required>
        <small id="reset-password-rules" class="password-rules">At least 10 characters with uppercase, lowercase, and a number.</small>
        <label for="reset-confirm">Confirm new password</label><input id="reset-confirm" type="password" autocomplete="new-password" required>
        <button class="primary" type="submit">Verify and Reset Password</button>
      </form>
      <button id="restart-reset" class="auth-link" type="button">Request another code</button>`;
  }

  function bindDialog() {
    const dialog = element.querySelector(".auth-modal");
    if (!dialog) return;
    document.documentElement.classList.add("auth-modal-open");
    const containFocus = (event) => keepFocusInDialog(event, dialog);
    document.addEventListener("focusin", containFocus, true);
    releaseModalFocus = () => {
      document.documentElement.classList.remove("auth-modal-open");
      document.removeEventListener("focusin", containFocus, true);
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); return; }
      trapTabKey(event, dialog);
    });
    requestAnimationFrame(() => dialog.querySelector("input, button")?.focus());

    element.querySelector("#switch-signup")?.addEventListener("click", () => setMode("signup"));
    element.querySelector("#switch-login")?.addEventListener("click", () => setMode("login"));
    element.querySelector("#forgot-password")?.addEventListener("click", () => setMode("forgot"));
    element.querySelector("#back-login")?.addEventListener("click", () => setMode("login"));
    element.querySelector("#restart-signup")?.addEventListener("click", () => setMode("signup"));
    element.querySelector("#restart-reset")?.addEventListener("click", () => setMode("forgot"));

    element.querySelector("#login-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      email = form.querySelector("#login-email").value.trim();
      if (!form.reportValidity()) return;
      try { completeLogin(await api.request("/api/auth/password-login", { method: "POST", body: JSON.stringify({ email, password: form.querySelector("#login-password").value }) })); }
      catch (error) { showError(error); }
    });

    element.querySelector("#signup-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      email = form.querySelector("#signup-email").value.trim();
      password = form.querySelector("#signup-password").value;
      passwordConfirmation = form.querySelector("#signup-confirm").value;
      if (!form.reportValidity()) return;
      if (password !== passwordConfirmation) { showError(new Error("Password confirmation does not match.")); return; }
      try {
        const result = await api.request("/api/auth/signup/request", { method: "POST", body: JSON.stringify({ email, password, passwordConfirmation }) });
        mode = "signupVerify"; message = "Verification code sent. It expires in 10 minutes."; messageKind = "success"; devCode = result.dev_code ?? ""; render();
      } catch (error) { showError(error); }
    });

    element.querySelector("#signup-verify-form")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
      try { completeLogin(await api.request("/api/auth/signup/verify", { method: "POST", body: JSON.stringify({ email, code: form.querySelector("#signup-code").value }) })); }
      catch (error) { showError(error); }
    });

    element.querySelector("#forgot-form")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.currentTarget; email = form.querySelector("#forgot-email").value.trim(); if (!form.reportValidity()) return;
      try {
        const result = await api.request("/api/auth/request-password-reset", { method: "POST", body: JSON.stringify({ email }) });
        mode = "resetVerify"; message = result.message; messageKind = "success"; devCode = result.dev_code ?? ""; render();
      } catch (error) { showError(error); }
    });

    element.querySelector("#reset-form")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.currentTarget;
      password = form.querySelector("#reset-password").value; passwordConfirmation = form.querySelector("#reset-confirm").value;
      if (!form.reportValidity()) return;
      if (password !== passwordConfirmation) { showError(new Error("Password confirmation does not match.")); return; }
      try {
        await api.request("/api/auth/confirm-password-reset", { method: "POST", body: JSON.stringify({ email, code: form.querySelector("#reset-code").value, password, passwordConfirmation }) });
        mode = "login"; message = "Password reset complete. Log in with your new password."; messageKind = "success"; devCode = ""; password = ""; passwordConfirmation = ""; render();
      } catch (error) { showError(error); }
    });

    element.querySelector("#use-dev-code")?.addEventListener("click", () => {
      const input = element.querySelector("#signup-code, #reset-code");
      if (input) { input.value = devCode; input.focus(); }
    });
  }

  function renderSignedOut() {
    element.innerHTML = `<div class="auth-entry-actions"><button id="open-login" class="primary" type="button">Login</button></div>
      ${modalOpen ? `<div class="auth-modal-backdrop" role="presentation"><section class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-description" tabindex="-1">
        <button id="close-auth" class="auth-close" type="button" aria-label="Close authentication">×</button>
        <aside class="auth-brand-panel" aria-hidden="true">
          <div class="auth-brand-mark"><span>S</span><strong>SysML Studio</strong></div>
          <div class="auth-brand-copy"><span>Welcome</span><h3>Design systems.<br><strong>Shape the future.</strong></h3><p>Model, validate, and collaborate in one focused workspace.</p></div>
          <div class="auth-brand-art" aria-label="Connected SysML system model">
            <span class="auth-model-node auth-model-node-system">System</span>
            <span class="auth-model-link auth-model-link-left"></span>
            <span class="auth-model-link auth-model-link-right"></span>
            <span class="auth-model-node auth-model-node-sensor">Sensor</span>
            <span class="auth-model-node auth-model-node-control">Control</span>
          </div>
        </aside>
        <main class="auth-form-panel">
          <header class="auth-modal-header"><span class="auth-eyebrow">Secure workspace</span><h2 id="auth-title">${titles[mode]}</h2><p id="auth-description">${escapeHtml(description())}</p></header>
          <div class="auth-modal-body">${authForm()}${message ? `<p class="auth-message ${messageKind}" role="${messageKind === "error" ? "alert" : "status"}">${escapeHtml(message)}</p>` : ""}${devCode ? `<button id="use-dev-code" class="auth-dev-code" type="button">Use local development code ${devCode}</button>` : ""}</div>
        </main>
      </section></div>` : ""}`;
    element.querySelector("#open-login").addEventListener("click", (event) => { restoreFocusTo = event.currentTarget; mode = "login"; modalOpen = true; message = ""; render(); });
    element.querySelector("#close-auth")?.addEventListener("click", () => {
      modalOpen = false;
      message = "";
      render();
      (restoreFocusTo?.isConnected ? restoreFocusTo : element.querySelector("#open-login"))?.focus();
      restoreFocusTo = null;
    });
    bindDialog();
  }

  function renderSignedIn() {
    element.innerHTML = `${state.view === "dashboard"
      ? `<div class="auth-entry-actions"><button id="logout" class="primary" type="button">Logout</button></div>`
      : `<div class="auth-user"><span class="auth-avatar">${escapeHtml(state.user.email.slice(0, 1).toUpperCase())}</span><span class="auth-email" title="${escapeHtml(state.user.email)}">${escapeHtml(state.user.email)}</span></div>`}
      ${logoutConfirmationOpen ? `<div class="logout-confirmation-backdrop"><section class="logout-confirmation" role="dialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description" tabindex="-1"><div class="logout-confirmation-icon" aria-hidden="true">!</div><div class="logout-confirmation-copy"><h2 id="logout-title">Log out?</h2><p id="logout-description">You will need to log in again to access your projects.</p></div><div class="logout-confirmation-actions"><button id="cancel-logout" type="button">Cancel</button><button id="confirm-logout" class="danger" type="button">Log out</button></div></section></div>` : ""}`;
    const closeConfirmation = () => { logoutConfirmationOpen = false; render(); element.querySelector("#logout")?.focus(); };
    element.querySelector("#logout")?.addEventListener("click", () => { logoutConfirmationOpen = true; render(); });
    const dialog = element.querySelector(".logout-confirmation");
    if (!dialog) return;
    element.querySelector("#cancel-logout").addEventListener("click", closeConfirmation);
    element.querySelector("#confirm-logout").addEventListener("click", () => { logoutConfirmationOpen = false; bus.emit("auth:logout"); });
    element.querySelector(".logout-confirmation-backdrop").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeConfirmation(); });
    dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeConfirmation(); return; } trapTabKey(event, dialog); });
    element.querySelector("#cancel-logout").focus();
  }

  function render() {
    releaseModalFocus();
    releaseModalFocus = () => {};
    if (state.user) renderSignedIn(); else renderSignedOut();
  }
  const stopAuthChanges = bus.on("auth:changed", render);
  const stopAuthOpen = bus.on("auth:open", (requestedMode = "login") => {
    if (state.user) return;
    restoreFocusTo = document.activeElement;
    mode = requestedMode === "signup" ? "signup" : "login";
    modalOpen = true;
    message = "";
    render();
  });
  render();
  return () => { releaseModalFocus(); stopAuthChanges(); stopAuthOpen(); };
});
