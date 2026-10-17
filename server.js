import express, { json, static as serveStatic } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import FoundryClient from './foundry.js';

const BASE_DIR = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(BASE_DIR, 'config.json');
if (!existsSync(CONFIG_PATH)) {
  console.error('config.json not found — copy config.example.json and fill it in.');
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const PORT = config.port || 3001;
const POLL_MS = (config.pollIntervalMinutes || 5) * 60 * 1000;
const IDLE_TICKS = Math.ceil((config.idleTimeoutMinutes || 30) / (config.pollIntervalMinutes || 5));

if (!config.adminPassword) {
  console.error('adminPassword is missing from config.json');
  process.exit(1);
}

const foundry = new FoundryClient(config);

const app = express();
app.use(json());
app.use((req, res, next) => {
  if (/config\.json/i.test(req.path)) return res.status(404).end();
  next();
});
app.use(serveStatic(join(BASE_DIR, 'public')));

app.get('/api/status', async (_, res) => {
  try {
    res.json(await foundry.getStatus());
  } catch {
    res.status(503).json({ active: false, error: 'Cannot reach Foundry' });
  }
});

app.get('/api/worlds', (_, res) => {
  try {
    res.json(foundry.listWorlds());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 10;
const failedAttempts = new Map();

function recordFailure(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW_MS; }
  entry.count++;
  failedAttempts.set(ip, entry);
}

function isRateLimited(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) { failedAttempts.delete(ip); return false; }
  return entry.count >= RATE_MAX;
}

app.post('/api/launch', async (req, res) => {
  const { worldId, password } = req.body || {};
  const ip = req.ip;
  if (!worldId) return res.status(400).json({ error: 'worldId is required' });

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many failed attempts — try again in 15 minutes.' });
  }

  const worldCfg = config.worlds?.[worldId];
  if (!worldCfg) return res.status(404).json({ error: 'World not found in config' });

  if (worldCfg.password && worldCfg.password !== password) {
    recordFailure(ip);
    return res.status(403).json({ error: 'Incorrect password' });
  }

  let status;
  try {
    status = await foundry.getStatus();
  } catch {
    return res.status(503).json({ error: 'Cannot reach Foundry' });
  }

  if (status.active) {
    if (status.world === worldId) return res.json({ ok: true });
    if (status.users !== 0) {
      return res.status(409).json({ error: 'Another world is active with users connected' });
    }
  }

  if (launching) return res.status(409).json({ error: 'A launch is already in progress' });
  launching = true;
  try {
    if (status.active) {
      console.log(`[launch] Switching from ${status.world} to ${worldId}`);
      await foundry.shutdownWorld();
      await waitForInactive();
    }
    await foundry.launchWorld(worldId);
    idleCount = 0;
    res.json({ ok: true });
  } catch (e) {
    const detail = e.response?.data?.error || e.message;
    res.status(500).json({ error: `Failed to launch: ${detail}` });
  } finally {
    launching = false;
  }
});

let launching = false;

async function waitForInactive(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      if (!(await foundry.getStatus()).active) return;
    } catch { /* Foundry may briefly refuse connections while shutting down */ }
  }
  throw new Error('previous world did not shut down in time');
}

app.get('/api/world-bg/:worldId', (req, res) => {
  if (!config.worlds?.[req.params.worldId]) return res.status(404).end();
  const imgPath = foundry.getWorldBackground(req.params.worldId);
  if (!imgPath) return res.status(404).end();
  res.sendFile(imgPath);
});

let idleCount = 0;

async function pollIdle() {
  let status;
  try {
    status = await foundry.getStatus();
  } catch {
    return;
  }

  if (!status.active) {
    idleCount = 0; return;
  }

  const users = status.users ?? -1;
  if (users === -1) return;

  if (users === 0) {
    idleCount++;
    console.log(`[idle] No users — tick ${idleCount}/${IDLE_TICKS}`);

    if (idleCount >= IDLE_TICKS) {
      console.log('[idle] Shutting down idle world...');
      try {
        await foundry.shutdownWorld();
        console.log('[idle] World shut down, back to setup.');
      } catch (e) {
        console.error('[idle] Shutdown failed:', e.message);
      }
      idleCount = 0;
    }
  } else {
    if (idleCount > 0) console.log(`[idle] ${users} user(s) active, resetting counter`);
    idleCount = 0;
  }
}

setInterval(pollIdle, POLL_MS);
console.log(`[idle] Polling every ${config.pollIntervalMinutes || 5} min, auto-shutdown after ${config.idleTimeoutMinutes || 30} min idle`);

app.listen(PORT, () => console.log(`Foundry Launcher running on :${PORT}`));
