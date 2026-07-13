import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { trapTabKey } from "./dialogFocus.js";

registerMfe("auth-session", (element, { state, api, bus }) => {
  let mode = "email";
  let email = "";
  let message = "";
  let devCode = "";
  let modalOpen = false;
  let logoutConfirmationOpen = false;

  function modalTitle() {
    if (mode === "reset") return "Reset password";
    if (mode === "resetVerify") return "Confirm reset code";
    if (mode === "password") return "Login with password";
    if (mode === "verify") return "Confirm your email";
    return "Login to SysML Studio";
  }

  function modalDescription() {
    if (mode === "reset") return "Enter your email and a new password. If the account exists, we will send a reset code.";
    if (mode === "resetVerify") return `Enter the reset code sent to ${email}.`;
    if (mode === "password") return "Use an existing email and password, or create a password account after email verification.";
    if (mode === "verify") return `We sent a 6-digit code to ${email}.`;
    return "Enter your email address. If it is new, we will create your private workspace after verification.";
  }

  function renderSignedOut() {
    element.innerHTML = `
      <button id="open-login" class="primary">Login</button>
      ${modalOpen ? `
        <div class="auth-modal-backdrop" role="presentation">
          <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button id="close-login" class="auth-close" title="Close login">×</button>
            <div class="auth-modal-header">
              <span class="auth-modal-icon">S</span>
              <div>
                <h2 id="auth-title">${modalTitle()}</h2>
                <p>${modalDescription()}</p>
              </div>
            </div>
            <div class="auth-modal-body">
              ${mode !== "verify" && mode !== "resetVerify" ? `
                <div class="auth-tabs">
                  <button id="email-code-tab" class="${mode === "email" ? "active" : ""}">Email code</button>
                  <button id="password-tab" class="${mode === "password" ? "active" : ""}">Password</button>
                </div>
              ` : ""}
              ${mode === "email" ? `
                <label for="login-email">Email address</label>
                <input id="login-email" type="email" placeholder="you@example.com" autocomplete="email" />
                <button id="send-code" class="primary">Send verification code</button>
              ` : ""}
              ${mode === "password" ? `
                <label for="password-email">Email address</label>
                <input id="password-email" type="email" placeholder="you@example.com" autocomplete="email" />
                <label for="password-input">Password</label>
                <input id="password-input" type="password" placeholder="At least 8 characters" autocomplete="current-password" />
                <button id="password-login" class="primary">Login with password</button>
                <button id="password-create">Create account with this password</button>
                <button id="password-reset">Forgot password?</button>
              ` : ""}
              ${mode === "reset" ? `
                <label for="reset-email">Email address</label>
                <input id="reset-email" type="email" placeholder="you@example.com" autocomplete="email" />
                <label for="reset-password">New password</label>
                <input id="reset-password" type="password" placeholder="At least 8 characters" autocomplete="new-password" />
                <button id="request-reset" class="primary">Send reset code</button>
                <button id="back-password">Back to password login</button>
              ` : ""}
              ${mode === "resetVerify" ? `
                <label for="reset-code">Reset code</label>
                <input id="reset-code" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code" />
                <button id="confirm-reset" class="primary">Update password</button>
                <button id="back-reset">Request a new code</button>
              ` : ""}
              ${mode === "verify" ? `
                <label for="verify-code">Verification code</label>
                <input id="verify-code" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code" />
                <button id="verify-login" class="primary">Verify and login</button>
                <button id="change-email">Use a different email</button>
              ` : ""}
              ${message ? `<p class="auth-message">${message}</p>` : ""}
              ${devCode ? `<button id="use-dev-code" class="auth-dev-code">Use dev code ${devCode}</button>` : ""}
            </div>
          </div>
        </div>
      ` : ""}
    `;

    element.querySelector("#open-login").addEventListener("click", () => {
      modalOpen = true;
      renderSignedOut();
    });

    element.querySelector("#close-login")?.addEventListener("click", () => {
      modalOpen = false;
      message = "";
      renderSignedOut();
    });

    element.querySelector(".auth-modal-backdrop")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        modalOpen = false;
        message = "";
        renderSignedOut();
      }
    });

    if (!modalOpen) return;

    element.querySelector("#email-code-tab")?.addEventListener("click", () => {
      mode = "email";
      message = "";
      devCode = "";
      renderSignedOut();
    });

    element.querySelector("#password-tab")?.addEventListener("click", () => {
      mode = "password";
      message = "";
      devCode = "";
      renderSignedOut();
    });

    if (mode === "email") {
      const emailInput = element.querySelector("#login-email");
      emailInput.value = email;
      element.querySelector("#send-code").addEventListener("click", async () => {
        try {
          email = emailInput.value.trim();
          const result = await api.request("/api/auth/request-code", {
            method: "POST",
            body: JSON.stringify({ email })
          });
          mode = "verify";
          message = "Verification code sent. Check your email. In local development, check the server console or .data/emailOutbox.json.";
          devCode = result.dev_code ?? "";
        } catch (error) {
          message = error.message;
          devCode = "";
        }
        renderSignedOut();
      });
      emailInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") element.querySelector("#send-code").click();
      });
      return;
    }

    if (mode === "password") {
      const emailInput = element.querySelector("#password-email");
      const passwordInput = element.querySelector("#password-input");
      emailInput.value = email;
      element.querySelector("#password-login").addEventListener("click", async () => {
        try {
          email = emailInput.value.trim();
          const result = await api.request("/api/auth/password-login", {
            method: "POST",
            body: JSON.stringify({ email, password: passwordInput.value })
          });
          modalOpen = false;
          message = "";
          devCode = "";
          bus.emit("auth:login", result);
          bus.emit("toast", `Signed in as ${result.user.email}`);
        } catch (error) {
          message = error.message;
          devCode = "";
          renderSignedOut();
        }
      });
      element.querySelector("#password-create").addEventListener("click", async () => {
        try {
          email = emailInput.value.trim();
          const result = await api.request("/api/auth/request-code", {
            method: "POST",
            body: JSON.stringify({ email, password: passwordInput.value })
          });
          mode = "verify";
          message = "Verification code sent. Enter it to create or update this email/password account.";
          devCode = result.dev_code ?? "";
        } catch (error) {
          message = error.message;
          devCode = "";
        }
        renderSignedOut();
      });
      element.querySelector("#password-reset").addEventListener("click", () => {
        mode = "reset";
        message = "";
        devCode = "";
        renderSignedOut();
      });
      passwordInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") element.querySelector("#password-login").click();
      });
      emailInput.focus();
      return;
    }

    if (mode === "reset") {
      const emailInput = element.querySelector("#reset-email");
      const passwordInput = element.querySelector("#reset-password");
      emailInput.value = email;
      element.querySelector("#request-reset").addEventListener("click", async () => {
        try {
          email = emailInput.value.trim();
          await api.request("/api/auth/request-password-reset", {
            method: "POST",
            body: JSON.stringify({ email, password: passwordInput.value })
          });
          mode = "resetVerify";
          message = "If the account exists, a reset code was sent. In local development, check the server console or .data/emailOutbox.json.";
        } catch (error) {
          message = error.message;
        }
        renderSignedOut();
      });
      element.querySelector("#back-password").addEventListener("click", () => {
        mode = "password";
        message = "";
        renderSignedOut();
      });
      emailInput.focus();
      return;
    }

    if (mode === "resetVerify") {
      const codeInput = element.querySelector("#reset-code");
      element.querySelector("#confirm-reset").addEventListener("click", async () => {
        try {
          await api.request("/api/auth/confirm-password-reset", {
            method: "POST",
            body: JSON.stringify({ email, code: codeInput.value })
          });
          mode = "password";
          message = "Password updated. You can login now.";
        } catch (error) {
          message = error.message;
        }
        renderSignedOut();
      });
      element.querySelector("#back-reset").addEventListener("click", () => {
        mode = "reset";
        message = "";
        renderSignedOut();
      });
      codeInput.focus();
      return;
    }

    const codeInput = element.querySelector("#verify-code");
    element.querySelector("#verify-login").addEventListener("click", async () => {
      try {
        const result = await api.request("/api/auth/verify", {
          method: "POST",
          body: JSON.stringify({ email, code: codeInput.value })
        });
        modalOpen = false;
        message = "";
        devCode = "";
        bus.emit("auth:login", result);
        bus.emit("toast", `Signed in as ${result.user.email}`);
      } catch (error) {
        message = error.message;
        devCode = "";
        renderSignedOut();
      }
    });
    element.querySelector("#change-email").addEventListener("click", () => {
      mode = "email";
      message = "";
      devCode = "";
      renderSignedOut();
    });
    element.querySelector("#use-dev-code")?.addEventListener("click", () => {
      codeInput.value = devCode;
      element.querySelector("#verify-login").click();
    });
    codeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") element.querySelector("#verify-login").click();
    });
    codeInput.focus();
  }

  function renderSignedIn() {
    element.innerHTML = `
      <div class="auth-user">
        <span class="auth-avatar">${state.user.email.slice(0, 1).toUpperCase()}</span>
        <span class="auth-email" title="${state.user.email}">${state.user.email}</span>
        ${state.view === "dashboard" ? `<button id="logout" title="Logout">Logout</button>` : ""}
      </div>
      ${logoutConfirmationOpen ? `
        <div class="logout-confirmation-backdrop">
          <section class="logout-confirmation" role="dialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description" tabindex="-1">
            <div class="logout-confirmation-icon" aria-hidden="true">!</div>
            <div class="logout-confirmation-copy">
              <h2 id="logout-title">Log out?</h2>
              <p id="logout-description">You will need to sign in again to access your projects.</p>
            </div>
            <div class="logout-confirmation-actions">
              <button id="cancel-logout" type="button">Cancel</button>
              <button id="confirm-logout" class="danger" type="button">Log out</button>
            </div>
          </section>
        </div>
      ` : ""}
    `;

    const restoreLogoutFocus = () => {
      logoutConfirmationOpen = false;
      renderSignedIn();
      // Rendering replaces the original trigger, so restore focus to its new equivalent.
      element.querySelector("#logout")?.focus();
    };

    element.querySelector("#logout")?.addEventListener("click", () => {
      logoutConfirmationOpen = true;
      renderSignedIn();
    });

    const dialog = element.querySelector(".logout-confirmation");
    if (!dialog) return;

    element.querySelector("#cancel-logout").addEventListener("click", restoreLogoutFocus);
    element.querySelector("#confirm-logout").addEventListener("click", () => {
      logoutConfirmationOpen = false;
      renderSignedIn();
      bus.emit("auth:logout");
    });
    element.querySelector(".logout-confirmation-backdrop").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) restoreLogoutFocus();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        restoreLogoutFocus();
        return;
      }
      trapTabKey(event, dialog);
    });
    element.querySelector("#cancel-logout").focus();
  }

  function render() {
    if (state.user) renderSignedIn();
    else renderSignedOut();
  }

  const stopAuthChanges = bus.on("auth:changed", render);
  render();
  return stopAuthChanges;
});
