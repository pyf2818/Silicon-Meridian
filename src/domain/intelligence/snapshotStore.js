const STORAGE_KEY = 'intelligenceSnapshots:v1';

// 留存治理（2026-09-22）：快照按天积累（每天一条，含 lanes/briefing 大对象），
// 此前无 cap——一年几百条会挤爆 localStorage 5MB 配额且写入失败被静默吞掉。
// 保最近 60 天：跨日演化（G3）只看「前一日」，60 天回看余量充足。
const MAX_SNAPSHOT_DAYS = 60;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function readState(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    if (parsed?.version !== 1 || typeof parsed.snapshots !== 'object' || !parsed.snapshots) {
      return { version: 1, snapshots: {} };
    }
    return parsed;
  } catch {
    return { version: 1, snapshots: {} };
  }
}

/** 按 date 倒序只保留最近 MAX_SNAPSHOT_DAYS 天（纯函数，不改入参）。 */
function pruneSnapshots(state) {
  const dates = Object.keys(state.snapshots).sort((a, b) => String(b).localeCompare(String(a)));
  if (dates.length <= MAX_SNAPSHOT_DAYS) return state;
  const next = { version: state.version, snapshots: {} };
  for (const date of dates.slice(0, MAX_SNAPSHOT_DAYS)) next.snapshots[date] = state.snapshots[date];
  return next;
}

function writeState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(pruneSnapshots(state)));
}

export function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

export function createSnapshotStore(storage = globalThis.localStorage) {
  if (!storage?.getItem || !storage?.setItem) throw new Error('Snapshot storage adapter is required');

  return {
    create(snapshot) {
      if (!snapshot?.date) throw new Error('Snapshot date is required');
      const state = readState(storage);
      if (state.snapshots[snapshot.date]) return clone(state.snapshots[snapshot.date]);
      const record = {
        ...clone(snapshot),
        version: Number(snapshot.version || 1),
        createdAt: snapshot.createdAt || new Date().toISOString(),
        updates: [],
      };
      state.snapshots[snapshot.date] = record;
      writeState(storage, state);
      return clone(record);
    },

    get(date) {
      return clone(readState(storage).snapshots[date] || null);
    },

    list() {
      return Object.values(readState(storage).snapshots)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .map(clone);
    },

    appendUpdate(date, update) {
      if (!update || typeof update !== 'object') throw new Error('Snapshot update is required');
      const state = readState(storage);
      const current = state.snapshots[date];
      if (!current) throw new Error(`Snapshot not found for ${date}`);
      current.updates = [...(current.updates || []), clone(update)];
      writeState(storage, state);
      return clone(current);
    },

    setValidatedAi(date, enrichment) {
      const state = readState(storage);
      const current = state.snapshots[date];
      if (!current) throw new Error(`Snapshot not found for ${date}`);
      if (current.ai) return clone(current);
      current.ai = clone(enrichment);
      writeState(storage, state);
      return clone(current);
    },
  };
}
