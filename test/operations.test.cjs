'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../src/lib/store');
const { createEngine, parseCsv } = require('../src/lib/operations');
const Business = require('../src/lib/business');

test('the Harness client registers its package name while retaining the independent sidebar id', () => {
  const vm = require('node:vm'); let registration;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../client.js'), 'utf8'), { fetch: async () => ({ json: async () => ({}) }), window: { __ModuleLoader__: { load(value) { registration = value; } } } });
  assert.equal(registration.id, require('../package.json').name);
  const plugin = registration.factory(() => ({ createElement() {} }));
  const slots = [];
  plugin.apply({ slots: { inject(name, fn) { fn(); }, register(row) { slots.push(row); } } });
  assert.equal(slots.find((s) => s.name === 'sidebar.panellist').id, 'qip-real-v3');
  assert.equal(slots.find((s) => s.name === 'sidebar.panellist').label(), '全质开源质量平台2');
});

async function fixture(t, runtime = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'total-v3-test-'));
  const store = new Store(); await store.init(dir, { scale: 'sme' });
  store.col('members').insert({ name: '张工' }); store.col('members').insert({ name: '李工' });
  const engine = createEngine({ store, outputDir: path.join(dir, 'reports'), runtime });
  engine.start();
  t.after(() => { engine.stop(); clearTimeout(store._timer); store.persist?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, engine, dir };
}
const input = { kind: 'issue', title: '轴套外径超规格', description: '本批次轴套外径测量出现超规格，需要核对影响范围并隔离复检。', owner: '张工', product: '示例轴套', batch: 'B-001', location: '机加工' };
function submit(engine, c) { return engine.act(c.id, 'submit', { version: c.version, author: '张工', result: '已核对本批次产品的实际范围，完成现场记录和隔离标识并落实本阶段要求。', evidence: '原始检验记录 QC-001 已逐项核对，复检数据、批次及签字与工作单一致。' }); }
const csv = '特性名称,测量值,规格下限,规格上限,批次,工序\n外径,12.01,11.9,12.1,B-001,机加工\n外径,12.03,11.9,12.1,B-001,机加工\n外径,12.14,11.9,12.1,B-001,机加工\n';
const file = () => ({ filename: 'measurement.csv', base64: Buffer.from(csv).toString('base64') });

test('approval, revocation, correction, four execution stages and archive stay connected', async (t) => {
  const { engine, store, dir } = await fixture(t);
  let c = engine.create(input); assert.equal(c.status, 'plan_review'); assert.equal(c.version, engine.resolve(c.id).version);
  const stale = c.version;
  c = engine.act(c.id, 'approve', { version: c.version });
  assert.equal(c.status, 'executing'); assert.equal(c.tasks.length, 4);
  assert.equal(store.col('projects').get(c.projectId).operationsId, c.id);
  assert.equal(store.col('todos').find((v) => v.operationsId === c.id && !v.done).length, 1);
  assert.throws(() => engine.act(c.id, 'approve', { version: stale }), /已更新/);
  c = engine.act(c.id, 'revoke', { version: c.version });
  const project = c.projectId;
  c = engine.act(c.id, 'approve', { version: c.version }); assert.equal(c.projectId, project);
  c = submit(engine, c);
  c = engine.act(c.id, 'return', { version: c.version, note: '请补充复检记录的核对结论' });
  assert.equal(c.stage, 0); assert.equal(c.submissions.length, 1);
  for (let i = 0; i < 4; i++) { c = submit(engine, c); c = engine.act(c.id, 'approve', { version: c.version }); }
  assert.equal(c.status, 'close_review');
  c = engine.act(c.id, 'approve', { version: c.version }); assert.equal(c.status, 'closed');
  assert.equal(store.col('issues').get(c.issueId).status, '已关闭');
  assert.equal(store.col('projects').get(c.projectId).progress, 100);
  assert.equal(store.col('knowledge').find((v) => v.operationsId === c.id).length, 1);
  assert.equal(store.col('reports').find((v) => v.operationsId === c.id).length, 1);
  const rec = store.col('reports').get(c.reportId); assert(fs.existsSync(rec.path)); assert.equal(fs.readFileSync(rec.path).subarray(0, 2).toString(), 'PK');
  assert.throws(() => engine.act(c.id, 'submit', { version: c.version, author: '张工', result: '随意修改已经归档的记录用于测试不可再次提交', evidence: '此处仅用于验证状态拦截是否正常生效' }), /没有可提交/);
  const reopened = new Store(); await reopened.init(dir, { scale: 'sme' });
  assert.equal(reopened.col('operationCases').get(c.id).status, 'closed'); reopened.persist.close();
});

test('preflight is read-only, rejects invalid data atomically, and repeated acceptance is idempotent', async (t) => {
  const { engine, store } = await fixture(t);
  assert.throws(() => engine.preview({ filename: 'bad.csv', base64: Buffer.from(csv.replace('12.01', 'abc')).toString('base64') }), /有效数值/);
  assert.equal(store.col('measurements').count(), 0);
  const p = engine.preview(file()); assert.equal(p.count, 3); assert.equal(p.out, 1); assert.equal(store.col('measurements').count(), 0);
  const accepted = engine.accept({ previewId: p.id }); assert.equal(accepted.imported, 3); assert.equal(store.col('measurements').count(), 3);
  assert.equal(engine.summary().cases.length, 1);
  const first = engine.summary().cases[0]; assert.equal(first.measurement.n, 3);
  assert.equal(engine.accept({ previewId: p.id }).duplicate, true);
  const repeat = engine.preview({ ...file(), filename: 'renamed.csv' }); assert.equal(repeat.duplicate, true);
  engine.accept({ previewId: repeat.id }); engine.scan(); engine.scan();
  assert.equal(store.col('measurements').count(), 3); assert.equal(engine.summary().cases.length, 1);
  assert.throws(() => engine.accept({ previewId: 'unknown' }), /过期/);
});

test('new measurements following a closed abnormal batch create exactly one follow-up case', async (t) => {
  const { engine, store } = await fixture(t);
  engine.accept({ previewId: engine.preview(file()).id });
  let c = engine.summary().cases[0]; c = engine.act(c.id, 'approve', { version: c.version });
  for (let i = 0; i < 4; i++) { c = submit(engine, c); c = engine.act(c.id, 'approve', { version: c.version }); }
  engine.act(c.id, 'approve', { version: c.version });
  const ch = store.col('spcChars').all()[0];
  store.col('measurements').insert({ charId: ch.id, batch: 'B-001', value: 12.2, ts: new Date().toISOString() });
  engine.scan(); engine.scan(); engine.scan();
  assert.equal(engine.summary().cases.length, 2);
  assert.equal(engine.summary().cases.filter((v) => v.status !== 'closed').length, 1);
});

test('quantity balance and verification gaps cannot be falsely approved when closure checks are enabled', async (t) => {
  const { engine } = await fixture(t); let c = engine.create(input);
  const before = c.version;
  assert.throws(() => engine.act(c.id, 'business', { version: before, business: { ...c.business, totalQty: 40, stockQty: 30, wipQty: 5, shippedQty: 1 } }), /影响总数/);
  assert.equal(engine.resolve(c.id).version, before);
  c = engine.act(c.id, 'business', { version: before, business: { ...c.business, enforce: true } });
  c = engine.act(c.id, 'approve', { version: c.version });
  for (let i = 0; i < 4; i++) { c = submit(engine, c); c = engine.act(c.id, 'approve', { version: c.version }); }
  assert.throws(() => engine.act(c.id, 'approve', { version: c.version }), /结案资料/);
  assert.equal(engine.resolve(c.id).status, 'close_review');
});

test('legacy edits and tool shortcuts cannot bypass the managed workflow', async (t) => {
  const { engine, store } = await fixture(t); const c = engine.create(input);
  assert.throws(() => store.col('issues').update(c.id, { status: '已关闭' }), /统一工作单/);
  assert.throws(() => store.col('issues').remove(c.id), /统一工作单/);
  assert.equal(engine.resolve(c.id).status, 'plan_review');
});

test('a persistence failure rolls back the work order, issue and business counters', async (t) => {
  const { engine, store } = await fixture(t); const before = structuredClone(store.db); const save = store.persist.save;
  store.persist.save = () => { throw new Error('injected disk failure'); };
  assert.throws(() => engine.create(input), /disk failure/);
  assert.deepEqual(store.db, before); store.persist.save = save;
  assert(engine.create(input).id);
});


function approve(engine, c, author = '李工') {
  return engine.act(c.id, 'approve', { version: c.version, author });
}
function closeCase(engine, c) {
  c = approve(engine, c);
  while (c.status === 'executing') c = approve(engine, submit(engine, c));
  return approve(engine, c);
}

test('new plan versions reach waiting and current tasks while completed stages keep approved text', async (t) => {
  const { engine, store } = await fixture(t);
  const sample = '先隔离受影响库存，再按每批 3 件进行抽检。';
  const full = '核对隔离边界，并对受影响的全部库存逐件全检。';
  const fullVerification = '核对百分之百复检明细和所有不合格件的处置记录。';
  const editPlan = (c, action, verification) => engine.act(c.id, 'plan', {
    version: c.version, author: '李工', plan: { ...c.plan, action, verification },
  });
  let c = approve(engine, editPlan(engine.create(input), sample, '抽查三件测量记录并核对隔离数量。'));
  assert.equal(c.tasks[0].instruction, sample);
  c = engine.act(c.id, 'revoke', { version: c.version });
  c = approve(engine, editPlan(c, full, fullVerification));
  assert.equal(c.planRevisions[0].action, sample);
  assert.equal(c.tasks[0].instruction, full);
  assert(c.tasks.every((task) => task.planVersion === 2 && task.verification === fullVerification));
  const todo = store.col('todos').one((row) => row.operationsId === c.id && !row.done);
  assert.equal(todo.instruction, full);
  assert.equal(todo.planVersion, 2);
  c = approve(engine, submit(engine, c));
  assert.equal(c.submissions.at(-1).planVersion, 2);

  c = engine.act(c.id, 'revoke', { version: c.version });
  const cause = '更换定位基准后对照原工装，并采用同一量规验证原因。';
  c = approve(engine, editPlan(c, cause, '保存新旧定位基准的复测结果和量具编号。'));
  assert.deepEqual(c.tasks.map((task) => task.planVersion), [2, 3, 3, 3]);
  assert.equal(c.tasks[0].instruction, full);
  assert.equal(c.tasks[1].planAction, cause);
  while (c.status === 'executing') c = approve(engine, submit(engine, c));
  c = approve(engine, c);
  const office = require('../src/lib/office');
  const report = office.zipReadFile(store.col('reports').get(c.reportId).path)['word/document.xml'].toString();
  for (const expected of [sample, full, fullVerification, cause, '采用方案版本 2', '采用方案版本 3']) {
    assert(report.includes(expected), expected);
  }
});

test('rolling measurement ledgers reconcile identifiers and allow independent unnumbered repeats', async (t) => {
  const { engine, store, dir } = await fixture(t);
  const row = { name: '内径', batch: 'rolling', lsl: 9, usl: 11, value: 10, ts: '2026-11-18T10:00:00Z' };
  const numbered = [1, 2, 3].map((n) => ({ ...row, source: '产线台账', sourceId: 'M-' + n }));
  const preview = (rows) => engine.preview({ filename: 'rolling.json', rows });
  const receive = (rows, duplicateDecisions) => engine.accept({ previewId: preview(rows).id, duplicateDecisions });
  assert.equal(receive(numbered).imported, 3);
  assert.equal(receive([...numbered].reverse()).imported, 0);
  const extended = preview([...numbered, { ...row, source: '产线台账', sourceId: 'M-4' }]);
  assert.deepEqual(extended.checks.map((r) => r.state), ['duplicate', 'duplicate', 'duplicate']);
  assert.equal(engine.accept({ previewId: extended.id }).imported, 1);
  assert.equal(receive([{ ...row, source: '复测台账', sourceId: 'M-1' }]).imported, 1);
  const collision = preview([{ ...numbered[0], value: 10.1 }, { ...row, source: '产线台账', sourceId: 'M-5' }]);
  assert.equal(collision.checks[0].state, 'conflict');
  assert.throws(() => engine.accept({ previewId: collision.id }), /内容不一致/);
  assert.equal(store.col('measurements').count(), 5);

  const legacy = [1, 2, 3].map((hour) => ({ ...row, batch: 'old', ts: '2026-11-18T0' + hour + ':00:00Z' }));
  assert.equal(receive(legacy).imported, 3);
  const rolling = preview([...legacy, { ...legacy[0], ts: '2026-11-18T04:00:00Z' }]);
  assert.deepEqual(rolling.checks.map((r) => r.row), [1, 2, 3]);
  assert.throws(() => engine.accept({ previewId: rolling.id }), /逐行确认/);
  assert.equal(engine.accept({ previewId: rolling.id, duplicateDecisions: { 1: 'skip', 2: 'skip', 3: 'skip' } }).imported, 1);
  assert.equal(receive([legacy[0]], { 1: 'keep' }).imported, 1);

  const reopened = new Store();
  await reopened.init(dir, { scale: 'sme' });
  assert.equal(reopened.col('measurements').find((r) => r.measurementSource === '产线台账').length, 4);
  assert.equal(reopened.col('measurements').find((r) => r.batch === 'old' && r.ts === '2026-11-18T01:00:00.000Z').length, 2);
  reopened.persist.close();
});

test('numbered conflicts within the same upload and stale duplicate decisions do not write partially', async (t) => {
  const { engine, store } = await fixture(t);
  const row = { name: '内径', batch: 'rolling', lsl: 9, usl: 11, value: 10, ts: '2026-11-18T10:00:00Z' };
  const preview = (rows) => engine.preview({ filename: 'rolling.json', rows });
  const first = preview([{ ...row, sourceId: '1' }, { ...row, sourceId: '1', value: 10.1 }]);
  assert.equal(first.checks[0].state, 'conflict');
  assert.throws(() => engine.accept({ previewId: first.id }), /内容不一致/);
  assert.equal(store.col('measurements').count(), 0);

  const p = preview([row, { ...row, value: 10.2 }]);
  engine.accept({ previewId: preview([row]).id });
  assert.throws(() => engine.accept({ previewId: p.id }), /重新预检/);
  assert.equal(store.col('measurements').count(), 1);
});

test('post-closure in-spec evidence only updates trace; new control signal creates one linked case', async (t) => {
  const { engine, store } = await fixture(t);
  const row = { name: '内径', batch: 'post-close', lsl: 9, usl: 11 };
  const receive = (samples, offset) => {
    const rows = samples.map((value, i) => ({ ...row, value, sourceId: String(offset + i),
      ts: new Date(Date.UTC(2026, 10, 18, 0, offset + i)).toISOString() }));
    return engine.accept({ previewId: engine.preview({ filename: 'measure.json', rows }).id });
  };
  receive([11.2], 0);
  const closed = closeCase(engine, engine.summary().cases[0]);
  assert.equal(closed.closedEvidence.outlierIds.length, 1);
  receive([9.9], 1);
  const archived = engine.resolve(closed.id);
  assert.equal(engine.summary().cases.length, 1);
  assert.equal(archived.measurement.n, 1);
  assert.equal(archived.measurementTrace.n, 2);
  receive([10, 10.1, 10.2, 10.3, 10.4, 10.5], 2);
  engine.scan();
  engine.scan();
  const created = engine.summary().cases.filter((c) => c.id !== closed.id);
  assert.equal(created.length, 1);
  assert.equal(created[0].previousCaseId, closed.id);
  assert.equal(created[0].recurrence.outlierIds.length, 0);
  assert(created[0].recurrence.chartAlarms.some((a) => a.rule === 3));
  assert.equal(store.col('operationCases').get(closed.id).followUpCaseIds[0], created[0].id);
});

test('capability requires sufficient stable data and a valid estimate; true specification exceedance is immediate', async (t) => {
  const { engine } = await fixture(t);
  const row = { charId: 'CT-TEST', name: '内径', lsl: 9, usl: 11 };
  const receive = (rows) => engine.accept({ previewId: engine.preview({ filename: 'capability.json', rows }).id });
  receive([9.1, 10, 10.9].map((value) => ({ ...row, batch: 'small', value })));
  let d = engine.summary();
  assert.equal(d.cases.length, 0);
  assert.equal(d.batches[0].capabilityStatus, 'insufficient');
  assert.equal(d.batches[0].minSamples, 50);
  assert.equal(d.batches[0].cpk, null);
  receive([{ ...row, batch: 'one', value: 11.3 }]);
  assert.equal(engine.summary().cases.length, 1);
  assert.equal(engine.summary().cases[0].measurement.out, 1);

  engine.setCapability('CT-TEST', { minSamples: 25, subgroupSize: 3 });
  assert.throws(() => engine.setCapability('CT-TEST', { minSamples: 3, subgroupSize: 1 }), /25/);
  const means = [10, 10.04, 9.99, 9.96, 10.02, 10.01, 9.98, 10.03, 9.97];
  const triples = (batch, groups, range) => groups.flatMap((mean, i) =>
    [-range, 0, range].map((delta) => ({ ...row, batch, subgroup: String(i + 1), value: mean + delta })));
  receive(triples('groups', means, 0.6));
  d = engine.summary();
  const grouped = d.batches.find((b) => b.batch === 'groups');
  assert.equal(grouped.method, 'X̄–R');
  assert.equal(grouped.capabilityStatus, 'ready');
  assert.equal(grouped.n, 27);
  assert(grouped.cpk > 0.4 && grouped.cpk < 0.6);
  assert(d.cases.some((c) => c.batch === 'groups' && c.description.includes('Cpk')));
  receive(triples('partial', means, 0.1).slice(1));
  assert.equal(engine.summary().batches.find((b) => b.batch === 'partial').capabilityStatus, 'invalid_subgroups');
  receive(triples('unstable', [10, 10.04, 10.09, 10.14, 10.19, 10.24, 10.29, 10.34, 10.39], 0.3));
  const unstable = engine.summary().batches.find((b) => b.batch === 'unstable');
  assert.equal(unstable.capabilityStatus, 'unstable');
  assert(unstable.signals > 0);
  assert.equal(unstable.cpk, null);
});

test('analysis modes save provenance and fall back without leaking tool-protocol JSON', async (t) => {
  const { engine, store } = await fixture(t, { model: { model: 'test' }, llm: { complete: async () => ({ text: '{"thought":"bad","tool":"fake"}' }) } });
  const c = engine.create(input);
  for (const mode of ['review', '8d', 'why', 'fmea', 'spc']) {
    const r = await engine.analyze({ mode, caseId: c.id, question: '需要核对什么证据？' });
    assert.equal(r.caseId, c.id); assert(!r.outputs.includes('"thought"')); assert(r.outputs.length > 10);
  }
  assert.equal(store.col('analysisRecords').count(), 5);
  assert.throws(() => engine.setPolicy({ enabled: 'true' }), /布尔值/);
});

test('quoted CSV parsing, unique verification batches and QR image preservation', () => {
  assert.deepEqual(parseCsv('a,b\n"x,y","z"\n'), [['a', 'b'], ['x,y', 'z']]);
  assert.throws(() => parseCsv('a,b\n"x,y'), /引号/);
  assert.throws(() => Business.normalizeBusiness({ verificationLots: [{ batch: 'B', checked: 10, failed: 11 }] }), /不能超过/);
  const qr = fs.readFileSync(path.join(__dirname, '../public/assets/wechat-support-blue.svg'));
  assert.equal(crypto.createHash('sha256').update(qr).digest('hex'), '09c4ce9f282b619455cc000b3a6f01fbf9bec31b6747d37dc53d3219ce9b0d04');
  const ui = fs.readFileSync(path.join(__dirname, '../public/js/operations.js'), 'utf8');
  assert(ui.includes('免费服务微信：周一到周六，早8:00至晚8:00'));
  assert(ui.includes('/qip-real-v3/assets/wechat-support-blue.svg'));
});

test('model-prepared plans remain drafts and never overwrite a newer human correction', async (t) => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const { engine } = await fixture(t, { model: { model: 'test' }, llm: { complete: () => pending } });
  let c = engine.create(input); const worker = engine.pump();
  c = engine.act(c.id, 'plan', { version: c.version, plan: { action: '人工已明确本批次隔离范围，先核对真实检验记录后执行。', owner: '李工' } });
  complete({ text: JSON.stringify({ action: '模型提出的另外一套处理动作，不能覆盖人工确认过的修改。', verification: '核对原始记录和批次范围', hypothesis: '待核实的发生原因假设' }) });
  await worker; const live = engine.resolve(c.id);
  assert(live.plan.action.startsWith('人工')); assert.equal(live.owner, '李工'); assert.equal(live.status, 'plan_review'); assert.equal(live.tasks.length, 0);
});

test('model drafts use the existing Harness bridge and stop at human approval', async (t) => {
  const { engine } = await fixture(t, { model: { model: 'test' }, llm: { complete: async () => ({ text: JSON.stringify({ action: '核对影响批次并落实隔离，登记实际库存、在制和流向。', verification: '对照复检记录和隔离清单核对数量', hypothesis: '工装变化可能影响定位，需要对照样本验证' }) }) } });
  const c = engine.create(input); await engine.pump();
  const live = engine.resolve(c.id); assert.equal(live.ai.status, 'ready'); assert(live.plan.source.includes('Harness')); assert.equal(live.status, 'plan_review'); assert.equal(live.tasks.length, 0);
});

test('attachments are durably stored, scoped to their work order and restricted to allowed file types', async (t) => {
  const { engine } = await fixture(t); const a = engine.create(input), b = engine.create(input);
  const file = engine.addFile(a.id, { version: a.version, filename: '复检记录.txt', base64: Buffer.from('测量值与原始记录核对结果').toString('base64') });
  assert(fs.existsSync(engine.getFile(a.id, file.file.id).path));
  assert.throws(() => engine.getFile(b.id, file.file.id), /不存在/);
  assert.throws(() => engine.addFile(a.id, { version: engine.resolve(a.id).version, filename: 'script.html', base64: 'dGVzdA==' }), /仅支持/);
});

test('manual drafts, saved revisions and the system document stay connected', async (t) => {
  const { engine, store } = await fixture(t);
  const row = await engine.analyze({ mode: 'manual', manualCompany: '示例公司', manualProducts: '精密轴套与装配件', manualScope: '采购、机加工、检验与交付', manualProcess: '评审订单→采购→机加工→检验→交付', manualRoles: '张工负责生产，李工负责检验', manualControls: '按批次追溯，首件和出货检验，质量负责人确认放行', manualRisks: '防止尺寸超差流出，目标口径由质量负责人核对' });
  assert(row.qmsDocId); assert.equal(row.version, 1);
  assert.equal(store.getSetting('qmsDocs', [])[0].content, row.outputs);
  const edited = engine.editAnalysis(row.id, { version: 1, outputs: row.outputs + '\n人工核对：检验记录保存三年。' });
  assert.equal(edited.version, 2); assert.equal(edited.revisions[0].outputs, row.outputs);
  assert.equal(store.getSetting('qmsDocs', [])[0].content, edited.outputs);
  assert.throws(() => engine.editAnalysis(row.id, { version: 1, outputs: edited.outputs }), /已被更新/);
  await assert.rejects(engine.analyze({ mode: 'manual' }), /企业名称/);
});

test('FMEA ratings are optional but partial or invalid ratings are rejected', async (t) => {
  const { engine } = await fixture(t); const c = engine.create(input);
  const r = await engine.analyze({ mode: 'fmea', caseId: c.id, severity: 8, occurrence: 3, detection: 4 });
  assert.equal(r.inputs.ratings.rpn, 96); assert(r.outputs.includes('RPN=96'));
  await assert.rejects(engine.analyze({ mode: 'fmea', caseId: c.id, severity: 11, occurrence: 3, detection: 4 }), /1～10/);
  await assert.rejects(engine.analyze({ mode: 'fmea', caseId: c.id, severity: 8 }), /数字|须为|数值|必填/);
});

test('a pending model result cannot resurrect cleared work orders', async (t) => {
  let complete;
  const { engine, store } = await fixture(t, { model: { model: 'test' }, llm: { complete: () => new Promise((resolve) => { complete = resolve; }) } });
  engine.create(input); const worker = engine.pump();
  store.db.operationCases = [];
  complete({ text: JSON.stringify({ action: '核对批次隔离范围及原始检验记录，整理出可复核的处理建议。', verification: '对照原始数据与复检记录', hypothesis: '可能与工装定位变化有关，尚需验证' }) });
  await worker; assert.equal(store.col('operationCases').count(), 0);
});
