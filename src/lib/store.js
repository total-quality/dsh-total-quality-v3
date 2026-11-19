'use strict';
/**
 * 数据持久层（零依赖）
 * ------------------------------------------------------------------
 * 单文件 JSON 库，原子写入（临时文件 + rename），支持集合级操作、
 * 人类可读的业务编号自增（QI-2026-0412 / QP-0377 / 8D 等）、
 * 变更订阅（供前端 SSE 推送实时刷新）。
 *
 * 用法：
 *   const store = require('./lib/store');
 *   await store.init('./data');
 *   store.col('issues').insert({...});
 */
const fs = require('fs');
const path = require('path');

/** 业务编号规则：集合 -> {prefix, key, width}
 *  注意：质量问题/改进项目/知识条目在业务上习惯写作 #QI-2026-0412、#QP-0377、#C-0231，
 *  这里把 '#' 作为编号的一部分统一存储，避免"新建的没有 #、初始数据有 #"的不一致。 */
const ID_RULES = {
  issues: { prefix: '#QI-', year: true, width: 4, counter: 'issue' },
  projects: { prefix: '#QP-', width: 4, counter: 'project' },
  qrqc: { prefix: 'QR-', year: true, width: 4, counter: 'qrqc' },
  workflows: { prefix: 'OA-', year: true, width: 5, counter: 'workflow' },
  todos: { prefix: 'TD-', width: 5, counter: 'todo' },
  benefits: { prefix: 'BN-', year: true, width: 4, counter: 'benefit' },
  reports: { prefix: 'RP-', year: true, width: 4, counter: 'report' },
  knowledge: { prefix: '#C-', width: 4, counter: 'knowledge' },
  chats: { prefix: 'CH-', width: 5, counter: 'chat' },
  audit: { prefix: 'AU-', width: 7, counter: 'audit' },
  measurements: { prefix: 'MS-', width: 8, counter: 'measurement' },
  spcChars: { prefix: 'CT-', width: 4, counter: 'spcChar' },
  members: { prefix: 'U-', width: 3, counter: 'member' },
  defects: { prefix: 'AQ-', width: 6, counter: 'defect' },
};

const DEFAULT_DB = {
  meta: { name: '质量平台', version: '2.0', createdAt: null, updatedAt: null },
  counters: {},
  settings: {},
  issues: [],
  projects: [],
  qrqc: [],
  workflows: [],
  todos: [],
  benefits: [],
  reports: [],
  knowledge: [],
  chats: [],
  audit: [],
  measurements: [],
  spcChars: [],
  members: [],
  defects: [],
  pendingActions: [],
  operationCases: [],
  operationEvents: [],
  operationImports: [],
  analysisRecords: [],
  materials: [],
  bom: [],
};

class Store {
  constructor() {
    this.db = JSON.parse(JSON.stringify(DEFAULT_DB));
    this.file = null;
    this._dirty = false;
    this._timer = null;
    this._listeners = new Set();
    this._measurementDirty = false;
    this.measurementRevision = 0;
  }

  async init(dataDir, opts) {
    fs.mkdirSync(dataDir, { recursive: true });
    const scale = (opts && opts.scale) === 'sme' ? 'sme' : 'large';
    this.scale = scale;
    const suffix = scale === 'sme' ? '-sme' : '';
    this.dir = dataDir;
    this.file = path.join(dataDir, 'qip-db' + suffix + '.json');
    // 切版式时重新装载：先回到空状态，避免上一套数据残留
    this.db = JSON.parse(JSON.stringify(DEFAULT_DB));
    // SQLite 作为权威存储；不可用时（旧 Node）自动退回 JSON。
    try {
      this.persist = require('../../db.cjs').open(path.join(dataDir, 'qip' + suffix + '.db'));
    } catch (err) {
      this.persist = null;
      console.error('[store] SQLite 不可用，退回 JSON 存储：' + (err && err.message));
    }
    const persisted = this.persist ? this.persist.load() : null;
    if (persisted) {
      this.db = Object.assign(JSON.parse(JSON.stringify(DEFAULT_DB)), persisted);
    } else if (fs.existsSync(this.file)) {
      try {
        const raw = fs.readFileSync(this.file, 'utf8');
        const parsed = JSON.parse(raw);
        this.db = Object.assign(JSON.parse(JSON.stringify(DEFAULT_DB)), parsed);
      } catch (e) {
        // 数据损坏：备份后重建，避免整个平台不可用
        const bak = this.file + '.corrupt-' + Date.now();
        try { fs.copyFileSync(this.file, bak); } catch (_) {}
        console.error('[store] 数据文件损坏，已备份到 ' + bak + '，将重建：' + e.message);
        this.db = JSON.parse(JSON.stringify(DEFAULT_DB));
      }
    }
    if (!this.db.meta.createdAt) this.db.meta.createdAt = new Date().toISOString();
    return this;
  }

  /** 是否已有业务数据（用于首启动时灌入初始数据） */
  isEmpty() {
    return (this.db.issues || []).length === 0 && (this.db.knowledge || []).length === 0;
  }

  // ---------------- 基础读写 ----------------
  col(name) {
    if (!this.db[name]) this.db[name] = [];
    const self = this;
    return {
      all: () => self.db[name],
      get: (id) => self.resolve(name, id),
      find: (fn) => self.db[name].filter(fn),
      one: (fn) => self.db[name].find(fn) || null,
      insert: (doc) => self.insert(name, doc),
      insertMany: (docs) => docs.map((d) => self.insert(name, d, true)) && (self.touch(), docs),
      update: (id, patch) => self.update(name, id, patch),
      remove: (id) => self.remove(name, id),
      count: () => self.db[name].length,
      name,
    };
  }

  /** 宽松解析编号：'#QP-0377' 与 'QP-0377' 视为同一条，避免智能体传入的编号形式影响查找 */
  resolve(collection, id) {
    const arr = this.db[collection] || [];
    if (id === undefined || id === null) return null;
    const s = String(id).trim();
    let d = arr.find((x) => x.id === s);
    if (!d) d = arr.find((x) => x.id === s.replace(/^#/, ''));
    if (!d) d = arr.find((x) => x.id === '#' + s.replace(/^#/, ''));
    return d || null;
  }

  nextId(collection, extra) {
    const rule = ID_RULES[collection];
    const now = new Date();
    const y = now.getFullYear();
    if (!rule) {
      this.db.counters['_seq_' + collection] = (this.db.counters['_seq_' + collection] || 0) + 1;
      this._dirty = true;
      return collection + '-' + this.db.counters['_seq_' + collection];
    }
    const key = rule.counter;
    this.db.counters[key] = (this.db.counters[key] || 0) + 1;
    let id = rule.prefix;
    if (rule.year) id += y + '-';
    id += String(this.db.counters[key]).padStart(rule.width, '0');
    this._dirty = true;
    if (extra && extra.forcePrefix) id = extra.forcePrefix + id.replace(/^[A-Z0-9]+-(\d{4}-)?/, '');
    return id;
  }

  insert(collection, doc, deferTouch) {
    if (!this.db[collection]) this.db[collection] = [];
    const d = Object.assign({}, doc);
    if (!d.id) d.id = this.nextId(collection, doc);
    if (!d.createdAt) d.createdAt = new Date().toISOString();
    d.updatedAt = d.createdAt;
    this.beforeWrite(collection);
    this.db[collection].push(d);
    if (!deferTouch) this.touch();
    return d;
  }

  update(collection, id, patch) {
    const doc = this.resolve(collection, id);
    if (!doc) return null;
    this.guardManaged(collection, doc);
    this.beforeWrite(collection);
    Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
    this.touch();
    return doc;
  }

  patchNested(collection, id, pathStr, value) {
    const doc = this.col(collection).get(id);
    if (!doc) return null;
    this.beforeWrite(collection);
    const parts = pathStr.split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    doc.updatedAt = new Date().toISOString();
    this.touch();
    return doc;
  }

  remove(collection, id) {
    const arr = this.db[collection] || [];
    const doc = this.resolve(collection, id);
    if (!doc) return false;
    this.guardManaged(collection, doc);
    this.beforeWrite(collection);
    arr.splice(arr.indexOf(doc), 1);
    this.touch();
    return true;
  }

  getSetting(keyPath, fallback) {
    const parts = keyPath.split('.');
    let cur = this.db.settings || {};
    for (const p of parts) {
      if (cur === undefined || cur === null || typeof cur !== 'object') return fallback;
      cur = cur[p];
    }
    return cur === undefined ? fallback : cur;
  }

  guardManaged(collection, doc) {
    if (!['issues', 'projects', 'workflows', 'todos'].includes(collection)) return;
    const operationId = doc.operationsId || (collection === 'projects' && this.resolve('issues', doc.issueId)?.operationsId);
    if (operationId) { const err = new Error('该记录由统一工作单管理，请在「确认与纠正」打开 ' + operationId + ' 调整、提交或批准，历史记录会保留'); err.status = 409; throw err; }
  }

  setSetting(keyPath, value) {
    const parts = keyPath.split('.');
    if (!this.db.settings) this.db.settings = {};
    let cur = this.db.settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    this.touch();
    this.emit();
    return value;
  }

  /** 全量替换某集合（用于导入/重置） */
  replace(collection, docs) {
    this.beforeWrite(collection);
    this.db[collection] = docs || [];
    this.touch();
    return this.db[collection].length;
  }

  // ---------------- 审计 ----------------
  audit(entry) {
    const rec = Object.assign(
      { id: this.nextId('audit'), ts: new Date().toISOString(), user: '当前用户' },
      entry
    );
    this.db.audit.push(rec);

    this.touch();
    return rec;
  }

  archiveAudit() {
    const until = Date.now() - this.getSetting('auditRetentionDays',365) * 86400000;
    const expired = this.db.audit.filter((entry) => Date.parse(entry.ts) < until);
    if (!expired.length) return 0;
    const ids = new Set(expired.map((entry) => entry.id));
    this.transaction(() => {
      this.db.auditArchive = [...(this.db.auditArchive || []), ...expired];
      this.db.audit = this.db.audit.filter((entry) => !ids.has(entry.id));
    });
    return expired.length;
  }

  // ---------------- 持久化 ----------------
  touch() {
    this._dirty = true;
    if (this._inTransaction) return;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.saveSync();
    }, 400);
    if (this._timer.unref) this._timer.unref();
  }

  beforeWrite(collection) {
    if (collection !== 'measurements') return;
    if (this._rollback && this._rollback.measurements === this.db.measurements) {
      this._rollback.measurements = structuredClone(this.db.measurements);
    }
    this._measurementDirty = true;
    this.measurementRevision++;
  }

  transaction(fn) {
    if (this._inTransaction) return fn();
    const { measurements, ...other } = this.db;
    const before = { ...structuredClone(other), measurements };
    this._rollback = before;
    const dirty = this._dirty;
    const measurementDirty = this._measurementDirty;
    const measurementRevision = this.measurementRevision;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._inTransaction = true;
    let committed = false;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') throw new Error('事务中不允许异步操作');
      if (this.db.measurements !== measurements && !this._measurementDirty) {
        this._measurementDirty = true;
        this.measurementRevision++;
      }
      this.saveSync(true, true, false);
      committed = true;
      return result;
    } catch (err) {
      this.db = before;
      this._dirty = dirty;
      this._measurementDirty = measurementDirty;
      this.measurementRevision = measurementRevision;
      if (dirty) this.touchAfterTransaction = true;
      throw err;
    } finally {
      this._rollback = null;
      this._inTransaction = false;
      if (this.touchAfterTransaction) { this.touchAfterTransaction = false; this.touch(); }
      if (committed) this.emit();
    }
  }

  saveSync(force, strict = false, scanMeasurements = !!force) {
    if ((!this._dirty && !force) || !this.file) return;
    this.db.meta.updatedAt = new Date().toISOString();
    try {
      if (this.persist) this.persist.save(this.db, { scanMeasurements: scanMeasurements || this._measurementDirty });
      else this.snapshot();
      if (scanMeasurements) this.measurementRevision++;
      this._measurementDirty = false;
      this._dirty = false;
      this.emit();
    } catch (e) {
      console.error('[store] 保存失败：' + e.message);
      if (strict) throw e;
    }
  }

  snapshot() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  // ---------------- 变更订阅 ----------------
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit() { if (this._inTransaction) return; for (const fn of this._listeners) { try { fn(); } catch (_) {} } }
}

module.exports = new Store();
module.exports.Store = Store;
module.exports.ID_RULES = ID_RULES;

