'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const BLOCK = 1024 * 1024;
const identity = 'qip-v3-business-backup';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function createBackups({ store, library, reports }) {
  const parent = () => path.join(store.dir, 'backups');
  const destinations = () => library.archiveFiles();
  const idPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;
  const archives = new Map();
  let receiving = 0;
  const staging = new Map();
  function cleanExpired() {
    for (const [id, draft] of staging) if (draft.expires <= Date.now()) {
      fs.rmSync(draft.dir, { force:true, recursive:true });
      staging.delete(id);
    }
  }
  function reportFiles(dir, prefix = '') {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes:true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      const key = prefix + entry.name;
      if (entry.isDirectory()) return reportFiles(file, key + '/');
      return entry.isFile() && safeKey('reports/' + key) ? [{ key:'reports/' + key, file }] : [];
    });
  }
  function safeKey(key) {
    if (['business.json','knowledge.db'].includes(key)) return true;
    if (key.startsWith('originals/')) return idPattern.test(key.slice(10,-9)) && key.endsWith('.original');
    if (!key.startsWith('reports/')) return false;
    return key.slice(8).split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\:*?"<>|\x00-\x1f]/.test(part) && !/[. ]$/.test(part) &&
      !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
  }
  function businessState() {
    return { ...store.db, settings: { ...store.db.settings, llm: {} } };
  }
  function build() {
    fs.mkdirSync(parent(), { recursive:true });
    const id = randomUUID();
    const file = path.join(parent(), id + '.qipbackup');
    const temp = file + '.tmp';
    const { database, originals } = destinations();
    const assets = [{ key:'business.json', bytes:Buffer.from(JSON.stringify(businessState())) },
      { key:'knowledge.db', file:database },
      ...originals.map((file) => ({ key:'originals/' + path.basename(file), file })),
      ...reportFiles(reports)];
    const out = new DatabaseSync(temp);
    try {
      out.exec(`
        CREATE TABLE manifest (format TEXT, version INTEGER, scale TEXT, createdAt TEXT);
        CREATE TABLE files (name TEXT PRIMARY KEY, size INTEGER NOT NULL, sha TEXT NOT NULL);
        CREATE TABLE blocks (name TEXT, seq INTEGER, data BLOB, PRIMARY KEY(name,seq)) WITHOUT ROWID;
        BEGIN IMMEDIATE;
      `);
      out.prepare('INSERT INTO manifest VALUES (?,?,?,?)').run(identity, 1, store.scale, new Date().toISOString());
      const row = out.prepare('INSERT INTO files VALUES (?,?,?)');
      const block = out.prepare('INSERT INTO blocks VALUES (?,?,?)');
      const scratch = Buffer.allocUnsafe(BLOCK);
      for (const asset of assets) {
        const sum = createHash('sha256');
        let seq = 0, size = 0;
        const add = (bytes) => { block.run(asset.key, seq++, bytes); sum.update(bytes); size += bytes.length; };
        if (asset.bytes) {
          for (let i = 0; i < asset.bytes.length; i += BLOCK) add(asset.bytes.subarray(i,i + BLOCK));
        } else {
          const fd = fs.openSync(asset.file, 'r');
          try {
            if (!fs.fstatSync(fd).isFile()) fail('备份来源不是普通文件');
            let count;
            while ((count = fs.readSync(fd,scratch,0,scratch.length,null))) add(scratch.subarray(0,count));
          } finally { fs.closeSync(fd); }
        }
        row.run(asset.key, size, sum.digest('hex'));
      }
      out.exec('COMMIT');
      out.close();
      fs.renameSync(temp, file);
    } catch (error) {
      try { out.close(); } catch {}
      fs.rmSync(temp, { force:true });
      throw error;
    }
    const record = { id, file, filename:'全质业务备份-' + new Date().toISOString().replace(/[:.]/g,'-') + '.qipbackup', size:fs.statSync(file).size };
    archives.set(id, record);
    return record;
  }
  function download(id) {
    if (!idPattern.test(id)) fail('备份不存在',404);
    const file = path.join(parent(), id + '.qipbackup');
    if (!fs.existsSync(file)) fail('备份不存在',404);
    return archives.get(id) || { id, file, filename:'全质业务备份-' + id + '.qipbackup', size:fs.statSync(file).size };
  }
  function validateState(state) {
    if (!state || !state.meta || !state.settings || !state.counters || !Array.isArray(state.operationCases) ||
        !Array.isArray(state.measurements) || !Array.isArray(state.members)) fail('业务数据结构不完整');
    for (const key of Object.keys(state)) {
      if (['__proto__','constructor','prototype'].includes(key)) fail('备份包含无效集合');
      if (['meta','settings','counters'].includes(key)) {
        if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) fail('备份属性不正确');
        continue;
      }
      if (!Array.isArray(state[key]) || state[key].some((item) => !item || typeof item !== 'object' || Array.isArray(item))) fail('备份集合结构不正确');
    }
    return state;
  }
  function unpack(file, dir) {
    const db = new DatabaseSync(file, { readOnly:true });
    try {
      db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
      const schema = db.prepare("SELECT name,type FROM sqlite_schema WHERE name IN ('manifest','files','blocks')").all();
      if (schema.length !== 3 || schema.some((r) => r.type !== 'table')) fail('文件不是全质业务备份');
      const m = db.prepare('SELECT format,version,scale,createdAt FROM manifest').get();
      if (m?.format !== identity || m.version !== 1) fail('备份格式或版本不受支持');
      if (m.scale !== store.scale) fail('备份所属企业版式与当前空间不一致');
      const binary = db.prepare('SELECT seq,length(data) AS size FROM blocks WHERE name=? ORDER BY seq');
      const blob = db.prepare('SELECT data FROM blocks WHERE name=? AND seq=?');
      const seen = new Map();
      for (const item of db.prepare('SELECT name,size,sha FROM files ORDER BY name').iterate()) {
        if (typeof item.name !== 'string' || !safeKey(item.name) || !Number.isSafeInteger(item.size) || item.size < 0 ||
            !/^[a-f\d]{64}$/.test(item.sha) || seen.has(item.name.toLowerCase())) fail('备份文件清单不正确');
        seen.set(item.name.toLowerCase(),item.sha);
        const dest = path.join(dir, ...item.name.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive:true });
        const hash = createHash('sha256');
        const fd = fs.openSync(dest, 'wx', 0o600);
        let size = 0, seq = 0;
        try {
          for (const range of binary.iterate(item.name)) {
            if (range.seq !== seq++ || range.size < 1 || range.size > BLOCK || range.size > item.size - size) fail('备份片段损坏');
            const bytes = blob.get(item.name, range.seq).data;
            let offset=0;
            while (offset<bytes.length) offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset);
            hash.update(bytes);
            size += bytes.length;
          }
        } finally { fs.closeSync(fd); }
        if (size !== item.size || item.sha !== hash.digest('hex')) fail('备份文件校验失败');
      }
      if (!seen.has('business.json') || !seen.has('knowledge.db')) fail('备份缺少业务数据库或知识库索引');
      const data = validateState(JSON.parse(fs.readFileSync(path.join(dir,'business.json'),'utf8')));
      for (const entry of data.operationCases) {
        if (!Array.isArray(entry.files)) fail('工作单附件清单无效');
        for (const attachment of entry.files) {
          const storageName=attachment?.storageName;
          if (!/^[a-f0-9-]{36}\.(pdf|png|jpe?g|txt|csv|json|xlsx|docx)$/.test(storageName) ||
              !seen.has('reports/evidence/'+storageName) ||
              (attachment.sha256 && seen.get('reports/evidence/'+storageName)!==attachment.sha256)) fail('备份缺少工作单附件或文件校验失败');
        }
      }
      const vault = new DatabaseSync(path.join(dir,'knowledge.db'), { readOnly:true });
      try {
        vault.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
        const docs = vault.prepare('SELECT id,size,length(original) AS stored FROM documents').all();
        for (const doc of docs) {
          if (!idPattern.test(doc.id) || (!doc.stored && !seen.has('originals/'+doc.id+'.original'))) fail('备份缺少知识库原件');
          if (!doc.stored && fs.statSync(path.join(dir,'originals',doc.id+'.original')).size !== doc.size) fail('知识库原件大小不一致');
        }
        return { ...m, cases:data.operationCases.length, measurements:data.measurements.length, documents:docs.length, assets:seen.size - 2 };
      } finally { vault.close(); }
    } finally { db.close(); }
  }
  async function receive(request, requestedBy) {
    cleanExpired();
    if (staging.size + receiving >= 3) fail('已有待核对的备份，请先取消或还原',409);
    const id = randomUUID(), dir = path.join(parent(),'restore-' + id);
    fs.mkdirSync(dir,{recursive:true});
    const file = path.join(dir,'archive');
    receiving++;
    try {
      const out = await fs.promises.open(file,'wx',0o600);
      try {
        for await (const chunk of request.iterator({ destroyOnReturn:false })) await out.writeFile(chunk);
        await out.sync();
      } finally { await out.close(); }
      const info = unpack(file,dir);
      fs.unlinkSync(file);
      staging.set(id,{ dir, info, requestedBy, expires:Date.now()+30*60000 });
      return { id, ...info };
    } catch (error) {
      fs.rmSync(dir,{recursive:true,force:true});
      if (error.status) throw error;
      if (['ENOSPC','EDQUOT'].includes(error.code)) fail('可用空间不足，无法预检备份',507);
      if (error.code === 'ERR_SQLITE_ERROR' || error instanceof SyntaxError) fail('文件格式不正确或备份已损坏');
      throw error;
    } finally { receiving--; }
  }
  function prepared(id, requestedBy) {
    cleanExpired();
    const draft = staging.get(id);
    if (!draft || draft.requestedBy !== requestedBy) fail('还原预检已过期，请重新选择备份',404);
    return draft;
  }
  function cancel(id, requestedBy) {
    const draft = prepared(id, requestedBy);
    fs.rmSync(draft.dir, { recursive:true, force:true });
    staging.delete(id);
  }
  function restore(id, actor) {
    const requestedBy = actor?.id || 'local';
    const draft = prepared(id, requestedBy);
    const data = validateState(JSON.parse(fs.readFileSync(path.join(draft.dir,'business.json'),'utf8')));
    if (actor && !data.members.some((m) => m.id === actor.memberId && m.name === actor.name)) {
      fail('备份中没有当前管理员对应的成员。请在独立本机空间还原后重新绑定账号',409);
    }
    const safety = build();
    const knowledge = destinations();
    library.closeForRestore();
    const replaced = [];
    const swap = (key, target) => {
      const source = path.join(draft.dir,key);
      const prior = source + '.previous';
      if (fs.existsSync(target)) fs.renameSync(target,prior);
      replaced.push({ source,target,prior,installed:false });
      if (fs.existsSync(source)) {
        fs.renameSync(source,target);
        replaced.at(-1).installed=true;
      }
    };
    try {
      swap('knowledge.db',knowledge.database);
      swap('originals',knowledge.directory);
      swap('reports',reports);
      fs.mkdirSync(reports,{recursive:true});
      for (const report of data.reports || []) {
        const file = path.basename(report.file || report.path || '');
        if (file && safeKey('reports/' + file)) report.path = path.join(reports,file);
      }
      data.meta.userCleared = true;
      const localLlm = store.getSetting('llm',{});
      store.transaction(() => {
        data.settings.llm = localLlm;
        for (const key of Object.keys(store.db)) if (!Object.hasOwn(data,key) && Array.isArray(store.db[key])) data[key] = [];
        store.db = data;
        store.audit({ user:actor?.name || '本机使用者', plugin:'数据管理', action:'还原业务备份',
          params:{ sourceCreatedAt:draft.info.createdAt, previousBackupId:safety.id } });
      });
    } catch (error) {
      for (const { source,target,prior,installed } of replaced.reverse()) {
        if (installed && fs.existsSync(target)) fs.renameSync(target,source);
        // Reports may be an empty newly created directory if the backup has no reports.
        else if (!installed && target === reports && fs.existsSync(target)) fs.rmdirSync(target);
        if (fs.existsSync(prior)) fs.renameSync(prior,target);
      }
      throw error;
    } finally { library.start(); }
    staging.delete(id);
    try { fs.rmSync(draft.dir, { recursive:true, force:true }); }
    catch (error) { console.warn('[backup] cleanup:',error.code); }
    return { ...draft.info, previousBackupId:safety.id };
  }
  return { build, download, receive, cancel, restore };
}
module.exports = { createBackups };
