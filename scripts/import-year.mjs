import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DASHBOARD_DIR = path.join(ROOT, "dashboard-web");
const SEALED_FILE = path.join(DASHBOARD_DIR, "data.sealed.json");
const ARCHIVE_DIR = path.join(ROOT, "archive");
const ENV_FILE = path.join(ROOT, ".env");

function loadDotEnv(filePath, target = {}) {
  if (!fsSync.existsSync(filePath)) return target;
  const content = fsSync.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in target)) target[key] = value;
  }
  return target;
}

const env = loadDotEnv(ENV_FILE, { ...process.env });
const DATA_PASSPHRASE = env.DATA_PASSPHRASE || env.DATA_KEY || "";

function parseArgs(argv) {
  const args = { source: "", yearLabel: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!args.source && !value.startsWith("--")) {
      args.source = value;
      continue;
    }
    if (value === "--year") {
      args.yearLabel = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (value.startsWith("--year=")) {
      args.yearLabel = value.slice("--year=".length);
    }
  }
  return args;
}

function inferYearLabel(filePath) {
  const base = path.basename(filePath);
  const match = base.match(/(\d{4})(?:年度|学年度)/);
  return match ? `${match[1]}学年度` : "";
}

function yearNumber(yearLabel) {
  const match = String(yearLabel || "").match(/(\d{4})/);
  return match ? Number(match[1]) : 0;
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

function pickRows(values) {
  if (!values?.length) return [];
  const headers = values[0].map((item) => String(item ?? "").trim());
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
  if (!required.every((name) => name in idx)) return [];

  const rows = [];
  for (let r = 1; r < values.length; r += 1) {
    const row = values[r];
    const province = String(row[idx["学生户口省份"]] ?? "").trim();
    const ethnicity = String(row[idx["学生民族"]] ?? "").trim();
    const idType = String(row[idx["学生身份证件类型"]] ?? "").trim();
    const studentCategory = String(row[idx["学生学生类别"]] ?? "").trim();
    const cityStatus = province === "上海市" ? "本市户籍" : "非本市户籍";
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
      cityStatus,
      ethnicityGroup: classifyEthnicity(idType, studentCategory, ethnicity),
    });
  }
  return rows.filter((row) => row.name);
}

async function readSealedData() {
  const raw = await fs.readFile(SEALED_FILE, "utf8");
  const sealed = JSON.parse(raw);
  if (!DATA_PASSPHRASE) {
    throw new Error("缺少 DATA_PASSPHRASE，无法解密现有数据。");
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

function sealData(value) {
  if (!DATA_PASSPHRASE) {
    throw new Error("缺少 DATA_PASSPHRASE，无法加密数据。");
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(DATA_PASSPHRASE, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

async function loadWorkbookRows(sourcePath) {
  const { FileBlob, SpreadsheetFile } = await import("@oai/artifact-tool");
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
  const sheet = workbook.worksheets.getItemAt(0);
  const rows = pickRows(sheet.getUsedRange().values);
  return rows;
}

async function copyToArchive(sourcePath, yearLabel) {
  const archiveYearDir = path.join(ARCHIVE_DIR, yearLabel);
  await fs.mkdir(archiveYearDir, { recursive: true });
  const baseName = path.basename(sourcePath);
  const target = path.join(archiveYearDir, baseName);
  if (!(await exists(target))) {
    await fs.copyFile(sourcePath, target);
    return target;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = path.extname(baseName);
  const stem = path.basename(baseName, suffix);
  const altTarget = path.join(archiveYearDir, `${stem}_${stamp}${suffix}`);
  await fs.copyFile(sourcePath, altTarget);
  return altTarget;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { source, yearLabel: explicitYear } = parseArgs(process.argv.slice(2));
  if (!source) {
    throw new Error("用法: node scripts/import-year.mjs <Excel路径> [--year 2025学年度]");
  }

  const sourcePath = path.isAbsolute(source) ? source : path.join(ROOT, source);
  if (!(await exists(sourcePath))) {
    throw new Error(`找不到源文件: ${sourcePath}`);
  }

  const yearLabel = explicitYear || inferYearLabel(sourcePath);
  if (!yearLabel) {
    throw new Error("无法从文件名识别学年度，请用 --year 2025学年度 指定。");
  }

  const existing = await readSealedData().catch(() => ({ generatedAt: "", years: [] }));
  const rows = await loadWorkbookRows(sourcePath);
  if (!rows.length) {
    throw new Error("未识别到符合格式的学生数据，请确认表头是否正确。");
  }

  const archivedPath = await copyToArchive(sourcePath, yearLabel);
  const nextYears = (existing.years || []).filter((item) => item.yearLabel !== yearLabel);
  nextYears.push({
    yearLabel,
    sourceFile: path.relative(ROOT, archivedPath).split(path.sep).join("/"),
    sourceName: path.basename(archivedPath),
    mtimeMs: (await fs.stat(sourcePath)).mtimeMs,
    rows,
  });
  nextYears.sort((a, b) => yearNumber(b.yearLabel) - yearNumber(a.yearLabel));

  const sealed = sealData({
    generatedAt: new Date().toISOString(),
    years: nextYears,
  });

  await fs.writeFile(SEALED_FILE, `${JSON.stringify(sealed, null, 2)}\n`, "utf8");
  console.log(`已更新 ${yearLabel}，归档文件: ${path.relative(ROOT, archivedPath).split(path.sep).join("/")}`);
  console.log(`密文数据已写入: ${path.relative(ROOT, SEALED_FILE).split(path.sep).join("/")}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
