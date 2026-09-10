/*
  Optional Firebase customer-account adapter.

  It uses Firebase's documented HTTPS APIs so the player stays dependency-free
  at build time. The Firebase web API key is a public client identifier; never
  put service-account credentials in this file or in web-config.js.
*/
(function installCustomerAuth(global) {
  const config = global.STB_PLAY_CONFIG || {};
  const firebase = config.firebase || {};
  const customer = config.customer || {};
  const enabled = Boolean(config.customerLoginEnabled);
  const configured = Boolean(firebase.apiKey && firebase.projectId);
  const sessionKey = "stbPlayFirebaseSession";
  let session = null;

  function readSession() {
    try {
      const stored = JSON.parse(localStorage.getItem(sessionKey) || "null");
      if (stored?.idToken && stored?.refreshToken && stored?.userId) return stored;
    } catch {}
    return null;
  }

  function saveSession(value) {
    session = value;
    try { localStorage.setItem(sessionKey, JSON.stringify(value)); } catch {}
    return value;
  }

  function clearSession() {
    session = null;
    try { localStorage.removeItem(sessionKey); } catch {}
  }

  function authError(payload, fallback) {
    const code = String(payload?.error?.message || "");
    const messages = {
      INVALID_LOGIN_CREDENTIALS: "The email or password is incorrect.",
      INVALID_PASSWORD: "The email or password is incorrect.",
      EMAIL_NOT_FOUND: "The email or password is incorrect.",
      USER_DISABLED: "This customer account is disabled.",
      TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Try again later.",
    };
    const error = new Error(messages[code] || fallback || "Customer sign-in failed.");
    error.code = code;
    return error;
  }

  async function postIdentity(endpoint, body) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(firebase.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw authError(payload, "Customer sign-in service is unavailable.");
    return payload;
  }

  async function refreshSession() {
    if (!session?.refreshToken) return null;
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebase.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.id_token) {
      clearSession();
      return null;
    }
    return saveSession({
      idToken: payload.id_token,
      refreshToken: payload.refresh_token || session.refreshToken,
      userId: payload.user_id || session.userId,
      email: session.email || "",
      expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
    });
  }

  async function ensureSession() {
    if (!enabled || !configured) return null;
    session = readSession();
    if (!session) return null;
    if (Number(session.expiresAt || 0) > Date.now() + 60_000) return session;
    return refreshSession();
  }

  function decodeFirestoreValue(value) {
    if (!value || typeof value !== "object") return null;
    if (Object.hasOwn(value, "stringValue")) return value.stringValue;
    if (Object.hasOwn(value, "integerValue")) return Number(value.integerValue);
    if (Object.hasOwn(value, "doubleValue")) return Number(value.doubleValue);
    if (Object.hasOwn(value, "booleanValue")) return Boolean(value.booleanValue);
    if (Object.hasOwn(value, "timestampValue")) return value.timestampValue;
    if (Object.hasOwn(value, "nullValue")) return null;
    if (value.referenceValue) return value.referenceValue;
    if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
    if (value.mapValue) return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, decodeFirestoreValue(child)])
    );
    return null;
  }

  function profilePath() {
    const template = String(customer.profilePath || config.customerProfilePath || "customers/{uid}");
    return template.replaceAll("{uid}", String(session?.userId || ""));
  }

  function field(profile, names, fallback = "") {
    for (const name of names) {
      const value = profile?.[name];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return fallback;
  }

  function parseCustomerDate(value) {
    if (typeof value === "number" || /^\d+$/.test(String(value || "").trim())) {
      const number = Number(value);
      return new Date(number < 10_000_000_000 ? number * 1000 : number);
    }
    return new Date(String(value || ""));
  }

  async function loadProfile() {
    if (!session?.idToken) throw new Error("Please sign in first.");
    const path = profilePath().split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebase.projectId)}/databases/(default)/documents/${path}`, {
      headers: { authorization: `Bearer ${session.idToken}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) throw new Error("Your customer profile is not configured yet.");
      throw new Error("Customer profile could not be loaded.");
    }
    const raw = Object.fromEntries(
      Object.entries(payload.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)])
    );
    const portalObject = raw.portal && typeof raw.portal === "object" ? raw.portal : {};
    const subscriptionObject = raw.subscription && typeof raw.subscription === "object" ? raw.subscription : {};
    const portal = field(raw, ["portalUrl", "server", "serverUrl"]) ||
      field(portalObject, ["url", "portalUrl", "server"]);
    const mac = field(raw, ["mac", "macAddress", "deviceMac"]) ||
      field(portalObject, ["mac", "macAddress", "deviceMac"]);
    const expiryDate = field(raw, ["expiryDate", "expiry", "expiresAt", "expireDate", "validUntil"],
      field(subscriptionObject, ["expiryDate", "expiry", "expiresAt"], null));
    const unlimited = Boolean(raw.unlimited) || ["0", "never", "unlimited", "infinite"].includes(String(expiryDate || "").trim().toLowerCase());
    const expiry = expiryDate && !unlimited ? parseCustomerDate(expiryDate) : null;
    if (expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) {
      throw new Error("This customer subscription has expired.");
    }
    if (!portal || !mac) throw new Error("Your customer profile has no portal server or MAC address.");
    return {
      nickname: String(field(raw, ["nickname", "portalName", "name"], "Customer Portal")),
      portalUrl: String(portal).trim(),
      mac: String(mac).trim().toUpperCase(),
      subscription: {
        plan: String(field(raw, ["plan", "package", "tariff"], field(subscriptionObject, ["plan", "package"], "Customer subscription"))),
        status: String(field(raw, ["status", "state"], field(subscriptionObject, ["status", "state"], "Active"))),
        expiryDate: unlimited ? null : (expiry && !Number.isNaN(expiry.getTime()) ? expiry.toISOString() : String(expiryDate || "")),
        unlimited,
      },
      raw,
    };
  }

  async function signIn(email, password) {
    if (!enabled) throw new Error("Customer login is disabled for this deployment.");
    if (!configured) throw new Error("Firebase customer login is not configured yet.");
    const payload = await postIdentity("accounts:signInWithPassword", {
      email: String(email || "").trim(),
      password: String(password || ""),
      returnSecureToken: true,
    });
    return saveSession({
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      userId: payload.localId,
      email: payload.email || String(email || "").trim(),
      expiresAt: Date.now() + Math.max(60, Number(payload.expiresIn) || 3600) * 1000,
    });
  }

  async function signOut() {
    clearSession();
    try {
      for (const key of ["stbPlayWebPortals", "netplusPortalUrl", "netplusMac", "stbPlayWebSubscription"]) localStorage.removeItem(key);
    } catch {}
  }

  const ready = ensureSession();
  global.STB_PLAY_CUSTOMER = Object.freeze({
    enabled,
    configured,
    ready,
    get session() { return session; },
    signIn,
    signOut,
    loadProfile,
  });
})(window);
