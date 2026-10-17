import { promises as fs } from 'node:fs';
import { mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Default: a ".postwire" folder in your home folder, so the same accounts show up however many copies or downloads of the
// project you run (a fresh download has no data folder of its own). Set DATA_DIR to put it somewhere else, e.g. a hosting disk.
const projectData = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const homeData = path.join(os.homedir(), '.postwire');
let resolved;
export const dataDir = () => {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (resolved) return resolved;
  resolved = homeData;
  try {
    // One-off move: data saved by older versions inside the project folder is copied across, never overwritten.
    mkdirSync(homeData, { recursive: true });
    for (const f of readdirSync(projectData)) {
      if (/\.json$/.test(f) && !existsSync(path.join(homeData, f))) copyFileSync(path.join(projectData, f), path.join(homeData, f));
    }
  } catch { /* no old data folder, nothing to move */ }
  return resolved;
};
const DATA_DIR = dataDir;

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR(), file), 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return fallback;
    // A file that exists but cannot be read must stop the app, not quietly start empty and overwrite your accounts.
    throw new Error(`Cannot read ${file} in ${DATA_DIR()}: ${e.message}. Fix or restore the file (a backup copy is kept as ${file}.bak).`);
  }
}

let writeQueue = Promise.resolve();
async function writeJson(file, data) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR(), { recursive: true });
    const target = path.join(DATA_DIR(), file);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.copyFile(target, `${target}.bak`).catch(() => {});
    await fs.rename(tmp, target);
  });
  return writeQueue;
}

// One at a time: read-modify-write sequences on the JSON files must not interleave.
let chain = Promise.resolve();
export const lock = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

export const loadStore = () => readJson('store.json', { items: {}, sources: {}, updatedAt: null });
export const saveStore = (s) => writeJson('store.json', s);
export const loadAiCache = () => readJson('ai-cache.json', {});
export const saveAiCache = (c) => writeJson('ai-cache.json', c);
export const loadUsers = () => readJson('users.json', { users: {} });
export const saveUsers = (u) => writeJson('users.json', u);
export const loadSessions = () => readJson('sessions.json', { sessions: {} });
export const saveSessions = (s) => writeJson('sessions.json', s);
export const loadSaved = () => readJson('saved.json', { entries: {} });
export const saveSaved = (s) => writeJson('saved.json', s);
export const loadVoice = () => readJson('voice.json', { posts: [] });
export const saveVoice = (v) => writeJson('voice.json', v);
