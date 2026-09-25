/**
 * App Store Connect REST client: the same key pair `npm run archive` already
 * authenticates with, signed here rather than handed to altool.
 *
 * Credentials come from .env.archive (ASC_KEY_ID, ASC_ISSUER_ID and the
 * directory holding AuthKey_<id>.p8). Nothing is written to disk and the token
 * lives 15 minutes, which is the ceiling Apple accepts.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://api.appstoreconnect.apple.com";

export function ascEnv(root) {
  const file = path.join(root, ".env.archive");
  if (!fs.existsSync(file)) throw new Error(`Missing ${file} (ASC_KEY_ID, ASC_ISSUER_ID, API_PRIVATE_KEYS_DIR)`);
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  const missing = ["ASC_KEY_ID", "ASC_ISSUER_ID", "API_PRIVATE_KEYS_DIR"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`${file} is missing ${missing.join(", ")}`);
  const keyPath = path.join(env.API_PRIVATE_KEYS_DIR, `AuthKey_${env.ASC_KEY_ID}.p8`);
  if (!fs.existsSync(keyPath)) throw new Error(`No private key at ${keyPath}`);
  return { ...env, keyPath };
}

/** Apple rejects any token living past 20 minutes (probed: 20 -> 200, 21 -> 401). */
const TOKEN_LIFE_S = 20 * 60;

/** ES256, the only algorithm App Store Connect accepts. */
export function token(env) {
  const header = { alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: env.ASC_ISSUER_ID, iat: now, exp: now + TOKEN_LIFE_S, aud: "appstoreconnect-v1" };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signing = `${b64(header)}.${b64(payload)}`;
  const der = crypto.sign("sha256", Buffer.from(signing), {
    key: fs.readFileSync(env.keyPath, "utf8"),
    dsaEncoding: "ieee-p1363",
  });
  return `${signing}.${der.toString("base64url")}`;
}

const RETRIES = 3;

/**
 * Retries network drops, 429 and 5xx up to RETRIES times, backing off 5s, 10s, 20s.
 * POST is never retried: a lost response may still have created the resource.
 */
async function fetchWithRetry(url, makeInit) {
  for (let attempt = 0; ; attempt++) {
    const init = makeInit();
    let res;
    let error;
    try {
      res = await fetch(url, init);
    } catch (e) {
      error = e;
    }
    const retryable = error || res.status === 429 || res.status >= 500;
    if (!retryable || init.method === "POST" || attempt === RETRIES) {
      if (error) throw error;
      return res;
    }
    const delay = 5000 * 2 ** attempt;
    const reason = error ? (error.cause?.code ?? error.message) : `HTTP ${res.status}`;
    console.error(`  ↻ ${init.method} ${new URL(url).pathname}: ${reason}, retry ${attempt + 1}/${RETRIES} in ${delay / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export function client(env) {
  // Every attempt asks for the bearer, so a retry after a slow upload never carries a stale one.
  let jwt;
  let jwtExpires = 0;
  function bearer() {
    if (Date.now() > jwtExpires - 3 * 60 * 1000) {
      jwt = token(env);
      jwtExpires = Date.now() + TOKEN_LIFE_S * 1000;
    }
    return jwt;
  }
  async function call(method, endpoint, body, extraHeaders) {
    const url = endpoint.startsWith("http") ? endpoint : `${BASE}${endpoint}`;
    const res = await fetchWithRetry(url, () => ({
      method,
      headers: {
        Authorization: `Bearer ${bearer()}`,
        ...(body && !(body instanceof Buffer) ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
    }));
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      if (!res.ok) throw new Error(`${method} ${endpoint} -> HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    if (!res.ok) {
      // Apple's errors carry the reason in detail; surfacing the status alone
      // turns a wrong display type into "HTTP 409" and a long afternoon.
      let detail = text;
      try {
        detail =
          JSON.parse(text)
            .errors?.map((e) => `${e.title}: ${e.detail}`)
            .join("; ") ?? text;
      } catch {
        /* not JSON */
      }
      throw new Error(`${method} ${endpoint} -> HTTP ${res.status}: ${detail}`);
    }
    return text ? JSON.parse(text) : null;
  }
  return {
    get: (endpoint) => call("GET", endpoint),
    post: (endpoint, body) => call("POST", endpoint, body),
    patch: (endpoint, body) => call("PATCH", endpoint, body),
    delete: (endpoint) => call("DELETE", endpoint),
    /** One upload operation of a reserved asset, verbatim from Apple's plan. */
    async put(operation, slice) {
      const headers = Object.fromEntries((operation.requestHeaders ?? []).map((h) => [h.name, h.value]));
      const res = await fetchWithRetry(operation.url, () => ({ method: operation.method, headers, body: slice }));
      if (!res.ok) throw new Error(`upload part -> HTTP ${res.status}`);
    },
  };
}

export function md5(file) {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}
