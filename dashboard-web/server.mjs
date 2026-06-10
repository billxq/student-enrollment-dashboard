import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SERVER_DIR, "..");
const PUBLIC_DIR = path.join(SERVER_DIR, "public");
const AUTH_FILE = path.join(SERVER_DIR, "auth.json");
const DATA_SEALED_FILE = path.join(SERVER_DIR, "data.sealed.json");
const DATA_PLAINTEXT_FILE = path.join(SERVER_DIR, "data.json");
const PORT = Number(process.env.PORT || 4173);
const DATA_PASSPHRASE = process.env.DATA_PASSPHRASE || process.env.DATA_KEY || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
};

const sessions = new Map();
const dataCache = {
  value: null,
  promise: null,
};

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeAuthStore(store) {
  return {
    users: store?.users || {},
    sessions: store?.sessions || {},
  };
}

async function ensureAuthStore() {
  try {
    await fs.access(AUTH_FILE);
  } catch {
    const initial = {
      users: {
        admin: {
          passwordHash: sha256("111111"),
          updatedAt: new Date().toISOString(),
        },
      },
      sessions: {},
    };
    await fs.writeFile(AUTH_FILE, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  }
}

async function readAuthStore() {
  await ensureAuthStore();
  const raw = await fs.readFile(AUTH_FILE, "utf8");
  return normalizeAuthStore(JSON.parse(raw));
}

async function writeAuthStore(store) {
  await fs.writeFile(AUTH_FILE, `${JSON.stringify(normalizeAuthStore(store), null, 2)}\n`, "utf8");
}

async function verifyCredentials(username, password) {
  const store = await readAuthStore();
  const user = store.users?.[username];
  return Boolean(user && user.passwordHash === sha256(password));
}

async function loadSessionsFromStore() {
  sessions.clear();
  const store = await readAuthStore();
  for (const [token, entry] of Object.entries(store.sessions || {})) {
    if (entry?.username) sessions.set(token, entry.username);
  }
}

async function persistSession(token, username) {
  const store = await readAuthStore();
  store.sessions[token] = {
    username,
    createdAt: new Date().toISOString(),
  };
  await writeAuthStore(store);
  sessions.set(token, username);
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function getCurrentUser(req) {
  const token = getBearerToken(req);
  return token ? sessions.get(token) || "" : "";
}

function requireAuth(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "\u672a\u767b\u5f55\u6216\u767b\u5f55\u5df2\u8fc7\u671f" });
    return null;
  }
  return user;
}

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendJson(res, statusCode, data) {
  send(res, statusCode, JSON.stringify(data), "application/json; charset=utf-8");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function decodeSealedData(raw) {
  if (!DATA_PASSPHRASE) {
    throw new Error("\u7f3a\u5c11 DATA_PASSPHRASE \u89e3\u5bc6\u5bc6\u94a5");
  }

  const sealed = JSON.parse(raw);
  if (sealed.version !== 1 || sealed.algorithm !== "aes-256-gcm") {
    throw new Error("\u4e0d\u652f\u6301\u7684\u6570\u636e\u52a0\u5bc6\u683c\u5f0f");
  }

  const salt = Buffer.from(sealed.salt, "base64");
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  const ciphertext = Buffer.from(sealed.ciphertext, "base64");
  const key = crypto.scryptSync(DATA_PASSPHRASE, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}

async function loadData() {
  if (dataCache.promise) return dataCache.promise;

  dataCache.promise = (async () => {
    if (dataCache.value) return dataCache.value;

    try {
      const raw = await fs.readFile(DATA_SEALED_FILE, "utf8");
      const value = decodeSealedData(raw);
      dataCache.value = value;
      return value;
    } catch (error) {
      if (await fileExists(DATA_PLAINTEXT_FILE)) {
        const raw = await fs.readFile(DATA_PLAINTEXT_FILE, "utf8");
        const value = JSON.parse(raw.replace(/^\uFEFF/, ""));
        dataCache.value = value;
        return value;
      }
      throw error;
    }
  })().finally(() => {
    dataCache.promise = null;
  });

  return dataCache.promise;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function changePassword(username, currentPassword, newPassword) {
  const store = await readAuthStore();
  const user = store.users?.[username];
  if (!user) return { ok: false, error: "\u7528\u6237\u4e0d\u5b58\u5728" };
  if (user.passwordHash !== sha256(currentPassword)) return { ok: false, error: "\u5f53\u524d\u5bc6\u7801\u4e0d\u6b63\u786e" };

  store.users[username] = {
    passwordHash: sha256(newPassword),
    updatedAt: new Date().toISOString(),
  };
  store.sessions = store.sessions || {};
  for (const [token, entry] of Object.entries(store.sessions)) {
    if (entry?.username === username) delete store.sessions[token];
  }
  await writeAuthStore(store);

  for (const [token, name] of sessions.entries()) {
    if (name === username) sessions.delete(token);
  }

  return { ok: true };
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const assetRoot = safePath.startsWith("/assets/") ? path.join(ROOT, "assets") : PUBLIC_DIR;
  const relativePath = safePath.startsWith("/assets/") ? safePath.replace(/^\/assets\//, "") : safePath;
  const filePath = path.join(assetRoot, relativePath);
  const normalized = path.normalize(filePath);
  const allowedRoots = [path.normalize(PUBLIC_DIR), path.normalize(path.join(ROOT, "assets"))];

  if (!allowedRoots.some((root) => normalized.startsWith(root))) {
    return send(res, 403, "Forbidden");
  }

  try {
    const content = await fs.readFile(normalized);
    send(res, 200, content, MIME[path.extname(normalized).toLowerCase()] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}

async function main() {
  await ensureAuthStore();
  await loadSessionsFromStore();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/login" && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        if (!username || !password) return sendJson(res, 400, { error: "\u8bf7\u8f93\u5165\u7528\u6237\u540d\u548c\u5bc6\u7801" });
        const ok = await verifyCredentials(username, password);
        if (!ok) return sendJson(res, 401, { error: "\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef" });
        const token = createToken();
        await persistSession(token, username);
        return sendJson(res, 200, { token, username });
      } catch (error) {
        return sendJson(res, 500, { error: String(error?.message || error) });
      }
    }

    if (url.pathname === "/api/me") {
      const username = getCurrentUser(req);
      if (!username) return sendJson(res, 401, { error: "\u672a\u767b\u5f55" });
      return sendJson(res, 200, { username });
    }

    if (url.pathname === "/api/change-password" && req.method === "POST") {
      try {
        const username = requireAuth(req, res);
        if (!username) return;
        const body = await readJsonBody(req);
        const currentPassword = String(body.currentPassword || "");
        const newPassword = String(body.newPassword || "");
        const confirmPassword = String(body.confirmPassword || "");
        if (!currentPassword || !newPassword) {
          return sendJson(res, 400, { error: "\u8bf7\u8f93\u5165\u5f53\u524d\u5bc6\u7801\u548c\u65b0\u5bc6\u7801" });
        }
        if (newPassword.length < 6) {
          return sendJson(res, 400, { error: "\u65b0\u5bc6\u7801\u81f3\u5c116\u4f4d" });
        }
        if (newPassword !== confirmPassword) {
          return sendJson(res, 400, { error: "\u4e24\u6b21\u8f93\u5165\u7684\u65b0\u5bc6\u7801\u4e0d\u4e00\u81f4" });
        }
        const result = await changePassword(username, currentPassword, newPassword);
        if (!result.ok) return sendJson(res, 400, { error: result.error });
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { error: String(error?.message || error) });
      }
    }

    if (url.pathname === "/api/data") {
      const username = requireAuth(req, res);
      if (!username) return;
      try {
        const data = await loadData();
        return sendJson(res, 200, data);
      } catch (error) {
        return sendJson(res, 500, { error: String(error?.message || error) });
      }
    }

    return serveStatic(req, res, url.pathname);
  });

  server.listen(PORT, () => {
    console.log(`\u5b66\u7c4d\u770b\u677f\u5df2\u542f\u52a8\uff1ahttp://localhost:${PORT}`);
  });
}

await main();
