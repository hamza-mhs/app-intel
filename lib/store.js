// Local persistence: tracked apps + daily metric snapshots (JSON files under ./data).
// Snapshots turn guesses into observations: install-count and rating-count deltas over real days.
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(process.env.DATA_DIR || 'data');
const TRACKED = path.join(DIR, 'tracked.json');
const histFile = (store, id) => path.join(DIR, 'history', `${store}_${id.replace(/[^\w.-]/g, '_')}.json`);

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeJSON(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 1));
  await fs.rename(tmp, file);
}

export const listTracked = () => readJSON(TRACKED, []);

export async function track(app) {
  const list = await listTracked();
  if (!list.some((t) => t.store === app.store && t.id === app.id)) {
    list.push({ store: app.store, id: app.id, name: app.name, icon: app.icon, country: app.country || 'us', addedAt: new Date().toISOString() });
    await writeJSON(TRACKED, list);
  }
  return list;
}

export async function untrack(store, id) {
  const list = (await listTracked()).filter((t) => !(t.store === store && t.id === id));
  await writeJSON(TRACKED, list);
  return list;
}

export const history = (store, id) => readJSON(histFile(store, id), []);

// One point per calendar day (UTC); a later snapshot the same day replaces the earlier one.
export async function snapshot(app) {
  const file = histFile(app.store, app.id);
  const h = await readJSON(file, []);
  const day = new Date().toISOString().slice(0, 10);
  const point = {
    day,
    t: new Date().toISOString(),
    ratingsCount: app.ratingsCount ?? null,
    ratingsCurrentVersion: app.ratingsCurrentVersion ?? null,
    installs: app.installs ?? null,
    rating: app.rating ?? null,
    price: app.price ?? null,
    version: app.version ?? null,
  };
  const i = h.findIndex((p) => p.day === day);
  if (i >= 0) h[i] = point;
  else h.push(point);
  await writeJSON(file, h);
  return h;
}
