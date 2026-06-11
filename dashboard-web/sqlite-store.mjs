import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_SQLITE_FILE = path.join(SERVER_DIR, "data.sqlite");
const DATA_SEALED_FILE = path.join(SERVER_DIR, "data.sealed.json");

let database = null;
let schemaReady = false;

function yearNumber(yearLabel) {
  const match = String(yearLabel || "").match(/(\d{4})/);
  return match ? Number(match[1]) : 0;
}

function getDatabase() {
  if (!database) {
    database = new DatabaseSync(DATA_SQLITE_FILE);
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec("PRAGMA journal_mode = WAL;");
  }
  return database;
}

function ensureSchema(db = getDatabase()) {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS academic_years (
      yearLabel TEXT PRIMARY KEY,
      termLabel TEXT NOT NULL,
      sourceFile TEXT NOT NULL,
      sourceName TEXT NOT NULL,
      mtimeMs INTEGER NOT NULL,
      yearNumber INTEGER NOT NULL,
      importedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      yearLabel TEXT NOT NULL REFERENCES academic_years(yearLabel) ON DELETE CASCADE,
      rowIndex INTEGER NOT NULL,
      name TEXT NOT NULL,
      grade TEXT NOT NULL,
      className TEXT NOT NULL,
      gender TEXT NOT NULL,
      status TEXT NOT NULL,
      province TEXT NOT NULL,
      ethnicity TEXT NOT NULL,
      idType TEXT NOT NULL,
      studentCategory TEXT NOT NULL,
      cityStatus TEXT NOT NULL,
      ethnicityGroup TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_students_year ON students(yearLabel);
    CREATE INDEX IF NOT EXISTS idx_students_year_sort ON students(yearLabel, rowIndex);
    CREATE INDEX IF NOT EXISTS idx_students_year_grade_class_name ON students(yearLabel, grade, className, name);
  `);
  schemaReady = true;
}

function decodeSealedData(raw, passphrase) {
  if (!passphrase) {
    throw new Error("缺少 DATA_PASSPHRASE，无法从加密备份迁移到 SQLite。");
  }

  const sealed = JSON.parse(raw);
  if (sealed.version !== 1 || sealed.algorithm !== "aes-256-gcm") {
    throw new Error("不支持的数据加密格式");
  }

  const salt = Buffer.from(sealed.salt, "base64");
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  const ciphertext = Buffer.from(sealed.ciphertext, "base64");
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function clearDatabase(db) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
      DELETE FROM students;
      DELETE FROM academic_years;
      DELETE FROM meta;
    `);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function writeDashboardDataToDatabase(value) {
  const db = getDatabase();
  ensureSchema(db);

  const metaStmt = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  const yearStmt = db.prepare(`
    INSERT OR REPLACE INTO academic_years (
      yearLabel, termLabel, sourceFile, sourceName, mtimeMs, yearNumber, importedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const rowStmt = db.prepare(`
    INSERT INTO students (
      yearLabel, rowIndex, name, grade, className, gender, status,
      province, ethnicity, idType, studentCategory, cityStatus, ethnicityGroup
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
      DELETE FROM students;
      DELETE FROM academic_years;
      DELETE FROM meta;
    `);

    metaStmt.run("generatedAt", String(value.generatedAt || ""));
    for (const year of value.years || []) {
      const yearLabel = String(year.yearLabel || "").trim();
      if (!yearLabel) continue;
      yearStmt.run(
        yearLabel,
        String(year.termLabel || yearLabel).trim(),
        String(year.sourceFile || "").trim(),
        String(year.sourceName || "").trim(),
        Number(year.mtimeMs || 0),
        yearNumber(yearLabel),
        String(value.generatedAt || ""),
      );

      const rows = Array.isArray(year.rows) ? year.rows : [];
      rows.forEach((row, index) => {
        rowStmt.run(
          yearLabel,
          index,
          String(row.name || ""),
          String(row.grade || ""),
          String(row.className || ""),
          String(row.gender || ""),
          String(row.status || ""),
          String(row.province || ""),
          String(row.ethnicity || ""),
          String(row.idType || ""),
          String(row.studentCategory || ""),
          String(row.cityStatus || ""),
          String(row.ethnicityGroup || ""),
        );
      });
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function readDashboardDataFromDatabase() {
  const db = getDatabase();
  ensureSchema(db);

  const generatedAtRow = db.prepare("SELECT value FROM meta WHERE key = 'generatedAt'").get();
  const years = db
    .prepare(`
      SELECT yearLabel, termLabel, sourceFile, sourceName, mtimeMs, importedAt
      FROM academic_years
      ORDER BY yearNumber DESC, importedAt DESC, yearLabel DESC
    `)
    .all();
  const rowsStmt = db.prepare(`
    SELECT
      name, grade, className, gender, status, province, ethnicity,
      idType, studentCategory, cityStatus, ethnicityGroup
    FROM students
    WHERE yearLabel = ?
    ORDER BY rowIndex ASC, id ASC
  `);

  return {
    generatedAt: String(generatedAtRow?.value || ""),
    years: years.map((year) => ({
      yearLabel: year.yearLabel,
      termLabel: year.termLabel,
      sourceFile: year.sourceFile,
      sourceName: year.sourceName,
      mtimeMs: Number(year.mtimeMs || 0),
      importedAt: year.importedAt,
      rows: rowsStmt.all(year.yearLabel),
    })),
  };
}

export async function loadDashboardData({ passphrase = "" } = {}) {
  const db = getDatabase();
  ensureSchema(db);

  const yearCountRow = db.prepare("SELECT COUNT(*) AS count FROM academic_years").get();
  const yearCount = Number(yearCountRow?.count || 0);
  if (!yearCount && (await fileExists(DATA_SEALED_FILE))) {
    const raw = await fs.readFile(DATA_SEALED_FILE, "utf8");
    const value = decodeSealedData(raw, passphrase);
    writeDashboardDataToDatabase(value);
  }

  return readDashboardDataFromDatabase();
}

export async function seedDashboardDatabaseFromSealed(passphrase) {
  if (!(await fileExists(DATA_SEALED_FILE))) return false;
  const raw = await fs.readFile(DATA_SEALED_FILE, "utf8");
  const value = decodeSealedData(raw, passphrase);
  writeDashboardDataToDatabase(value);
  return true;
}

export function writeDashboardDataToSqlite(value) {
  writeDashboardDataToDatabase(value);
}
