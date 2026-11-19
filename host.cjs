'use strict';
/**
 * 质量平台 · 本地服务端（零依赖）
 * ------------------------------------------------------------------
 * 职责：
 *   ① 静态托管前端（public/）
 *   ② 代理大模型请求（解决浏览器跨域 + 密钥不出前端）
 *   ③ 暴露平台 REST API（问题库/项目/SPC/知识库/OA/收益/报表/导入导出）
 *   ④ SSE 流式推送工具调用链与回答
 *
 * 启动：node server.js  （或双击 start.bat）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { pipeline } = require('node:stream/promises');

const ROOT = __dirname;
const LOADED_VERSION = require('./package.json').version;
const PUBLIC_DIR = path.join(ROOT, 'public');
const os = require('os');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
// 指定数据库目录：默认 DSH_HOME/qip-real-v3/data，可用 QIP_REAL_V3_DATA_DIR 覆盖
const DATA_DIR = process.env.QIP_REAL_V3_DATA_DIR || path.join(DSH_HOME, 'qip-real-v3', 'data');
const OUTPUT_DIR = path.join(DATA_DIR, 'reports');
// 版式：本发行版只提供中小型企业版（sme）。large 分支保留在代码里，
// 仅在显式设置环境变量 QIP_SCALE=large 时才启用（用于内部回归测试）。
const SCALE_FILE = path.join(DATA_DIR, 'active-scale.json');
const SCALES = [
  { key: 'sme', label: '中小企业版' },
];
function currentScale() {
  if (process.env.QIP_SCALE === 'large') return 'large';
  return 'sme';
}
function writeScale(scale) {
  fs.writeFileSync(SCALE_FILE, JSON.stringify({ scale, at: new Date().toISOString() }, null, 2), 'utf8');
}

const store = require('./src/lib/store');
const qms = require('./src/lib/qms');
const qmsSurvey = require('./src/lib/qms-survey');
const localWorkflows = require('./src/lib/local-workflows');
const knowledge = require('./src/lib/knowledge-library');
const library = knowledge.createLibrary(store);
const voice = require('./src/lib/voice').createVoice();
const identity = require('./src/lib/signing-identity').createIdentity(store);
const backups = require('./src/lib/business-backup').createBackups({store,library,reports:OUTPUT_DIR});
const qualitySkills = require('./src/lib/quality-skills');
const agent = require('./agent-host.cjs');
const chatResponse = require('./src/lib/chat-response');
const registry = require('./src/tools/registry');
require('./src/tools/data');
require('./src/tools/analysis');
require('./src/tools/business');
require('./src/tools/docs');
const docsTools = require('./src/tools/docs');

/* 运行时依赖由 index.js 注入：真实 DeepSeek（Harness 内置 LLM 服务）*/
const runtime = { llm: null, model: null };
function setRuntime(next) { Object.assign(runtime, next || {}); }
const operations = require('./src/lib/operations').createEngine({ store, outputDir: OUTPUT_DIR, runtime });
registry.define({ name: 'operations_overview', plugin: '质量运营', label: '质量运营待办与流程总览', description: '读取当前待确认方案、执行任务、复核与结案状态。询问今天最该处理什么、谁负责、何时完成时优先查询。只读取本机实际记录。', parameters: {type:'object',properties:{}}, run() { const d = operations.summary(); return {ok:true,counts:d.counts,policy:d.policy,lastScan:d.lastScan,cases:d.cases.filter((c)=>c.status!=='closed').map((c)=>({id:c.id,title:c.title,status:d.labels[c.status],owner:c.owner,due:c.tasks[c.stage]?.due||c.plan.due,next:c.tasks[c.stage]?.instruction||c.plan.action,verification:c.tasks[c.stage]?.verification||c.plan.verification,planVersion:c.tasks[c.stage]?.planVersion,issueId:c.issueId,projectId:c.projectId}))}; } });
registry.define({ name: 'operations_case_get', plugin: '质量运营', label: '查询完整质量工作单', description: '按工作单或问题编号读取处理方案、原始来源、当前阶段、已提交与已接受的执行记录、业务追溯和验证数据。附件只返回元信息，未读取附件正文。不能代替人工批准。', parameters: {type:'object',properties:{id:{type:'string'}},required:['id']}, run(args) { return {ok:true,row:operations.resolve(args.id)}; } });

const PORT = Number(process.env.PORT || 8760);
const HOST = process.env.HOST || '127.0.0.1';

/* ================================================================== */
/* 工具函数                                                           */
/* ================================================================== */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendText(res, code, text, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(text);
}
function readBody(req, maxBytes = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    function receive(c) {
      size += c.length;
      if (size > maxBytes) {
        req.off('data', receive);
        chunks.length = 0;
        reject(Object.assign(new Error('请求体过大（上限 ' + Math.round(maxBytes / 1048576) + ' MB）'), { status: 413 }));
        return;
      }
      chunks.push(c);
    }
    req.on('data', receive);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const b = await readBody(req, limit);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch (e) { throw new Error('请求体不是合法 JSON'); }
}
function qs(req) {
  const u = new URL(req.url || '/', 'http://x');
  const out = {};
  u.searchParams.forEach((value, key) => { out[key] = value; });
  return out;
}

/** 对外输出设置时隐藏 API Key 明文 */
function publicSettings() {
  const s = JSON.parse(JSON.stringify(store.db.settings || {}));
  const model = runtime.model || null;
  s.llm = Object.assign({}, s.llm || {}, {
    source: 'deepseek-harness',
    hasApiKey: !!model, // 直接复用 Harness 已登录的 DeepSeek 模型，无需单独填 Key
    provider: model ? model.provider : '',
    model: model ? model.model : '',
    modelLabel: model ? (model.provider + ' / ' + model.model) : '未连接',
    description: model
      ? '插件内所有 AI 能力都通过 DeepSeek Harness 当前模型真实调用（真实模型调用，非预设话术）'
      : 'Harness 当前没有可用模型，请先在 Harness 里完成模型接入',
  });
  delete s.llm.apiKey;
  for (const config of Object.values(s.plugins || {})) {
    if (config && typeof config === 'object') delete config.apiKey;
  }
  return s;
}

/* ================================================================== */
/* 路由表                                                             */
/* ================================================================== */
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }
function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method && r.method !== '*') continue;
    const m = pathname.match(r.pattern);
    if (m) return { handler: r.handler, params: m.slice(1).map(decodeURIComponent) };
  }
  return null;
}

/* V3: one durable work order from intake to closure; existing endpoints stay available. */

/* Local employee accounts provide verified identities for the quality work order. */
route('GET', /^\/api\/signing$/, async (req, res) => sendJson(res,200,{ ok:true, ...identity.visible(req) }));
route('POST', /^\/api\/signing\/setup$/, async (req,res) => {
  if (!identity.loopback(req)) return sendJson(res,403,{ok:false,error:'请在 Harness 所在电脑上启用员工签核'});
  const account = identity.enroll(await readJson(req),true);
  sendJson(res,201,{ok:true,actor:identity.startSession(req,res,account)});
});
route('POST', /^\/api\/signing\/login$/, async (req,res) => sendJson(res,200,{ok:true,actor:identity.login(req,res,await readJson(req))}));
route('POST', /^\/api\/signing\/logout$/, async (req,res) => { identity.logout(req,res); sendJson(res,200,{ok:true}); });
function requireManager(req) {
  if (req.signer?.role === 'manager' || !identity.configured() && identity.loopback(req)) return;
  throw Object.assign(new Error('该操作需要已登录的质量主管'),{status:403});
}
route('GET', /^\/api\/signing\/accounts$/, async (req,res) => { requireManager(req); sendJson(res,200,{ok:true,...identity.directoryView()}); });
route('POST', /^\/api\/signing\/accounts$/, async (req,res) => {
  if (req.signer?.role !== 'manager') return sendJson(res,403,{ok:false,error:'请先登录质量主管账号'});
  sendJson(res,201,{ok:true,account:identity.publicAccount(identity.enroll(await readJson(req)))});
});
route('PUT', /^\/api\/signing\/accounts\/([a-f0-9-]+)\/password$/, async (req,res,id) => {
  if (!req.signer) return sendJson(res,401,{ok:false,error:'请先登录员工账号'});
  const account=identity.changePassword(req.signer,id,await readJson(req));
  store.audit({user:req.signer.name,plugin:'员工签核',action:'更新员工登录凭据',params:{accountId:account.id}});
  sendJson(res,200,{ok:true,self:account.id===req.signer.id});
});
route('POST', /^\/api\/signing\/delegations$/, async (req,res) => {
  if (!req.signer) return sendJson(res,401,{ok:false,error:'请先登录员工账号'});
  sendJson(res,201,{ok:true,row:identity.delegate(req.signer,await readJson(req))});
});
route('DELETE', /^\/api\/signing\/delegations\/([a-f0-9-]+)$/, async (req,res,id) => {
  if (!req.signer) return sendJson(res,401,{ok:false,error:'请先登录员工账号'});
  sendJson(res,200,{ok:true,row:identity.revoke(req.signer,id)});
});
route('POST', /^\/api\/backups$/, async (req,res) => {
  requireManager(req);
  const {id,filename,size}=backups.build();
  sendJson(res,201,{ok:true,id,filename,size});
});
route('GET', /^\/api\/backups\/([a-f0-9-]+)$/, async (req,res,id) => {
  requireManager(req);
  const {file,filename,size}=backups.download(id);
  res.writeHead(200,{'Cache-Control':'no-store','Content-Type':'application/octet-stream',
    'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(filename),'Content-Length':size,'X-Content-Type-Options':'nosniff'});
  fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
});
route('POST', /^\/api\/backups\/restore\/prepare$/, async (req,res) => {
  requireManager(req);
  if (req.headers['content-type'] !== 'application/octet-stream') return sendJson(res,415,{ok:false,error:'请选择业务备份文件'});
  const preview = await backups.receive(req,req.signer?.id || 'local');
  sendJson(res,201,{ok:true,...preview});
});
route('DELETE', /^\/api\/backups\/restore\/([a-f0-9-]+)$/, async (req,res,id) => {
  requireManager(req); backups.cancel(id,req.signer?.id || 'local'); sendJson(res,200,{ok:true});
});
route('POST', /^\/api\/backups\/restore\/([a-f0-9-]+)$/, async (req,res,id) => {
  requireManager(req);
  const input=await readJson(req);
  if (input?.confirm !== '还原') return sendJson(res,400,{ok:false,error:'请输入「还原」确认替换当前业务数据'});
  operations.stop();
  let result;
  try { result = backups.restore(id,req.signer); }
  finally { operations.start(); }
  sendJson(res,200,{ok:true,...result});
});
route('PUT', /^\/api\/audit\/retention$/, async (req,res) => {
  requireManager(req);
  const {days}=await readJson(req);
  if (!Number.isSafeInteger(days) || days<1 || days>3650) return sendJson(res,400,{ok:false,error:'留存期限须为 1～3650 天'});
  store.transaction(()=>store.setSetting('auditRetentionDays',days));
  sendJson(res,200,{ok:true,archived:store.archiveAudit()});
});

route('GET', /^\/api\/voice$/, async (req,res) => sendJson(res,200,{ok:true,...voice.status()}));
route('POST', /^\/api\/voice\/prepare$/, async (req,res) => {
  voice.prepare();
  sendJson(res,202,{ok:true,...voice.status()});
});
route('POST', /^\/api\/voice\/transcribe$/, async (req,res) => {
  const cancel = new AbortController();
  const close = () => cancel.abort();
  res.once('close',close);
  try {
    const result = await voice.transcribe(req,cancel.signal);
    if (!cancel.signal.aborted) sendJson(res,200,{ok:true,...result});
  } catch (error) {
    if (!cancel.signal.aborted) throw error;
  } finally { res.off('close',close); }
});
route('GET', /^\/api\/operations\/schema\.js$/, async (req, res) => sendText(res, 200, fs.readFileSync(path.join(ROOT, 'src/lib/business.js'), 'utf8'), MIME['.js']));
route('GET', /^\/api\/operations$/, async (req, res) => sendJson(res, 200, { ok: true, ...operations.summary() }));
route('POST', /^\/api\/operations\/scan$/, async (req, res) => sendJson(res, 200, { ok: true, ...operations.scan() }));
route('PUT', /^\/api\/operations\/characteristics\/([^/]+)\/capability$/, async (req, res, id) => sendJson(res, 200, { ok: true, row: operations.setCapability(id, await readJson(req)) }));
route('PUT', /^\/api\/operations\/policy$/, async (req, res) => sendJson(res, 200, { ok: true, policy: operations.setPolicy(await readJson(req)) }));
route('POST', /^\/api\/operations\/preview$/, async (req, res) => sendJson(res, 200, { ok: true, ...operations.preview(await readJson(req)) }));
route('POST', /^\/api\/operations\/accept$/, async (req, res) => sendJson(res, 200, { ok: true, ...operations.accept(await readJson(req)) }));
route('POST', /^\/api\/operations\/cases$/, async (req, res) => sendJson(res, 201, { ok: true, row: operations.create(await readJson(req)) }));
route('POST', /^\/api\/operations\/cases\/([^/]+)\/draft$/, async (req, res, id) => { const row = operations.requestDraft(id, await readJson(req)); operations.pump().catch((err) => console.error(err.message)); sendJson(res, 202, { ok: true, row }); });
route('POST', /^\/api\/operations\/cases\/([^/]+)\/files$/, async (req,res,id) => {
  const input=await readJson(req);
  const signer=req.signer ? identity.signingActor(req.signer,input?.delegationId) : null;
  sendJson(res,201,{ok:true,...operations.addFile(id,input,signer)});
});
route('GET', /^\/api\/operations\/cases\/([^/]+)\/files\/([^/]+)$/, async (req, res, id, fileId) => {
  const f = operations.getFile(id, fileId); const bytes = fs.readFileSync(f.path);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(f.filename), 'X-Content-Type-Options': 'nosniff', 'Content-Length': bytes.length }); res.end(bytes);
});
route('GET', /^\/api\/operations\/cases\/([^/]+)$/, async (req, res, id) => sendJson(res, 200, { ok: true, row: operations.resolve(id) }));
route('POST', /^\/api\/operations\/cases\/([^/]+)\/(plan|business|supplement|approve|revoke|submit|return|library)$/, async (req,res,id,action) => {
  const input=await readJson(req);
  const signer=req.signer ? identity.signingActor(req.signer,input?.delegationId) : null;
  if (action==='library') {
    if (!Array.isArray(input.documentIds) || input.documentIds.length>12 || input.documentIds.some((v)=>typeof v!=='string')) {
      return sendJson(res,400,{ok:false,error:'一次最多关联 12 份资料'});
    }
    const c=operations.resolve(id);
    const retained=new Map((c.libraryRefs || []).map((ref)=>[ref.id,ref]));
    const catalog=new Map(library.list().map((d)=>[d.id,d]));
    input.refs=[...new Set(input.documentIds)].map((key)=>{
      const doc=catalog.get(key);
      if (retained.has(key)) return retained.get(key);
      if (!doc || !doc.effective || doc.status!=='ready' || (doc.product && doc.product!==c.product) || (doc.process && doc.process!==c.location)) {
        throw Object.assign(new Error('只能关联当前有效且适用于该工作单的资料'),{status:409});
      }
      const {id,name,documentNumber,revision,effectiveFrom,product,process}=doc;
      return {id,name,documentNumber,revision,effectiveFrom,product,process};
    });
  }
  if (action==='approve') {
    const c=operations.resolve(id);
    if (c.status==='plan_review' && (c.libraryRefs || []).some((ref)=>!library.usable(ref.id))) {
      return sendJson(res,409,{ok:false,error:'方案引用的资料已失效，请在文件依据中选择当前有效版'});
    }
  }
  sendJson(res,200,{ok:true,row:operations.act(id,action,input,signer)});
});
route('GET', /^\/api\/operations\/events$/, async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = () => { if (!res.destroyed) res.write('data: ' + JSON.stringify({ revision: operations.summary().revision }) + '\n\n'); };
  send(); const off = store.on(send); const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000); heartbeat.unref?.();
  res.on('close', () => { off(); clearInterval(heartbeat); });
});
route('GET', /^\/api\/operations\/skill-templates$/, async (req, res) => sendJson(res, 200, { ok: true, templates: qualitySkills.templates }));
route('GET', /^\/api\/operations\/analysis$/, async (req, res) => sendJson(res, 200, { ok: true, rows: store.col('analysisRecords').all().slice().reverse() }));
route('POST', /^\/api\/operations\/analysis$/, async (req, res) => sendJson(res, 201, { ok: true, row: await operations.analyze(await readJson(req)) }));
route('PUT', /^\/api\/operations\/analysis\/([^/]+)$/, async (req,res,id) => sendJson(res,200,{ok:true,row:operations.editAnalysis(id,await readJson(req))}));
route('GET', /^\/api\/operations\/analysis\/([^/]+)\/download$/, async (req, res, id) => {
  const row = store.col('analysisRecords').get(id); if (!row) return sendJson(res, 404, { ok: false, error: '分析记录不存在' });
  const format = new URL(req.url, 'http://x').searchParams.get('format');
  if (row.skillReport && (format === 'docx' || format === 'xlsx')) {
    const office = require('./src/lib/office');
    const bytes = format === 'docx' ? office.docxWrite(qualitySkills.docxBlocks(row)) : office.xlsxWrite(row.skillReport.sections.map((s, i) => ({
      name: '章节 ' + (i + 1), headerRow: false, rows: [[s.title], ...s.tables.flatMap((t) => [[t.title], t.header, ...t.rows.map((cells) => cells.map((v) => typeof v === 'number' ? v : qualitySkills.got(v))), []])],
    })));
    res.writeHead(200, { 'Content-Type': MIME['.' + format], 'Content-Disposition': 'attachment; filename="analysis-' + encodeURIComponent(id) + '.' + format + '"', 'Content-Length': bytes.length });
    return res.end(bytes);
  }
  res.setHeader('Content-Disposition', 'attachment; filename="analysis-' + encodeURIComponent(id) + '.md"');
  sendText(res, 200, '# ' + row.title + '\n\n' + row.source + '\n\n' + row.outputs, MIME['.md']);
});
route('GET', /^\/api\/operations\/cases\/([^/]+)\/report$/, async (req, res, id) => {
  const c = operations.resolve(id); if (c.status !== 'closed') return sendJson(res, 409, { ok: false, error: '请先确认结案再下载归档报告' });
  store.transaction(() => operations.report(c)); const rec = store.col('reports').get(c.reportId); const bytes = fs.readFileSync(rec.path);
  res.writeHead(200, { 'Content-Type': MIME['.docx'], 'Content-Disposition': 'attachment; filename="quality-operation.docx"', 'Content-Length': bytes.length }); res.end(bytes);
});

/* ---------------- 健康检查与元信息 ---------------- */
route('GET', /^\/api\/health$/, async (req, res) => {
  sendJson(res, 200, {
    ok: true, service: brandName(), version: LOADED_VERSION,
    uptime: Math.round(process.uptime()) + 's',
    dataDir: DATA_DIR, counts: countAll(),
    db: store.persist ? store.persist.info() : { engine: 'json', path: store.file },
    llmConfigured: !!runtime.llm,
    model: runtime.model || null,
  });
});
route('GET', /^\/api\/bootstrap$/, async (req, res) => {
  const snap = docsTools.dashboardSnapshot('');
  sendJson(res, 200, {
    ok: true,
    org: store.getSetting('org', {}),
    hasSampleData: !store.db.meta.userCleared,
    brand: brandName(),
    scale: currentScale(),
    scales: SCALES,
    naming: currentNaming(),
    settings: publicSettings(),
    counts: countAll(),
    todos: store.col('todos').find((t) => !t.done).slice(0, 20),
    pendingActions: store.col('pendingActions').find((a) => a.status === 'pending'),
    tools: registry.all().map((t) => ({ name: t.name, label: t.label, plugin: t.plugin, write: t.write, confirm: t.confirm, description: t.description })),
    kpi: snap,
    serverTime: new Date().toISOString(),
  });
});
function countAll() {
  return {
    issues: store.col('issues').count(), projects: store.col('projects').count(),
    measurements: store.col('measurements').count(), spcChars: store.col('spcChars').count(),
    knowledge: store.col('knowledge').count(), defects: store.col('defects').count(),
    members: store.col('members').count(), workflows: store.col('workflows').count(),
    qrqc: store.col('qrqc').count(), benefits: store.col('benefits').count(),
    reports: store.col('reports').count(), audit: store.col('audit').count(),
    chats: store.col('chats').count(),
  };
}

/* ---------------- 设置 ---------------- */
route('GET', /^\/api\/settings$/, async (req, res) => sendJson(res, 200, { ok: true, settings: publicSettings() }));
route('POST', /^\/api\/settings$/, async (req, res) => {
  const body = await readJson(req);
  // 深度合并
  function merge(base, patch) {
    for (const k of Object.keys(patch || {})) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
      if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) { base[k] = merge(base[k] || {}, patch[k]); }
      else base[k] = patch[k];
    }
    return base;
  }
  const cur = store.db.settings || {};
  // apiKey 为空字符串时不覆盖已有值；为 null 时表示清除
  const incoming = JSON.parse(JSON.stringify(body.settings || body));
  if (incoming.llm) {
    if (incoming.llm.apiKey === '' || incoming.llm.apiKey === undefined) delete incoming.llm.apiKey;
    else if (incoming.llm.apiKey === null) incoming.llm.apiKey = '';
  }
  store.transaction(() => { store.db.settings = merge(cur, incoming); });
  sendJson(res, 200, { ok: true, settings: publicSettings() });
});
/* ---------------- 版式：本发行版只提供「中小企业版」 ---------------- */
route('GET', /^\/api\/scale$/, async (req, res) => sendJson(res, 200, { ok: true, scale: currentScale(), scales: SCALES, single: true }));
route('POST', /^\/api\/scale$/, async (req, res) => {
  // 单一版式：不再支持切换，接口保留只为兼容旧前端/旧脚本
  const body = await readJson(req);
  const want = body && body.scale;
  if (want && want !== currentScale()) {
    return sendJson(res, 400, { ok: false, error: '本发行版只提供中小企业版，不支持切换为大中型企业版' });
  }
  return sendJson(res, 200, { ok: true, scale: currentScale(), changed: false, counts: countAll(), brand: brandName(), naming: currentNaming() });
});
/* ---------------- 初始设置：公司 / 部门 / 车间 / 产品名称 ---------------- */
route('GET', /^\/api\/brand$/, async (req, res) => sendJson(res, 200, { ok: true, brand: brandName() }));
const DEFAULT_NAMING = {
  company: '某某精密制造有限公司',
  dept: '质量部',
  workshops: ['一车间', '二车间'],
  products: ['产品甲', '产品乙'],
};
/** 平台显示名：用户在「初始设置」里填了公司名称就显示公司名称，否则用内置名 */
const DEFAULT_BRAND = '全质开源质量平台2';
function brandName() {
  const s = store.db.settings || {};
  const b = typeof s.brand === 'string' ? s.brand.trim() : '';
  return DEFAULT_BRAND;
}

/** 当前生效的命名：org 里的公司/部门优先，其余回落 settings.naming → 内置默认 */
function currentNaming() {
  const s = store.db.settings || {};
  const n = s.naming || {};
  const org = s.org || {};
  const ws = (Array.isArray(n.workshops) && n.workshops.length) ? n.workshops.slice() : DEFAULT_NAMING.workshops.slice();
  const pd = (Array.isArray(n.products) && n.products.length) ? n.products.slice() : DEFAULT_NAMING.products.slice();
  return {
    company: org.company || n.company || DEFAULT_NAMING.company,
    dept: org.dept || n.dept || DEFAULT_NAMING.dept,
    workshops: ws,
    products: pd,
  };
}

/**
 * 两组名称的对齐：先按「完全同名」配对（这样中间插入、调换顺序都不会误替换），
 * 剩下的按顺序一一对应；多出来的旧名视为「已移除」，数据保留原名不动。
 */
function pairLists(oldList, newList) {
  const usedOld = new Set();
  const matchedNew = new Set();
  newList.forEach((nm, j) => {
    const i = oldList.findIndex((o, k) => o === nm && !usedOld.has(k));
    if (i >= 0) { usedOld.add(i); matchedNew.add(j); }
  });
  const restOld = oldList.filter((_, k) => !usedOld.has(k));
  const restNew = newList.filter((_, j) => !matchedNew.has(j));
  const pairs = [];
  const n = Math.min(restOld.length, restNew.length);
  for (let k = 0; k < n; k++) if (restOld[k] && restNew[k] && restOld[k] !== restNew[k]) pairs.push([restOld[k], restNew[k]]);
  return { pairs, dropped: restOld.slice(n), added: restNew.slice(n) };
}

/** 旧名 → 新名 的替换对（长串优先，避免短词先吃掉长词） */
function buildRenamePairs(oldN, newN) {
  const pairs = [];
  const push = (from, to) => { if (from && to && from !== to && pairs.every((p) => p[0] !== from)) pairs.push([from, to]); };
  const ws = pairLists(oldN.workshops, newN.workshops);
  const pd = pairLists(oldN.products, newN.products);
  ws.pairs.forEach(([f, t]) => push(f, t));
  pd.pairs.forEach(([f, t]) => push(f, t));
  push(oldN.company, newN.company);
  push(oldN.dept, newN.dept);
  pairs.sort((a, b) => b[0].length - a[0].length);
  return { pairs, dropped: ws.dropped.concat(pd.dropped), added: ws.added.concat(pd.added) };
}

/** 递归替换字符串（含数组与对象，就地修改 map 里的值） */
function renameStrings(node, pairs, stat) {
  if (typeof node === 'string') {
    let out = node;
    for (const [from, to] of pairs) if (out.indexOf(from) >= 0) out = out.split(from).join(to);
    if (out !== node && stat) stat.fields++;
    return out;
  }
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) node[i] = renameStrings(node[i], pairs, stat); return node; }
  if (node && typeof node === 'object') { Object.keys(node).forEach((k) => { node[k] = renameStrings(node[k], pairs, stat); }); return node; }
  return node;
}
const RENAME_COLLECTIONS = ['issues', 'projects', 'knowledge', 'qrqc', 'todos', 'benefits', 'reports', 'members',
  'spcChars', 'defects', 'workflows', 'measurements', 'chats', 'audit', 'pendingActions'];

route('GET', /^\/api\/naming$/, async (req, res) => sendJson(res, 200, {
  ok: true, naming: currentNaming(), brand: brandName(), defaults: DEFAULT_NAMING,
  note: (store.db.settings || {}).namingNote || null,
  limits: { workshops: 12, products: 10 },
}));
route('POST', /^\/api\/naming$/, async (req, res) => {
  const body = await readJson(req);
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 40);
  const pick = (arr, max) => (Array.isArray(arr) ? arr : []).map(clean).filter(Boolean).slice(0, max);
  const workshops = pick(body.workshops, 12);
  const products = pick(body.products, 10);
  const company = clean(body.company) || DEFAULT_NAMING.company;
  const dept = clean(body.dept) || DEFAULT_NAMING.dept;
  if (!workshops.length) return sendJson(res, 400, { ok: false, error: '至少要有 1 个车间' });
  if (!products.length) return sendJson(res, 400, { ok: false, error: '至少要有 1 个产品' });
  if (new Set(workshops).size !== workshops.length) return sendJson(res, 400, { ok: false, error: '车间名称不能重复' });
  if (new Set(products).size !== products.length) return sendJson(res, 400, { ok: false, error: '产品名称不能重复' });
  const oldN = currentNaming();
  const newN = { company, dept, workshops, products };
  const built = buildRenamePairs(oldN, newN);
  const pairs = built.pairs;
  const stat = { fields: 0 };
  if (pairs.length) {
    RENAME_COLLECTIONS.forEach((k) => { if (store.db[k]) renameStrings(store.db[k], pairs, stat); });
  }
  store.db.settings = store.db.settings || {};
  store.db.settings.naming = newN;
  const brandIn = typeof body.brand === 'string' ? clean(body.brand) : '';
  // 公司名称还是内置占位（某制造型企业）时保持平台原名，避免「没填也变」的错觉
  store.db.settings.brand = brandIn || (company === DEFAULT_NAMING.company ? DEFAULT_BRAND : company);
  store.db.settings.org = Object.assign({}, store.db.settings.org || {}, { company, dept });
  const note = clean(body.note);
  if (note) store.db.settings.namingNote = { text: body.note, ts: new Date().toISOString() };
  store.db.meta = store.db.meta || {};
  store.db.meta.namingV = (store.db.meta.namingV || 0) + 1;
  store.touch(); store.saveSync(true); store.emit();
  console.log('[qip-real-v3] 初始设置已应用：' + company + ' / ' + dept + ' / 车间 ' + workshops.join('、') + ' / 产品 ' + products.join('、') +
    '（替换 ' + pairs.length + ' 组旧名，改动 ' + stat.fields + ' 个字段' + (built.dropped.length ? '，移除 ' + built.dropped.length + ' 个旧名' : '') + '）');
  sendJson(res, 200, { ok: true, naming: Object.assign({}, newN, { brand: store.db.settings.brand }), renamed: { pairs: pairs.length, fields: stat.fields, dropped: built.dropped, added: built.added } });
});

/**
 * 「增加信息」：把用户自由写的需求交给 AI，判断该怎么改平台配置。
 * 只做「建议」，不直接落库；前端确认后再走 /api/naming 应用到数据。
 */
route('POST', /^\/api\/naming\/interpret$/, async (req, res) => {
  const body = await readJson(req);
  const text = String(body.text || '').trim();
  if (!text) return sendJson(res, 400, { ok: false, error: '请先在「增加信息」里写点内容' });
  const cur = currentNaming();
  // 无论有没有模型，先把这段说明存下来，别让用户的输入丢掉
  store.db.settings = store.db.settings || {};
  store.db.settings.namingNote = { text, ts: new Date().toISOString() };
  store.touch();
  if (!runtime.llm) {
    return sendJson(res, 200, {
      ok: false, needModel: true,
      error: '当前没有可用的模型：请先在 Harness 里接入模型，AI 才能判断如何调整。这段说明已经保存下来了。',
      naming: cur,
    });
  }
  const system = [
    '您是「' + brandName() + '」的配置助手。用户会用自然语言补充企业信息（产线、车间、产品、部门、班次等）。',
    '您的任务是判断：为了让平台贴合用户描述，应该把「初始设置」里的名称改成什么。',
    '只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。字段：',
    '{"summary":"一句话说明您打算怎么调整","naming":{"company":"公司名称或空","dept":"部门名称或空","workshops":["按顺序的车间名"],"products":["按顺序的产品名"]},',
    ' "extra":[{"path":"建议调整的设置项","value":"建议值","why":"理由"}],"steps":["给用户的操作提示"]}',
    '规则：workshops 至少 1 个、最多 12 个；products 至少 1 个、最多 10 个；',
    '如果用户没提到的类别，就把该字段留空字符串或空数组（表示保持现状）；不要编造用户没说的车间/产品名称。',
  ].join('\n');
  const user = '【当前配置】\n' + JSON.stringify(cur) + '\n\n【用户补充信息】\n' + text + '\n\n请输出 JSON。';
  try {
    const r = await runtime.llm.complete({ system, user, maxTokens: 1600 });
    const raw = String(r.text || '');
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    let plan = null;
    if (s >= 0 && e > s) { try { plan = JSON.parse(raw.slice(s, e + 1)); } catch (_) { plan = null; } }
    if (!plan) return sendJson(res, 200, { ok: false, error: 'AI 返回的不是可用的 JSON，请再试一次或把需求写得更具体。', raw: raw.slice(0, 800) });
    const nm = plan.naming || {};
    const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 40);
    const ws = (Array.isArray(nm.workshops) ? nm.workshops : []).map(clean).filter(Boolean).slice(0, 12);
    const pd = (Array.isArray(nm.products) ? nm.products : []).map(clean).filter(Boolean).slice(0, 10);
    const suggestion = {
      summary: clean(plan.summary) || '（AI 未给出说明）',
      company: clean(nm.company) || cur.company,
      dept: clean(nm.dept) || cur.dept,
      workshops: ws.length ? ws : cur.workshops.slice(),
      products: pd.length ? pd : cur.products.slice(),
      extra: Array.isArray(plan.extra) ? plan.extra.slice(0, 8) : [],
      steps: (Array.isArray(plan.steps) ? plan.steps : []).map((x) => String(x).slice(0, 200)).slice(0, 8),
    };
    console.log('[qip-real-v3] AI 已解析「增加信息」：' + suggestion.summary);
    sendJson(res, 200, { ok: true, suggestion, current: cur, model: r.model, provider: r.provider });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: 'AI 判断失败：' + err.message });
  }
});

route('POST', /^\/api\/settings\/test-llm$/, async (req, res) => {
  if (!runtime.llm) {
    return sendJson(res, 200, { ok: false, steps: [{ name: '① 模型接入', ok: false, detail: 'Harness 宿主没有可用的 LLM 服务。', ms: 0 }] });
  }
  try {
    const r = await runtime.llm.ping();
    sendJson(res, 200, r);
  } catch (e) {
    sendJson(res, 200, { ok: false, steps: [{ name: '连通性测试', ok: false, detail: e.message, ms: 0 }] });
  }
});
/* ---------------- 数据集合通用读写 ---------------- */
const WRITABLE = {
  issues: ['title', 'description', 'model', 'workshop', 'station', 'source', 'severity', 'owner', 'status', 'projectId', 'rootCause', 'containment', 'verifyResult', 'quantity', 'tags'],
  projects: ['title', 'description', 'model', 'workshop', 'owner', 'severity', 'stage', 'benefitEstimate', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'],
  knowledge: ['title', 'problem', 'cause', 'action', 'effect', 'tags', 'category', 'model', 'author', 'type', 'status'],
  qrqc: ['topic', 'problem', 'tempAction', 'owner', 'status', 'level', 'attendees'],
  todos: ['title', 'user', 'priority', 'dueAt', 'done', 'link'],
  benefits: ['projectId', 'type', 'amount', 'period', 'note', 'status'],
  members: ['name', 'role', 'dept', 'seniority', 'expert', 'skills', 'phone'],
  spcChars: ['name', 'model', 'workshop', 'station', 'nominal', 'usl', 'lsl', 'unit', 'subgroupSize', 'ctq'],
  defects: ['type', 'workshop', 'station', 'model', 'confidence', 'severity', 'batch', 'ts'],
  workflows: ['type', 'title', 'content', 'applicant', 'status', 'relatedId'],
  reports: ['type', 'title', 'period', 'status', 'scope'],
  chats: ['title', 'messages'],
};

route('POST', /^\/api\/(qrqc|benefits|workflows)\/([^/]+)\/decision$/, async (req,res,col,id) =>
  sendJson(res, 200, {ok:true,row:localWorkflows.decide(store,col,id,{...await readJson(req),...(req.signer ? {author:req.signer.name} : {})})}));
route('POST', /^\/api\/members\/([^/]+)\/growth$/, async (req,res,id) =>
  sendJson(res, 201, {ok:true,row:localWorkflows.recordGrowth(store,id,await readJson(req))}));

Object.keys(WRITABLE).forEach((col) => {
  route('GET', new RegExp('^/api/' + col + '$'), async (req, res) => {
    const q = qs(req);
    let rows = store.col(col).all().slice();
    // 通用筛选：任意字段精确匹配 + keyword 模糊 + days 时间窗 + limit/offset + sort
    for (const [k, v] of Object.entries(q)) {
      if (['keyword', 'days', 'limit', 'offset', 'sort', 'order'].includes(k)) continue;
      if (v === '' || v === undefined) continue;
      rows = rows.filter((r) => String(r[k] === undefined ? '' : r[k]) === String(v));
    }
    if (q.keyword) { const k = String(q.keyword); rows = rows.filter((r) => JSON.stringify(r).indexOf(k) >= 0); }
    if (q.days) { const since = new Date(Date.now() - Number(q.days) * 86400000).toISOString(); rows = rows.filter((r) => (r.createdAt || r.ts || '') >= since); }
    if (q.sort) { const f = String(q.sort), dir = q.order === 'asc' ? 1 : -1; rows.sort((a, b) => (a[f] > b[f] ? dir : a[f] < b[f] ? -dir : 0)); }
    const total = rows.length;
    const offset = Number(q.offset || 0), limit = q.limit ? Number(q.limit) : 200;
    rows = rows.slice(offset, offset + limit);
    sendJson(res, 200, { ok: true, total, rows: col === 'chats' ? rows.map(chatResponse.historyRow) : rows });
  });
  route('POST', new RegExp('^/api/' + col + '$'), async (req, res) => {
    const body = await readJson(req);
    if (col === 'members') return sendJson(res, 201, { ok: true, row: localWorkflows.saveMember(store, '', body) });
    const doc = {};
    WRITABLE[col].forEach((k) => { if (body[k] !== undefined) doc[k] = body[k]; });
    const rec = store.col(col).insert(doc);
    res && sendJson(res, 200, { ok: true, row: rec });
  });
  route('GET', new RegExp('^/api/' + col + '/([^/]+)$'), async (req, res, id) => {
    const rec = store.col(col).get(id);
    if (!rec) return sendJson(res, 404, { ok: false, error: '未找到 ' + id });
    sendJson(res, 200, { ok: true, row: col === 'chats' ? chatResponse.historyRow(rec) : rec });
  });
  route('PUT', new RegExp('^/api/' + col + '/([^/]+)$'), async (req, res, id) => {
    const body = await readJson(req);
    if (col === 'members') return sendJson(res, 200, { ok: true, row: localWorkflows.saveMember(store, id, body) });
    if (['qrqc', 'benefits', 'workflows'].includes(col) && body.status !== undefined) {
      return sendJson(res, 409, { ok: false, error: '请通过对应的处理操作记录决定及依据' });
    }
    const patch = {};
    WRITABLE[col].forEach((k) => { if (body[k] !== undefined) patch[k] = body[k]; });
    const rec = col === 'todos' ? localWorkflows.updateTodo(store, id, patch) : store.col(col).update(id, patch);
    if (!rec) return sendJson(res, 404, { ok: false, error: '未找到 ' + id });
    sendJson(res, 200, { ok: true, row: rec });
  });
  route('DELETE', new RegExp('^/api/' + col + '/([^/]+)$'), async (req, res, id) => {
    if (col==='members' && identity.memberHasAccount(store.col('members').get(id)?.id)) return sendJson(res,409,{ok:false,error:'成员已绑定签核账号，请保留该成员记录'});
    const ok = store.col(col).remove(id);
    sendJson(res, 200, { ok, error: ok ? undefined : '未找到 ' + id });
  });
});

/* ---------------- 工具直接调用（供界面按钮用） ---------------- */
route('GET', /^\/api\/tools$/, async (req, res) => {
  sendJson(res, 200, { ok: true, tools: registry.all().map((t) => ({ name: t.name, label: t.label, plugin: t.plugin, description: t.description, write: t.write, confirm: t.confirm, parameters: t.parameters })) });
});
route('POST', /^\/api\/tools\/([^/]+)$/, async (req, res, name) => {
  const tool = registry.get(name);
  if (!tool) return sendJson(res, 404, { ok: false, error: '工具不存在：' + name });
  const args = await readJson(req);
  try {
    const out = await tool.run(args, { outputDir: OUTPUT_DIR });
    store.audit({ user: '当前用户', plugin: tool.plugin, action: tool.label + '（界面直接调用）', params: args, resultSummary: agent.summarize(name, out), purpose: '界面操作' });
    sendJson(res, 200, { ok: out && out.ok !== false, error: out?.error, result: out, summary: agent.summarize(name, out) });
  } catch (e) {
    sendJson(res, 200, { ok: false, error: e.message });
  }
});

/* Personal document library, independent of the legacy example/experience cards. */
function allowLibraryAccess(req) {
  const origin = req.headers.origin;
  if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== 'http://' + req.headers.host && origin !== 'https://' + req.headers.host)) {
    throw Object.assign(new Error('请从插件页面访问知识库'), { status: 403 });
  }
}
function requestSignal(res) {
  const ac = new AbortController();
  res.once('close', () => ac.abort());
  return ac.signal;
}

route('GET', /^\/api\/library$/, async (req, res) => {
  allowLibraryAccess(req);
  sendJson(res, 200, { ok: true, documents: library.list(), formats: knowledge.formats, storage: library.storage(), embeddingEnabled: library.embeddingEnabled });
});
route('POST', /^\/api\/library$/, async (req, res) => {
  allowLibraryAccess(req);
  const raw = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() === 'application/octet-stream';
  let result;
  if (raw) {
    const expected = req.headers['content-length'] === undefined ? undefined : Number(req.headers['content-length']);
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0)) {
      return sendJson(res, 400, { ok:false, error:'文件大小不正确' });
    }
    try {
      result = await library.uploadStream(qs(req).filename, req, expected);
    } catch (error) {
      if (req.destroyed || res.destroyed) return;
      if (!req.complete) {
        res.setHeader('Connection', 'close');
        req.resume();
      }
      throw error;
    }
  } else {
    // The old JSON client still buffers base64. Browser uploads use the binary stream above.
    const input = await readJson(req, Math.ceil(knowledge.MAX_LEGACY_UPLOAD_BYTES / 3) * 4 + 8192);
    result = library.upload(input);
  }
  sendJson(res, result.duplicate ? 200 : 202, { ok: true, ...result });
});
route('GET', /^\/api\/library\/search$/, async (req, res) => {
  allowLibraryAccess(req);
  const { q, id } = qs(req);
  const params = qs(req);
  sendJson(res, 200, { ok: true, excerpts: library.search(q, { id, product: String(params.product || '').slice(0,80), process: String(params.process || '').slice(0,80) }) });
});
route('GET', /^\/api\/library\/([a-f0-9-]+)\/parts\/(\d+)$/, async (req, res, id, part) => {
  allowLibraryAccess(req);
  sendJson(res, 200, { ok: true, excerpt: library.context(library.excerpt(id, Number(part))) });
});
route('GET', /^\/api\/library\/([a-f0-9-]+)\/download$/, async (req, res, id) => {
  allowLibraryAccess(req);
  const row = library.original(id);
  let handle;
  if (row.file) {
    try { handle = await fs.promises.open(row.file, 'r'); }
    catch (error) {
      if (error.code === 'ENOENT') return sendJson(res, 404, { ok:false, error:'本机缺少该原文件' });
      throw error;
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(row.name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16)),
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Length': row.size });
  if (handle) await pipeline(handle.createReadStream(), res);
  else res.end(row.original);
});
route('PUT', /^\/api\/library\/([a-f0-9-]+)\/version$/, async (req,res,id) => {
  requireManager(req);
  const document=library.setVersion(id,await readJson(req));
  store.audit({user:req.signer?.name || '本机使用者',plugin:'知识库',action:'更新文件版次',params:{id,revision:document.revision,state:document.revisionState}});
  sendJson(res,200,{ok:true,document});
});
route('POST', /^\/api\/library\/([a-f0-9-]+)\/retry$/, async (req, res, id) => {
  allowLibraryAccess(req);
  library.retry(id);
  sendJson(res, 202, { ok: true });
});
route('DELETE', /^\/api\/library\/([a-f0-9-]+)$/, async (req, res, id) => {
  allowLibraryAccess(req);
  library.remove(id);
  sendJson(res, 200, { ok: true });
});
route('POST', /^\/api\/library\/suggestions$/, async (req, res) => {
  allowLibraryAccess(req);
  const signal = AbortSignal.any([requestSignal(res), AbortSignal.timeout(65000)]);
  const body = await readJson(req, 4096);
  const candidates = await knowledge.suggestions(library, runtime.model && runtime.llm, body?.target, body?.documentId ?? '', signal);
  sendJson(res, 200, { ok: true, candidates });
});

/* ---------------- 对话（SSE 流式） ---------------- */
route('POST', /^\/api\/chat\/stream$/, async (req, res) => {
  const body = await readJson(req);
  const libraryMode = body?.scope === 'library';
  if (typeof body?.text !== 'string' || !body.text.trim()) {
    return sendJson(res, 400, { ok: false, error: '请填写要发送的问题。' });
  }
  if (libraryMode) {
    allowLibraryAccess(req);
    if (body.text.length > 4000) {
      return sendJson(res, 400, { ok: false, error: '请填写不超过 4000 字的知识库问题' });
    }
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) {} };
  send({ type: 'connected' });

  const signal = requestSignal(res);

  const sessionId = body.sessionId || 'default';
  const settings = store.db.settings || {};
  const history = Array.isArray(body.history) ? body.history : [];

  try {
    let result = chatResponse.clarify(body.text, body.scope);
    if (result) {
      send({ type: 'content', text: result.content });
      send({ ...result, type: 'done' });
    } else if (libraryMode) {
      send({ type: 'library_search' });
      result = { ok: true, ...await knowledge.answer(library, runtime.model && runtime.llm, body.text.trim(), history,
        AbortSignal.any([signal, AbortSignal.timeout(65000)]), {product: typeof body.product==='string' ? body.product.slice(0,80) : '', process: typeof body.process==='string' ? body.process.slice(0,80) : ''}) };
      send({ type: 'content', text: result.content });
      send({ type: 'library_sources', sources: result.sources });
    } else {
      result = await agent.run({ text: body.text, sessionId, settings, history, signal, outputDir: OUTPUT_DIR }, send);
    }
    if (signal.aborted) return;
    // 保存会话
    if (body.saveHistory !== false && result && result.ok) {
      let chat = store.col('chats').get(sessionId);
      const msgs = (chat ? chat.messages : []).concat([
        { role: 'user', content: body.text, ts: new Date().toISOString() },
        { role: 'assistant', content: result.content, ts: new Date().toISOString(), trace: result.trace, usage: result.usage, sources: result.sources, incomplete: result.incomplete, clarification: result.clarification },
      ]);
      if (chat) store.col('chats').update(sessionId, { messages: msgs, updatedAt: new Date().toISOString() });
      else store.col('chats').insert({ id: sessionId, title: String(body.text).slice(0, 30), messages: msgs });
    }
    send({ type: 'finish', ok: !!(result && result.ok), usage: result && result.usage });
  } catch (e) {
    send({ type: 'error', message: e.message || String(e) });
  }
  res.write('data: [DONE]\n\n');
  res.end();
});
route('POST', /^\/api\/chat\/confirm$/, async (req, res) => {
  const { id } = await readJson(req);
  const r = await agent.executePending(id, OUTPUT_DIR);
  sendJson(res, 200, r);
});
route('POST', /^\/api\/chat\/reject$/, async (req, res) => {
  const { id, reason } = await readJson(req);
  sendJson(res, 200, agent.rejectPending(id, reason));
});
route('GET', /^\/api\/chat\/pending$/, async (req, res) => sendJson(res, 200, { ok: true, rows: store.col('pendingActions').find((a) => a.status === 'pending') }));
route('GET', /^\/api\/chats$/, async (req, res) => sendJson(res, 200, { ok: true, rows: store.col('chats').all().map((c) => ({ id: c.id, title: c.title, count: (c.messages || []).length, updatedAt: c.updatedAt })) }));
route('DELETE', /^\/api\/chats\/([^/]+)$/, async (req, res, id) => sendJson(res, 200, { ok: store.col('chats').remove(id) }));

/* ---------------- 统计与可视化数据 ---------------- */
route('GET', /^\/api\/kpi\/overview$/, async (req, res) => {
  const snap = docsTools.dashboardSnapshot(qs(req).scope || '');
  // 驾驶舱 KPI 由真实统计引擎计算（判异/能力/项目/收益）
  const ov = registry.get('dashboard_overview').run({ days: Number(qs(req).days || 7) });
  const trend = buildTrend();
  const workshopDist = distBy('issues', 'workshop');
  sendJson(res, 200, {
    ok: true,
    kpi: Object.assign({}, snap, { KPI: ov.KPI, 特性状态: ov.特性状态, 高风险特性: ov.高风险特性 }),
    trend, workshopDist, paretoType: distBy('issues', 'type'),
  });
});
function distBy(col, field) {
  const rows = store.col(col).all();
  const m = {};
  rows.forEach((r) => { const k = r[field] || '未分类'; m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}
/** 用测量数据真实构造趋势：按日汇总均值与超差率 */
function buildTrend(days = 14) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = store.col('measurements').all().filter((m) => m.ts >= since);
  const byDay = {};
  for (const r of rows) {
    const d = r.ts.slice(0, 10);
    (byDay[d] = byDay[d] || { day: d, n: 0, sum: 0, oos: 0 });
    byDay[d].n++; byDay[d].sum += r.value;
  }
  const chars = {};
  store.col('spcChars').all().forEach((c) => { chars[c.id] = c; });
  for (const r of rows) {
    const c = chars[r.charId];
    if (c && (r.value > c.usl || r.value < c.lsl)) byDay[r.ts.slice(0, 10)].oos++;
  }
  return Object.values(byDay).sort((a, b) => (a.day < b.day ? -1 : 1)).map((d) => ({
    day: d.day, 合格率: Number((((d.n - d.oos) / d.n) * 100).toFixed(2)), 样本量: d.n, 超差率: Number(((d.oos / d.n) * 100).toFixed(3)),
  }));
}
route('GET', /^\/api\/kpi\/trend$/, async (req, res) => sendJson(res, 200, { ok: true, trend: buildTrend(Number(qs(req).days || 14)) }));
/** 分产品质量健康度（真实计算） */
route('GET', /^\/api\/kpi\/models$/, async (req, res) => {
  const models = ['产品A', '产品B', '产品C'];
  const chars = store.col('spcChars').all();
  const rows = models.map((m) => {
    const mChars = chars.filter((c) => c.model === m);
    let n = 0, oos = 0, cpkSum = 0, cpkN = 0;
    mChars.forEach((c) => {
      const ms = store.col('measurements').find((x) => x.charId === c.id);
      n += ms.length;
      oos += ms.filter((x) => x.value > c.usl || x.value < c.lsl).length;
      try { if (ms.length > 4) { cpkSum += require('./src/lib/stats').capability(ms.map((x) => x.value), c.usl, c.lsl).cpk; cpkN++; } } catch (_) {}
    });
    const defs = store.col('defects').find((d) => d.model === m);
    const issues = store.col('issues').find((i) => i.model === m);
    const openIssues = issues.filter((i) => i.status !== '已关闭');
    const ftt = n ? ((n - oos) / n) * 100 : 0;
    const defectDensity = defs.length ? defs.length : 0;
    const avgCpk = cpkN ? cpkSum / cpkN : 0;
    // 健康度评分：合格率 60% + 过程能力 25% + 问题密度 15%
    const score = Math.max(0, Math.min(100,
      (ftt / 100) * 60 + Math.min(1, avgCpk / 1.67) * 25 + Math.max(0, 1 - openIssues.length / 20) * 15));
    return {
      model: m, 测量点数: n, 超差点: oos, 合格率: Number(ftt.toFixed(2)), 平均Cpk: Number(avgCpk.toFixed(2)),
      AI质检缺陷数: defectDensity, 问题总数: issues.length, 未关闭问题: openIssues.length, A级未关闭: openIssues.filter((i) => i.severity === 'A').length,
      健康度评分: Number(score.toFixed(1)),
      风险提示: (openIssues.filter((i) => i.severity === 'A').slice(0, 1).map((i) => i.title)[0]) || (avgCpk < 1.33 ? '过程能力偏低（Cpk ' + avgCpk.toFixed(2) + '）' : ''),
    };
  });
  sendJson(res, 200, { ok: true, models: rows });
});
route('GET', /^\/api\/kpi\/morning$/, async (req, res) => {
  const r = await agent.morningReport(store.db.settings);
  sendJson(res, 200, { ok: true, markdown: r.markdown, snapshot: r.snapshot, risks: r.risks });
});
route('GET', /^\/api\/spc\/chars$/, async (req, res) => {
  const r = registry.get('spc_list_chars').run({});
  sendJson(res, 200, { ok: true, chars: r.清单 });
});
route('GET', /^\/api\/spc\/detail$/, async (req, res) => {
  const q = qs(req);
  const chart = registry.get('spc_control_chart').run({ charId: q.charId, days: Number(q.days || 7) });
  const cap = registry.get('spc_capability').run({ charId: q.charId, days: Number(q.days || 30) });
  const rules = registry.get('spc_rule_check').run({ charId: q.charId, days: Number(q.days || 7) });
  const hist = registry.get('spc_histogram').run({ charId: q.charId, days: Number(q.days || 30) });
  sendJson(res, 200, { ok: true, chart, capability: cap, rules, histogram: hist });
});
route('GET', /^\/api\/audit$/, async (req, res) => {
  const q = qs(req);
  const archived = q.archive === '1';
  let rows = store.col(archived ? 'auditArchive' : 'audit').all().slice().reverse();
  if (q.plugin) rows = rows.filter((r) => r.plugin === q.plugin);
  if (q.user) rows = rows.filter((r) => r.user === q.user);
  const offset=Math.max(0, Math.trunc(Number(q.offset)) || 0), limit=Math.min(500,Math.max(1,Math.trunc(Number(q.limit)) || 100));
  sendJson(res,200,{ok:true,retentionDays:store.getSetting('auditRetentionDays',365),total:rows.length,rows:rows.slice(offset,offset+limit)});
});

/* ---------------- 导入导出 ---------------- */
route('POST', /^\/api\/import$/, async (req, res) => {
  const body = await readJson(req);
  const { filename, base64, target, mapping } = body;
  if (target && !['measurements', 'issues', 'defects', 'materials', 'bom'].includes(target)) return sendJson(res, 400, { ok:false, error:'不支持该导入目标' });
  if (!filename || !base64) return sendJson(res, 400, { ok: false, error: '缺少 filename / base64' });
  if (!target || target === 'measurements') {
    const preview = operations.preview({ filename, base64 });
    if (body.previewOnly) return sendJson(res, 200, { ok: true, filename, target: 'measurements', ...preview });
    if (preview.checks.some((row) => row.state === 'conflict' ||
      (row.state === 'possible' && !['skip', 'keep'].includes(body.duplicateDecisions?.[row.row])))) {
      return sendJson(res, 409, { ok: false, error: '请在接收预检中核对重复或冲突行', ...preview });
    }
    return sendJson(res, 200, { ok: true, filename, target: 'measurements', ...operations.accept({ previewId: preview.id, duplicateDecisions: body.duplicateDecisions }), preview: preview.preview });
  }
  const buf = Buffer.from(base64, 'base64');
  const office = require('./src/lib/office');
  let sheets;
  try {
    if (/\.xlsx$/i.test(filename)) sheets = office.xlsxRead(buf).sheets;
    else if (/\.csv$/i.test(filename)) sheets = [{ name: 'CSV', rows: office.csvRead(buf) }];
    else return sendJson(res, 200, { ok: false, error: '仅支持 .xlsx 与 .csv（如需导入 .xls 请另存为 .xlsx）' });
  } catch (e) {
    return sendJson(res, 200, { ok: false, error: '文件解析失败：' + e.message });
  }
  const result = store.transaction(() => importSheets(sheets, target || 'measurements', mapping));
  store.audit({ user: '当前用户', plugin: '@MES', action: '导入数据', params: { filename, target, rows: result.imported }, resultSummary: '导入 ' + result.imported + ' 行', purpose: '数据接入' });
  sendJson(res, 200, Object.assign({ ok: true, filename, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })), preview: sheets[0].rows.slice(0, 6) }, result));
});

/** 把表格数据导入指定集合：自动识别表头（中文/英文字段名） */
function importSheets(sheets, target, mapping) {
  const aliases = {
    materials: {
      code:['编码','code'], name:['物料','物料名称','name'], price:['单价','price'], unit:['单位','unit'], supplier:['供应商','supplier'],
    },
    bom: {
      model:['产品','model'], part:['零件','part'], code:['编码','code'], level:['层级','level'], quantity:['用量','数量','quantity'], supplier:['供应商','supplier'],
    },
    measurements: {
      charId: ['特性编号', '特性', 'charid', 'char_id', '特性代码'], charName: ['特性名称', '名称', 'charname'],
      model: ['产品', 'model', '产品'], workshop: ['车间', 'workshop'], station: ['工位', 'station', '工序'],
      ts: ['时间', '日期', '测量时间', 'ts', 'datetime', 'time'], value: ['测量值', '值', 'value', '实测值', '数据'],
      unit: ['单位', 'unit'], shift: ['班次', 'shift'], batch: ['批次', 'batch', '批号'], supplier: ['供应商', 'supplier'],
      operator: ['操作者', '操作员', 'operator', '检验员'], vin: ['VIN', 'vin', '车架号'], subgroup: ['子组', 'subgroup'],
    },
    issues: {
      title: ['问题描述', '问题', '标题', 'title'], description: ['详细描述', '描述', 'description'],
      model: ['产品', 'model'], workshop: ['车间', 'workshop'], station: ['工位', 'station'],
      source: ['来源', 'source'], severity: ['等级', 'severity', '级别'], owner: ['责任人', 'owner'],
      status: ['状态', 'status'], createdAt: ['登记时间', '时间', 'createdat'],
    },
    defects: {
      type: ['缺陷类型', '类型', 'type'], workshop: ['车间', 'workshop'], station: ['工位', 'station'],
      model: ['产品', 'model'], confidence: ['置信度', 'confidence'], severity: ['等级', 'severity'],
      batch: ['批次', 'batch'], ts: ['时间', 'ts'],
    },
  };
  const map = mapping || aliases[target] || {};
  const rows = sheets[0].rows;
  if (!rows || rows.length < 2) return { imported: 0, skipped: 0, message: '表格为空或只有表头' };
  const header = rows[0].map((h) => String(h || '').trim());
  // 建立列索引
  const colIndex = {};
  for (const [field, names] of Object.entries(map)) {
    const i = header.findIndex((h) => names.some((n) => h.toLowerCase() === String(n).toLowerCase() || h.indexOf(n) >= 0));
    if (i >= 0) colIndex[field] = i;
  }
  // 平台已有测量数据时，自动推断特性规格
  const chars = {};
  store.col('spcChars').all().forEach((c) => { chars[c.id] = c; });
  let imported = 0, skipped = 0;
  const errors = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) { skipped++; continue; }
    const obj = {};
    for (const [field, ci] of Object.entries(colIndex)) {
      let v = row[ci];
      if (v === undefined || v === null) continue;
      v = String(v).trim();
      if (!v) continue;
      if (['value','confidence','price','level','quantity'].includes(field)) { const n = Number(v); if (!Number.isFinite(n)) continue; obj[field] = n; continue; }
      if (field === 'ts' || field === 'createdAt') {
        let t = v.replace(/\//g, '-');
        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) t += 'T08:00:00+08:00';
        const d = new Date(t);
        obj[field] = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
        continue;
      }
      obj[field] = v;
    }
    if (target === 'measurements') {
      if (obj.value === undefined) { skipped++; if (errors.length < 5) errors.push('第 ' + (r + 1) + ' 行缺少测量值'); continue; }
      const ch = obj.charId ? chars[obj.charId] : null;
      const rec = {
        charId: obj.charId || 'IMPORTED-001', charName: obj.charName || (ch ? ch.name : '导入特性'),
        model: obj.model || (ch ? ch.model : ''), workshop: obj.workshop || (ch ? ch.workshop : ''),
        station: obj.station || (ch ? ch.station : ''), ts: obj.ts || new Date().toISOString(),
        value: obj.value, unit: obj.unit || (ch ? ch.unit : ''), shift: obj.shift || '白班',
        batch: obj.batch || '', supplier: obj.supplier || '', operator: obj.operator || '', vin: obj.vin || '',
        subgroup: obj.subgroup ? Number(obj.subgroup) : undefined, source: '导入',
      };
      store.col('measurements').insert(rec, true);
      imported++;
    } else {
      if (target === 'materials' || target === 'bom') {
        const materials = target === 'materials';
        const valid = materials ? obj.code && obj.name && obj.unit && Number.isFinite(obj.price) && obj.price >= 0
          : obj.model && obj.part && obj.code && Number.isInteger(obj.level) && obj.level >= 1 && Number.isFinite(obj.quantity) && obj.quantity > 0;
        if (!valid) {
          skipped++;
          if (errors.length < 5) errors.push('第 ' + (r + 1) + ' 行缺少必填字段或数值无效');
          continue;
        }
        const rows = store.col(target);
        const existing = rows.one((row) => row.code === obj.code && (materials || (row.model === obj.model && row.level === obj.level)));
        if (existing) rows.update(existing.id, obj, true);
        else rows.insert(obj, true);
        imported++;
        continue;
      }
      if ((!obj.title && target === 'issues') || (!obj.type && target === 'defects')) { skipped++; continue; }
      if (target === 'defects') obj.ts ||= new Date().toISOString();
      if (target === 'issues') {
        const severity = String(obj.severity || 'C').trim().toUpperCase().replace(/\s*级$/, '');
        if (!['A', 'B', 'C'].includes(severity)) {
          skipped++;
          if (errors.length < 5) errors.push('第 ' + (r + 1) + ' 行问题等级须为 A、B 或 C');
          continue;
        }
        obj.severity = severity;
        obj.status = 'open';
      }
      store.col(target).insert(Object.assign({ source: '导入' }, obj), true);
      imported++;
    }
  }
  store.touch(); store.emit();
  return { imported, skipped, target, errors, detectedColumns: Object.keys(colIndex), header };
}

route('GET', /^\/api\/reports$/, async (req, res) => sendJson(res, 200, { ok: true, rows: store.col('reports').all().slice().reverse() }));
route('GET', /^\/api\/reports\/download\/(.+)$/, async (req, res, file) => {
  const safe = path.basename(file);
  const fp = path.join(OUTPUT_DIR, safe);
  if (!fs.existsSync(fp)) return sendText(res, 404, '文件不存在：' + safe);
  const ext = path.extname(safe).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="' + encodeURIComponent(safe) + '"',
    'Content-Length': fs.statSync(fp).size,
  });
  fs.createReadStream(fp).pipe(res);
});

/* ---------------- 数据管理 ---------------- */
route('POST', /^\/api\/data\/reset$/, async (req, res) => {
  await readJson(req);
  const registeredMembers = identity.configured() ? store.col('members').all() : null;
  const seed = currentScale() === 'sme' ? require('./src/data/seed-sme').seedSme : require('./src/data/seed').seed;
  const info=store.transaction(()=>{
    const keep=store.getSetting('llm',{});
    const days=store.getSetting('auditRetentionDays',365);
    const audit = store.col('audit').all();
    const archive = store.col('auditArchive').all();
    const counter=store.db.counters.audit || 0;
    for (const key of Object.keys(store.db)) if (Array.isArray(store.db[key])) store.db[key]=[];
    store.db.counters={};
    store.db.settings={};
    const seeded=seed(store,{persist:false});
    if (registeredMembers) {
      store.db.members=registeredMembers;
      store.db.counters.member=Math.max(store.db.counters.member || 0,...registeredMembers.map((m)=>Number(m.id.split('-').at(-1)) || 0));
    }
    store.db.audit=audit;
    store.db.auditArchive=archive;
    store.db.counters.audit=Math.max(store.db.counters.audit || 0,counter);
    store.db.meta.userCleared=false;
    store.db.settings.llm={...(store.db.settings.llm || {}),...keep};
    store.db.settings.auditRetentionDays=days;
    store.audit({user:req.signer?.name || '本机使用者',plugin:'数据管理',action:'重建样例数据'});
    operations.adoptExisting();
    return seeded;
  });
  sendJson(res, 200, { ok: true, seeded: info, message: '初始数据已重建（模型配置已保留）' });
});
route('POST', /^\/api\/data\/clear$/, async (req, res) => {
  const body = await readJson(req);
  const keep = (store.db.settings && store.db.settings.llm) || {};
  const fullClear = body.collections === undefined;
  const cols = body.collections || ['issues', 'projects', 'measurements', 'knowledge', 'defects', 'qrqc', 'workflows', 'todos', 'benefits', 'reports', 'chats', 'pendingActions', 'operationCases', 'operationEvents', 'operationImports', 'analysisRecords', 'materials', 'bom'];
  if (!Array.isArray(cols) || cols.some((c) => typeof c !== 'string' || ['audit','auditArchive'].includes(c) || (identity.configured() && c==='members') || !Array.isArray(store.db[c]))) return sendJson(res, 400, { ok: false, error: '清空范围须为有效业务集合' });
  store.transaction(() => {
    cols.forEach((c) => { store.db[c] = []; });
    if (fullClear) {
      store.db.meta.userCleared = true;
      delete store.db.meta.operationsLastScan;
      delete store.db.meta.operationsLastResult;
    }
    store.db.settings = store.db.settings || {};
    store.db.settings.llm = Object.assign(store.db.settings.llm || {}, keep);
    store.audit({user:req.signer?.name || '本机使用者',plugin:'数据管理',action:'清空业务数据',params:{collections:cols}});
  });
  sendJson(res, 200, { ok: true, cleared: cols, message: '已清空 ' + cols.length + ' 个集合' });
});

/* ---------------- 系统状态：真实数据库 / 真实模型 ---------------- */
route('GET', /^\/api\/system\/db$/, async (req, res) => {
  sendJson(res, 200, {
    ok: true,
    dataDir: DATA_DIR,
    outputDir: OUTPUT_DIR,
    counts: countAll(),
    db: store.persist ? store.persist.info() : { engine: 'json', path: store.file },
  });
});
route('GET', /^\/api\/system\/model$/, async (req, res) => {
  sendJson(res, 200, { ok: true, model: runtime.model || null, available: !!runtime.llm, source: 'deepseek-harness' });
});

/* ---------------- 体系文件（中小型企业版）：调研 / 手册 / 程序文件 ---------------- */
function qmsSurveyData() {
  const st = store.db.settings || {};
  if (!st.qmsSurvey) return null;
  const company = st.naming?.company ? currentNaming().company : st.qmsSurvey.company;
  return { ...st.qmsSurvey, company, revision: st.qmsSurvey.revision || 0 };
}
function qmsDocList() {
  const st = store.db.settings || {};
  return Array.isArray(st.qmsDocs) ? st.qmsDocs : [];
}
function qmsSaveDocs(list) {
  store.db.settings = store.db.settings || {};
  store.db.settings.qmsDocs = list;
  store.touch();
}
function surveyResponse(survey) {
  const naming = currentNaming();
  const progress = qmsSurvey.progress(survey || {});
  return {
    ok: true,
    survey,
    completion: progress.percent,
    progress,
    schema: qmsSurvey.schema,
    defaults: { company: survey?.company || naming.company, products: naming.products },
  };
}

route('GET', /^\/api\/qms\/survey$/, async (req, res) => {
  sendJson(res, 200, surveyResponse(qmsSurveyData()));
});
route('POST', /^\/api\/qms\/survey$/, async (req, res) => {
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendJson(res, 400, { ok: false, error: '调研数据格式不正确' });
  }
  const previous = qmsSurveyData() || {};
  const revision = previous.revision || 0;
  if (body.revision !== undefined && body.revision !== revision) {
    return sendJson(res, 409, { ok: false, error: '调研已在其他页面更新。请保留当前输入，刷新后核对。' });
  }
  const saved = { ...previous, ...qmsSurvey.cleanSurvey(body.survey || body, previous) };
  if (store.db.settings?.naming?.company) saved.company = currentNaming().company;
  saved.completed = body.completed === true || body.survey?.completed === true;
  const missing = qmsSurvey.progress(saved).missingRequired;
  if (saved.completed && missing.length) {
    return sendJson(res, 400, { ok: false, error: '请补齐：' + missing.map(key => qmsSurvey.labels[key]).join('、') });
  }
  saved.revision = revision + 1;
  saved.updatedAt = new Date().toISOString();
  store.transaction(() => store.setSetting('qmsSurvey', saved));
  sendJson(res, 200, surveyResponse(saved));
});
route('GET', /^\/api\/qms\/docs$/, async (req, res) => {
  const q = qs(req);
  const type = q.type || '';
  const rows = qmsDocList()
    .filter((d) => !type || d.type === type)
    .map((d) => ({ id: d.id, type: d.type, title: d.title, code: d.code, source: d.source, model: d.model || null, chars: (d.content || '').length, createdAt: d.createdAt }));
  sendJson(res, 200, { ok: true, rows });
});
route('GET', /^\/api\/qms\/doc\/(.+)$/, async (req, res, id) => {
  const d = qmsDocList().find((x) => x.id === decodeURIComponent(id));
  if (!d) return sendJson(res, 404, { ok: false, error: '文件不存在' });
  sendJson(res, 200, { ok: true, doc: d });
});
route('POST', /^\/api\/qms\/generate$/, async (req, res) => {
  const body = await readJson(req);
  const type = ['manual', 'procedure', 'tier3'].indexOf(body.type) >= 0 ? body.type : 'manual';
  const sv = qmsSurveyData();
  const missing = qmsSurvey.progress(sv || {}).missingForGeneration;
  if (missing.length) return sendJson(res, 400, {
    ok: false, error: '请先保存调研并补齐：' + missing.map(key => qmsSurvey.labels[key]).join('、'),
  });
  const b = qms.brief(sv);
  let docs = [];
  let source = 'template';
  let model = null;
  let note = '';
  if (runtime.llm) {
    try {
      const prompt = type === 'manual' ? qms.manualPrompt(b) : (type === 'procedure' ? qms.procedurePrompt(b) : qms.tier3Prompt(b));
      const r = await runtime.llm.complete({ system: '您只输出 Markdown 正文，不写解释、不加代码块围栏。', user: prompt, maxTokens: type === 'manual' ? 6000 : (type === 'procedure' ? 6000 : 9000), reasoning: false });
      const text = String((r && r.text) || '').replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
      if (text.length >= (type === 'manual' ? 800 : (type === 'procedure' ? 1500 : 2500))) {
        if (type === 'manual') {
          docs = [{ title: b.company + ' 质量手册', code: b.manual.code, content: qms.manualControlBlock(b) + '\n\n' + text }];
        } else if (type === 'procedure') {
          docs = qms.splitProcedures(text);
        } else {
          docs = qms.splitTier3(text);
        }
        source = 'ai';
        model = (r && r.model) || (runtime.model && (runtime.model.label || runtime.model.model)) || null;
      } else {
        note = '模型返回内容过短，已改用内置模板生成。';
      }
    } catch (e) {
      note = '模型调用失败（' + e.message + '），已改用内置模板生成。';
    }
  } else {
    note = '当前没有接入模型，以下内容由内置模板按调研表生成（结构可直接用，条文需按实际流程复核）。';
  }
  if (!docs.length) {
    if (type === 'manual') docs = [{ title: b.company + ' 质量手册', code: b.manual.code, content: qms.manualTemplate(b) }];
    else if (type === 'procedure') docs = qms.procedureTemplates(b);
    else docs = qms.tier3Templates(b);
  }
  const now = new Date().toISOString();
  const saved = docs.map((d, i) => ({
    id: 'QMS-' + type + '-' + Date.now().toString(36) + i,
    type, title: d.title || (type === 'manual' ? b.company + ' 质量手册' : (type === 'procedure' ? '程序文件 ' + (i + 1) : '三层次文件 ' + (i + 1))),
    code: d.code || (type === 'manual' ? 'QM-01' : (type === 'procedure' ? 'QP-' : 'TL-') + String(i + 1).padStart(2, '0')),
    content: d.content, source, model, createdAt: now,
  }));
  // 同类型只保留最近一次生成结果
  const keep = qmsDocList().filter((d) => d.type !== type || d.analysisId);
  qmsSaveDocs(keep.concat(saved));
  store.saveSync(true);
  sendJson(res, 200, {
    ok: true, type, source, model, note,
    docs: saved.map((d) => ({ id: d.id, title: d.title, code: d.code, chars: d.content.length, createdAt: d.createdAt })),
  });
});

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  p = decodeURIComponent(p);
  // 浏览器半（DSH 客户端插件）放在插件根目录、不在 public/ 下：
  // 宿主若按「挂载前缀 + client.js」来取，这里直接给它，别落到单页回退
  if (/^\/(client\.js|client)$/.test(p)) {
    const cf = path.join(ROOT, 'client.js');
    if (fs.existsSync(cf)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store, must-revalidate' });
      return fs.createReadStream(cf).pipe(res);
    }
  }
  const fp = path.join(PUBLIC_DIR, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!fp.startsWith(PUBLIC_DIR)) return sendText(res, 403, '禁止访问');
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      // 单页应用回退
      const idx = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(idx)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store, must-revalidate' });
        return fs.createReadStream(idx).pipe(res);
      }
      return sendText(res, 404, 'Not Found');
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store, must-revalidate' });
    fs.createReadStream(fp).pipe(res);
  });
}

/* ================================================================== */
/* 插件入口：初始化 + 请求分发（由 index.js 挂到 /qip-real-v3 前缀）            */
/* ================================================================== */
let ready = null;
let saveTimer = null;

/* 旧口径（冲压/焊装/…车间、质量改进科、郑伟老师）+ 演示类用词一次性迁移到新口径。
   幂等：靠 meta.wordingV3 打标；直接改内存 store 再 saveSync，避免运行期被覆盖。 */
const WORDING_RULES = [
  ['不是演示版', '不是空壳'], ['演示样例', '初始'], ['样例演示', '初始'],
  ['演示名称', '初始名称'], ['演示默认', '默认'], ['演示口径', '初始口径'], ['演示数据', '初始数据'], ['演示', '初始'],
  ['样例审计记录', '初始审计记录'], ['样例数据初始化', '初始数据初始化'], ['重建样例数据', '重建初始数据'], ['样例', '初始'],
  ['示例', '算例'], ['样板', ''],
  ['电池 PACK 车间', '五车间'], ['电池PACK车间', '五车间'], ['PACK 车间', '五车间'], ['电池 PACK', '五车间'], ['电池PACK', '五车间'],
  ['PACK 装配线', '五车间装配线'], ['PACK 模组', '五车间模组'], ['PACK 上盖', '五车间上盖'], ['PACK 线', '五车间线'], ['PACK', '五车间'],
  ['总装车间', '四车间'], ['总装三线', '四车间三线'], ['总装二线', '四车间二线'], ['总装一线', '四车间一线'], ['总装线', '四车间线'], ['总装', '四车间'],
  ['焊装车间', '二车间'], ['焊装', '二车间'],
  ['涂装车间', '三车间'], ['涂装', '三车间'],
  ['冲压车间', '一车间'], ['冲压', '一车间'],
  ['质量改进科', '质量改进部门'], ['科室', '部门'],
  ['郑伟老师', '陈老师'], ['郑老师', '陈老师'], ['郑伟', '陈伟'],
];

/**
 * 单次扫描版替换：一次扫描、长词优先，替换结果不会被下一条规则再吃一遍
 * （例如「演示样例」必须先整体换成「初始」，否则会得到「初始初始」）。
 */
function fixWordingOnce(text) {
  if (!text || typeof text !== 'string') return text;
  const map = new Map(WORDING_RULES);
  const keys = WORDING_RULES.map(([f]) => f).sort((a, b) => b.length - a.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(keys.map(esc).join('|'), 'g');
  return text.replace(re, (m) => (map.has(m) ? map.get(m) : m));
}

function normalizeWording(node) {
  if (typeof node === 'string') return fixWordingOnce(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = normalizeWording(node[i]);
    return node;
  }
  if (node && typeof node === 'object') {
    Object.keys(node).forEach((k) => { node[k] = normalizeWording(node[k]); });
    return node;
  }
  return node;
}

function init() {
  if (ready) return ready;
  ready = (async () => {
    const scale = currentScale();
    await store.init(DATA_DIR, { scale });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const firstRun = store.isEmpty() && !store.db.meta.userCleared;
    if (firstRun) {
      if (scale === 'sme') {
        const { seedSme } = require('./src/data/seed-sme');
        const info = seedSme(store);
        console.log('[qip-real-v3] 首次启动（中小型企业版），已灌入初始数据集：' + JSON.stringify(info));
      } else {
        const { seed } = require('./src/data/seed');
        const info = seed(store);
        store.saveSync(true);
        console.log('[qip-real-v3] 首次启动，已灌入初始数据集：' + JSON.stringify(info));
      }
    } else if (scale !== 'sme') {
      // 既有实例：把问题库一次性扩到 10 倍（幂等，靠 meta.dataScaleIssues 打标）
      const { scaleupIssues } = require('./src/data/seed');
      const up = scaleupIssues(store);
      if (up) {
        store.saveSync(true);
        console.log('[qip-real-v3] 问题库已扩量：新增 ' + up.added + ' 起，合计 ' + up.total + ' 起');
      }
    }
    if (!Array.isArray(store.db.pendingActions)) store.db.pendingActions = [];
    // 历史数据口径迁移（车间编号 / 部门名 / 称谓 / 演示类用词），只做一次；
    // 中小型企业版有自己的一套口径（冲压/装配两车间），不能再按大企业规则改写
    // wordingV4：把「郑伟 / 郑老师」改成「陈伟 / 陈老师」，老库也会被带上
    if (scale !== 'sme' && store.db.meta.wordingV4 !== 1) {
      normalizeWording(store.db);
      store.db.meta.wordingV4 = 1;
      store.db.meta.wordingV3 = 1;
      console.log('[qip-real-v3] 已把历史数据迁移到「一~五车间 / 质量改进部门 / 陈老师」口径（含演示类用词清理）');
    }
    store.saveSync(true); // 保证库/文件在启动时就是落盘状态
    operations.start();
    library.start();
    // 定时强制落盘：插件写操作走 400ms 防抖，这里兜底，避免异常退出丢数据
    const timer = setInterval(() => store.saveSync(), 5000);
    if (timer.unref) timer.unref();
    saveTimer = timer;
    const snapshot = () => {
      try { store.archiveAudit(); if (store.persist) store.snapshot(); }
      catch (error) { console.error('[store] 定时快照失败：' + error.message); }
    };
    if (!fs.existsSync(store.file) || Date.now() - fs.statSync(store.file).mtimeMs >= 86400000) snapshot();
    setInterval(snapshot,86400000).unref();
    const info = store.persist ? store.persist.info() : null;
    console.log('[qip-real-v3] 就绪：数据库=' + (info ? info.path : store.file) + '，报告目录=' + OUTPUT_DIR);
    return { firstRun, info };
  })();
  return ready;
}

function handle(req, res) {
  const pathname = new URL(req.url || '/', 'http://x').pathname || '/';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  init().then(async () => {
    if (pathname.startsWith('/api/')) {
      const m = match(req.method, pathname);
      if (!m) return sendJson(res, 404, { ok: false, error: '接口不存在：' + req.method + ' ' + pathname });
      try {
        if (!['GET','HEAD'].includes(req.method)) identity.sameOrigin(req);
        const publicAccess = ['/api/health','/api/operations/schema.js','/api/signing','/api/signing/setup','/api/signing/login','/api/signing/logout'].includes(pathname);
        if (!publicAccess && identity.configured()) {
          req.signer = identity.actor(req);
          if (!req.signer) return sendJson(res,401,{ok:false,error:'请先登录员工账号'});
          const staffWrite = /^\/api\/operations\/cases(?:$|\/[^/]+\/(?:submit|files)$)/.test(pathname)
            || /^\/api\/voice\/(?:prepare|transcribe)$/.test(pathname)
            || /^\/api\/signing\/delegations(?:\/|$)/.test(pathname)
            || /^\/api\/signing\/accounts\/[a-f0-9-]+\/password$/.test(pathname);
          if (req.signer.role === 'worker' && !['GET','HEAD'].includes(req.method) && !staffWrite) {
            return sendJson(res,403,{ok:false,error:'该操作需要质量主管账号'});
          }
        }
        await m.handler(req, res, ...m.params);
      } catch (e) {
        console.error('[qip-real-v3] ' + pathname + ' 出错：', e);
        if (!res.headersSent) sendJson(res, e.status || 500, { ok: false, error: e.message });
        else try { res.end(); } catch (_) {}
      }
      return;
    }
    serveStatic(req, res, pathname);
  }).catch((e) => {
    console.error('[qip-real-v3] 初始化失败：', e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: '平台初始化失败：' + e.message });
  });
}

module.exports = {
  init, handle, setRuntime, runtime,
  store, registry, agent,
  DATA_DIR, OUTPUT_DIR, PUBLIC_DIR,
  countAll, publicSettings,
  operations,
};






