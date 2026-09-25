import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const JEV_API = process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = process.env.JEV_MODEL || "jev-latest";
const TIMEOUT_MS = Number(process.env.RALPH_JEV_TIMEOUT_MS || "30000");
const COOLDOWN_MS = Number(process.env.JEV_COOLDOWN_MS || "300000");
const CIRCUIT_FILE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ralph-jev", "circuit.json");

export function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== "" && process.env[name] !== undefined ? value : fallback;
}

function readEnvKey(path) {
  if (!path || !existsSync(path)) return null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*"?([^"\s]+)"?/);
    if (m) return m[1];
  }
  return null;
}

function loadApiKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  const dir = join(homedir(), ".config", "jev-browser-use");
  const fromDir = readEnvKey(join(dir, ".env"));
  if (fromDir) return fromDir;
  try {
    const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    return readEnvKey(cfg.envFile);
  } catch {
    return null;
  }
}

export function circuitOpen() {
  try {
    const { openUntil } = JSON.parse(readFileSync(CIRCUIT_FILE, "utf8"));
    return Date.now() < openUntil;
  } catch {
    return false;
  }
}

function tripCircuit(reason) {
  mkdirSync(dirname(CIRCUIT_FILE), { recursive: true });
  writeFileSync(CIRCUIT_FILE, JSON.stringify({ openUntil: Date.now() + COOLDOWN_MS, reason }));
}

export async function askJev(state, questions) {
  if (circuitOpen()) throw new Error("circuit open");
  const key = loadApiKey();
  if (!key) throw new Error("TYPESAFE_API_KEY not configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(JEV_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = `Jev HTTP ${res.status}`;
      if (res.status === 429 || res.status >= 500) tripCircuit(err);
      throw new Error(err);
    }
    const data = await res.json();
    return data.answers || {};
  } finally {
    clearTimeout(timer);
  }
}

export function noul(answers, id) {
  const value = answers?.[id]?.noul;
  if (typeof value !== "number") throw new Error(`Jev response missing noul '${id}'`);
  return value;
}

export function readStdinJson() {
  const raw = readFileSync(0, "utf8");
  return JSON.parse(raw || "{}");
}

export function sh(cwd, cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

export function tail(text, max) {
  return text.length > max ? text.slice(text.length - max) : text;
}

export function recentEvents(workspace, count = 15) {
  const marker = join(workspace, ".ralph", "current-events");
  const path = existsSync(marker)
    ? resolve(workspace, readFileSync(marker, "utf8").trim())
    : join(workspace, ".ralph", "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-count)
    .map((line) => {
      try {
        const e = JSON.parse(line);
        return { topic: e.topic, payload: String(e.payload ?? "").slice(0, 300) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function loopObjective(workspace) {
  const lock = join(workspace, ".ralph", "loop.lock");
  if (existsSync(lock)) {
    try {
      const { prompt } = JSON.parse(readFileSync(lock, "utf8"));
      if (prompt) return String(prompt);
    } catch {}
  }
  const promptFile = join(workspace, "PROMPT.md");
  return existsSync(promptFile) ? readFileSync(promptFile, "utf8") : "";
}

export function taskCounts(workspace) {
  const path = join(workspace, ".ralph", "agent", "tasks.jsonl");
  const counts = {};
  if (!existsSync(path)) return counts;
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    try {
      const status = JSON.parse(line).status || "unknown";
      counts[status] = (counts[status] || 0) + 1;
    } catch {}
  }
  return counts;
}

export function fail(prefix, error) {
  process.stderr.write(`${prefix}: ${error.message}\n`);
  process.exit(error.message === "circuit open" ? 2 : 1);
}
