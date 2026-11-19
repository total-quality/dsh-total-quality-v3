(function (g) {
  'use strict';
  const { esc, card, tag, dt, empty, modal, closeModal, toast } = UI;
  const base = '/qip-real-v3/api/operations';
  const S = { data: null, tab: 'decision', active: null, preview: null, busy: false, stream: null };
  const statusColor = { plan_review: 'blue', needs_info: 'orange', executing: 'blue', result_review: 'purple', close_review: 'orange', closed: 'green' };
  const button = (action, label, id = '', cls = '') => `<button type="button" class="btn ${cls}" data-op="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
  const field = (label, name, value = '', type = 'text', full = false) => `<label class="op-field${full ? ' full' : ''}">${esc(label)}<${type === 'textarea' ? 'textarea rows="4"' : `input type="${type}"${type === 'number' ? ' step="any"' : ''}`} name="${esc(name)}" ${type === 'textarea' ? '' : `value="${esc(value)}"`}>${type === 'textarea' ? esc(value) + '</textarea>' : ''}</label>`;
  const select = (label, name, values, value) => `<label class="op-field">${esc(label)}<select name="${name}">${values.map(([k, v]) => `<option value="${esc(k)}" ${k === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  const owners = () => (S.data?.people || []).map((n) => [n, n]);
  const localDate = (iso) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const note = (s, cls = '') => `<div class="op-note ${cls}">${esc(s)}</div>`;
  const form = (kind, body, label = '保存', id = '') => `<form data-op-form="${kind}" data-id="${esc(id)}" class="op-form">${body}<div class="op-error full" role="alert"></div><div class="op-actions full"><button class="btn btn-primary" type="submit">${label}</button></div></form>`;
  const heading = (title, sub = '', extra = '') => `<div class="op-heading"><div><span class="op-eyebrow">QUALITY OPERATIONS</span><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="op-actions">${extra}${button('guide', '使用指南')}</div></div><div id="opLive" hidden class="op-note">有新的数据变化。${button('refresh', '更新展示')}</div>`;
  const load = async () => (S.data = await API.get(base));
  const go = (p) => g.goPage(p);
  const tabs = (list, selected) => `<div class="op-tabs">${list.map(([k, title, count]) => `<button type="button" data-op="tab" data-id="${k}" class="${k === selected ? 'on' : ''}">${esc(title)} <b>${count}</b></button>`).join('')}</div>`;
  function caseCard(c) { return `<article class="op-case"><div class="op-case-top"><span>${esc(c.number)}</span>${tag(c.risk + '级', c.risk === 'A' ? 'red' : 'orange')}${tag(S.data.labels[c.status], statusColor[c.status])}</div><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p><div class="op-case-meta">${esc(c.owner)} · ${esc(c.batch || '批次待补充')} · ${esc(c.location || '工序待补充')}</div><div class="op-case-bottom"><span>${c.tasks.length ? '已完成 ' + c.tasks.filter((t) => t.status === 'done').length + '/' + c.tasks.length + ' 阶段' : '方案和核对清单已准备'}${c.status === 'executing' ? ' · ' + esc(dt(c.tasks[c.stage]?.due)) : ''}</span>${button('detail', '打开工作单 →', c.id, 'btn-primary')}</div></article>`; }
  function wireLive() {
    S.stream?.close();
    if (!g.EventSource) return;
    S.stream = new EventSource(base + '/events');
    S.stream.onmessage = (e) => { let v; try { v = JSON.parse(e.data); } catch (_) { return; } if (S.data && v.revision !== S.data.revision) { const banner = document.getElementById('opLive'); if (banner) banner.hidden = false; } };
  }
  function footer() { return '<div class="footer-note">全质开源质量平台2 · 站内自动跟进，关键决定由管理者确认</div>'; }
  g.Pages.runHub = { title: '运行中枢', sub: '资料接收、风险筛查与工作单处理', mount: wireLive, async render() {
    const d = await load(), n = d.counts, decisions = d.cases.filter((c) => ['plan_review', 'result_review', 'close_review'].includes(c.status));
    return `${heading('质量工作，向前一步。', '自动整理证据与下一步动作，需要判断的内容集中在同一张工作单。', button('scan', '立即筛查', '', 'btn-primary'))}
      <section class="op-hero"><div class="op-hero-copy"><span class="op-live-dot">${d.policy.enabled ? '定时筛查已开启' : '定时筛查已暂停'}</span><h2>全程自动跟进，<br><em>关键时刻，由您确认。</em></h2><p>每 ${d.policy.scanHours} 小时筛查 · 导入后即时检查<br>最近筛查 ${esc(d.lastScan ? dt(d.lastScan) : '尚未运行，点击立即筛查')}</p><div class="op-actions">${button('decisions', '查看待确认 ' + decisions.length + ' →', '', 'btn-primary')}${button('new', '＋ 录入信息')}${button('guide', '开始使用')}</div></div><div class="op-orbit" aria-hidden="true"><div class="op-ring"></div><b>全</b><span class="op-node n1">资料接收</span><span class="op-node n2">异常筛查</span><span class="op-node n3">执行跟进</span><span class="op-node n4">结果归档</span></div><figure class="op-support"><img class="ch-support-qr" src="/qip-real-v3/assets/wechat-support-blue.svg" width="176" height="176" alt="扫码添加免费服务微信"><figcaption>免费服务微信：周一到周六，早8:00至晚8:00</figcaption></figure></section>
      <div class="op-metrics">${[['待您确认', decisions.length, '方案、执行结果与结案决定', 'decisions'], ['执行跟进', n.executing, '当前任务已派到站内待办', 'execution'], ['需补充资料', n.needs_info, '缺口可在工作单原处补齐', 'missing'], ['已结案归档', n.closed, '报告与经验可追溯', 'closed']].map(([title, value, sub, act]) => `<button class="op-metric" data-op="${act}"><span>${title}</span><strong>${value}<small> 项</small></strong><p>${sub}</p></button>`).join('')}</div>
      <div class="op-grid"><section>${card('需要决定', '方案、证据、责任人与期限在同一处核对', decisions.slice(0, 4).map(caseCard).join('') || empty('当前没有待确认事项'))}</section><aside>${card('处理动态', '自动处理与人工决定均留有记录', d.events.slice(0, 8).map((e) => `<div class="op-event"><i class="${e.automatic ? '' : 'human'}"></i><div><p>${esc(e.text)}</p><small>${esc(dt(e.at))} · ${e.automatic ? '自动流程' : '人工决定'}</small>${e.caseId ? button('detail', '查看工作单', e.caseId, 'btn-sm') : ''}</div></div>`).join('') || empty('接收第一份资料后，这里会显示处理记录'))}${card('运营策略', '自动化范围可调整', `<p>筛查 ${d.policy.enabled ? '开启' : '暂停'} · 自动派工 ${d.policy.internalDispatch ? '开启' : '暂停'}</p><p>结案后报告 ${d.policy.autoReport ? '自动整理' : '手动整理'} · 经验 ${d.policy.autoKnowledge ? '自动沉淀' : '手动沉淀'}</p>${button('policy', '调整策略')}${button('workbench', '改进工作台')}`)}</aside></div>${footer()}`;
  } };
  g.Pages.confirmFix = { title: '确认与纠正', sub: '在同一张工作单核对、调整和批准', mount: wireLive, async render() {
    const d = await load(), tab = S.tab;
    const filters = { decision: (c) => ['plan_review', 'result_review', 'close_review'].includes(c.status), approved: (c) => c.status === 'executing', missing: (c) => c.status === 'needs_info', closed: (c) => c.status === 'closed', all: () => true };
    const f = filters[tab] || filters.decision;
    return heading('把决定，放在证据旁边。', '可直接批准，也可修改后批准；执行中的方案可以取消批准，记录会保留。', button('new', '＋ 录入信息', '', 'btn-primary')) + tabs([['decision', '待确认'], ['approved', '已批准'], ['missing', '需补资料'], ['closed', '已归档'], ['all', '全部']].map(([key, label]) => [key, label, d.cases.filter(filters[key]).length]), tab) + '<div class="op-card-grid">' + (d.cases.filter(f).map(caseCard).join('') || empty('该分类暂无工作单')) + '</div>' + footer();
  } };
  g.Pages.followUp = { title: '执行跟进', sub: '现场提交、自动预检、管理者复核', mount: wireLive, async render() { const d = await load(); return heading('每一个动作，都接得上。', '打开工作单即可填写实际执行结果和验证依据。', button('scan', '立即筛查')) + '<div class="op-lanes">' + [['executing', '执行中'], ['result_review', '待结果复核'], ['close_review', '待结案'], ['closed', '已归档']].map(([key, title]) => `<section><h2>${title}<small>${d.counts[key]}</small></h2>${d.cases.filter((c) => c.status === key).map(caseCard).join('') || empty('暂无')}</section>`).join('') + '</div>' + footer(); } };
  function capabilityLabel(b) {
    if (b.cpk !== null) return 'Cpk ' + b.cpk.toFixed(3) + ' · ' + b.method;
    return {
      insufficient: '能力样本待积累 ' + b.n + '/' + b.minSamples + ' · ' + b.method,
      invalid_subgroups: '需核对子组编号或各组样本量 · ' + b.n + ' 点',
      unstable: '控制图有信号，能力暂缓 · ' + b.method + ' · ' + b.n + ' 点',
      no_variation: '未观察到组内变差，能力暂缓',
    }[b.capabilityStatus] || '暂无能力估计';
  }
  function renderRequirement(t) {
    return t ? `<p class="op-text">${esc(g.QBusiness.taskRequirement(t))}</p>` : '';
  }
  function renderRevisions(c) {
    const revisions = c.planRevisions || [];
    return revisions.length ? card('方案版本', '', revisions.slice().reverse().map((r) =>
      `<details class="op-business"><summary>方案版本 ${r.version}</summary><p class="op-text">${esc(g.QBusiness.planRevisionText(r))}</p></details>`).join('')) : '';
  }
  g.Pages.intakeTrace = { title: '接收与追溯', sub: '先预检，确认后入库；异常自动进入处理箱', mount() { wireLive(); const zone = document.getElementById('opDrop'); zone?.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); }); zone?.addEventListener('dragleave', () => zone.classList.remove('over')); zone?.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const file = e.dataTransfer.files[0]; if (file) receiveFile(file).catch((err) => toast(err.message, 'err')); }); }, async render() {
    const d = await load(); return heading('接收一次，后续自动接上。', '支持 CSV、JSON、XLSX。先核对字段、规格与批次，再接收和筛查。', button('new', '＋ 录入问题 / 申请')) + `<section id="opDrop" class="op-drop"><span>⇧</span><h2>拖入测量文件，或选择本地文件</h2><p>无效文件不会写入 · 重复文件跳过 · 测量点数与产品件数分开统计</p><div class="op-actions">${button('file', '选择文件', '', 'btn-primary')}${button('sample', '下载 CSV 模板')}</div></section><div class="op-pipeline">${['字段与规格预检', '归组与重复检查', '实算能力与判异', '异常进入待确认'].map((x, i) => `<div><b>0${i + 1}</b><span>${x}</span></div>`).join('')}</div>` + card('特性 / 批次追溯', '沿用原统计引擎，规格内不代表过程稳定', `<div class="op-table-wrap"><table class="op-table"><thead><tr><th>特性</th><th>批次</th><th>测量点</th><th>超规格点</th><th>过程能力</th><th>判异信号</th><th></th></tr></thead><tbody>${d.batches.map((b) => `<tr><td>${esc(b.name)}<small>${esc(b.charId)}</small></td><td>${esc(b.batch)}</td><td>${b.n}</td><td>${b.out}</td><td>${esc(capabilityLabel(b))}</td><td>${b.signals}</td><td>${button('capability', '筛查设置', b.charId, 'btn-sm')}</td></tr>`).join('')}</tbody></table></div>`) + card('接收记录', '', d.imports.map((r) => `<div class="op-import"><b>${esc(r.filename)}</b><span>新增 ${r.count} 条${r.skipped ? ' · 跳过 ' + r.skipped + ' 条' : ''} · ${esc(dt(r.at))}</span></div>`).join('') || empty('暂无接收记录')) + footer();
  } };

  function businessForm(c) {
    const B = g.QBusiness, b = c.business, a = B.assessBusiness(b, c);
    const body = note('这里记录实际追溯事实，不会代替 ERP 冻结库存或向外部系统放行。') + select('业务路径', 'route', Object.entries(B.businessRoutes).filter(([k]) => c.kind === 'application' ? k === 'change' : c.kind === 'complaint' ? k === 'customer' : k !== 'change').map(([k, v]) => [k, v.name]), b.route) + B.businessFields.map(([k, title]) => field(title, k, b[k] || '', k === 'gaugeValidUntil' ? 'date' : 'text')).join('') + '<h3 class="full">影响范围与数量</h3>' + note('总数 = 库存＋在制＋已发货；退回数属于已发货的子集，不重复相加。') + B.quantityFields.map(([k, title]) => field(title, k, b[k] ?? '', 'number')).join('') + field('处置 / 隔离记录', 'dispositionRecord', b.dispositionRecord || '', 'text', true) + '<h3 class="full">整改后的批次验证</h3>' + field('措施实施日期', 'actionDate', b.actionDate || '', 'date') + field('要求批次数', 'requiredBatches', b.requiredBatches || 3, 'number') + field('改善前样本数', 'baselineChecked', b.baselineChecked ?? '', 'number') + field('改善前不良数', 'baselineFailed', b.baselineFailed ?? '', 'number') + field('允许不良率（%）', 'allowedDefectRate', b.allowedDefectRate ?? 0, 'number') + '<div class="full op-verification">' + Array.from({ length: Math.min(12, Math.max(3, (b.verificationLots || []).length + 1)) }, (_, i) => { const r = b.verificationLots?.[i] || {}; return `<fieldset><legend>验证批次 ${i + 1}</legend>${[['batch', '批次', 'text'], ['date', '日期', 'date'], ['checked', '样本数', 'number'], ['failed', '不良数', 'number'], ['record', '原始记录编号', 'text']].map(([k, title, type]) => field(title, 'v' + i + '_' + k, r[k] ?? '', type)).join('')}</fieldset>`; }).join('') + '</div><h3 class="full">防再发与文件联动</h3>' + B.changeFields.map(([k, title]) => { const r = b.changes?.find((v) => v.key === k) || {}; return select(title, 'ch_' + k, [['pending', '待更新'], ['done', '已完成'], ['na', '不适用']], r.status || 'pending') + field('版本 / 记录 / 不适用理由', 'rec_' + k, r.record || ''); }).join('') + `<label class="full"><input type="checkbox" name="enforce" ${b.enforce ? 'checked' : ''}> 结案时核对上述业务资料（未齐仍可保存草稿）</label>` + note('当前缺口：' + ([...a.invalid, ...a.missing].join('；') || '结构化核对通过'));
    return form('business', body, '保存业务关联', c.id);
  }
  async function detail(id) {
    await load(); const c = (await API.get(base + '/cases/' + encodeURIComponent(id))).row; S.active = c;
    let primary = '';
    if (c.status === 'plan_review') primary = card('核对处理方案', c.plan.source, (c.ai?.status === 'failed' ? note('模型起草暂未完成：' + c.ai.message, 'warn') : '') + button('draft', '用当前资料重新起草', c.id, 'btn-sm') + form('plan', field('处理动作', 'action', c.plan.action, 'textarea', true) + field('验证要求', 'verification', c.plan.verification, 'textarea', true) + select('责任人', 'owner', owners(), c.owner) + field('截止时间', 'due', localDate(c.plan.due), 'datetime-local') + select('风险等级', 'risk', [['A', 'A 级'], ['B', 'B 级'], ['C', 'C 级']], c.risk), '保存调整', c.id)) + `<div class="op-decision-bar">${button('approve', '一键批准', c.id, 'btn-primary')}<span>批准后自动建立任务并派发当前阶段待办。</span></div>`;
    if (c.status === 'needs_info') primary = card('补充资料', c.missing.join('；'), form('supplement', field('补充事实、要求与验证安排', 'text', c.supplement || '', 'textarea', true), '提交补充资料', c.id));
    if (c.status === 'executing') { const t = c.tasks[c.stage]; primary = card('填写' + t.title + '结果', t.owner + ' · 截止 ' + dt(t.due), renderRequirement(t) + (c.returnNote ? note('上次退回：' + c.returnNote, 'warn') : '') + form('submit', field('实际执行结果', 'result', '', 'textarea', true) + field('验证方式与证据', 'evidence', '', 'textarea', true) + select('提交人', 'author', owners(), t.owner) + '<label class="op-field">附件（可选，单个 5 MB）<input type="file" name="evidenceFile" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.json,.xlsx,.docx"></label>', '提交结果并复核', c.id)) + button('revoke', '取消批准并修改方案', c.id); }
    if (c.status === 'result_review') { const sub = c.submissions.at(-1); primary = card('执行结果待复核', sub.author + ' · ' + dt(sub.createdAt), `${renderRequirement(c.tasks[c.stage])}<h3>实际执行结果</h3><p class="op-text">${esc(sub.result)}</p><h3>验证方式与证据</h3><p class="op-text">${esc(sub.evidence)}</p>${note(c.precheck?.warning || '')}<div class="op-actions">${button('approve', '一键批准', c.id, 'btn-primary')}</div><details><summary>纠正 / 退回补充</summary>${form('return', field('需补充或纠正的内容', 'note', '', 'textarea', true), '退回当前阶段', c.id)}</details>`); }
    if (c.status === 'close_review') primary = card('结案资料已汇总', '请核对全部阶段结果与业务验证记录', note('系统只汇总已经人工接受的执行记录。结案后按策略生成报告和经验卡。') + c.tasks.map((t) => `<h3>${esc(t.title)}</h3>${renderRequirement(t)}`).join('') + button('approve', '一键批准', c.id, 'btn-primary'));
    if (c.status === 'closed') primary = card('已结案归档', c.closedBy + ' · ' + dt(c.closedAt), note('本工作单的执行结果、人工复核记录和业务追溯资料已保留。') + `<a class="btn btn-primary" href="/qip-real-v3/api/operations/cases/${encodeURIComponent(c.id)}/report">下载处理报告</a>`);
    const history = `<ol class="op-history">${c.history.slice().reverse().map((h) => `<li><b>${esc(h.text)}</b><small>${esc(dt(h.at))} · ${h.automatic ? '自动流程' : '人工记录'}</small></li>`).join('')}</ol>`;
    modal({ width: 'wide', title: c.title, sub: c.number + ' · ' + S.data.labels[c.status] + ' · ' + c.risk + '级', body: `<div class="op-detail" data-case="${esc(c.id)}"><div>${primary}<details class="op-business"><summary>业务关联、数量平衡与效果验证</summary>${c.status === 'closed' ? `<pre class="op-text">${esc(g.QBusiness.businessSummary(c.business, c))}</pre>` : businessForm(c)}</details>${card('分析与工作台', '', button('analyzeCase', '以此工作单进入改进工作台', c.id))}</div><aside>${card('事实与来源', c.source, `<p class="op-text">${esc(c.description)}</p><p>产品 ${esc(c.product || '待补充')} · 批次 ${esc(c.batch || '待补充')}</p>${c.previousCaseId ? button('detail', '前次工作单 ' + c.previousCaseId, c.previousCaseId, 'btn-sm') : ''}${(c.followUpCaseIds || []).map((id) => button('detail', '复发工作单 ' + id, id, 'btn-sm')).join('')}${c.measurementTrace ? note('结案后批次追溯：' + c.measurementTrace.n + ' 个测量点 · 超规格 ' + c.measurementTrace.out + ' 点') : ''}${c.files.map((f) => `<p><a class="btn btn-sm" href="${base}/cases/${encodeURIComponent(c.id)}/files/${encodeURIComponent(f.id)}">下载 ${esc(f.filename)}</a></p>`).join('')}${c.measurement ? note(c.measurement.n + ' 个测量点 / 超规格 ' + c.measurement.out + ' 点；测量点不等于产品件数') : ''}`)}${card('执行路径', '每一阶段的结果都在原工作单提交', c.tasks.length ? c.tasks.map((t, i) => `<div class="op-task ${i === c.stage ? 'current' : ''}"><b>${esc(t.title)}</b><small>${esc(t.owner)} · ${esc(dt(t.due))}</small><span>${{ active: '待执行', waiting: c.status === 'plan_review' && i === c.stage ? '待方案确认' : '待前序完成', review: '待复核', done: '已接受' }[t.status]}</span>${t.planVersion ? `<details><summary>方案版本 ${t.planVersion} · 执行要求</summary>${renderRequirement(t)}</details>` : renderRequirement(t)}</div>`).join('') : note('批准方案后自动建立执行路径'))}${renderRevisions(c)}${card('处理记录', '', history)}</aside></div>`, footer: button('close', '关闭') });
  }
  async function receiveFile(file) {
    if (file.size > 5 * 1024 * 1024) throw Error('请选择 5 MB 以内的文件');
    const base64 = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1]); fr.onerror = reject; fr.readAsDataURL(file); });
    const p = await API.post(base + '/preview', { filename: file.name, base64 });
    const possible = p.checks.filter((r) => r.state === 'possible');
    const conflicts = p.checks.filter((r) => r.state === 'conflict');
    const duplicates = p.checks.filter((r) => r.state === 'duplicate').length;
    const summary = p.duplicate ? '该文件已经接收。' :
      p.count + ' 条通过字段预检 · 超规格 ' + p.out + ' 点 · 按编号跳过 ' + duplicates + ' 条';
    const review = possible.length ? note('这些无编号记录与已有测量相似。独立复测选「保留」，从旧台账重复带入选「跳过」。') +
      button('skipDuplicates', '疑似行全部跳过') + button('keepDuplicates', '疑似行全部保留') : '';
    const checkedRows = [...conflicts, ...possible];
    const checkTable = checkedRows.length ? `<div class="op-table-wrap" style="max-height:350px;overflow:auto"><table class="op-table"><thead><tr><th>数据行</th><th>特性</th><th>批次</th><th>测量时间</th><th>值</th><th>处理</th></tr></thead><tbody>${checkedRows.map((r) => `<tr><td>${r.row}</td><td>${esc(r.name)}</td><td>${esc(r.batch)}</td><td>${esc(r.ts ? dt(r.ts) : '未填')}</td><td>${r.value}</td><td>${r.state === 'conflict' ? '编号 ' + esc(r.sourceId) + ' 内容冲突' : `<select aria-label="第 ${r.row} 条数据的处理方式" data-op-duplicate="${r.row}"><option value="">请选择</option><option value="skip">跳过</option><option value="keep">保留</option></select>`}</td></tr>`).join('')}</tbody></table></div>` : '';
    const sample = `<div class="op-table-wrap"><table class="op-table"><thead><tr><th>特性</th><th>批次</th><th>值</th><th>规格</th></tr></thead><tbody>${p.preview.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.batch)}</td><td>${r.value}</td><td>${r.lsl}～${r.usl}</td></tr>`).join('')}</tbody></table></div>`;
    modal({ width: 'wide', title: '接收前核对', sub: file.name,
      body: note(summary) + (conflicts.length ? note('同一来源和编号对应了不同记录。请核对源表后重新导入。', 'warn') : '') + review + checkTable + sample,
      footer: button('close', p.duplicate ? '关闭' : '取消') + (p.duplicate || conflicts.length ? '' : button('accept', '确认接收', p.id, 'btn-primary')) });
  }
  function newCase() { modal({ title: '录入问题或申请', sub: '先填写已知事实，系统准备方案，后续在同一工作单补充', body: form('new', select('类型', 'kind', [['issue', '质量问题'], ['complaint', '客户反馈'], ['application', '变更申请']], 'issue') + select('责任人', 'owner', owners(), S.data?.people[0]) + field('标题', 'title', '', 'text', true) + field('情况说明', 'description', '', 'textarea', true) + field('产品', 'product') + field('批次', 'batch') + field('工序 / 车间', 'location') + select('等级', 'risk', [['A', 'A 级'], ['B', 'B 级'], ['C', 'C 级']], 'B'), '生成处理方案') }); }
  const handlers = {
    refresh: () => go(g.State.page), detail: (id) => detail(id), close: closeModal,
    decisions: () => { S.tab = 'decision'; go('confirmFix'); }, missing: () => { S.tab = 'missing'; go('confirmFix'); }, closed: () => { S.tab = 'closed'; go('confirmFix'); }, execution: () => go('followUp'), tab: (id) => { S.tab = id; go('confirmFix'); },
    scan: async () => { const r = await API.post(base + '/scan'); toast('筛查完成，新增异常 ' + r.created + ' 条，站内催办 ' + r.reminders + ' 条', 'ok'); await go(g.State.page); },
    new: async () => { await load(); newCase(); },
    approve: async (id) => { if (document.querySelector('.dm-panel form[data-dirty="1"]')) throw Error('有未保存的调整，请先保存后再批准'); const r = await API.post(base + '/cases/' + encodeURIComponent(id) + '/approve', { version: S.active.version, author: '管理者' }); S.active = r.row; await detail(id); },
    draft: async (id) => { if (document.querySelector('.dm-panel form[data-dirty="1"]')) throw Error('请先保存当前调整再重新起草'); await API.post(base + '/cases/' + encodeURIComponent(id) + '/draft', {version:S.active.version}); await detail(id); },
    revoke: async (id) => { await API.post(base + '/cases/' + encodeURIComponent(id) + '/revoke', { version: S.active.version, author: '管理者' }); await detail(id); },
    file: () => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,.json,.xlsx'; input.onchange = () => { if (input.files[0]) receiveFile(input.files[0]).catch((e) => toast(e.message, 'err')); }; input.click(); },
    skipDuplicates: () => document.querySelectorAll('.dm-panel [data-op-duplicate]').forEach((e) => { e.value = 'skip'; }),
    keepDuplicates: () => document.querySelectorAll('.dm-panel [data-op-duplicate]').forEach((e) => { e.value = 'keep'; }),
    accept: async (id) => {
      const choices = [...document.querySelectorAll('.dm-panel [data-op-duplicate]')];
      const unset = choices.find((e) => !e.value);
      if (unset) { unset.focus(); throw Error('请先逐行确认疑似重复数据'); }
      const r = await API.post(base + '/accept', { previewId: id, duplicateDecisions: Object.fromEntries(choices.map((e) => [e.dataset.opDuplicate, e.value])) });
      closeModal(); toast('新增 ' + r.imported + ' 条，跳过 ' + r.skipped + ' 条', 'ok'); await go('intakeTrace');
    },
    capability: (id) => {
      const b = S.data.batches.find((row) => row.charId === id);
      modal({ title: '能力筛查设置', sub: b.name, body: form('capability', field('最低测量点数', 'minSamples', b.minSamples, 'number', true) +
        field('每组样本量', 'subgroupSize', b.configuredSubgroupSize, 'number', true) +
        note('子组设 0 时按导入的子组编号识别，设 1 使用 I–MR，设 2 或以上时各组须有相同的完整样本。控制图有信号时暂停能力建单，超规格点仍即时筛查。'), '保存设置', id) });
    },
    sample: () => { const content = '\uFEFF特性名称,测量值,规格下限,规格上限,批次,工序,产品,单位,测量来源,源测量编号\n轴套外径,12.02,11.9,12.1,B-示例01,机加工,示例轴套,mm,台账示例,MS-001\n轴套外径,12.03,11.9,12.1,B-示例01,机加工,示例轴套,mm,台账示例,MS-002\n轴套外径,12.13,11.9,12.1,B-示例01,机加工,示例轴套,mm,台账示例,MS-003\n'; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); a.download = '测量接收模板.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); },
    policy: () => modal({ title: '自动化策略', sub: '作用于当前插件的本地数据与站内待办', body: form('policy', ['enabled', 'autoDraft', 'internalDispatch', 'autoReport', 'autoKnowledge'].map((k, i) => `<label><input type="checkbox" name="${k}" ${S.data.policy[k] ? 'checked' : ''}> ${['定时与数据变化筛查', '模型自动准备处理方案', '自动派发站内待办', '结案自动生成报告', '结案自动沉淀经验'][i]}</label>`).join('') + field('筛查间隔（小时）', 'scanHours', S.data.policy.scanHours, 'number') + field('超期催办间隔（小时）', 'reminderHours', S.data.policy.reminderHours, 'number') + note('方案批准、执行结果复核和结案决定始终由管理者确认。催办记录保存在站内，不自动向外发送消息。'), '保存策略') }),
    guide: () => modal({ title: '使用指南 · 全质开源质量平台2', sub: '从接收到归档，沿一张工作单完成', body: '<div class="op-guide">' + [['接收资料', '在“接收与追溯”上传测量文件，先看预检结果，再确认接收。也可以直接录入质量问题、客诉或变更申请。'], ['核对并批准方案', '在“确认与纠正”打开工作单，核对事实、处理动作、责任人与期限；需要调整就在原处保存，再一键批准。'], ['现场执行与结果复核', '任务自动进入站内待办。责任人在同一工作单填写实际结果与证据，管理者批准或写明意见退回；每次提交都保留。'], ['补齐验证并结案', '在业务关联区核对数量平衡、连续批次数据与文件更新。全部阶段接受后确认结案，按策略生成报告和经验。'], ['管理问答与分析', '改进工作台可选择关联工作单与分析模式。系统自动带入现有资料，未知的原因和事实继续标记待核实。']].map(([t, p], i) => `<section><b>0${i + 1}</b><div><h3>${t}</h3><p>${p}</p></div></section>`).join('') + '</div>' }),
    workbench: () => go('opsWorkbench'), analyzeCase: (id) => { S.workbenchCase = id; S.editingSkill = null; S.workbenchMode = 'review'; closeModal(); go('opsWorkbench'); },
  };
  document.addEventListener('input', (e) => { const f = e.target.closest('form[data-op-form]'); if (f) f.dataset.dirty = '1'; });
  document.addEventListener('change', (e) => { const f = e.target.closest('form[data-op-form]'); if (f) f.dataset.dirty = '1';  });
  document.addEventListener('click', async (e) => { const b = e.target.closest('[data-op]'); if (!b) return; e.preventDefault(); const fn = handlers[b.dataset.op]; if (!fn || S.busy) return; S.busy = true; b.disabled = true; try { await fn(b.dataset.id); } catch (err) { toast(err.message, 'err', 8000); } finally { S.busy = false; if (b.isConnected) b.disabled = false; } });
  document.addEventListener('submit', async (e) => { const f = e.target.closest('form[data-op-form]'); if (!f) return; e.preventDefault(); if (S.busy) return; S.busy = true; const submit = f.querySelector('button[type=submit]'); submit.disabled = true; const values = Object.fromEntries(new FormData(f)); const kind = f.dataset.opForm, id = f.dataset.id; let body = { ...values, version: S.active?.version };
    try {
      if (kind === 'new') { const r = await API.post(base + '/cases', values); await detail(r.row.id); }
      else if (kind === 'policy') { body = { scanHours: Number(values.scanHours), reminderHours: Number(values.reminderHours) }; for (const k of ['enabled', 'autoDraft', 'internalDispatch', 'autoReport', 'autoKnowledge']) body[k] = !!f.elements[k].checked; await API.put(base + '/policy', body); closeModal(); await go('runHub'); }
      else if (kind === 'capability') { await API.put(base + '/characteristics/' + encodeURIComponent(id) + '/capability', values); closeModal(); await go('intakeTrace'); }
      else if (kind === 'analysis' || kind === 'skillEdit') await runAnalysis(f, values);
      else if (kind === 'analysisEdit') { const r = (await API.put(base + '/analysis/' + encodeURIComponent(id), values)).row; const panel = f.closest('[data-analysis-record]'); if (panel) panel.outerHTML = renderAnalysis(r); await refreshAnalysisList(); }
      else {
        if (kind === 'plan') body = { version: S.active.version, risk: values.risk, plan: { action: values.action, verification: values.verification, owner: values.owner, due: values.due ? new Date(values.due).toISOString() : '' } };
        if (kind === 'business') { const b = { ...values, enforce: f.elements.enforce.checked, verificationLots: Array.from({ length: 12 }, (_, i) => Object.fromEntries(['batch', 'date', 'checked', 'failed', 'record'].map((k) => [k, values['v' + i + '_' + k] || '']))), changes: g.QBusiness.changeFields.map(([key]) => ({ key, status: values['ch_' + key], record: values['rec_' + key] })) }; body = { version: S.active.version, business: b }; }
        if (kind === 'submit') {
          const file = f.elements.evidenceFile?.files[0];
          if (file) {
            if (file.size > 5 * 1024 * 1024) throw Error('附件须小于 5 MB');
            const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
            const uploaded = await API.post(base + '/cases/' + encodeURIComponent(id) + '/files', {version:S.active.version,filename:file.name,base64});
            S.active.version = uploaded.version; S.active.files.push(uploaded.file); f.elements.evidenceFile.value = '';
          }
          body.version = S.active.version; body.files = S.active.files.map((v) => v.id);
        }
        await API.post(base + '/cases/' + encodeURIComponent(id) + '/' + kind, body); await detail(id);
      }
    } catch (err) { const out = f.querySelector('.op-error'); if (out) out.textContent = err.message; else toast(err.message, 'err'); }
    finally { S.busy = false; if (submit.isConnected) submit.disabled = false; }
  });
  // Workbench is shared by local analysis modes and the existing free-form Harness chat.
  const analysisList = (records) => records.slice(0, 15).map((r) => `<div class="op-import"><div><b>${esc(r.title)}</b><small>${esc(dt(r.updatedAt || r.createdAt))} · 第 ${r.version || 1} 版</small></div>${button('analysisRecord', '查看', r.id, 'btn-sm')}</div>`).join('') || empty('暂无记录');
  async function refreshAnalysisList() { const list = document.getElementById('opAnalysisList'); if (list) list.innerHTML = analysisList((await API.get(base + '/analysis')).rows); }
  const Skills = g.QSkills;
  async function runAnalysis(f, values) {
    const mode = f.elements.mode.value;
    const skill = Skills.supported(mode);
    const out = document.getElementById('opAnalysis');
    const result = f.dataset.editingMode
      ? await API.put(base + '/analysis/' + encodeURIComponent(f.dataset.id), { caseId: values.caseId, version: values.version, skill: Skills.read(f, mode) })
      : await API.post(base + '/analysis', skill ? { mode, caseId: values.caseId, skill: Skills.read(f, mode) } : values);
    f.dataset.dirty = '';
    if (out?.isConnected) {
      if (f.dataset.editingMode) { S.editingSkill = result.row; f.elements.version.value = result.row.version; }
      out.innerHTML = renderAnalysis(result.row);
      if (skill) out.scrollIntoView({ block: 'start' });
    }
    await refreshAnalysisList();
  }
  function renderAnalysis(r) {
    const download = `${base}/analysis/${encodeURIComponent(r.id)}/download`;
    const content = r.skillReport ? Skills.preview(r) + `<div class="op-actions skill-export"><a class="btn" href="${download}?format=docx">下载 Word</a><a class="btn" href="${download}?format=xlsx">下载 Excel</a><a class="btn" href="${download}">下载 Markdown</a>${button('skillEdit', '修订报告表单', r.id)}</div>`
      : `<pre class="op-text">${esc(r.outputs)}</pre><a class="btn" href="${download}">下载分析记录</a>${r.qmsDocId ? note('该手册草稿已同步到体系文件，修订时会一并更新。') : ''}<details><summary>核对并修订草稿</summary>${form('analysisEdit', `<input type="hidden" name="version" value="${r.version || 1}">` + field('标题', 'title', r.title, 'text', true) + field('正文', 'outputs', r.outputs, 'textarea', true), '保存修订版本', r.id)}</details>`;
    return `<section data-analysis-record="${esc(r.id)}">` + card(r.title, r.source + ' · 第 ' + (r.version || 1) + ' 版 · ' + dt(r.updatedAt || r.createdAt), (r.modelError ? note('模型提示：' + r.modelError, 'warn') : '') + content) + '</section>';
  }
  function openSkill(mode) {
    S.workbenchCase = document.querySelector('#content form[data-op-form] [name="caseId"]')?.value || '';
    S.workbenchMode = mode;
    S.editingSkill = null;
    return go('opsWorkbench');
  }
  g.Pages.opsWorkbench = { title: '改进工作台', sub: '选择分析模式，自动带入关联工作单资料',
    mount() {
      const f = document.querySelector('form[data-op-form="analysis"], form[data-op-form="skillEdit"]');
      f.dataset.editingMode = S.editingSkill?.tool || '';
      Skills.mount(f, S.data.cases);
    },
    async render() {
      const [d, { rows: records }, { survey }, { templates }] = await Promise.all([load(), API.get(base + '/analysis'), API.get('/qip-real-v3/api/qms/survey'), API.get(base + '/skill-templates')]);
      const companySurvey = survey || {};
      const editing = S.editingSkill;
      const mode = editing?.tool || S.workbenchMode || 'review';
      const caseId = editing?.caseId ?? S.workbenchCase ?? '';
      const choices = [['review', '核对与行动建议'], ['8d', '8D 报告草稿'], ['why', '5Why 原因验证'], ['fmea', 'PFMEA / DFMEA 分析'], ['spc', 'SPC / 过程能力'], ['manual', '质量手册草稿']];
      const manual = `<fieldset class="full op-mode-fields" data-mode-fields="manual" ${mode === 'manual' ? '' : 'hidden disabled'}><legend>企业资料（沿用已保存的体系调研，可调整）</legend>` + [['manualCompany', '企业名称', companySurvey.company], ['manualProducts', '产品与服务', companySurvey.products], ['manualScope', '业务及适用范围', companySurvey.scope], ['manualProcess', '主要流程', companySurvey.processFlow], ['manualRoles', '岗位职责', (companySurvey.roles || companySurvey.teamMembers)], ['manualControls', '检验、放行与追溯', companySurvey.controls], ['manualRisks', '主要风险与质量目标', [companySurvey.risks, companySurvey.objective].filter(Boolean).join('\n')]].map(([name, label, value]) => field(label, name, value || '', name === 'manualCompany' ? 'text' : 'textarea', true)).join('') + '</fieldset>';
      const analysisFields = (editing ? `<input type="hidden" name="mode" value="${esc(mode)}"><input type="hidden" name="version" value="${editing.version}">` : select('分析模式', 'mode', choices, mode))
        + select('关联工作单', 'caseId', [['', '不关联工作单'], ...d.cases.map((c) => [c.id, c.number + ' ' + c.title])], caseId)
        + field('问题 / 关注点 / 约束条件', 'question', '请核对当前资料，列出下一步、责任人、时限、验证方式与待确认项。', 'textarea', true)
        + ['8d', 'fmea'].map((key) => Skills.render(key, mode, templates[key], editing)).join('') + manual;
      return heading('带着事实，讨论下一步。', '工作单、执行记录、测量摘要和业务关联可一起核对。', `<div class="op-actions">${editing ? button('skillNew', '新建分析') : ''}<button class="btn" data-act="goto" data-args='{"page":"aiwb"}'>自由问答</button></div>`) + '<div class="op-grid"><section>'
        + card(editing ? '修订 · ' + editing.title : '分析与管理问答', editing ? '保存后更新同一份记录，并保留上一版本。关联工作单的证据以本次保存时为准。' : '选取分析模式、填写资料，结果留档供核对。', form(editing ? 'skillEdit' : 'analysis', analysisFields, '生成并保存分析记录', editing?.id || ''))
        + '<div id="opAnalysis">' + (editing ? renderAnalysis(editing) : '') + '</div></section><aside>' + card('已保存分析', '记录与工作单保存在同一本地数据库', '<div id="opAnalysisList">' + analysisList(records) + '</div>') + '</aside></div>';
    },
  };
  async function findAnalysis(id) {
    const r = (await API.get(base + '/analysis')).rows.find((v) => v.id === id);
    if (!r) throw Error('这份分析记录已不存在');
    return r;
  }
  handlers.analysisRecord = async (id) => { const r = await findAnalysis(id); modal({ title: r.title, body: renderAnalysis(r) }); };
  handlers.skillEdit = async (id) => { S.editingSkill = await findAnalysis(id); closeModal(); await go('opsWorkbench'); };
  handlers.skillNew = () => openSkill(S.editingSkill.tool);
  g.OperationsUI = { detail, receiveFile, state: S, openSkill };
})(window);
