'use strict';

// Distill the CY556 workflows into local, reviewable reports. Template hints are questions, not evidence.
const PROFILES = {
  '8d': {
    paint: ['涂装缺陷', /漆面|涂装|喷涂|漆膜|流挂|色差|橘皮/, '比较漆膜厚度、清洁度、喷涂参数与固化记录。'],
    assembly: ['装配缺陷', /装配|卡扣|松动|扭矩|异响|漏装/, '复核物料防错、工装定位、拧紧曲线和工序放行。'],
    welding: ['焊接缺陷', /焊接|虚焊|焊点|焊穿|焊渣/, '比对电流、时间、压力、夹持和破坏性抽检记录。'],
    dimensional: ['尺寸超差', /尺寸|外径|内径|超差|公差|Cpk|变形|收缩/i, '复测不良件与对照件，核查量具、刀具、定位和工艺参数。'],
    generic: ['通用缺陷', /$^/, '按人、机、料、法、环、测进行对照验证。'],
  },
  fmea: {
    electronics: ['电子与控制器', /控制器|传感器|电路|线束|ECU|PCB/i, '核对接口、电源、信号及环境条件下的关键功能。'],
    mechanical: ['机械与装配', /轴套|轴承|齿轮|紧固件|装配|扭矩|壳体/, '核对配合公差、传力路径、定位与防错。'],
    surface: ['表面处理', /电镀|热处理|氧化|表面处理|淬火/, '核对材料前处理、过程窗口、测量与耐久要求。'],
    paint: ['涂装工艺', /喷涂|电泳|漆面|涂装|喷漆/, '核对底材处理、漆膜厚度、外观和附着力。'],
    generic: ['通用风险', /$^/, '从功能与验收要求出发，逐条分析失效链。'],
  },
};

const WORD = '待补充';
const got = (v) => v === 0 ? '0' : String(v || WORD);
const kv = (title, rows) => ({ title, header: ['项目', '内容'], rows });
const section = (title, ...tables) => ({ title, tables });
const table = (title, header, rows) => ({ title, header, rows });
const bad = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
function str(value, label, max = 1000) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) bad(`${label}须为不超过 ${max} 字的文本`);
  return value.trim();
}
function fields(input, schema) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('资料格式不正确');
  return Object.fromEntries(schema.map(([key, label, max]) => [key, str(input[key], label, max)]));
}
function list(input, schema, label, max) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > max) bad(`${label}最多 ${max} 条`);
  return input.map((row) => fields(row, schema)).filter((row) => Object.values(row).some(Boolean));
}
function count(value, label) {
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))) bad(`${label}须为非负整数`);
  return Number(value);
}
function profile(mode, selected, problem, product) {
  const templates = PROFILES[mode];
  if (selected && !Object.hasOwn(templates, selected)) bad('请重新选择报告模板');
  const pick = (s) => Object.keys(templates).find((key) => templates[key][1].test(s));
  const key = selected || pick(problem) || pick(product) || 'generic';
  return { name: templates[key][0], hint: templates[key][2] };
}
function stageRecords(c, key) {
  return (c?.submissions || []).filter((s) => s.taskKey === key && !s.returnNote).map((s) => [
    s.acceptedBy ? `已复核 · ${s.acceptedBy}` : '待复核', s.author, s.result, s.evidence,
  ]);
}
function stageTable(c, key, title = '工作单执行记录') {
  return table(title, ['状态', '提交人', '实施记录', '验证证据'], stageRecords(c, key));
}
function checkDate(value, label) {
  if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) bad(label + '须为有效日期');
}
const COMMON = [['product', '产品', 200], ['customer', '客户', 200], ['problem', '问题描述', 12000], ['process', '工序／设计范围', 500], ['team', '团队', 1000], ['requirements', '要求与限制', 2000], ['template', '模板', 40]];
function build8D(input, c, measurements) {
  const v = fields(input, [...COMMON, ['scope', '影响范围', 1000], ['origin', '问题来源', 20], ['sample', '检验件数', 16], ['defects', '不良件数', 16], ['containment', '临时围堵', 4000], ['root', '根因归纳', 3000], ['yokoten', '防再发与横向展开', 3000]]);
  v.product ||= c?.product || '';
  v.problem ||= c?.description || '';
  v.customer ||= c?.business?.customer || '';
  v.process ||= c?.location || '';
  v.team ||= c?.owner || '';
  if (!v.product || !v.problem) bad('8D 请补齐产品和问题描述');
  v.origin ||= c?.kind === 'complaint' ? 'customer' : 'internal';
  if (!['internal', 'customer'].includes(v.origin) || (c?.kind === 'complaint' && v.origin !== 'customer')) bad('请选择与工作单一致的问题来源');
  if (v.origin === 'customer' && !v.customer) bad('客户反馈需填写客户名称');
  let rate = WORD;
  if (v.sample || v.defects) {
    const sample = count(v.sample, '检验件数'), defects = count(v.defects, '不良件数');
    if (sample === 0 || defects > sample) bad('检验件数须大于零，不良件数不可超过检验件数');
    rate = `${(100 * defects / sample).toFixed(2)}%（${defects} / ${sample} 件）`;
  }
  v.why = list(input.why, [['question', '追问'], ['answer', '原因或假设'], ['evidence', '证据']], '5 Why', 5);
  for (const row of v.why) if (!row.question || !row.answer) bad('每条 5 Why 须填写问题和原因或假设');
  v.actions = list(input.actions, [['action', '措施'], ['cause', '对应根因'], ['owner', '责任人', 100], ['due', '期限', 10], ['verify', '验证办法']], '永久措施', 20);
  for (const row of v.actions) {
    if (!row.action || !row.cause) bad('每项永久措施须填写措施和对应根因');
    checkDate(row.due, '措施期限');
  }
  const p = profile('8d', v.template, v.problem, v.product);
  const b = c?.business || {};
  const overview = [['工作单', c?.number], ['关联问题 / 项目', [c?.issueId, c?.projectId].filter(Boolean).join(' / ')], ['产品', v.product], ['问题来源', v.origin === 'customer' ? '客户反馈' : '内部发现'], ['客户', v.customer], ['工序', v.process], ['批次', c?.batch || b.lot], ['团队 / 责任人', v.team], ['问题描述', v.problem], ['影响范围', v.scope], ['实测不良率（按件）', rate], ['要求与限制', v.requirements]];
  return { inputs: v, template: p.name, sections: [
    section('D0–D2 准备、建组与问题描述', kv('5W2H 与追溯资料', overview),
      table('关联批次测量快照（点数不等于件数）', ['特性', '批次', '测量点', '超规格点', '规格下限', '规格上限', 'Cpk'], measurements.map((m) => [m.name, m.batch, m.n, m.out, m.lsl, m.usl, m.cpk == null ? WORD : m.cpk.toFixed(3)]))),
    section('D3 临时围堵与有效性', kv('围堵计划与追溯', [['录入的围堵方案', v.containment], ['工作单方案', c?.plan?.action], ['隔离件数', b.heldQty], ['复检件数', b.checkedQty], ['不良件数', b.failedQty], ['处置记录', b.dispositionRecord]]), stageTable(c, 'contain')),
    section('D4 根因分析与证据', kv('待验证事项', [['模板排查建议', p.hint], ['根因归纳（待核实）', v.root], ['发生与流出原因', '分别核对原始证据后确认']]), table('5 Why', ['层次', '追问', '原因／假设', '验证依据'], v.why.map((w, i) => [i + 1, w.question, w.answer, w.evidence])), stageTable(c, 'cause')),
    section('D5 选择永久纠正措施', table('措施评估清单', ['纠正措施', '对应根因', '责任人', '期限', '验证办法'], v.actions.map((a) => [a.action, a.cause, a.owner, a.due, a.verify]))),
    section('D6 实施与效果验证', stageTable(c, 'correct', '纠正措施实施记录'), stageTable(c, 'verify', '效果验证执行记录'), table('连续批次验证资料', ['批次', '日期', '检验件数', '不良件数', '原始记录'], (b.verificationLots || []).map((l) => [l.batch, l.date, l.checked, l.failed, l.record]))),
    section('D7 防再发与横向展开', kv('防错、标准及培训', [['横向展开计划', v.yokoten], ['文件更新记录', (b.changes || []).filter((item) => item.record).map((item) => `${item.key} · ${item.record}`).join('\n')]])),
    section('D8 关闭与确认', kv('关闭依据', [['工作单状态', c?.closedAt ? '已归档' : '尚未确认结案'], ['原工作单的结案人 / 日期', c?.closedAt && `${c.closedBy} / ${c.closedAt}`], ['报告审核、批准及客户确认', WORD]])),
  ] };
}

// Heuristic used by the CY556 reference. Always report as a suggested priority.
function referenceAP(s, o, d) {
  if (s >= 9) return o === 1 && d === 1 ? 'M' : 'H';
  if (s >= 6) {
    if (o >= 6 || (o >= 4 && d >= 7)) return 'H';
    return o <= 3 && d <= 3 ? 'L' : 'M';
  }
  if (s >= 4) return d >= 7 && o >= 4 ? (o >= 6 ? 'H' : 'M') : 'L';
  return s >= 2 && o >= 4 && d >= 5 ? 'M' : 'L';
}
function rating(values) {
  if (!values.some(Boolean)) return [WORD, WORD, WORD, WORD, WORD];
  if (!values.every((value) => /^(?:[1-9]|10)$/.test(value))) bad('S、O、D 须同时填写 1–10 的整数');
  const [s, o, d] = values.map(Number);
  return [s, o, d, s * o * d, referenceAP(s, o, d)];
}
function buildFMEA(input, c) {
  const v = fields(input, [...COMMON, ['type', 'FMEA 类型', 8], ['scope', '结构范围／工序清单', 3000], ['designOwner', '设计责任方', 200]]);
  v.product ||= c?.product || '';
  v.problem ||= c?.description || '';
  v.customer ||= c?.business?.customer || '';
  v.process ||= c?.location || '';
  v.team ||= c?.owner || '';
  if (!['PFMEA', 'DFMEA'].includes(v.type)) bad('请先确认是 PFMEA 还是 DFMEA');
  if (!v.product || !v.customer || !v.process || !v.scope || (v.type === 'DFMEA' && !v.designOwner)) bad('请填写产品、客户、分析范围及结构层级／工序清单，DFMEA 还需填写设计责任方');
  v.chains = list(input.chains, [['function', '功能或要求'], ['effect', '失效影响'], ['mode', '失效模式'], ['cause', '失效起因'], ['pc', '预防控制'], ['dc', '探测控制'], ['s', 'S', 2], ['o', 'O', 2], ['d', 'D', 2], ['measure', '改进措施'], ['owner', '责任人'], ['due', '计划期限', 10], ['evidence', '验证记录'], ['postS', '复评 S', 2], ['postO', '复评 O', 2], ['postD', '复评 D', 2]], '失效链', 20);
  const rows = v.chains.map((r, i) => {
    checkDate(r.due, '措施期限');
    if (!r.mode || !r.effect || !r.cause) bad(`失效链 ${i + 1} 须填写失效模式、影响与起因`);
    const score = rating([r.s, r.o, r.d]);
    const post = rating([r.postS, r.postO, r.postD]);
    if ([r.postS, r.postO, r.postD].some(Boolean) && (!r.measure || !r.evidence || score[4] === WORD)) bad('复评请同时填写初始评分、改进措施和验证记录');
    return { ...r, index: i + 1, score, post };
  });
  const p = profile('fmea', v.template, v.problem, v.product);
  const rank = { H: 0, M: 1, L: 2, [WORD]: 3 };
  const sorted = rows.slice().sort((a, b) => rank[a.score[4]] - rank[b.score[4]] || (Number(b.score[3]) || 0) - (Number(a.score[3]) || 0));
  return { inputs: v, template: p.name, sections: [
    section('1 · 策划与范围', kv('分析资料', [['FMEA 类型', v.type], ['产品', v.product], ['客户', v.customer], ['工作单', c?.number], ['分析对象', v.process], ['团队', v.team], ['已知现象', v.problem], ['适用要求 / 限制', v.requirements]])),
    section('2 · 结构分析', kv('分析边界', [[v.type === 'DFMEA' ? '系统与组件层级' : '工序清单', v.scope], ...(v.type === 'DFMEA' ? [['设计责任方', v.designOwner]] : []), ['模板核查提示', p.hint]])),
    section('3 · 功能分析', table('功能与要求', ['编号', '功能与要求'], rows.map((r) => [r.index, r.function]))),
    section('4 · 失效分析', table('失效链', ['编号', '失效影响', '失效模式', '失效起因'], rows.map((r) => [r.index, r.effect, r.mode, r.cause]))),
    section('5 · 风险分析', table('现行控制与参考 AP', ['编号', '预防控制', '探测控制', 'S', 'O', 'D', 'RPN', '参考 AP'], sorted.map((r) => [r.index, r.pc, r.dc, ...r.score]))),
    section('6 · 优化及复评', table('措施跟踪', ['编号', '措施', '责任人', '期限', '验证记录', '复评 S', '复评 O', '复评 D', '复评 RPN', '复评参考 AP'], sorted.map((r) => [r.index, r.measure, r.owner, r.due, r.evidence, ...r.post]))),
    section('7 · 结果沟通', kv('评审备注', [['待团队核对', '参考 AP 采用源项目的启发式分支；正式评级须对照企业采用的 AP 表核定。RPN 仅辅助排序。'], ['评分待补', rows.length ? `${rows.filter((r) => r.score[4] === WORD).length} 条` : '请先补充失效链'], ['报告批准', WORD]]), stageTable(c, 'verify')),
  ] };
}

function build(mode, input, c, measurements) {
  if (mode === '8d') return build8D(input, c, measurements);
  if (mode === 'fmea') return buildFMEA(input, c);
  return bad('该模式没有结构化 Skill');
}
const templates = Object.fromEntries(Object.entries(PROFILES).map(([mode, entries]) => [mode, Object.entries(entries).map(([key, [name]]) => [key, name])]));
function docxBlocks(row) {
  return [{ type: 'title', text: row.title }, { type: 'subtitle', text: `${row.source} · 第 ${row.version} 版 · 待核对` },
    ...row.skillReport.sections.flatMap((s) => [{ type: 'h1', text: s.title }, ...s.tables.flatMap((t) => [{ type: 'h2', text: t.title }, t.rows.length ? { type: 'table', header: t.header, rows: t.rows.map((cells) => cells.map(got)) } : { type: 'p', text: WORD }])])];
}
function markdown(report) {
  const cell = (v) => got(v).replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
  const line = (values) => '| ' + values.map(cell).join(' | ') + ' |';
  return report.sections.map((s) => `## ${s.title}\n\n` + s.tables.map((t) => `### ${t.title}\n\n` + (t.rows.length ? [line(t.header), line(t.header.map(() => '---')), ...t.rows.map(line)].join('\n') : WORD)).join('\n\n')).join('\n\n');
}

module.exports = { build, templates, got, markdown, docxBlocks };
