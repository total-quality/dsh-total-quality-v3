'use strict';

const certificates = [
  ['ISO9001', 'ISO 9001 质量管理体系'],
  ['IATF16949', 'IATF 16949 汽车行业质量体系'],
  ['ISO14001', 'ISO 14001 环境管理体系'],
  ['ISO45001', 'ISO 45001 职业健康安全'],
];
const schedules = ['周六周日都休息', '仅周日休息', '都不休息', '大小周休息'];
const sections = [
  { id: 'basis', title: '基本信息', fields: [
    ['company', '公司名称', 'company'],
    ['certs', '适用体系', 'certs'],
    ['otherCert', '其他体系或版本', 'text', '例如其他标准、行业体系或顾客特定要求'],
  ] },
  { id: 'people', title: '组织与团队', fields: [
    ['chairman', '董事长'], ['legalRep', '法人代表'], ['gm', '总经理'],
    ['deputyGm', '副总经理'], ['mgmtRep', '管理者代表'],
    ['teamLeader', '贯标组长'], ['teamMembers', '贯标组员'],
    ['certOffice', '贯标办主任'], ['officeMembers', '贯标办成员'], ['auditors', '内审员'],
    ['orgs', '部门与职责', 'orgs'],
  ] },
  { id: 'process', title: '产品与过程', fields: [
    ['products', '体系覆盖的产品与服务', 'area', '可补充型号和服务范围'],
    ['scope', '体系适用范围', 'area', '厂区、业务边界及不适用条款和依据'],
    ['processFlow', '从接单到交付的主要过程', 'area', '按顺序填写工序、外包环节和交付接口'],
    ['controls', '检验、放行与追溯', 'area', '检验频次、放行岗位及批次和记录编号'],
    ['roles', '岗位与职责补充', 'area', '关键岗位、责任边界与跨部门接口'],
    ['risks', '主要质量风险', 'area', '失效风险、顾客要求及现有控制'],
    ['documents', '已有文件与待补记录', 'area', '程序、作业指导书、控制计划和记录位置'],
  ] },
  { id: 'profile', title: '企业概况', fields: [
    ['geo', '地理位置与交通'], ['addr', '公司地址'],
    ['area', '占地面积（㎡）', 'decimal'], ['building', '建筑面积（㎡）', 'decimal'],
    ['staff', '正式员工（人）', 'integer'], ['techStaff', '管理技术人员（人）', 'integer'],
    ['edu', '人员学历分布', 'area'], ['equipment', '主要设备', 'area'], ['customers', '主要客户', 'area'],
    ['contactPerson', '企业联系人'], ['phone', '联系人手机', 'tel'], ['tel', '企业电话', 'tel'], ['fax', '传真', 'tel'],
  ] },
  { id: 'policy', title: '方针与目标', fields: [
    ['mission', '公司宗旨', 'area'], ['policy', '质量方针', 'area', '使用企业确认过的原文'],
    ['objective', '质量目标', 'area', '逐项写明指标、目标值、统计周期和责任岗位'],
  ] },
  { id: 'plan', title: '认证与签署', fields: [
    ['certDate', '计划取证日期', 'period'], ['phase1Date', '一阶段审核日期', 'period'],
    ['auditDate', '正式审核日期', 'period'], ['weekend', '休息日安排', 'schedule'],
    ['design', '是否承担设计开发', 'design'], ['documentPrefix', '手册编号前缀', 'prefix', '例如 ABC，生成 ABC-QM-01'],
    ['manualAuthor', '编制人', 'text', '留空沿用贯标办主任'],
    ['manualReviewer', '审核人', 'text', '留空沿用管理者代表'],
    ['manualApprover', '批准人', 'text', '留空沿用总经理'],
    ['manualEffectiveDate', '拟生效日期', 'date', '按实际文件发布安排填写'],
  ] },
  { id: 'filler', title: '填写人', fields: [
    ['contactName', '填写人姓名'], ['contactPhone', '填写人手机', 'tel'],
  ] },
];
const requiredForGeneration = ['company', 'certs', 'products'];
const requiredForCompletion = [...requiredForGeneration, 'contactName', 'contactPhone'];
const keyFields = [...requiredForCompletion, 'scope', 'processFlow', 'orgs', 'mgmtRep', 'policy', 'objective', 'controls'];

function hasValue(survey, key) {
  if (key === 'certs') return Boolean(survey.certs?.length || survey.otherCert?.trim());
  if (key === 'orgs') return Boolean(survey.orgs?.some(row => row.dept?.trim()));
  return Boolean(String(survey[key] ?? '').trim());
}

function progress(survey = {}) {
  const done = keyFields.filter(key => hasValue(survey, key)).length;
  return {
    done,
    total: keyFields.length,
    percent: Math.round(done * 100 / keyFields.length),
    missingForGeneration: requiredForGeneration.filter(key => !hasValue(survey, key)),
    missingRequired: requiredForCompletion.filter(key => !hasValue(survey, key)),
  };
}

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function limitFor(type) {
  if (type === 'area') return 4000;
  if (type === 'prefix') return 8;
  return 400;
}

function readText(value, label, limit) {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') invalid(label + '格式不正确');
  const text = String(value).trim();
  if (text.length > limit) invalid(label + '最多填写 ' + limit + ' 个字符');
  return text;
}

function validPeriod(value, allowMonth) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.exec(value);
  if (!m || Number(m[1]) < 1900) return false;
  if (!m[3]) return allowMonth;
  return new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

function cleanSurvey(input, previous = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('调研数据格式不正确');
  const result = {};
  for (const [key, label, type] of sections.flatMap(section => section.fields)) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (typeof value === 'string' && value === previous[key]) continue;
    if (type === 'certs') {
      if (!Array.isArray(value) || value.length > 12) invalid('请选择适用体系');
      result[key] = [...new Set(value.map(item => readText(item, label, 120)).filter(Boolean))];
      continue;
    }
    if (type === 'orgs') {
      if (!Array.isArray(value) || value.length > 29) invalid('最多填写 29 个部门');
      result[key] = value.map((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) invalid('部门信息格式不正确');
        const dept = readText(row.dept, '部门名称', 160);
        const owner = readText(row.owner, '部门负责人', 100);
        const duty = readText(row.duty, '部门职责', 1000);
        if (!dept && (owner || duty)) invalid('请填写第 ' + (index + 1) + ' 行的部门名称');
        return { dept, owner, duty };
      }).filter(row => row.dept);
      continue;
    }
    let text = readText(value, label, limitFor(type));
    if (type === 'prefix') text = text.toUpperCase();
    if (text) {
      if ((type === 'period' || type === 'date') && !validPeriod(text, type === 'period')) invalid(label + '请填写有效日期' + (type === 'period' ? '或月份' : ''));
      if (type === 'integer' && !/^\d+$/.test(text)) invalid(label + '须为非负整数');
      if (type === 'decimal' && !/^\d+(\.\d+)?$/.test(text)) invalid(label + '须为非负数字');
      if (type === 'prefix' && !/^[A-Z0-9]{1,8}$/.test(text)) invalid(label + '只接受英文字母和数字');
      if (type === 'schedule' && !schedules.includes(text)) invalid(label + '选项无效');
      if (type === 'design' && !['有', '无'].includes(text)) invalid(label + '选项无效');
      if (key === 'contactPhone' && (!/^\+?[0-9() -]{7,30}$/.test(text) || text.replace(/\D/g, '').length < 7)) invalid(label + '格式不正确');
    }
    result[key] = text;
  }
  return result;
}

const labels = Object.fromEntries(sections.flatMap(section => section.fields).map(([key, label]) => [key, label]));

module.exports = {
  schema: { sections, certificates, schedules, requiredForCompletion, keyFields },
  cleanSurvey, progress, labels,
};
