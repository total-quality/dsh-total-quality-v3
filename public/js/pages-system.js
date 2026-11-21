/* ==================================================================
   系统页面：审批中心 / 系统设置 / 审计日志
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, kpi, table, tag, dt, day, num, empty, infoGrid, input, readForm, toast, modal, brand } = UI;
  const Pages = global.Pages;
  const SetState = global.SetState = { steps: null, testing: false, initDraft: null, aiSuggestion: null, aiNoteText: '' };

  /* ================= 审批中心与待办 ================= */
  Pages.approval = {
    title: '审批中心与待办', sub: 'OA 审批流 · 派工任务 · 人工确认拦截的动作',
    async render() {
      const [wfRes, todoRes] = await Promise.all([API.get('/qip-real-v3/api/workflows', { limit: 200 }), API.get('/qip-real-v3/api/todos', { limit: 300 })]);
      const wfs = wfRes.rows || [];
      const todos = todoRes.rows || [];
      const pending = wfs.filter((w) => w.status === 'pending');
      const openTodos = todos.filter((t) => !t.done);
      return `
      <div class="ai-strip">
        <div class="ai-ico">✅</div>
        <div class="ai-txt"><b>审批与派工：</b>审批和待办在本机留档。质量工作单需要到对应工作单处理。对外承诺类动作由智能体挂起为「待确认项」，人工确认后才真正执行。当前待审批 <b>${pending.length}</b> 单，未完成待办 <b>${openTodos.length}</b> 项。</div>
        ${act('＋ 发起审批', 'newWorkflow', {}, 'btn btn-ai')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '⏳', label: '待审批', value: pending.length, color: '#c8620a', icoBg: '#fff3e0', delta: '其中加急 ' + pending.filter((w) => w.urgent).length })}
        ${kpi({ ico: '✅', label: '已批准', value: wfs.filter((w) => w.status === 'approved').length, color: '#18a058', icoBg: '#e8f7ee' })}
        ${kpi({ ico: '📌', label: '未完成待办', value: openTodos.length, color: '#1a56db', delta: 'A 级 ' + openTodos.filter((t) => t.priority === 'A').length })}
        ${kpi({ ico: '🔒', label: '待人工确认动作', value: (global.State.bootstrap.pendingActions || []).length, color: '#e5484d', icoBg: '#feece8', delta: '智能体已挂起', act: 'goto', args: { page: 'aiwb' } })}
      </div>
      ${card('OA 审批流', '共 ' + wfs.length + ' 单',
        table(['单号', '类型', '标题', '申请人', '关联', '状态', '审批人', '提交时间', ''],
          wfs.map((w) => ({
            cells: ['<b>' + esc(w.id) + '</b>' + (w.urgent ? ' ' + tag('加急', 'red') : ''), tag(w.type, 'blue'), esc(w.title), esc(w.applicant), esc(w.relatedId || '—'),
              w.status === 'pending' ? tag('待审批', 'orange') : w.status === 'approved' ? tag('已批准', 'green') : tag(w.status === 'rejected' ? '已驳回' : w.status, 'gray'),
              (w.approvers || []).map((a) => esc(a.name) + (a.status === 'approved' ? tag('已批', 'green') : tag(a.status === 'rejected' ? '已驳回' : '待批', 'gray'))).join(' '), dt(w.createdAt),
              w.operationsId ? act('查看工作单', 'openOperation', { id: w.operationsId }, 'btn btn-sm') : w.status === 'pending' ? act('批准', 'approveWf', { id: w.id }, 'btn btn-sm btn-primary') + act('驳回', 'rejectWf', { id: w.id }, 'btn btn-sm') : act('详情', 'wfDetail', { id: w.id }, 'btn btn-sm')],
          })), { empty: '暂无审批单' }))}
      ${card('待办清单', '共 ' + openTodos.length + ' 项未完成',
        table(['级别', '事项', '责任人', '来源', '期限', ''],
          openTodos.map((t) => ({
            cells: [tag(t.priority, t.priority === 'A' ? 'red' : t.priority === 'B' ? 'orange' : 'gray'), '<b>' + esc(t.title) + '</b>', esc(t.user || ''), esc(t.source || ''), dt(t.dueAt),
              t.operationsId ? act('打开工作单', 'openOperation', { id:t.operationsId }, 'btn btn-sm')
              : wfs.some((w) => w.id === t.link) ? act('查看审批', 'wfDetail', { id:t.link }, 'btn btn-sm')
              : t.source === '@FIN 收益核定' ? act('打开收益台账', 'goto', { page:'benefit' }, 'btn btn-sm')
              : act('完成', 'todoDone', { id: t.id }, 'btn btn-sm')],
          })), { empty: '暂无待办' }))}
      <div class="footer-note">${brand()} · 审批中心</div>`;
    },
  };

  /* ================= 系统设置 ================= */
  Pages.settings = {
    title: '系统设置', sub: '模型接入 · 智能体护栏 · 插件总线 · 数据管理',
    async render() {
      const boot = global.State.bootstrap;
      const s = boot.settings || {};
      const llm = s.llm || {}, agent = s.agent || {}, plugins = s.plugins || {};
      const counts = boot.counts || {};
      let dbStatus = null;
      try { dbStatus = (await API.get('/qip-real-v3/api/system/db')).db || null; } catch (_) { dbStatus = null; }
      return `
      <div class="ai-strip">
        <div class="ai-ico">⚙️</div>
        <div class="ai-txt"><b>配置说明：</b>插件内的 AI 对话直接调用 <b>DeepSeek Harness 当前登录的真实 DeepSeek 模型</b>（ctx.llm 服务，默认锁定最新的 DeepSeek-V4.1-Flash），不在本平台另存任何 API Key；业务数据保存在本机 SQLite。问答和起草会把必要的上下文发送给 Harness 配置的模型。</div>
        ${act('测试连通性', 'testLlm', {}, 'btn btn-ai')}
      </div>

      ${card('① 模型接入（真实 DeepSeek · 由 Harness 提供）', llm.hasApiKey ? tag('已连接真实模型', 'green') : tag('Harness 未接入模型', 'red'),
        `<div class="form-row"><div class="fl">当前模型<small>插件默认锁定 DeepSeek-V4.1-Flash；不可用时自动回落 Harness 当前模型，也可用环境变量 QIP_LLM_MODEL 覆盖</small></div><div class="fc"><b>${esc(llm.modelLabel || '未连接')}</b></div></div>
        <div class="form-row"><div class="fl">调用链路<small>真实模型调用，不是预设话术</small></div><div class="fc"><code>页面 → 插件 Host → ctx.llm → ${esc(llm.provider || 'DeepSeek')} / ${esc(llm.model || '')}</code></div></div>
        <div class="form-row"><div class="fl">说明</div><div class="fc" style="color:#5e6b85;line-height:1.9;">${esc(llm.description || '')}<br>本插件不需要单独填写 API Key 或 Base URL：模型接入、密钥与账号统一由 Harness 管理，插件只负责调用。</div></div>
        <div style="margin-top:12px;display:flex;gap:8px;">${act('测试连通性（真实调用一次模型）', 'testLlm', {}, 'btn btn-ai')}</div>
        ${SetState.testing ? '<div class="test-steps"><div class="empty"><span class="spin"></span>　正在测试（会真实调用模型，约 5~20 秒）…</div></div>' : ''}
        ${SetState.steps ? '<div class="test-steps">' + SetState.steps.map((st) => `<div class="test-step"><span class="${st.ok ? 'ts-ok' : 'ts-fail'}">${st.ok ? '✓' : '✗'}</span><div><b>${esc(st.name)}</b><div style="color:#5e6b85;margin-top:2px;">${esc(st.detail)}</div><div style="color:#8791a5;font-size:11px;">${st.ms}ms</div></div></div>`).join('') + '</div>' : ''}`)}

      ${card('② 智能体护栏', '对应技术方案第五章「安全与信创治理」',
        `<div class="form-row"><div class="fl">最大工具调用轮次<small>防止无限循环</small></div><div class="fc">${input('agent.maxRounds', agent.maxRounds, { type: 'number', small: true })}</div></div>
        <div class="form-row"><div class="fl">护栏开关</div><div class="fc" style="display:flex;flex-direction:column;gap:10px;">
          <span>助手引用实际资料并标注待核实假设，标记为需确认的操作等待人工确认。</span>
          ${input('agent.maskSensitive', agent.maskSensitive !== false, { type: 'checkbox', label: '敏感信息脱敏（VIN / 手机号 / 身份证）' })}
        </div></div>
        <div class="form-row"><div class="fl">企业自定义要求<small>会追加到系统提示词</small></div><div class="fc">${input('agent.systemPersona', agent.systemPersona || '', { type: 'textarea', rows: 3, placeholder: '例如：本厂重点关注出口批次质量；术语请使用「FTT / QRQC / 8D」；回复请尽量简洁。' })}</div></div>
        <div style="margin-top:12px;">${act('保存护栏设置', 'saveSettings', { section: 'agent' }, 'btn btn-primary')}</div>`)}

      ${card('③ 助手工具分组', '读取本地业务和已导入的数据',
        table(['分组', '说明', '数据来源', '助手', ''],
          Object.keys(plugins).map((k) => {
            const p = plugins[k];
            return {
              cells: ['<b>' + esc(p.name) + '</b><br><span style="font-size:10.5px;color:#8791a5;">' + esc(p.desc) + '</span>',
                esc(p.desc), tag('本地数据仓', 'blue'),
                p.enabled === false ? tag('已停用', 'gray') : tag('运行中', 'green'),
                act('配置', 'pluginConfig', { key: k }, 'btn btn-sm')],
            };
          })) +
        '<p class="library-tip">MES、质检和财务分组使用本站已录入或导入的记录。外部系统接入需单独适配。</p>')}

      ${global.Signing.cards()}

      ${card('④ 数据管理', '本地数据仓：' + Object.entries(counts).map(([k, v]) => k + ' ' + v).join(' · '),
        `${dbStatus ? `<div style="border:1px solid #c9d8f5;background:#f7faff;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.9;margin-bottom:12px;">
          <b>权威数据库：</b>SQLite <code>${esc(dbStatus.path)}</code>　${Math.round(dbStatus.sizeBytes / 1024)} KB　SQLite ${esc(dbStatus.sqliteVersion || '')}<br>
          <b>表行数：</b>${Object.entries(dbStatus.tables || {}).map(([k, v]) => k + ' ' + v).join(' · ')}　（日常按记录保存，JSON 快照定时更新）
        </div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          ${act('导入 Excel / CSV（测量数据）', 'importFile', { target: 'measurements' }, 'btn btn-primary')}
          ${act('导入问题清单', 'importFile', { target: 'issues' }, 'btn')}
          ${act('导入 AI 质检缺陷', 'importFile', { target: 'defects' }, 'btn')}
          ${act('导入物料成本', 'importFile', { target: 'materials' }, 'btn')}
          ${act('导入 BOM', 'importFile', { target: 'bom' }, 'btn')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${act('重建样例数据', 'resetData', {}, 'btn')}
          ${act('清空业务数据（保留模型配置）', 'clearData', {}, 'btn')}
        </div>
        <div style="font-size:11.5px;color:#8791a5;margin-top:10px;line-height:1.9;">
          <b>导入格式说明：</b>Excel 第一行为表头，平台会自动识别中文/英文字段名（如「时间/测量值/特性编号/产品/车间/批号/供应商/班次/操作者/VIN」）。
          测量可用于 SPC 判异和 Cpk。物料成本表需有编码、物料名称、单价、单位，BOM 表需有产品、零件、编码、层级、用量。若表头是特殊叫法，导出模板后按模板填写最稳妥：${act('导出模板', 'exportData', { dataset: 'measurement_template', filename: '导入模板_测量数据' }, 'btn btn-sm')}
        </div>`)}
      <div class="footer-note">${brand()} · 系统设置 · 以 MIT 许可开源（可自由修改、私有化部署与二次开发）</div>`;
    },
  };

  /* ================= 审计日志 ================= */
  Pages.audit = {
    title: '审计日志', sub: '谁 · 何时 · 用了哪个插件 · 取了什么 · 用于什么',
    async render() {
      const res = await API.get('/qip-real-v3/api/audit', { limit: 300 });
      const rows = res.rows || [];
      const byPlugin = {}; rows.forEach((r) => { byPlugin[r.plugin] = (byPlugin[r.plugin] || 0) + 1; });
      const byUser = {}; rows.forEach((r) => { byUser[r.user] = (byUser[r.user] || 0) + 1; });
      return `
      <div class="ai-strip">
        <div class="ai-ico">🔍</div>
        <div class="ai-txt"><b>站内审计</b>　查阅工作单处理和助手工具的操作时间、经办人、用途与结果摘要。</div>
        ${act('导出审计日志', 'exportAudit', {}, 'btn')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '📋', label: '审计记录', value: rows.length, delta: '最近 300 条' })}
        ${kpi({ ico: '🔌', label: '覆盖插件', value: Object.keys(byPlugin).length, color: '#0a9e8f', icoBg: '#e0f6f2', delta: Object.keys(byPlugin).slice(0, 4).join(' / ') })}
        ${kpi({ ico: '👤', label: '活跃操作人', value: Object.keys(byUser).length, color: '#7a5af8', icoBg: '#f0ebff', delta: Object.keys(byUser).slice(0, 3).join(' / ') })}
        ${kpi({ ico: '🤖', label: '智能体调用', value: rows.filter((r) => (r.purpose || '').indexOf('智能体') >= 0).length, color: '#1a56db' })}
      </div>
      ${card('审计明细', '按时间倒序',
        table(['时间', '操作人', '插件', '动作', '参数', '结果摘要', '用途'],
          rows.map((r) => [dt(r.ts), esc(r.user), tag(r.plugin, 'navy'), esc(r.action), '<span style="font-size:11px;font-family:Consolas,monospace;color:#5e6b85;">' + esc(JSON.stringify(r.params || {}).slice(0, 60)) + '</span>', '<span style="font-size:11.5px;">' + esc((r.resultSummary || '').slice(0, 60)) + '</span>', esc(r.purpose || '')]),
          { empty: '暂无审计记录' }))}
      <div class="footer-note">${brand()} · 审计日志</div>`;
    },
  };
})(window);




