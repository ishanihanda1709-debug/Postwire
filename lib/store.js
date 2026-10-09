import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf8')); }
  catch { return fallback; }
}

let writeQueue = Promise.resolve();
async function writeJson(file, data) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const target = path.join(DATA_DIR, file);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, target);
  });
  return writeQueue;
}

export const loadStore = () => readJson('store.json', { items: {}, sources: {}, updatedAt: null });
export const saveStore = (s) => writeJson('store.json', s);
export const loadPortfolio = () => readJson('portfolio.json', { entries: {} });
export const savePortfolio = (p) => writeJson('portfolio.json', p);
export const loadAiCache = () => readJson('ai-cache.json', {});
export const saveAiCache = (c) => writeJson('ai-cache.json', c);
