/* ==================================================================
   知识与团队页面：知识库 / 员工成长中心 / 插件架构 / 移动端
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, kpi, table, tag, bar, md, dt, day, num, empty, infoGrid, ring, lineChart, paretoChart, brand } = UI;
  const Pages = global.Pages;
  const KB = global.KBState = { query: '', type: '', category: '', results: null };

  /* ================= P10 知识库与经验传承 ================= */
  Pages.knowledge = {
    title: '知识库与经验传承', sub: '师傅经验数字化 · 语义检索（BM25 + 中文 bigram）',
    async render() {
      const [statRes, kr] = await Promise.all([API.tool('kb_stats', {}), API.get('/qip-real-v3/api/knowledge', { limit: 300 })]);
      const rows = kr.rows || [];
      const st = statRes.result || {};
      const types = st.按类型 || {};
      const cats = st.按类别 || {};
      let results = KB.results;
      let searchInfo = '';
      if (KB.query) {
        const r = await API.tool('kb_search', { query: KB.query, topK: 10, type: KB.type || undefined, category: KB.category || undefined });
        results = (r.result && r.result.结果) || [];
        searchInfo = `<div style="font-size:11.5px;color:#5e6b85;margin-bottom:8px;">检索「<b>${esc(KB.query)}</b>」命中 <b>${results.length}</b> 条（BM25 + 中文 bigram 语义匹配）${KB.type ? '，类型限定：' + esc(KB.type) : ''}</div>`;
      }
      return `
      <div class="ai-strip">
        <div class="ai-ico">📚</div>
        <div class="ai-txt"><b>经验传承</b>　可录入经验卡、查找历史案例和已有规范。企业资料可上传至知识库文件页，供工作助手检索并引用。</div>
        ${act('上传知识库文件', 'goto', { page: 'library' }, 'btn btn-primary')}
        ${act('新增经验卡', 'newKnowledge', {}, 'btn')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '📚', label: '知识条目总量', value: rows.length, delta: Object.entries(types).map(([k, v]) => k + ' ' + v).join(' · ') })}
        ${kpi({ ico: '👨‍🏭', label: '经验卡（师傅经验）', value: types['经验卡'] || 0, color: '#7a5af8', icoBg: '#f0ebff' })}
        ${kpi({ ico: '🗂️', label: '历史故障案例', value: types['历史案例'] || 0, color: '#0a9e8f', icoBg: '#e0f6f2', delta: '项目关闭自动归档' })}
        ${kpi({ ico: '📖', label: '标准 / 规范条款', value: types['标准'] || 0, color: '#c8620a', icoBg: '#fff3e0', delta: '检索即引用出处' })}
      </div>

      ${card('语义检索', '问知识库：以前有没有类似问题？师傅怎么处理的？',
        `<div style="display:flex;gap:8px;margin-bottom:10px;">
          <input class="inp" id="kbQuery" placeholder="例如：充电口盖间隙超差怎么排查 / 漆面颗粒污染源定位 / Cpk 判定准则" value="${esc(KB.query)}" onkeydown="if(event.key==='Enter')Actions.kbSearch()"/>
          ${act('检索', 'kbSearch', {}, 'btn btn-primary')}
          ${act('清空', 'kbClear', {}, 'btn')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
          ${['', '经验卡', '历史案例', '标准'].map((t) => `<span class="quick-cmd" data-act="kbType" data-args='${esc(JSON.stringify({ type: t }))}' style="${KB.type === t ? 'border-color:#1a56db;color:#1a56db;background:#f7faff;' : ''}">${t || '全部类型'}</span>`).join('')}
          ${(() => {
            const wsNames = (((global.State.bootstrap || {}).naming || {}).workshops || ['一车间', '二车间', '三车间', '四车间', '五车间']);
            const categoryNames = ['', ...new Set([...wsNames, ...Object.keys(cats)].filter(Boolean))];
            return categoryNames.map((c) => `<span class="quick-cmd" data-act="kbCat" data-args='${esc(JSON.stringify({ category: c }))}' style="${KB.category === c ? 'border-color:#1a56db;color:#1a56db;background:#f7faff;' : ''}">${esc(c || '全部类别')}</span>`).join('');
          })()}
        </div>
        ${searchInfo}
        ${results ? (results.length ? results.map((r) => `
          <div class="list-row" data-act="kbDetail" data-args='${esc(JSON.stringify({ id: r.编号 }))}' style="display:block;">
            <div style="display:flex;gap:8px;align-items:center;"><b style="font-size:13px;">${esc(r.标题)}</b>${tag(r.类型, 'purple')}${tag(r.类别, 'gray')}<span style="margin-left:auto;font-size:11px;color:#1a56db;">相关度 ${r.相关度}</span></div>
            <div style="font-size:11.5px;color:#5e6b85;margin-top:5px;line-height:1.75;">${r.正文 ? esc(r.正文.slice(0, 220)) : '<b>问题：</b>' + esc((r.问题 || '').slice(0, 90)) + '<br><b>对策：</b>' + esc((r.对策 || '').slice(0, 150))}</div>
            <div style="font-size:11px;color:#8791a5;margin-top:4px;">出处：${esc(r.出处 || '')}${r.编号 ? '　编号：' + esc(r.编号) : ''}</div>
          </div>`).join('') : empty('未检索到相关内容，换个更具体的工艺/缺陷关键词试试', '🔍')) : ''}`)}

      <div class="grid g2-1">
        ${card('知识库条目', '共 ' + rows.length + ' 条 · 点击查看全文',
          table(['编号', '类型', '类别', '标题', '作者', '浏览', ''],
            rows.map((r) => ({
              __act: 'kbDetail', __args: { id: r.id },
              cells: ['<b>' + esc(r.id) + '</b>', tag(r.type, r.type === '经验卡' ? 'purple' : r.type === '标准' ? 'orange' : 'teal'), esc(r.category || ''), esc(r.title), esc(r.author || ''), r.views || 0, act('查看', 'kbDetail', { id: r.id }, 'btn btn-sm')],
            }))))}
        <div>
          ${card('类别分布', '知识库结构', paretoChart(Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })), {}))}
        </div>
      </div>
      <div class="footer-note">${brand()} · 知识库</div>`;
    },
  };

  /* ================= P11 员工成长中心 ================= */
  Pages.growth = {
    title: '员工成长中心', sub: '人员、阶段训练与考核记录',
    async render() {
      const {rows:members} = await API.get('/qip-real-v3/api/members', { limit: 1000 });
      const growth = members.flatMap((m) => (m.growth || []).map((item) => ({ ...item, member:m.name })));
      return `
      ${card('人员台账', members.length + ' 人 · ' + growth.length + ' 条成长记录',
        table(['姓名', '部门', '岗位', '司龄（年）', '最近成长阶段', '操作'], members.map((m) => [
          esc(m.name), esc(m.dept), esc(m.role), esc(m.seniority ?? '—'), esc(m.growth?.at(-1)?.stage || '尚无记录'),
          act('记录 / 查看', 'growthForm', {id:m.id}, 'btn btn-sm') + ' ' + act('编辑人员', 'memberForm', {id:m.id}, 'btn btn-sm'),
        ]), {empty:'暂无人员，先登记真实人员后即可记录阶段训练。'}), act('新增人员', 'memberForm', {}, 'btn btn-primary'))}
      ${card('30 / 60 / 90 天培养记录', '由带教人记录实际任务与考核结果',
        table(['人员', '阶段', '训练或考核内容', '记录人', '时间'], growth.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,20)
          .map((r)=>[esc(r.member),esc(r.stage),esc(r.summary),esc(r.reviewer),dt(r.at)]), {empty:'暂无成长记录'}))}
      ${card('带教资料', '使用现有经验与企业文件检索', '<div class="op-actions">'
        + act('查内部资料', 'libraryChat', {}, 'btn btn-primary') + act('查处理经验', 'goto', {page:'knowledge'}, 'btn') + '</div>')}
      <div class="footer-note">${brand()} · 成长中心</div>`;
    },
  };

  /* ================= P12 DeepSeek 插件架构 ================= */
  Pages.arch = {
    title: 'DeepSeek 插件架构', sub: 'Harness 运行状态 · 插件总线 · 安全护栏 · 审计',
    async render() {
      const boot = global.State.bootstrap;
      const tools = boot.tools || [];
      const settings = boot.settings || {};
      const plugins = settings.plugins || {};
      const auditRes = await API.get('/qip-real-v3/api/audit', { limit: 60 });
      const audit = auditRes.rows || [];
      const byPlugin = {};
      tools.forEach((t) => { (byPlugin[t.plugin] = byPlugin[t.plugin] || []).push(t); });
      const auditByPlugin = {};
      audit.forEach((a) => { auditByPlugin[a.plugin] = (auditByPlugin[a.plugin] || 0) + 1; });
      const llm = settings.llm || {};

      return `
      <div class="ai-strip">
        <div class="ai-ico">🧱</div>
        <div class="ai-txt"><b>架构：</b>由 Harness 承载模型和插件页面。质量工具按能力分组，读取本机业务库和用户导入的数据。</div>
        ${act('插件接入说明', 'pluginGuide', {}, 'btn')}
      </div>

      <div class="card">
        <div class="card-hd"><span class="t">三层架构与数据流</span><span class="s">当前实际运行状态</span></div>
        <svg viewBox="0 0 900 250" style="width:100%;">
          <rect x="10" y="12" width="880" height="40" rx="8" fill="#e4edff" stroke="#c9d8f5"/>
          <text x="24" y="38" font-size="12" fill="#0b3ea8" font-weight="700">用户层</text>
          <text x="110" y="38" font-size="11.5" fill="#33415c">工作台 · 现场录入 · 站内审批 · 看板与知识检索</text>
          <path d="M450 52 L450 72" stroke="#95a3bd" stroke-width="2" marker-end="url(#ar)"/>
          <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#95a3bd"/></marker></defs>
          <rect x="10" y="72" width="880" height="58" rx="8" fill="#f0ebff" stroke="#ddd6ff"/>
          <text x="24" y="96" font-size="12" fill="#7a5af8" font-weight="700">AI 中台</text>
          <text x="110" y="96" font-size="11.5" fill="#33415c">DeepSeek Harness：意图理解 → 任务规划(ReAct) → 插件编排 → 知识检索(RAG) → 深度推理 → 结果整合 → 安全护栏</text>
          <text x="110" y="116" font-size="11" fill="#7a5af8">当前模型：${esc(llm.model || '未配置')}　Base URL：${esc(llm.baseUrl || '—')}　API Key：${llm.hasApiKey ? '已配置 ' + esc(llm.apiKeyMasked || '') : '未配置'}　工具数：${tools.length}</text>
          <path d="M450 130 L450 150" stroke="#95a3bd" stroke-width="2" marker-end="url(#ar)"/>
          <rect x="10" y="150" width="880" height="46" rx="8" fill="#e0f6f2" stroke="#bfe3d2"/>
          <text x="24" y="178" font-size="12" fill="#0a9e8f" font-weight="700">插件总线</text>
          ${Object.keys(byPlugin).slice(0, 9).map((p, i) => `<rect x="${110 + i * 86}" y="160" width="80" height="26" rx="6" fill="#fff" stroke="#bfe3d2"/><text x="${150 + i * 86}" y="177" font-size="10.5" fill="#0a9e8f" text-anchor="middle">${esc(p)} (${byPlugin[p].length})</text>`).join('')}
          <path d="M450 196 L450 212" stroke="#95a3bd" stroke-width="2" marker-end="url(#ar)"/>
          <rect x="10" y="212" width="880" height="32" rx="8" fill="#f2f4f8" stroke="#e4e8f0"/>
          <text x="24" y="233" font-size="11.5" fill="#5e6b85">数据来源：本机业务库、录入或导入的数据、用户知识库文件</text>
        </svg>
      </div>

      <div class="grid g2" style="margin-bottom:14px;">
        ${card('插件清单与运行状态', '共 ' + Object.keys(byPlugin).length + ' 个插件 / ' + tools.length + ' 个工具',
          table(['插件', '工具数', '模式', '状态', '近 60 条审计调用', ''],
            Object.keys(byPlugin).map((p) => {
              const key = Object.keys(plugins).find((k) => plugins[k].name === p || plugins[k].name?.split(' ')[0] === p);
              const cfg = key ? plugins[key] : null;
              return {
                cells: ['<b>' + esc(p) + '</b><br><span style="font-size:10.5px;color:#8791a5;">' + esc(cfg ? cfg.desc : '') + '</span>', byPlugin[p].length,
                  cfg ? tag('本地数据仓', 'blue') : tag('内置', 'blue'),
                  cfg && cfg.enabled === false ? tag('已停用', 'gray') : tag('运行中', 'green'),
                  auditByPlugin[p] || 0,
                  act('工具', 'showPlugin', { plugin: p }, 'btn btn-sm') + (key ? act('配置', 'pluginConfig', { key }, 'btn btn-sm') : '')],
              };
            })))}
        ${card('Harness 运行状态', '真实统计',
          infoGrid([
            ['模型', esc(llm.model || '未配置')], ['深度推理', llm.deepThinking ? '已开启' : '关闭'],
            ['温度', llm.temperature], ['最大 Token', llm.maxTokens],
            ['最大工具轮次', (settings.agent || {}).maxRounds || 8], ['自动工具调用', (settings.agent || {}).autoTool !== false ? '开启' : '关闭'],
            ['结论引用出处', '启用'], ['敏感操作人工确认', '启用'],
            ['敏感信息脱敏', (settings.agent || {}).maskSensitive !== false ? '开启（VIN/手机号）' : '关闭'], ['全程审计', '开启（按保留期归档）'],
            ['数据存储', '本机 SQLite', true],
          ]))}
      </div>

      <div class="grid g2">
        ${card('安全与信创治理', '技术方案第五章落地情况',
          table(['治理项', '机制', '当前状态'], [
            ['数据与模型', '数据保存在本机。问答时相关资料发往 Harness 配置的模型。', tag('本地存储', 'blue')],
            ['使用身份', '插件沿用当前 Harness 会话。站内操作记录填写的经办人。', tag('Harness', 'blue')],
            ['敏感脱敏', 'VIN / 手机号 / 身份证在进入 Prompt 前自动脱敏', tag('已开启', 'green')],
            ['全程审计', '每次工具调用留痕：谁·何时·取了什么·用途', tag('已开启', 'green')],
            ['引用', '知识库回答提供可打开的原文；普通问答按提示要求模型说明依据。', tag('原文可查', 'green')],
            ['人工确认', '对外发送 / 对外承诺 / 8D 关闭三类动作强制确认', tag('已开启', 'green')],
          ]))}
        ${card('审计日志', '最近 ' + audit.length + ' 条工具调用',
          table(['时间', '操作人', '插件', '动作', '结果摘要'],
            audit.slice(0, 20).map((a) => [dt(a.ts), esc(a.user), tag(a.plugin, 'navy'), esc(a.action), '<span style="font-size:11.5px;">' + esc((a.resultSummary || '').slice(0, 50)) + '</span>'])),
          act('查看全部', 'goto', { page: 'audit' }))}
      </div>
      <div class="footer-note">${brand()} · 插件架构</div>`;
    },
  };

  /* ================= P13 移动端适配 ================= */
  Pages.mobile = {
    title: '现场工作入口', sub: '窄屏可直接打开本机业务页面',
    async render() {
      const response = await API.get('/qip-real-v3/api/operations');
      const decision = (response.counts.plan_review || 0) + (response.counts.result_review || 0) + (response.counts.close_review || 0);
      return `${card('现场工作入口', '当前 Harness 的同一份数据',
        '<div class="op-actions">'
        + act('录入现场问题','newIssue',{},'btn btn-primary')
        + act('录入现场描述','voiceReport',{},'btn')
        + act('待确认（' + decision + '）','goto',{page:'confirmFix'},'btn')
        + act('执行跟进','goto',{page:'followUp'},'btn')
        + act('查知识库','libraryChat',{},'btn')
        + act('下载报表','goto',{page:'report'},'btn') + '</div>')}
        <div class="footer-note">${brand()} · 现场工作</div>`;
    },
  };
})(window);




