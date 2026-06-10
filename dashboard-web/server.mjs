import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SERVER_DIR, "..");
const PUBLIC_DIR = path.join(SERVER_DIR, "public");
const AUTH_FILE = path.join(SERVER_DIR, "auth.json");
const DATA_FILE = path.join(SERVER_DIR, "data.json");
const PORT = Number(process.env.PORT || 4173);

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
  key: "",
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
  const normalized = normalizeAuthStore(store);
  await fs.writeFile(AUTH_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
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
    sendJson(res, 401, { error: "未登录或登录已过期" });
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

function isIgnoredDir(name) {
  return ["node_modules", "outputs", ".git", ".codex", "dist"].includes(name);
}

async function walkXlsx(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isIgnoredDir(entry.name)) continue;
      results.push(...(await walkXlsx(path.join(dir, entry.name))));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".xlsx")) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function asPosix(p) {
  return p.split(path.sep).join("/");
}

function inferYearLabel(filePath) {
  const normalized = asPosix(path.relative(ROOT, filePath));
  const folderMatch = normalized.match(/(\d{4})学年度/);
  if (folderMatch) return `${folderMatch[1]}学年度`;
  const nameMatch = path.basename(filePath).match(/^(\d{4})年度\.xlsx$/);
  if (nameMatch) return `${nameMatch[1]}学年度`;
  const anyMatch = normalized.match(/(\d{4})/);
  return anyMatch ? `${anyMatch[1]}学年度` : path.basename(filePath, ".xlsx");
}

function isForeignStudent(idType, studentCategory) {
  const text = `${idType} ${studentCategory}`.toLowerCase();
  return /护照|passport|外国|外籍|港澳|台胞/.test(text);
}

function classifyEthnicity(idType, studentCategory, ethnicity) {
  if (isForeignStudent(idType, studentCategory)) return "外籍";
  if (ethnicity === "汉族") return "汉族";
  if (!ethnicity || ethnicity === "其他") return "其他/未明确";
  return "少数民族";
}

function pickPrimaryRows(values) {
  if (!values.length) return [];

  const headers = values[0].map((h) => String(h ?? "").trim());
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const required = [
    "学生姓名",
    "学生年级",
    "学生班级名称",
    "学生性别",
    "学生当前状态",
    "学生户口省份",
    "学生民族",
    "学生身份证件类型",
    "学生学生类别",
  ];

  if (!required.every((h) => h in idx)) return [];

  const rows = [];
  for (let r = 1; r < values.length; r += 1) {
    const row = values[r];
    const province = String(row[idx["学生户口省份"]] ?? "").trim();
    const ethnicity = String(row[idx["学生民族"]] ?? "").trim();
    const idType = String(row[idx["学生身份证件类型"]] ?? "").trim();
    const studentCategory = String(row[idx["学生学生类别"]] ?? "").trim();
    rows.push({
      name: String(row[idx["学生姓名"]] ?? "").trim(),
      grade: String(row[idx["学生年级"]] ?? "").trim(),
      className: String(row[idx["学生班级名称"]] ?? "").trim(),
      gender: String(row[idx["学生性别"]] ?? "").trim(),
      status: String(row[idx["学生当前状态"]] ?? "").trim(),
      province,
      ethnicity,
      idType,
      studentCategory,
      cityStatus: province === "上海市" ? "本市户籍" : "非本市户籍",
      ethnicityGroup: classifyEthnicity(idType, studentCategory, ethnicity),
    });
  }

  return rows.filter((row) => row.name);
}

async function loadWorkbook(filePath) {
  const { FileBlob, SpreadsheetFile } = await import("@oai/artifact-tool");
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
  const firstSheet = wb.worksheets.getItemAt(0);
  const rows = pickPrimaryRows(firstSheet.getUsedRange().values);
  return {
    yearLabel: inferYearLabel(filePath),
    sourceFile: path.relative(ROOT, filePath).split(path.sep).join("/"),
    sourceName: path.basename(filePath),
    mtimeMs: (await fs.stat(filePath)).mtimeMs,
    rows,
  };
}

async function rebuildDataFromExcel() {
  const candidates = await walkXlsx(ROOT);
  const datasets = [];

  for (const filePath of candidates) {
    try {
      const data = await loadWorkbook(filePath);
      if (data.rows.length > 0) datasets.push(data);
    } catch {
      // Ignore workbooks that do not match the enrollment format.
    }
  }

  const byYear = new Map();
  for (const item of datasets) {
    const existing = byYear.get(item.yearLabel);
    if (
      !existing ||
      item.mtimeMs > existing.mtimeMs ||
      (item.mtimeMs === existing.mtimeMs && item.sourceFile.length < existing.sourceFile.length)
    ) {
      byYear.set(item.yearLabel, item);
    }
  }

  const years = [...byYear.values()]
    .sort((a, b) => b.yearLabel.localeCompare(a.yearLabel, "zh-Hans-CN"))
    .map((item) => ({
      yearLabel: item.yearLabel,
      sourceFile: item.sourceFile,
      sourceName: item.sourceName,
      mtimeMs: item.mtimeMs,
      rows: item.rows,
    }));

  return { generatedAt: new Date().toISOString(), years };
}

async function loadData() {
  if (dataCache.promise) return dataCache.promise;

  dataCache.promise = (async () => {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      const value = JSON.parse(raw);
      dataCache.key = `${value.generatedAt || ""}:${value.years?.length || 0}`;
      dataCache.value = value;
      return value;
    } catch {
      const value = await rebuildDataFromExcel();
      dataCache.key = `${value.generatedAt || ""}:${value.years?.length || 0}`;
      dataCache.value = value;
      return value;
    }
  })().finally(() => {
    dataCache.promise = null;
  });

  return dataCache.promise;
}

async function changePassword(username, currentPassword, newPassword) {
  const store = await readAuthStore();
  const user = store.users?.[username];
  if (!user) return { ok: false, error: "用户不存在" };
  if (user.passwordHash !== sha256(currentPassword)) return { ok: false, error: "当前密码不正确" };

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
        if (!username || !password) return sendJson(res, 400, { error: "请输入用户名和密码" });
        const ok = await verifyCredentials(username, password);
        if (!ok) return sendJson(res, 401, { error: "用户名或密码错误" });
        const token = createToken();
        await persistSession(token, username);
        return sendJson(res, 200, { token, username });
      } catch (error) {
        return sendJson(res, 500, { error: String(error?.message || error) });
      }
    }

    if (url.pathname === "/api/me") {
      const username = getCurrentUser(req);
      if (!username) return sendJson(res, 401, { error: "未登录" });
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
          return sendJson(res, 400, { error: "请输入当前密码和新密码" });
        }
        if (newPassword.length < 6) {
          return sendJson(res, 400, { error: "新密码至少 6 位" });
        }
        if (newPassword !== confirmPassword) {
          return sendJson(res, 400, { error: "两次输入的新密码不一致" });
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
    console.log(`学籍看板已启动：http://localhost:${PORT}`);
  });
}

await main();
