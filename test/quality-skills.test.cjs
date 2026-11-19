const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../src/lib/quality-skills');

const exampleCase = {
  id: 'QI-1', number: 'QI-1', issueId: 'QI-1', projectId: 'QP-1', product: '轴套', description: '外径超差', batch: 'A1', location: '机加工', owner: '张工',
  business: { customer: '示例客户', dispositionRecord: 'H-21' }, plan: { action: '核对并隔离批次库存' },
  submissions: [
    { taskKey: 'contain', result: '隔离 40 件', evidence: 'H-21', author: '李工', acceptedBy: '王工' },
    { taskKey: 'cause', result: '初步复核记录', evidence: 'C-01', author: '张工' },
    { taskKey: 'cause', result: '已退回的猜测', evidence: '无', author: '张工', returnNote: '须补证据' },
  ],
};

test('8D labels evidence review state and distinguishes parts from measurement points', () => {
  const report = build('8d', {}, exampleCase, [{ name: '外径', batch: 'A1', n: 55, out: 2, cpk: 1.02 }]);
  assert.equal(report.template, '尺寸超差');
  const [{ tables: [basics, measurement] }, { tables: [, containment] }, { tables: [, , cause] }] = report.sections;
  assert.deepEqual(basics.rows.find(([label]) => label.includes('按件')), ['实测不良率（按件）', '待补充']);
  assert.deepEqual(measurement.rows[0].slice(0, 4), ['外径', 'A1', 55, 2]);
  assert.equal(containment.rows[0][0], '已复核 · 王工');
  assert.deepEqual(cause.rows.map((r) => r[0]), ['待复核']);
  assert.throws(() => build('8d', { sample: '40', defects: '41' }, exampleCase, []), /不可超过/);
  assert.throws(() => build('8d', { actions: [{ action: '验证', cause: '夹具磨损', due: '2026-02-30' }] }, exampleCase, []), /有效日期/);
  assert.throws(() => build('8d', { product: '轴套', problem: '外径超差', origin: 'customer' }, null, []), /客户名称/);
});

test('FMEA handles incomplete ratings, AP ordering, and evidence before rescoring', () => {
  const low = { mode: '磨损', effect: '异常噪音', cause: '使用寿命超限', s: '4', o: '2', d: '3' };
  const high = { mode: '卡滞', effect: '失去驱动', cause: '错装', s: '9', o: '2', d: '3', measure: '增加防错', evidence: 'VF-01', postS: '9', postO: '1', postD: '1' };
  const unscored = { mode: '超差', effect: '无法装配', cause: '加工波动' };
  const buildFmea = (chains) => build('fmea', { type: 'PFMEA', scope: '粗车 → 精车 → 检验', chains }, exampleCase, []);
  const report = buildFmea([low, unscored, high]);
  assert.equal(report.template, '机械与装配');
  assert.deepEqual(report.sections[4].tables[0].rows.map((r) => [r[0], r[6], r[7]]), [[3, 54, 'H'], [1, 24, 'L'], [2, '待补充', '待补充']]);
  assert.deepEqual(report.sections[5].tables[0].rows[0].slice(-5), [9, 1, 1, 9, 'M']);
  assert.throws(() => buildFmea([{ ...high, evidence: '' }]), /验证记录/);
  assert.throws(() => buildFmea([{ ...low, d: '' }]), /同时填写/);
  assert.throws(() => build('fmea', { type: 'DFMEA', scope: '组件' }, exampleCase, []), /设计责任方/);
});
