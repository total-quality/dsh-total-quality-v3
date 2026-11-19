'use strict';
/**
 * SQLite 持久层（node:sqlite 内置驱动，零第三方依赖）
 * ------------------------------------------------------------------
 * SQLite 按记录持久化业务数据。全量 JSON 快照由宿主定时生成。
 *
 * 表结构（关系表 + JSON 文档表混用，兼顾"真数据库"与"字段灵活"）：
 *   meta(key, value)                平台元信息 / 计数器 / 设置（JSON 文本）
 *   records(collection, ordinal, id, payload, created_at, updated_at)  业务集合逐条
 *   measurements(...)               测量值展开成真列，可直接 SQL 统计
 *   audit_log(...)                  审计留痕
 *   reports(...)                    生成的报告文件登记
 *
 * 数据库路径：<DATA_DIR>/qip.db（默认 DSH_HOME/qip-real-v3/data/qip.db，可用 QIP_REAL_V3_DATA_DIR 覆盖）
 */
const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  DatabaseSync = null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  path  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  id         TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection, ordinal);
CREATE TABLE IF NOT EXISTS measurements (
  id         TEXT PRIMARY KEY,
  char_id    TEXT,
  char_name  TEXT,
  model      TEXT,
  workshop   TEXT,
  station    TEXT,
  ts         TEXT,
  value      REAL,
  usl        REAL,
  lsl        REAL,
  unit       TEXT,
  shift      TEXT,
  batch      TEXT,
  supplier   TEXT,
  operator   TEXT,
  vin        TEXT,
  source     TEXT
);
CREATE INDEX IF NOT EXISTS idx_measurements_char_ts ON measurements(char_id, ts);
CREATE TABLE IF NOT EXISTS audit_log (
  id             TEXT PRIMARY KEY,
  ts             TEXT,
  user           TEXT,
  plugin         TEXT,
  action         TEXT,
  params         TEXT,
  result_summary TEXT,
  purpose        TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE TABLE IF NOT EXISTS reports (
  id         TEXT PRIMARY KEY,
  type       TEXT,
  title      TEXT,
  period     TEXT,
  file       TEXT,
  created_at TEXT
);
`;

const SKIP = new Set(['meta', 'counters', 'settings', 'pendingActionsUnused']);

function flatten(obj, prefix, out) {
  for (const key of Object.keys(obj || {})) {
    const value = obj[key];
    const full = prefix ? prefix + '.' + key : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
    else out[full] = value;
  }
  return out;
}

function unflatten(flat) {
  const root = {};
  for (const [full, value] of Object.entries(flat || {})) {
    const parts = full.split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return root;
}

function open(file) {
  if (!DatabaseSync) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);

  const st = {
    metaSet: db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)'),
    metaGet: db.prepare('SELECT value FROM meta WHERE key = ?'),
    recDel: db.prepare('DELETE FROM records WHERE collection=? AND id=?'),
    recIns: db.prepare('INSERT OR REPLACE INTO records(collection, ordinal, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    recAll: db.prepare('SELECT collection, ordinal, id, payload FROM records ORDER BY collection, ordinal'),
    setDel: db.prepare('DELETE FROM settings WHERE path=?'),
    setIns: db.prepare('INSERT OR REPLACE INTO settings(path, value) VALUES (?, ?)'),
    setAll: db.prepare('SELECT path, value FROM settings'),
    meaDel: db.prepare('DELETE FROM measurements WHERE id=?'),
    meaIns: db.prepare(`INSERT OR REPLACE INTO measurements
      (id, char_id, char_name, model, workshop, station, ts, value, usl, lsl, unit, shift, batch, supplier, operator, vin, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    audDel: db.prepare('DELETE FROM audit_log WHERE id=?'),
    audIns: db.prepare(`INSERT OR REPLACE INTO audit_log
      (id, ts, user, plugin, action, params, result_summary, purpose) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    repDel: db.prepare('DELETE FROM reports WHERE id=?'),
    repIns: db.prepare('INSERT OR REPLACE INTO reports(id, type, title, period, file, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  };
  let recordCache = new Map();
  let settingsCache = new Map();
  const adapter = {
    engine: 'sqlite',
    file,
    load() {
      const n = db.prepare('SELECT COUNT(*) AS c FROM records').get();
      const hasMeta = st.metaGet.get('state');
      if ((!n || Number(n.c) === 0) && !hasMeta) return null;
      const state = { meta: {}, counters: {}, settings: {} };
      settingsCache = new Map();
      recordCache = new Map();
      for (const row of st.setAll.all()) {
        settingsCache.set(row.path, row.value);
        const parts = String(row.path).split('.');
        let cur = state.settings;
        for (let i = 0; i < parts.length - 1; i++) {
          if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        let value = row.value;
        try { value = JSON.parse(row.value); } catch (_) { /* 普通字符串 */ }
        cur[parts[parts.length - 1]] = value;
      }
      const metaRow = hasMeta ? hasMeta.value : null;
      if (metaRow) {
        try {
          const parsed = JSON.parse(metaRow);
          state.meta = parsed.meta || {};
          state.counters = parsed.counters || {};
        } catch (_) { /* 忽略 */ }
      }
      for (const row of st.recAll.all()) {
        const collection = String(row.collection);
        if (!recordCache.has(collection)) recordCache.set(collection, new Map());
        recordCache.get(collection).set(row.id, { ordinal: row.ordinal, payload: row.payload });
        if (!Array.isArray(state[collection])) state[collection] = [];
        try {
          state[collection].push(JSON.parse(row.payload));
        } catch (_) { /* 跳过坏行 */ }
      }
      return state;
    },
    save(state, { scanMeasurements = true } = {}) {
      const chars = new Map((state.spcChars || []).map((ch) => [ch.id, ch]));
      const now = new Date().toISOString();
      const settings = new Map(Object.entries(flatten(state.settings || {}, '', {}))
        .map(([key, value]) => [key, JSON.stringify(value) ?? 'null']));
      const next = new Map(recordCache);
      const changed = new Map();
      const names = new Set([...recordCache.keys(), ...Object.keys(state).filter((key) => !SKIP.has(key) && Array.isArray(state[key]))]);
      for (const collection of names) {
        if (collection === 'measurements' && !scanMeasurements) continue;
        const prior = recordCache.get(collection) || new Map();
        const current = new Map();
        const edits = [];
        for (const [ordinal, doc] of (state[collection] || []).entries()) {
          if (!doc || typeof doc !== 'object') continue;
          const id = String(doc.id ?? collection + '-' + ordinal);
          const payload = JSON.stringify(doc);
          const old = prior.get(id);
          current.set(id, { ordinal, payload });
          if (!old || old.payload !== payload || old.ordinal !== ordinal) edits.push({ id, ordinal, payload, doc, changed: old?.payload !== payload });
        }
        const removed = [...prior.keys()].filter((id) => !current.has(id));
        if (edits.length || removed.length) changed.set(collection, { edits, removed });
        next.set(collection, current);
      }
      const changedSpecs = new Set();
      for (const edit of changed.get('spcChars')?.edits || []) {
        const old = recordCache.get('spcChars')?.get(edit.id);
        const prior = old && JSON.parse(old.payload);
        if (!prior || ['name','model','workshop','station','unit','lsl','usl'].some((field) => prior[field] !== edit.doc[field])) changedSpecs.add(edit.id);
      }
      for (const id of changed.get('spcChars')?.removed || []) changedSpecs.add(id);
      const writeMeasurement = (m) => {
        const ch = chars.get(m.charId) || {};
        st.meaIns.run(String(m.id), m.charId || null, m.charName || ch.name || null, m.model || ch.model || null,
          m.workshop || ch.workshop || null, m.station || ch.station || null, m.ts || null,
          Number.isFinite(Number(m.value)) ? Number(m.value) : null,
          ch.usl === undefined ? null : Number(ch.usl), ch.lsl === undefined ? null : Number(ch.lsl),
          m.unit || ch.unit || null, m.shift || null, m.batch || null, m.supplier || null, m.operator || null, m.vin || null, m.source || null);
      };
      const mirrorDelete = { measurements: st.meaDel, audit: st.audDel, reports: st.repDel };
      db.exec('BEGIN IMMEDIATE');
      try {
        st.metaSet.run('state', JSON.stringify({ meta: state.meta || {}, counters: state.counters || {} }));
        st.metaSet.run('updatedAt', now);
        for (const key of settingsCache.keys()) if (!settings.has(key)) st.setDel.run(key);
        for (const [key, value] of settings) if (settingsCache.get(key) !== value) st.setIns.run(key, value);
        for (const [collection, { edits, removed }] of changed) {
          for (const id of removed) {
            st.recDel.run(collection, id);
            mirrorDelete[collection]?.run(id);
          }
          for (const { id, ordinal, payload, doc, changed } of edits) {
            st.recIns.run(collection, ordinal, id, payload, doc.createdAt || null, doc.updatedAt || null);
            if (!changed) continue;
            if (collection === 'measurements' && !changedSpecs.has(doc.charId)) writeMeasurement(doc);
            if (collection === 'audit') st.audIns.run(id, doc.ts || null, doc.user || null, doc.plugin || null, doc.action || null,
              JSON.stringify(doc.params ?? null), doc.resultSummary || null, doc.purpose || null);
            if (collection === 'reports') st.repIns.run(id, doc.type || null, doc.title || null, doc.period || null,
              doc.file || doc.path || null, doc.createdAt || null);
          }
        }
        if (changedSpecs.size) for (const m of state.measurements || []) if (changedSpecs.has(m.charId)) writeMeasurement(m);
        db.exec('COMMIT');
        recordCache = next;
        settingsCache = settings;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw err;
      }
      return true;
    },
    info() {
      const count = (table) => {
        try { return Number(db.prepare('SELECT COUNT(*) AS c FROM ' + table).get().c); } catch (_) { return 0; }
      };
      let size = 0;
      try { size = fs.statSync(file).size; } catch (_) { /* ignore */ }
      const updatedAt = st.metaGet.get('updatedAt');
      return {
        engine: 'sqlite',
        path: file,
        sizeBytes: size,
        sqliteVersion: (db.prepare('SELECT sqlite_version() AS v').get() || {}).v || '',
        updatedAt: updatedAt ? updatedAt.value : null,
        tables: {
          records: count('records'),
          measurements: count('measurements'),
          audit_log: count('audit_log'),
          reports: count('reports'),
          settings: count('settings'),
        },
      };
    },
    /** 只读 SQL（供自检/运维核对），仅允许 SELECT */
    query(sql, params) {
      const text = String(sql || '').trim();
      if (!/^select\b/i.test(text)) throw new Error('只允许 SELECT 查询');
      return db.prepare(text).all(...(params || []));
    },
    close() { try { db.close(); } catch (_) { /* ignore */ } },
  };
  return adapter;
}

module.exports = { open, DatabaseSync };
