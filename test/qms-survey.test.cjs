'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSurvey, progress } = require('../src/lib/qms-survey');
const qms = require('../src/lib/qms');

test('drafts distinguish generation prerequisites from completion and support a custom standard', () => {
  const draft = cleanSurvey({ company: '测试企业', products: '精密轴套', otherCert: '顾客质量体系要求' });
  assert.deepEqual(progress(draft).missingForGeneration, []);
  assert.deepEqual(progress(draft).missingRequired, ['contactName', 'contactPhone']);
  assert.equal(qms.brief(draft).cert, '顾客质量体系要求');
  assert.deepEqual(cleanSurvey({ scope: '', contactPerson: '' }), { scope: '', contactPerson: '' });
});

test('the survey validates new inputs and preserves untouched legacy date text', () => {
  assert.throws(() => cleanSurvey({ auditDate: '2027-02-30' }), /有效日期/);
  assert.throws(() => cleanSurvey({ orgs: [{ owner: '李工' }] }), /部门名称/);
  assert.throws(() => cleanSurvey({ contactPhone: '--------' }), /格式/);
  assert.deepEqual(cleanSurvey({ certDate: '2027年6月' }, { certDate: '2027年6月' }), {});
  assert.deepEqual(cleanSurvey({ certDate: '2027-06', documentPrefix: 'abc' }), { certDate: '2027-06', documentPrefix: 'ABC' });
});

test('handbook draft applies survey roles, process and dates without substituting filler data', () => {
  const draft = cleanSurvey({
    company: '测试企业', products: '精密轴套', certs: ['ISO9001', 'ISO14001'],
    certOffice: '陈工', mgmtRep: '王工', gm: '周工', manualReviewer: '赵工',
    scope: '杭州厂区生产与出货', processFlow: '表面处理\n成品检验',
    controls: '质量主管放行并填写 QI-01', orgs: [{ dept: '客户服务组', duty: '处理顾客反馈' }],
    certDate: '2027-09', manualEffectiveDate: '2027-05-18',
    documentPrefix: 'ACME', objective: '一次合格率 ≥ 99%\n每月核对',
    contactName: '填表专员', contactPhone: '13000000000',
  });
  const brief = qms.brief(draft);
  const manual = qms.manualTemplate(brief);
  for (const fact of ['ACME-QM-01', '陈工', '赵工', '周工', '2027-05-18', '表面处理\n成品检验', '客户服务组', 'QI-01', '一次合格率 ≥ 99%\n每月核对']) assert(manual.includes(fact), fact);
  assert(!manual.includes('填表专员') && !manual.includes('13000000000'));
  assert(qms.procedureTemplates(brief).find(doc => doc.title.startsWith('生产')).content.includes('QI-01'));
});
