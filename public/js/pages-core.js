/* ==================================================================
   核心页面：驾驶舱 / AI 改进工作台(智能体) / 质量问题库 / 改进项目(8D)
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, kpi, table, tag, sevTag, statusTag, bar, md, dt, day, num, empty, loadingBlock, infoGrid, lineChart, paretoChart, controlChart, fishbone, ring, brand } = UI;
  /* 问题清单视图状态：ABC 分类 + 分组折叠（Actions 通过 global.issueView 修改） */
  const issueView = global.issueView = { sev: 'all', open: { A: true, B: false, C: false } };
  const Pages = global.Pages = global.Pages || {};


  /* ================= P1 质量驾驶舱 =================
     原驾驶舱整页内容已按需求删除，改为五个子页（运行中枢 / 确认与纠正 / 执行跟进 /
     接收与追溯 / 经验与标准），实现见 public/js/pages-cockpit.js。
     这里只保留 redirect，兼容老的 #dashboard 入口。 */
  Pages.dashboard = {
    title: '质量驾驶舱', sub: '运行中枢 · 确认与纠正 · 执行跟进 · 接收与追溯 · 经验与标准',
    async render() {
      // app.js 的 go() 已把 dashboard 映射到 runHub，这里只是兜底
      return UI.empty('质量驾驶舱已拆分为五个子页：运行中枢 / 确认与纠正 / 执行跟进 / 接收与追溯 / 经验与标准', '📊');
    },
  };

  /* ================= P2 AI 改进工作台（智能体） ================= */
  const Chat = global.Chat = {
    sessionId: 's-' + new Date().toISOString().slice(0, 10),
    messages: [],     // {role, content, sources[], pending[], ts, error}
    busy: false,
    ctrl: null,
  };

  Pages.aiwb = {
    title: 'AI 改进工作台', sub: '查询质量数据、检索文件和生成报告',
    mount() { global.ChatVoice.mount(); },
    async render() {
      const boot = global.State.bootstrap;
      const tools = (boot.tools || []);
      const byPlugin = {};
      tools.forEach((t) => { (byPlugin[t.plugin] = byPlugin[t.plugin] || []).push(t); });
      const cfg = boot.settings && boot.settings.llm || {};
      const configured = !!(boot.settings && boot.settings.llm && boot.settings.llm.hasApiKey);
      const pluginChips = Object.keys(byPlugin).map((p) => `<span class="plugin-chip ok" data-act="showPlugin" data-args='${esc(JSON.stringify({ plugin: p }))}'>✅ ${esc(p)} <b>${byPlugin[p].length}</b></span>`).join('');

      setTimeout(renderChat, 0);
      return `
      ${configured ? '' : `<div class="ai-strip" style="background:linear-gradient(90deg,#fff5f4,#fff3e0);border-color:#ffdcd9;">
        <div class="ai-ico" style="background:linear-gradient(135deg,#c8620a,#e5484d);">⚠️</div>
        <div class="ai-txt"><b>当前没有可用模型。</b>请在 DeepSeek Harness 中配置模型，然后在本插件的系统设置里测试连通性。</div>
        ${act('立即配置模型', 'goto', { page: 'settings' }, 'btn btn-primary')}
      </div>`}
      <div class="ai-strip">
        <div class="ai-ico">🤖</div>
        <div class="ai-txt"><b>DeepSeek Harness 工作台：</b>一句话驱动 ${Object.keys(byPlugin).length} 个插件、${tools.length} 个工具协同——查数、判异、根因、写报告、发流程。当前模型：<b>${esc(cfg.model || '未配置')}</b>${cfg.hasApiKey ? '（已配置）' : '（未配置）'}，护栏：结论必须有出处 · 三类动作强制人工确认 · 全程审计。</div>
        ${act('使用指南', 'wbGuide', {}, 'btn')}
      </div>
      <div class="wb wb-solo">
        <div class="chat-wrap">
          <div class="chat-head">
            <span class="t">对话式改进工作台</span>
            <span class="s" id="chatMeta">${Chat.messages.length ? Chat.messages.length + ' 条消息' : '新会话'}</span>
            <span style="margin-left:auto;display:flex;gap:6px;">
              ${act('清空', 'chatClear', {}, 'btn btn-sm')}
              ${act('历史', 'chatHistory', {}, 'btn btn-sm')}
            </span>
          </div>
          <div class="chat-body" id="chatBody"></div>
          <div class="chat-foot">
            <div class="chat-composer">
              <div class="chat-composer-top">
                <label class="chat-scope-switch"><input id="chatLibraryMode" type="checkbox" ${Chat.libraryMode ? 'checked' : ''}>查知识库</label>
                ${act('管理知识库文件', 'goto', { page: 'library' }, 'chat-library-link')}
              </div>
              <textarea class="chat-input" id="chatInput" rows="2" aria-label="输入问题" placeholder="想了解哪项质量问题？可以用 @SPC 等名称指定查询。"></textarea>
              <div class="chat-composer-bar">
                <div class="chat-dictation">
                  <button type="button" class="chat-dictation-btn" id="chatVoice" aria-pressed="false">
                    <span class="chat-mic-icon" aria-hidden="true"></span><span id="chatVoiceLabel">语音听写</span>
                  </button>
                  <span class="chat-dictation-meter" id="chatVoiceMeter" aria-hidden="true" hidden><i></i><i></i><i></i><i></i><i></i></span>
                  <button type="button" class="chat-dictation-cancel" id="chatVoiceCancel" hidden>取消</button>
                  <output id="chatVoiceStatus" aria-live="polite"></output>
                </div>
                <div class="chat-composer-send">
                  <span class="chat-composer-keyboard">Enter 发送 · Shift+Enter 换行</span>
                  <span id="chatState" aria-live="polite"></span>
                  ${act('停止', 'chatStop', {}, 'btn btn-sm')}
                  ${act('发送', 'chatSend', {}, 'btn btn-primary')}
                </div>
              </div>
            </div>
            <div class="chat-actions">
              <span class="quick-cmd" data-act="quickAsk" data-args='${esc(JSON.stringify({ q: '分析上周产品C 充电口盖间隙超差问题，给出根因假设排序和处置建议' }))}'>分析充电口盖间隙超差根因</span>
              <span class="quick-cmd" data-act="quickAsk" data-args='${esc(JSON.stringify({ q: '@SPC 检查全部关键特性的判异情况，按严重度排序，并给出每个失控特性的排查方向' }))}'>@SPC 全面判异体检</span>
              <span class="quick-cmd" data-act="quickAsk" data-args='${esc(JSON.stringify({ q: '生成本周质量周报（Word 文档）' }))}'>一键生成质量周报</span>
              <span class="quick-cmd" data-act="quickAsk" data-args='${esc(JSON.stringify({ q: '扫描当前质量风险并给出今天最该处理的 3 件事' }))}'>风险扫描＋今日重点</span>
            </div>
          </div>
        </div>
      </div>`;
    },
  };

  /** 渲染聊天区域 */
  function renderChat() {
    const body = document.getElementById('chatBody');
    if (!body) return;
    if (!Chat.messages.length) {
      body.innerHTML = `<div class="empty" style="padding:60px 20px;">
        <span class="e-ico">🤖</span>
        <div style="font-size:13.5px;color:#33415c;font-weight:600;margin-bottom:8px;">我可以用真实数据帮您做质量改进</div>
        <div style="text-align:left;max-width:560px;margin:0 auto;font-size:12.5px;line-height:2;color:#5e6b85;">
          · <b>查数取证</b>：「@MES 查四车间三线充电口盖间隙近 7 日数据」<br>
          · <b>判异分析</b>：「@SPC 检查 CT-0378 的八大判异准则」<br>
          · <b>根因假设</b>：「分析充电口盖间隙超差，给出根因假设排序」<br>
          · <b>经验检索</b>：「知识库里有没有类似案例？师傅怎么处理的？」<br>
          · <b>立项闭环</b>：「把这个升级为 8D 项目并推荐团队」<br>
          · <b>成文成表</b>：「生成根因分析报告（Word）」/「把测量数据导出 Excel」<br>
          · <b>收益测算</b>：「测算定位销整改后的年化收益（财务口径）」
        </div>
        <div style="margin-top:14px;font-size:11.5px;color:#8791a5;">所有数字来自真实计算，结论自动挂接出处；对外承诺类动作会请您确认后才执行。</div>
      </div>`;
      return;
    }
    const followBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 160;
    const scrollTop = body.scrollTop;
    body.innerHTML = Chat.messages.map((m, i) => renderMsg(m, i)).join('');
    body.scrollTop = followBottom ? body.scrollHeight : scrollTop;
  }
  global.renderChat = renderChat;

  function renderMsg(m, i) {
    if (m.role === 'user') {
      return `<div class="msg user"><div class="av">我</div><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
    }
    let inner = '';
    if (m.content) inner += `<div class="md-body">${md(m.content)}</div>`;
    if (m.sources?.length) inner += `<div class="library-citations"><strong>原文出处</strong>${m.sources.map((ref) => QipLibrary.sourceButton(ref)).join('')}</div>`;
    if (m.pending && m.pending.length) {
      inner += m.pending.map((p) => `<div class="confirm-card">
        <div class="cc-t">⚠️ 待人工确认：${esc(p.label)}　<span style="font-weight:400;color:#8791a5;font-size:11px;">${esc(p.plugin)} / ${esc(p.id)}</span></div>
        <div class="cc-d">该动作属于「对外发送 / 对外承诺 / 8D 关闭」类，按平台护栏必须由人确认后才会真正执行。<br>参数：<code style="font-size:11px;">${esc(JSON.stringify(p.args))}</code></div>
        <div class="cc-a">${act('✓ 确认执行', 'confirmAction', { id: p.id, i }, 'btn btn-primary btn-sm')}${act('✕ 拒绝', 'rejectAction', { id: p.id, i }, 'btn btn-sm')}</div>
      </div>`).join('');
    }
    if (m.running && !m.content) inner += '<div class="run-status"><span class="dot"></span>正在生成回答…</div>';
    if (m.error) inner += `<div style="color:#e5484d;font-size:12.5px;">❌ ${esc(m.error)}</div>`;
    return `<div class="msg"><div class="av">AI</div><div class="bubble">${inner}</div></div>`;
  }

  /* ================= P3 质量问题库 ================= */
  Pages.problem = {
    title: '质量问题库', sub: 'AI 去重 / 自动定级 / 相似案例匹配 · 真实数据',
    async render() {
      const res = await API.get('/qip-real-v3/api/issues', { limit: 300 });
      const rows = res.rows || [];
      const open = rows.filter((r) => r.status !== '已关闭');
      const byWs = {};
      rows.forEach((r) => { byWs[r.workshop || '未分类'] = (byWs[r.workshop || '未分类'] || 0) + 1; });
      const total = rows.length || 1;
      let cum = 0;
      const paretoRows = Object.entries(byWs).sort((a, b) => b[1] - a[1]).map(([name, value]) => { cum += value; return { name, value, cumPct: (cum / total) * 100 }; });
      const bySource = {}; rows.forEach((r) => { bySource[r.source || '其他'] = (bySource[r.source || '其他'] || 0) + 1; });

      return `
      <div class="ai-strip">
        <div class="ai-ico">🤖</div>
        <div class="ai-txt"><b>AI 问题治理：</b>问题库共 <b>${rows.length}</b> 起，未关闭 <b>${open.length}</b> 起（A 级 ${open.filter((r) => r.severity === 'A').length} 起）；来源分布：${Object.entries(bySource).map(([k, v]) => esc(k) + ' ' + v).join(' · ')}。发现问题时会自动做同构去重与相似案例匹配。</div>
        ${act('＋ 发现问题', 'newIssue', {}, 'btn btn-ai')}
      </div>
      <div class="imp-hint">
        <span class="big">📱 导入问题清单</span>
        <span class="imp-sub">支持 Excel / CSV。问题进入本机台账后，可补充事实、指派责任人并开始处理。</span>
        ${act('导入问题（Excel / CSV）', 'importFile', { target: 'issues' }, 'btn btn-primary btn-sm')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '📋', label: '问题总数', value: rows.length, delta: '本月新增 ' + rows.filter((r) => (r.createdAt || '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length, act: 'issueSev', args: { sev: 'all' } })}
        ${kpi({ ico: '🚨', label: '未关闭 A 级', value: open.filter((r) => r.severity === 'A').length, color: '#e5484d', icoBg: '#feece8', delta: '需 2h 响应 / 24h 围堵', deltaColor: '#e5484d' })}
        ${kpi({ ico: '🔄', label: '已关联改进项目', value: rows.filter((r) => r.projectId).length, color: '#7a5af8', icoBg: '#f0ebff', delta: '升级率 ' + ((rows.filter((r) => r.projectId).length / (rows.length || 1)) * 100).toFixed(1) + '%' })}
        ${kpi({ ico: '✅', label: '已关闭', value: rows.filter((r) => r.status === '已关闭').length, color: '#18a058', icoBg: '#e8f7ee', delta: '关闭率 ' + ((rows.filter((r) => r.status === '已关闭').length / (rows.length || 1)) * 100).toFixed(1) + '%' })}
      </div>
      ${card('问题清单', '共 ' + rows.length + ' 起 · 按 A/B/C 分类折叠 · 点击行查看详情',
        `<div class="sev-chips">
          ${[['all', '全部 ' + rows.length], ['A', 'A 级 ' + rows.filter((r) => r.severity === 'A').length], ['B', 'B 级 ' + rows.filter((r) => r.severity === 'B').length], ['C', 'C 级 ' + rows.filter((r) => r.severity === 'C').length]].map(([v, label]) =>
            `<span class="chip ${issueView.sev === v ? 'on' : ''}" data-act="issueSev" data-args='${esc(JSON.stringify({ sev: v }))}'>${label}</span>`).join('')}
          <span style="margin-left:auto;display:flex;gap:6px;">
            ${act('全部展开', 'issueOpenAll', { open: true }, 'btn btn-sm')}
            ${act('全部收起', 'issueOpenAll', { open: false }, 'btn btn-sm')}
            ${act('导出 Excel', 'exportData', { dataset: 'issues' }, 'btn btn-sm')}
          </span>
        </div>` +
        issueGroups(rows, issueView),
        act('导出 Excel', 'exportData', { dataset: 'issues' }))}
      <div class="grid g2">
        ${card('问题类别帕累托', '按车间统计 · 真实数据', paretoChart(paretoRows) + `<div style="font-size:11.5px;color:#5e6b85;margin-top:6px;">${paretoRows[0] ? '「' + esc(paretoRows[0].name) + '」占比最高（' + (paretoRows[0].value / total * 100).toFixed(1) + '%）' : ''}</div>`)}
        ${card('AI 同构问题预警', '重复发生识别（相似度实算）',
          repeatWarnings(rows) || empty('暂未发现重复发生的同构问题', '✅'))}
      </div>
      <div class="footer-note">${brand()} · 问题库</div>`;
    },
  };

  function repeatWarnings(rows) {
    // 客户端聚类：同车间 + 标题相似（用字符 bigram 粗算）
    const groups = [];
    const used = new Set();
    rows.forEach((a, i) => {
      if (used.has(a.id)) return;
      const g = [a];
      rows.forEach((b, j) => {
        if (i === j || used.has(b.id)) return;
        if (a.workshop && b.workshop && a.workshop !== b.workshop) return;
        if (sim(a.title, b.title) >= 0.42) { g.push(b); used.add(b.id); }
      });
      if (g.length >= 2) { used.add(a.id); groups.push(g); }
    });
    if (!groups.length) return '';
    return groups.slice(0, 4).map((g) => `<div style="border:1px solid #ffdcd9;background:#fff5f4;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
      <b style="color:#e5484d;">🔴 ${esc(g[0].workshop || '')}「${esc(g[0].title.slice(0, 16))}」类问题重复发生 ${g.length} 次</b>
      <div style="font-size:11.5px;color:#5e6b85;margin-top:4px;">聚类成员：${g.map((x) => esc(x.id) + '（' + esc(x.status) + '）').join(' / ')}</div>
      <div style="font-size:11.5px;margin-top:6px;">${tag('AI 建议：升级为质量改进项目 + 设计端横展', 'red')} ${act('一键立项', 'projectFromGroup', { ids: g.map((x) => x.id), title: g[0].title, workshop: g[0].workshop, model: g[0].model }, 'btn btn-primary btn-sm')}</div>
    </div>`).join('');
  }
  function sim(a, b) {
    const bg = (s) => { const t = String(s || '').toLowerCase().replace(/[\s\u3000，。、；：！？（）]/g, ''); const o = []; for (let i = 0; i < t.length - 1; i++) o.push(t.slice(i, i + 2)); return o; };
    const A = bg(a), B = bg(b);
    if (!A.length || !B.length) return 0;
    const m = {}; A.forEach((x) => m[x] = (m[x] || 0) + 1);
    let dot = 0; B.forEach((x) => { if (m[x]) dot++; });
    return dot / Math.sqrt(A.length * B.length);
  }

  /* 问题清单：按 A/B/C 折叠分组（数量大时优先看 A 级） */
  function issueGroups(rows, view) {
    const META = {
      A: ['A 级 · 严重', 'red', '涉及安全/法规或已流出，须 2h 响应'],
      B: ['B 级 · 批量风险', 'orange', '存在批量风险，24h 内围堵'],
      C: ['C 级 · 个案', 'gray', '个案问题，按常规节奏闭环'],
    };
    const sevs = view.sev === 'all' ? ['A', 'B', 'C'] : [view.sev];
    const html = sevs.map((sev) => {
      const list = rows.filter((r) => (String(r.severity || '').toUpperCase() || 'C') === sev);
      const openCnt = list.filter((r) => r.status !== '已关闭').length;
      const body = list.length
        ? table(['编号', '产品', '车间/工位', '问题描述', '来源', '状态', '责任人', '关联项目'],
          list.map((r) => ({
            __act: 'issueDetail', __args: { id: r.id },
            cells: ['<b>' + esc(r.id) + '</b>', esc(r.model), esc(r.workshop) + (r.station ? (r.workshop && r.station.startsWith(r.workshop) ? '·' + esc(r.station.slice(r.workshop.length).replace(/^[·\-\s]+/, '')) : '·' + esc(r.station)) : ''), esc(r.title), tag(r.source, r.source === 'AI 质检' ? 'purple' : r.source === 'MES' ? 'navy' : r.source === '市场' ? 'green' : 'gray'), statusTag(r.status), esc(r.owner || '—'), r.projectId ? tag(r.projectId, 'blue') : '—'],
          })), { empty: '该等级暂无问题' })
        : empty('该等级暂无问题', '—');
      return `<details class="acc" ${view.open[sev] ? 'open' : ''}>
        <summary><span class="caret2">▶</span>${tag(META[sev][0], META[sev][1])}<span style="font-weight:500;font-size:12px;color:#5e6b85;">${esc(META[sev][2])}</span><span class="cnt">${list.length} 起 · 未关闭 ${openCnt}</span></summary>
        <div class="acc-body">${body}</div>
      </details>`;
    }).join('');
    return html || empty('暂无问题记录', '📭');
  }

  /* ================= P4 质量改进项目（8D） ================= */
  const STAGE_DEF = [['D1', '组建团队', '24h'], ['D2', '描述问题', '24h'], ['D3', '临时措施', '48h'], ['D4', '根因分析', '10 日历日'], ['D5', '永久对策', '15 日历日'], ['D6', '实施验证', '30 日历日'], ['D7', '预防横展', '15 日历日'], ['D8', '关闭表彰', '—']];
  const STAGE_COLOR = { D1: '#95a3bd', D2: '#5a8bff', D3: '#5a8bff', D4: '#7a5af8', D5: '#0a9e8f', D6: '#0a9e8f', D7: '#18a058', D8: '#18a058' };
// 中小型企业版：课题不做八步，按 PDCA 四步走（周期短、一人多岗）
const PDCA_DEF = [['P', '计划', '#5a8bff', '3 日'], ['D', '执行', '#7a5af8', '7 日'], ['C', '检查', '#0a9e8f', '3 日'], ['A', '处置', '#18a058', '1 日']];
const PDCA_AI = {
  P: '定目标值 / 现状数据对比（手工录数 AI 校验）',
  D: '对策清单 + 作业指导书草稿',
  C: '效果对比表 + 控制图复判',
  A: '固化成 SOP / 横展到另一车间',
};
function pdcaOf(p) {
  const i = typeof p.stageIndex === 'number' ? p.stageIndex : 0;
  return i < 3 ? 'P' : i < 6 ? 'D' : i === 6 ? 'C' : 'A';
}
const isSme = () => !!(global.Scale && global.Scale.isSme && global.Scale.isSme());

  Pages.eightd = {
    get title() { return isSme() ? 'QC 小组课题' : '质量改进项目'; },
  get sub() { return isSme() ? 'PDCA 四步 · 小改小革 · 周循环' : '8D / 专项改进 · 阶段流转 · SLA 计时'; },
    async render() {
      const res = await API.get('/qip-real-v3/api/projects', { limit: 300 });
      const rows = res.rows || [];
      const { activeProjects, projectIsClosed, projectStageCode } = global.QBusiness;
      const open = activeProjects(rows);
      const overdue = open.filter((r) => r.overdue);
      const aiDraft = rows.length ? Math.round(rows.filter((r) => r.aiDrafted).length / rows.length * 100) : 0;
      const tasks = global.State.bootstrap.todos || [];
      const focus = open.filter((r) => projectStageCode(r) === 'D4' || r.overdue)[0] || open[0];
      const SLA_AI = {
        D1: '按技能图谱推荐团队', D2: '5W2H 自动成文', D3: '围堵方案库匹配（含历史有效率）', D4: '因果图 / 5Why / 数据取证 / DOE 方案',
        D5: '对策库匹配 + OA 审批流自动发起', D6: '@MES 自动采集验证数据做前后对比', D7: '五维横展清单自动生成', D8: '收益核定 + 案例自动归档',
      };
      const slaRows = isSme()
        ? PDCA_DEF.map(([k, name, color, sla]) => [k + ' ' + name, sla, PDCA_AI[k], open.filter((r) => pdcaOf(r) === k).length])
        : STAGE_DEF.map(([k, name, sla]) => [k + ' ' + name, sla, SLA_AI[k], open.filter((r) => projectStageCode(r) === k).length]);
      const projRows = rows.map((p) => ({
        __act: 'projectDetail', __args: { id: p.id },
        cells: ['<b>' + esc(p.id) + '</b>', esc(p.title), tag(p.stage, projectIsClosed(p) ? 'green' : 'purple'), esc(p.owner),
          bar(p.progress, p.overdue ? '#e5484d' : '#1a56db') + '<span style="font-size:10.5px;color:#8791a5;">' + p.progress + '%</span>',
          day(p.dueAt), projectIsClosed(p) ? tag('已关闭', 'green') : p.overdue ? tag('超期 ' + p.overdueDays + ' 天', 'red') : tag('进行中', 'blue')],
      }));

      return `
      <div class="ai-strip">
        <div class="ai-ico">🧩</div>
        <div class="ai-txt">${isSme()
          ? '<b>课题推进：</b>按 PDCA 四步走（计划 3 日、执行 7 日、检查 3 日、处置 1 日），周例会同步进度，超期由质量主管直接协调。AI 可帮写现状对比、对策清单、效果验证表与固化 SOP。'
          : '<b>改进项目智能推进：</b>平台按 D1–D8 阶段 SLA 自动计时（临时措施 48h、根因分析 10 日、实施验证 30 日），超期自动升级厂级 QRQC 并抄送主管。AI 可起草 5W2H、因果图、5Why、DOE 方案与对策清单。'}</div>
        ${act('＋ 立项（AI 推荐团队）', 'newProject', {}, 'btn btn-ai')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '🔄', label: '在改项目', value: open.length, delta: 'A ' + open.filter((r) => r.severity === 'A').length + ' · B ' + open.filter((r) => r.severity === 'B').length + ' · C ' + open.filter((r) => r.severity === 'C').length })}
        ${kpi({ ico: '🚨', label: '超期项目', value: overdue.length, color: '#e5484d', icoBg: '#feece8', delta: overdue.length ? '已自动升级厂级 QRQC' : '无超期', deltaColor: overdue.length ? '#e5484d' : '#18a058' })}
        ${kpi({ ico: '🤖', label: 'AI 起草内容占比', value: aiDraft + '%', color: '#7a5af8', icoBg: '#f0ebff', delta: '人工复核修改 ' + (100 - aiDraft) + '%' })}
        ${kpi({ ico: '📅', label: '今日待办', value: tasks.length, color: '#c8620a', icoBg: '#fff3e0', delta: '点击查看', act: 'goto', args: { page: 'approval' } })}
      </div>

      ${card(isSme() ? 'QC 小组课题看板' : '质量改进阶段看板', (isSme() ? '按 PDCA 四步推进 · 共 ' + open.length + ' 个在改课题' : '共 ' + open.length + ' 个在改项目 · 点击卡片查看/推进'),
        `<div class="kanban">${(isSme() ? PDCA_DEF.map(([k, name, color, sla]) => {
          const list = open.filter((r) => pdcaOf(r) === k);
          return `<div class="kb-col"><h5><span class="kb-dot" style="background:${color};"></span>${k} ${name}<span style="margin-left:auto;color:#8791a5;">${list.length}</span></h5>
            ${list.map((p) => `<div class="kb-card" data-act="projectDetail" data-args='${esc(JSON.stringify({ id: p.id }))}' ${p.overdue ? 'style="border-color:#ffdcd9;"' : ''}>
              <b>${esc(p.id)} ${esc(p.title.slice(0, 14))}</b>
              ${p.overdue ? tag('超期 ' + p.overdueDays + ' 天', 'red') : tag(p.severity + ' 级', p.severity === 'A' ? 'red' : 'orange')}
              <div class="meta"><span>${esc(p.model || '')} · ${esc(p.workshop || '')}</span><span>${esc(p.owner || '')}</span></div>
            </div>`).join('') || '<div style="font-size:10.5px;color:#b8c0cf;text-align:center;padding:8px 0;">—</div>'}
          </div>`;
        }).join('') : STAGE_DEF.map(([k, name]) => {
          const list = open.filter((r) => r.stage === k);
          return `<div class="kb-col"><h5><span class="kb-dot" style="background:${STAGE_COLOR[k]};"></span>${k} ${name}<span style="margin-left:auto;color:#8791a5;">${list.length}</span></h5>
            ${list.map((p) => `<div class="kb-card" data-act="projectDetail" data-args='${esc(JSON.stringify({ id: p.id }))}' ${p.overdue ? 'style="border-color:#ffdcd9;"' : ''}>
              <b>${esc(p.id)} ${esc(p.title.slice(0, 14))}</b>
              ${p.overdue ? tag('超期 ' + p.overdueDays + ' 天', 'red') : tag(p.severity + ' 级', p.severity === 'A' ? 'red' : 'orange')}
              <div class="meta"><span>${esc(p.model || '')} · ${esc(p.workshop || '')}</span><span>${esc(p.owner || '')}</span></div>
            </div>`).join('') || '<div style="font-size:10.5px;color:#b8c0cf;text-align:center;padding:8px 0;">—</div>'}
          </div>`;
        }).join(''))}</div>`)}
      ${focus ? card('焦点项目：' + esc(focus.id) + ' ' + esc(focus.title), '阶段 ' + focus.stage + ' · SLA ' + ((STAGE_DEF.find((s) => s[0] === focus.stage) || [])[2] || '') + ' · 责任人 ' + esc(focus.owner),
        infoGrid([['项目编号', esc(focus.id)], ['当前阶段', focus.stage + ' ' + ((STAGE_DEF.find((s) => s[0] === focus.stage) || [])[1] || '')], ['责任人', esc(focus.owner || '')], ['产品/车间', esc(focus.model + ' / ' + focus.workshop)], ['截止日期', day(focus.dueAt) + (focus.overdue ? '　' + tag('已超期 ' + focus.overdueDays + ' 天', 'red') : '')], ['来源问题', esc(focus.issueId || '—')], ['预估收益', (focus.benefitEstimate || 0) + ' 万元'], ['进度', focus.progress + '%']].concat([['项目描述', esc(focus.description || '—'), true]]), 'g4c') +
        '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
        act('查看详情 / 推进阶段', 'projectDetail', { id: focus.id }, 'btn btn-primary') +
        act('AI 生成因果图与根因假设', 'aiQuick', { q: '针对项目 ' + focus.id + '（' + focus.title + '）做根因分析：先查数据，再给出按置信度排序的根因假设与验证方法' }, 'btn btn-ai') +
        act('AI 起草 5W2H', 'aiQuick', { q: '为项目 ' + focus.id + ' 起草 D2 问题描述（5W2H），要包含量化数据' }, 'btn') +
        '</div>') : ''}
      <div style="margin-top:14px;">
        ${card('项目清单', '共 ' + rows.length + ' 个',
          table(['编号', '项目名称', '阶段', '责任人', '进度', '截止', '状态'], projRows),
          act('导出 Excel', 'exportData', { dataset: 'projects' }))}
        ${card(isSme() ? 'PDCA 节奏与 AI 支持' : '8D 阶段 SLA 与 AI 支持', isSme() ? '周例会同步 · 超期由质量主管协调' : '超期自动升级 · 抄送主管',
          table(['阶段', 'SLA', 'AI 支持能力', '在改'], slaRows))}
      </div>
      <div class="footer-note">${brand()} · 质量改进项目</div>`;
    },
  };

  global.ChatState = Chat;
  global.renderMsgFn = renderMsg;
  global.STAGE_DEF = STAGE_DEF;
  global.STAGE_COLOR = STAGE_COLOR;
})(window);




