/* ==================================================================
   体系文件（中小型企业版）：填写体系调研 → 一键生成手册 / 程序文件
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, table, tag, dt, empty, infoGrid } = UI;
  const Pages = global.Pages;
  function summaryCard(sv, schema, goPage) {
    const b = sv || {};
    const titles = new Map(schema?.certificates || []);
    const certs = [...(b.certs || []).map(code => titles.get(code) || code), b.otherCert].filter(Boolean).join(' + ') || '未选择';
    return card('调研摘要', '生成文件时按这里的信息组织内容', infoGrid([
      ['公司名称', esc(b.company || '—')],
      ['认证类型', esc(certs)],
      ['覆盖产品', esc(b.products || '—')],
      ['员工规模', b.staff ? esc(b.staff) + ' 人' : '—'],
      ['管理者代表', esc(b.mgmtRep || '—')],
      ['有无设计开发', esc(b.design || '—')],
      ['质量方针', esc(b.policy || '—'), true],
      ['质量目标', esc(b.objective || '—'), true],
      ['部门设置', esc((b.orgs || []).map((o) => o.dept).filter(Boolean).join('、') || '—'), true],
    ]), act('去完善调研', 'goto', { page: goPage || 'qmsSurvey' }));
  }

  function docsCard(type, docs) {
    const rows = (docs || []).map((d) => [
      `<b>${esc(d.code || '')}</b> ${esc(d.title || '')}`,
      d.source === 'ai' ? tag('AI 生成', 'blue') : tag('模板生成', 'gray'),
      String(d.chars || 0) + ' 字',
      dt(d.createdAt),
      act('查看', 'qmsDoc', { id: d.id }, 'btn btn-sm') + act('下载 .md', 'qmsDown', { id: d.id }, 'btn btn-sm'),
    ]);
    const extra = (type === 'procedure' || type === 'tier3') && rows.length
      ? act('全部下载为一个文件', 'qmsDownAll', { type }, 'btn btn-sm')
      : '';
    const cardTitle = type === 'manual' ? '已生成的质量手册' : (type === 'procedure' ? '已生成的程序文件' : '已生成的三层次文件（A / B / C 三层）');
    return card(cardTitle,
      rows.length ? '共 ' + rows.length + ' 份 · 同类生成文件保留最近一次' : '还没有生成，点上方按钮生成',
      rows.length ? table(['文件', '来源', '字数', '生成时间', '操作'], rows) : empty('还没有生成文件'),
      extra);
  }

  /* ---------------- 一键生成手册 ---------------- */
  Pages.qmsManual = {
    title: '一键生成手册', sub: '按调研信息生成企业质量手册（Markdown，可下载）',
    async render() {
      let s = { survey: null, completion: 0 }, d = { rows: [] };
      try { s = await API.get('/qip-real-v3/api/qms/survey'); } catch (e) { /* 旧后端 */ }
      try { d = await API.get('/qip-real-v3/api/qms/docs?type=manual'); } catch (e) { /* 旧后端 */ }
      const sv = s.survey || null;
      const ready = s.progress?.missingForGeneration?.length === 0;
      return `
      <div class="ai-strip">
        <div class="ai-ico">📄</div>
        <div class="ai-txt"><b>一键生成质量手册：</b>按调研表里的公司信息、组织机构、方针目标与认证类型，生成含「发布令、公司简介、方针目标、第 1~10 章、附录（术语 / 过程清单 / 文件清单）」的 Markdown 手册；接了模型由模型写，没接模型用内置模板生成骨架。</div>
        ${act(ready ? '一键生成手册' : '先填写调研', ready ? 'qmsGen' : 'goto', ready ? { type: 'manual' } : { page: 'qmsSurvey' }, 'btn btn-ai')}
      </div>
      ${ready ? '' : '<div class="dm-note" style="margin-bottom:12px;">还没有调研信息：请先到「填写体系调研」保存公司名称、适用体系和覆盖产品。</div>'}
      <div class="grid g2-1">
        <div>${summaryCard(sv, s.schema)}</div>
        <div>${card('手册包含的章节', '生成后可在下方查看与下载',
          `<ul class="qms-list">
            <li>发布令 · 公司简介</li>
            <li>质量方针与质量目标</li>
            <li>1 范围 / 2 引用文件 / 3 术语</li>
            <li>4 组织环境 / 5 领导作用 / 6 策划</li>
            <li>7 支持 / 8 运行 / 9 绩效评价 / 10 改进</li>
            <li>附录 A 术语 · B 过程清单 · C 文件清单</li>
          </ul>`)}</div>
      </div>
      ${docsCard('manual', d.rows || [])}`;
    },
  };

  /* ---------------- 一键生成程序文件 ---------------- */
  Pages.qmsProc = {
    title: '一键生成程序文件', sub: '按调研信息生成 10 个程序文件（Markdown，可逐个下载或打包）',
    async render() {
      let s = { survey: null, completion: 0 }, d = { rows: [] };
      try { s = await API.get('/qip-real-v3/api/qms/survey'); } catch (e) { /* 旧后端 */ }
      try { d = await API.get('/qip-real-v3/api/qms/docs?type=procedure'); } catch (e) { /* 旧后端 */ }
      const sv = s.survey || null;
      const ready = s.progress?.missingForGeneration?.length === 0;
      const planned = ['文件控制程序', '记录控制程序', '管理评审程序', '内部审核程序', '不合格品控制程序',
        '纠正措施程序', '采购与供应商控制程序', '生产与服务提供控制程序', '监视和测量资源控制程序', '人力资源与培训控制程序'];
      return `
      <div class="ai-strip">
        <div class="ai-ico">📑</div>
        <div class="ai-txt"><b>一键生成程序文件：</b>生成中小型制造企业最常备的 10 个二级程序文件，每个含「编号、目的、适用范围、职责、工作流程、相关记录、相关文件」，可直接下载成 .md 后转 Word 使用。</div>
        ${act(ready ? '一键生成程序文件' : '先填写调研', ready ? 'qmsGen' : 'goto', ready ? { type: 'procedure' } : { page: 'qmsSurvey' }, 'btn btn-ai')}
      </div>
      ${ready ? '' : '<div class="dm-note" style="margin-bottom:12px;">还没有调研信息：请先到「填写体系调研」保存公司名称、适用体系和覆盖产品。</div>'}
      <div class="grid g2-1">
        <div>${summaryCard(sv, s.schema)}</div>
        <div>${card('将生成的 10 个程序文件', '编号 QP-01 ~ QP-10',
          `<ol class="qms-list">${planned.map((p) => '<li>' + p + '</li>').join('')}</ol>`)}</div>
      </div>
      ${docsCard('procedure', d.rows || [])}`;
    },
  };

  /* ---------------- 一键生成三层次文件 ---------------- */
  const TIER3_PLAN = [
    ['A 层', 'TL-01 三层次体系文件编制说明', '分三层、编制职责、编号规则、受控与修订'],
    ['A 层', 'TL-02 第一层文件清单', '手册 / 方针目标 / 职责分配 / 适用范围'],
    ['B 层', 'TL-03 第二层程序文件清单', 'QP-01 ~ QP-10 与过程、责任部门对应表'],
    ['C 层', 'WI-01 冲压工序作业指导书', '作业前确认、首件、过程自检、异常处理'],
    ['C 层', 'WI-02 装配工序作业指导书', '物料确认、装配顺序、扭矩复核、互检'],
    ['C 层', 'WI-03 来料检验规范', '抽样方案、检验项目、判定与让步'],
    ['C 层', 'WI-04 首件确认与过程巡检规范', '首件时机、巡检频次、判异与追溯'],
    ['C 层', 'WI-05 不合格品标识与隔离规范', '红牌、隔离区、评审与处置'],
    ['C 层', 'TL-04 第三层记录表格清单', 'QR-01 ~ QR-10 与归属文件、保存期限'],
  ];

  Pages.qmsTier3 = {
    title: '一键生成三层次文件', sub: '按调研信息生成 A 纲领 / B 程序 / C 作业与记录三层文件（Markdown，可逐个下载或打包）',
    async render() {
      let s = { survey: null, completion: 0 }, d = { rows: [] };
      try { s = await API.get('/qip-real-v3/api/qms/survey'); } catch (e) { /* 旧后端 */ }
      try { d = await API.get('/qip-real-v3/api/qms/docs?type=tier3'); } catch (e) { /* 旧后端 */ }
      const sv = s.survey || null;
      const ready = s.progress?.missingForGeneration?.length === 0;
      return `
      <div class="ai-strip">
        <div class="ai-ico">🗂️</div>
        <div class="ai-txt"><b>一键生成三层次文件：</b>一次生成 9 份 —— <b>A 层</b>纲领性文件（编制说明、第一层文件清单）、<b>B 层</b>程序文件清单、<b>C 层</b>作业指导书与检验规范 5 份 + 记录表格清单；每份含「目的、适用范围、职责、内容要求、相关记录、相关文件」，可直接下载 .md 转 Word 使用。接了模型由模型写，没接模型用内置模板生成骨架。</div>
        ${act(ready ? '一键生成三层次文件' : '先填写调研', ready ? 'qmsGen' : 'goto', ready ? { type: 'tier3' } : { page: 'qmsSurvey' }, 'btn btn-ai')}
      </div>
      ${ready ? '' : '<div class="dm-note" style="margin-bottom:12px;">还没有调研信息：请先到「填写体系调研」保存公司名称、适用体系和覆盖产品。</div>'}
      <div class="grid g2-1">
        <div>${summaryCard(sv, s.schema)}</div>
        <div>${card('将生成的 9 份文件', 'A 层 2 份 · B 层 1 份 · C 层 6 份',
          table(['层次', '文件', '要点'], TIER3_PLAN.map(function (r) {
            return { cells: [tag(r[0], r[0] === 'A 层' ? 'blue' : (r[0] === 'B 层' ? 'orange' : 'green')), '<b>' + esc(r[1]) + '</b>', '<span style="color:#5e6b85;">' + esc(r[2]) + '</span>'] };
          })))}</div>
      </div>
      ${docsCard('tier3', d.rows || [])}`;
    },
  };
})(window);
