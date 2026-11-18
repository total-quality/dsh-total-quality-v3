/* ==================================================================
   质量驾驶舱 —— 五个子页（运行中枢 / 确认与纠正 / 执行跟进 / 接收与追溯 / 经验与标准）
   结构参考「质序 V3」的 overview / decisions / execution / intake / knowledge，
   视觉沿用本平台既有组件（card / kpi / table / tag / act）与配色。
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, kpi, table, tag, sevTag, bar, dt, day, num, empty, infoGrid, brand } = UI;
  const Pages = global.Pages = global.Pages || {};
  const API = global.API;

  const C = global.Cockpit = { tab: 'pending', ktype: '' };

  const SEV_COLOR = { A: '#e5484d', B: '#c8620a', C: '#5a6478' };
  const TABS = [['pending', '待确认'], ['result', '待结果复核'], ['close', '待结案'], ['all', '全部']];

  /* ---------------- 数据抓取与派生 ---------------- */
  async function grab(quiet) {
    const safe = (p, q) => API.get(p, q).catch(() => ({ rows: [], total: 0 }));
    const [kpiRes, issues, projects, knowledge, audit, todos] = await Promise.all([
      safe('/qip-real-v3/api/kpi/overview'),
      safe('/qip-real-v3/api/issues', { limit: 200 }),
      safe('/qip-real-v3/api/projects', { limit: 100 }),
      safe('/qip-real-v3/api/knowledge', { limit: 200 }),
      safe('/qip-real-v3/api/audit', { limit: 30 }),
      safe('/qip-real-v3/api/todos', { limit: 50 }),
    ]);
    const k = (kpiRes && kpiRes.kpi) || {};
    const K = k.KPI || {};
    const I = issues.rows || [];
    const P = projects.rows || [];
    const openIssues = I.filter((x) => x.status !== '已关闭');
    const stageOf = (p) => (typeof p.stageIndex === 'number' ? p.stageIndex : 0);

    // 待确认：A 级未关闭问题 + D4/D5 待方案确认的项目
    const confirmList = P.filter((p) => stageOf(p) >= 3 && stageOf(p) <= 4)
      .concat([]);
    const needInfo = openIssues.filter((x) => !x.rootCause && !x.containment).slice(0, 4);
    const following = P.filter((p) => !p.closedAt);
    const overdue = P.filter((p) => p.overdue);
    const pendingReview = P.filter((p) => stageOf(p) === 5);   // D6 结果复核
    const closing = P.filter((p) => stageOf(p) >= 6);          // D7/D8 结案
    const closedProjects = P.filter((p) => p.closedAt || stageOf(p) >= 7);
    const autoDone = (audit.rows || []).filter((a) => a.plugin && a.plugin !== '本平台').length;

    return { k, K, I, P, K2: knowledge.rows || [], A: audit.rows || [], T: todos.rows || [],
      openIssues, confirmList, needInfo, following, overdue, pendingReview, closing, closedProjects, autoDone, stageOf };
  }

  function headText() {
    const d = new Date();
    return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  }

  /** 页面标题块：大号深蓝标题 + 灰色说明行（+ 右侧动作），风格对齐 reference 图 */
  function head(title, sub, actions) {
    return `<div class="ch-head">
      <div class="ch-head-main"><h1>${title}</h1>${sub ? '<p>' + sub + '</p>' : ''}</div>
      ${actions ? '<div class="ch-head-act">' + actions + '</div>' : ''}
    </div>`;
  }

  /* ================= 1. 运行中枢 ================= */
  Pages.runHub = {
    title: '运行中枢', sub: '',
    async render() {
      const D = await grab();
      const pend = D.confirmList.length;
      const FLOW = [['📥', '接收'], ['🔍', '检测'], ['🧭', '研判'], ['📤', '派工'], ['👁️', '验证'], ['📚', '归档']];
      const feed = (D.A || []).slice(0, 7);
      return `
      <div class="ch-hero">
        <div class="ch-hero-main">
          <h2>让质量工作，<em>自己向前。</em></h2>
          <p>${headText()} · 只把需要判断的事留给您。</p>
          <div class="ch-hero-stats">资料在流动，问题有去向，结果有回响。</div>
          <div class="ch-hero-btns">
            ${act('查看 ' + pend + ' 项待确认 →', 'goto', { page: 'confirmFix' }, 'btn btn-primary')}
            ${act('接收资料', 'goto', { page: 'intakeTrace' }, 'btn')}
          </div>
        </div>
        <figure class="ch-hero-side ch-support">
          <img class="ch-support-qr" src="/qip-real-v3/assets/wechat-support-blue.svg" width="176" height="176" alt="扫码添加免费服务微信">
          <figcaption class="ch-support-caption">免费服务微信：周一到周六，早8:00至晚8:00</figcaption>
        </figure>
      </div>

      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '✅', label: '需要您确认', value: D.confirmList.length, color: '#0b3ea8', icoBg: '#e4edff', delta: '方案确认与结果复核', act: 'goto', args: { page: 'confirmFix' } })}
        ${kpi({ ico: '🔁', label: '流程正在跟进', value: D.following.length, color: '#7a5af8', icoBg: '#efeaff', delta: '其中超期 ' + D.overdue.length + ' 个', act: 'goto', args: { page: 'followUp' } })}
        ${kpi({ ico: '⚙️', label: '已自动完成', value: D.autoDone, color: '#18a058', icoBg: '#e8f7ee', delta: '接收、整理与流程更新' })}
        ${kpi({ ico: '📝', label: '待补充信息', value: D.needInfo.length, color: '#c8620a', icoBg: '#fff3e0', delta: '自动列明缺口，补齐后进入确认' })}
      </div>

      <div class="grid g2-1" style="margin-bottom:14px;">
        <div>${card('仅需您决定', '证据、建议与下一步放在一起，无需跨页填写',
          D.confirmList.slice(0, 3).map((p) => `
            <div class="ch-decision">
              <div class="ch-dec-ico">${tag(p.severity || '—', p.severity === 'A' ? 'red' : p.severity === 'B' ? 'orange' : 'gray')}</div>
              <div class="ch-dec-body">
                <b>${esc(p.title)}</b>
                <div class="ch-dec-meta">${esc(p.id)} · ${esc(p.model || '')} · ${esc(p.workshop || '')} · ${esc(p.owner || '')}</div>
                <p>当前阶段 ${esc(p.stage || '—')} · 下一步：核对并推进 · 截止 ${esc(dt(p.dueAt))}${p.overdue ? ' · <span style="color:#e5484d;">已超期 ' + (p.overdueDays || 0) + ' 天</span>' : ''}</p>
              </div>
              <div class="ch-dec-act">${act('打开处理 →', 'goto', { page: 'followUp' }, 'btn btn-sm')}</div>
            </div>`).join('') || empty('当前没有需要您确认的事项'),
          act('全部事项 →', 'goto', { page: 'confirmFix' }, 'btn btn-sm'))}
        </div>
        <div>${card('需要补充的资料', '把缺口说清楚，负责人在原事项里补充',
          (D.needInfo || []).map((x) => `
            <div class="ch-need"><span>📄</span><div><b>${esc(x.title)}</b><p>${esc(x.id)} · ${esc(x.workshop || '')} · 缺「根因 / 临时措施」</p></div></div>`).join('') || empty('当前没有缺资料的记录'))}
        </div>
      </div>

      <div class="grid g2" style="margin-bottom:14px;">
        ${card('每条事项，都有下一步', '从接收一路连到归档',
          '<div class="ch-flow">' + FLOW.map(([i, n], k) => `
            <div class="ch-step${k === 2 ? ' now' : ''}"><b>${i}</b><span>${n}</span></div>${k < FLOW.length - 1 ? '<span class="ch-arrow">›</span>' : ''}`).join('') + '</div>' +
          '<div class="ch-flow-note"><span>流程内自动整理，关键节点集中确认</span><b>全程留痕</b></div>',
          act('查看执行路径 →', 'goto', { page: 'followUp' }, 'btn btn-sm'))}
        ${card('最近的自动处理与人工确认', '全部操作可在「系统 → 审计日志」追溯',
          (feed.length ? '<div class="ch-feed">' + feed.map((e) => `
            <div class="ch-feed-item"><i></i><div><p>${esc(e.action || '')}${e.resultSummary ? ' · ' + esc(String(e.resultSummary).slice(0, 40)) : ''}</p>
            <time>${esc(dt(e.ts))} · ${esc(e.user || '系统')} · ${esc(e.plugin || '本平台')}</time></div></div>`).join('') + '</div>' : empty('暂无操作记录')))}
      </div>
      <div class="footer-note">${brand()} · 质量驾驶舱 / 运行中枢</div>`;
    },
  };

  /* ================= 2. 确认与纠正 ================= */
  Pages.confirmFix = {
    title: '确认与纠正', sub: '',
    async render() {
      const D = await grab();
      const tab = C.tab || 'pending';
      const map = { pending: D.confirmList, result: D.pendingReview, close: D.closing, all: D.P };
      const rows = (map[tab] || []).slice(0, 40);
      const tabs = '<div class="ch-tabs">' + TABS.map(([k, n]) => {
        const cnt = { pending: D.confirmList.length, result: D.pendingReview.length, close: D.closing.length, all: D.P.length }[k] || 0;
        return `<span class="ch-tab${k === tab ? ' on' : ''}" data-act="cockpitTab" data-args='{"tab":"${k}"}'>${n}<b>${cnt}</b></span>`;
      }).join('') + '</div>';
      return `
      ${head('看过证据，再按下确认。', '所有需要判断的事项集中在这里。方案、责任人和时限都可以在原处调整。',
        act('＋ 记录新问题', 'newIssue', {}, 'btn btn-primary'))}
      ${tabs}
      <div class="grid g2-1">
        <div>${card('事项清单', '共 ' + rows.length + ' 项 · 点卡片进入处理',
          '<div class="ch-dec-list">' + (rows.map((p) => `
            <div class="ch-decision">
              <div class="ch-dec-ico">${tag(p.severity || (p.stage ? 'D' + p.stage : '—'), p.severity === 'A' ? 'red' : p.severity === 'B' ? 'orange' : 'blue')}</div>
              <div class="ch-dec-body">
                <b>${esc(p.title)}</b>
                <div class="ch-dec-meta">${esc(p.id)} · ${esc(p.model || '')} · ${esc(p.workshop || '')} · ${esc(p.owner || '')}</div>
                <p>${p.stage ? '当前阶段 ' + esc(p.stage) + ' · 截止 ' + esc(dt(p.dueAt)) : '状态 ' + esc(p.status || '—') + ' · 发现于 ' + esc(dt(p.createdAt))}${p.overdue ? ' · <span style="color:#e5484d;">超期 ' + (p.overdueDays || 0) + ' 天</span>' : ''}</p>
              </div>
              <div class="ch-dec-act">${act(p.stage ? '推进 →' : '查看 →', 'goto', { page: p.stage ? 'followUp' : 'problem' }, 'btn btn-sm')}</div>
            </div>`).join('') || empty('这个分类下暂时没有事项')) + '</div>')}</div>
        <div>
          ${card('确认前先核对三件事', '把判断依据摆在一起',
            '<ul class="ch-check"><li><b>事实是否完整</b>：问题描述、批次、数量、检测方法是否齐全</li>' +
            '<li><b>根因是否可信</b>：是否有多问一层（5Why）与数据支撑，而不是猜测</li>' +
            '<li><b>对策是否可验证</b>：谁做、什么时候做完、用什么数据证明有效</li></ul>')}
          <div style="height:14px;"></div>
          ${card('当前缺口', '补齐后自动进入确认',
            '<div class="ch-mini-list">' + ((D.needInfo || []).map((x) => `<div><b>${esc(x.title)}</b><p>${esc(x.id)} · 缺根因或临时措施</p></div>`).join('') || '<p class="ch-muted">暂无缺口</p>') + '</div>')}
        </div>
      </div>
      <div class="footer-note">${brand()} · 质量驾驶舱 / 确认与纠正</div>`;
    },
  };

  /* ================= 3. 执行跟进 ================= */
  Pages.followUp = {
    title: '执行跟进', sub: '',
    async render() {
      const D = await grab();
      const lanes = [
        ['执行中', D.P.filter((p) => D.stageOf(p) >= 3 && D.stageOf(p) <= 4), '#5a8bff'],
        ['待结果复核', D.pendingReview, '#7a5af8'],
        ['待结案', D.P.filter((p) => D.stageOf(p) === 6), '#0a9e8f'],
        ['已归档', D.P.filter((p) => D.stageOf(p) >= 7), '#8791a5'],
      ];
      const cardOf = (p) => `
        <div class="ch-workcard">
          <div class="ch-wc-top"><b>${esc(p.id)}</b>${tag(p.severity || '—', p.severity === 'A' ? 'red' : p.severity === 'B' ? 'orange' : 'gray')}</div>
          <div class="ch-wc-title">${esc(p.title)}</div>
          <div class="ch-wc-meta">${esc(p.model || '')} · ${esc(p.workshop || '')} · ${esc(p.owner || '')}</div>
          <div class="ch-wc-bar"><div class="ch-bar"><i class="${p.overdue ? 'od' : ''}" style="width:${Math.max(2, Math.min(100, p.progress || 0))}%"></i></div><span>${p.progress || 0}%</span></div>
          <div class="ch-wc-foot">步骤 ${esc(p.stage || '—')} · 截止 ${esc(dt(p.dueAt))}${p.overdue ? ' · <span style="color:#e5484d;">超期 ' + (p.overdueDays || 0) + ' 天</span>' : ''}</div>
          <div class="ch-wc-act">${act('打开事项 →', 'goto', { page: 'eightd' }, 'btn btn-sm')}</div>
        </div>`;
      return `
      ${head('每个动作，都接得上。', '自动派工与提醒：现场提交结果后，回到同一条工作单完成复核。',
        act('刷新', 'refreshPage', {}, 'btn'))}
      <div class="ch-kanban">
        ${lanes.map(([name, rows, color]) => `
          <div class="ch-lane">
            <div class="ch-lane-head"><b style="color:${color};">${name}</b><span>${rows.length}</span></div>
            ${rows.length ? rows.slice(0, 8).map(cardOf).join('') : '<div class="ch-muted" style="padding:12px;">暂无</div>'}
          </div>`).join('')}
      </div>
      <div class="footer-note">${brand()} · 质量驾驶舱 / 执行跟进</div>`;
    },
  };

  /* ================= 4. 接收与追溯 ================= */
  Pages.intakeTrace = {
    title: '接收与追溯', sub: '',
    async render() {
      const D = await grab();
      const raw = (D.k && (D.k.charRows || D.k.特性状态)) || [];
      const chars = raw.map((c) => ({
        id: c.id || c.特性 || '', name: c.name || c.特性名称 || c.特性 || '', workshop: c.workshop || c.车间 || '',
        lsl: c.lsl, usl: c.usl, mean: c.mean || c.均值, cpk: c.cpk || c.Cpk, oos: c.oos || c.超差 || 0,
        status: c.status || c.状态 || '',
      })).slice(0, 14);
      const rows = chars.map((c) => ({
        cells: ['<b>' + esc(c.id) + '</b>', esc(c.name || ''), esc(c.workshop || ''),
          esc(typeof c.lsl === 'number' ? c.lsl + '~' + c.usl + ' mm' : '—'),
          esc(c.mean || '—'), esc(c.cpk || '—'),
          (c.oos || 0) > 0 ? '<span style="color:#e5484d;">' + c.oos + '</span>' : '0',
          c.status === '失控' ? tag('失控', 'red') : tag('受控', 'green')],
      }));
      const STEPS = [['📄', '01 识别资料', '映射字段与检查格式'], ['🗂️', '02 归组与去重', '按特性、批次追溯'],
        ['🔍', '03 检查规格', '测量值与规格限比对'], ['📚', '04 匹配经验', '按产品与工序关联']];
      return `
      ${head('给我资料，剩下的自动接上。', '拖入测量文件，自动核对字段、去重、检查规格，再把异常送到需要确认的地方。',
        act('＋ 记录新问题', 'newIssue', {}, 'btn btn-primary'))}
      <div class="ch-drop" data-act="importFile" data-args='{"target":"measurements"}'>
        <div class="ch-drop-ico">⬆️</div>
        <h3>点这里选择文件，或把 CSV / Excel 拖进窗口</h3>
        <p>支持中文 / 英文字段 · 先预检再接收 · 重复资料自动跳过</p>
        <div class="ch-drop-btns">
          ${act('选择本地文件', 'importFile', { target: 'measurements' }, 'btn btn-primary')}
          ${act('下载示例 CSV', 'cockpitSampleCsv', {}, 'btn')}
        </div>
      </div>
      <div class="ch-pipeline">
        ${STEPS.map(([i, t, d]) => `<div class="ch-pipe"><b>${i}</b><div><h4>${t}</h4><p>${d}</p></div></div>`).join('')}
      </div>
      <div class="grid g2-1">
        <div>${card('在做的特性与规格（可追溯）', '点编号可查看控制图与判异',
          table(['特性', '名称', '车间', '规格', '均值', 'Cpk', '超差', '状态'], rows, { empty: '还没有测量数据' }))}</div>
        <div>
          ${card('接收概览', '本月实际统计',
            infoGrid([
              ['在线测量点', String(Math.round((D.k && D.k.measurements) || 0))],
              ['超差点', String(Math.round((D.k && D.k.oos) || 0))],
              ['判异信号', String(Math.round((D.k && D.k.violations) || 0))],
              ['SPC 特性', String(((D.k && (D.k.charRows || D.k.特性状态)) || []).length)],
              ['未关闭问题', String(Math.round((D.K && D.K.未关闭问题) || 0))],
              ['在改项目', String(Math.round((D.K && D.K.在改项目) || 0))],
            ]))}
          <div style="height:14px;"></div>
          ${card('导入后会发生什么', '',
            '<ul class="ch-check"><li>字段对不上的行会被列出来，先修再导入，不会脏写</li><li>同一批次重复上传只保留一份</li><li>超出规格限的点自动标记并进入判异</li><li>异常会被送到「确认与纠正」，等责任人处理</li></ul>')}
        </div>
      </div>
      <div class="footer-note">${brand()} · 质量驾驶舱 / 接收与追溯</div>`;
    },
  };

  /* ================= 5. 经验与标准 ================= */
  Pages.expStandard = {
    title: '经验与标准', sub: '',
    async render() {
      const D = await grab();
      const all = D.K2 || [];
      const types = [];
      all.forEach((x) => { const t = x.type || '经验卡'; if (types.indexOf(t) < 0) types.push(t); });
      const cur = C.ktype || '';
      const rows = (cur ? all.filter((x) => (x.type || '经验卡') === cur) : all).slice(0, 30);
      const views = all.reduce((s, x) => s + (x.views || 0), 0);
      return `
      ${head('每次解决，都成为下一次的起点。', '结案后自动整理经验，关联原工作单；再次发现相似问题带回核对清单。',
        act('＋ 新增知识条目', 'goto', { page: 'knowledge' }, 'btn btn-primary'))}
      <div class="ch-chips">
        <span class="ch-chip${cur === '' ? ' on' : ''}" data-act="cockpitKbType" data-args='{"type":""}'>全部 ${all.length}</span>
        ${types.map((t) => `<span class="ch-chip${cur === t ? ' on' : ''}" data-act="cockpitKbType" data-args='{"type":"${esc(t)}"}'>${esc(t)} ${all.filter((x) => (x.type || '经验卡') === t).length}</span>`).join('')}
      </div>
      <div class="grid g3">
        ${rows.map((x) => `
          <div class="ch-kcard">
            <div class="ch-kcard-top"><span class="ch-kico">📗</span>${tag(x.type || '经验卡', 'blue')}</div>
            <h4>${esc(x.title)}</h4>
            <p>${esc(String(x.content || x.summary || '').replace(/^\s*[【\[][^】\]]{1,8}[】\]]\s*/, '').slice(0, 110))}${String(x.content || '').length > 110 ? '…' : ''}</p>
            <div class="ch-chips-sm">${(x.tags || []).slice(0, 4).map((t) => '<span>' + esc(t) + '</span>').join('')}</div>
            <div class="ch-kcard-foot">
              <span>${esc(x.author || '—')} · ${esc(dt(x.createdAt))} · 浏览 ${x.views || 0}</span>
              ${act('查看 →', 'cockpitKb', { id: x.id }, 'btn btn-sm')}
            </div>
          </div>`).join('') || empty('还没有知识条目')}
      </div>
      <div class="grid g2-1" style="margin-top:14px;">
        ${card('沉淀概览', '真实统计',
          infoGrid([
            ['知识条目', String(all.length)],
            ['累计浏览', String(views)],
            ['经验卡', String(all.filter((x) => (x.type || '经验卡') === '经验卡').length)],
            ['标准条款', String(all.filter((x) => (x.type || '') === '标准').length)],
          ]))}
        ${card('下次遇到相似问题，先看这三件事', '',
          '<ul class="ch-check"><li>上次的根因结论，是否与本例的 4M 变化点吻合</li><li>上次的对策是否已在现场落地（点检表 / 防错 / 培训）</li><li>上次的验证数据，是否支撑这次的判定阈值</li></ul>')}
      </div>
      <div class="footer-note">${brand()} · 质量驾驶舱 / 经验与标准</div>`;
    },
  };
})(window);
