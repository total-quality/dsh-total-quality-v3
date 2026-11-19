(function (g) {
  'use strict';
  const { esc } = UI;
  const configs = {
    '8d': { steps: ['way', 'action'], label: '8D 报告草稿' },
    fmea: { steps: ['chain'], label: 'FMEA 报告草稿' },
  };
  const rowGroups = {
    way: { key: 'why', label: '5 Why', item: '追问', max: 5, fields: [['question', '追问'], ['answer', '原因或假设'], ['evidence', '验证依据', 'area']] },
    action: { key: 'actions', label: '永久纠正措施', item: '措施', max: 20, fields: [['action', '永久措施'], ['cause', '对应根因'], ['owner', '责任人'], ['due', '期限', 'date'], ['verify', '验证办法', 'area']] },
    chain: { key: 'chains', label: '失效链与措施', item: '失效链', max: 20, fields: [['function', '功能与要求'], ['mode', '失效模式'], ['effect', '失效影响'], ['cause', '失效起因'], ['pc', '现行预防控制'], ['dc', '现行探测控制']],
      scores: [['s', '严重度 S', 'score'], ['o', '发生度 O', 'score'], ['d', '探测度 D', 'score']],
      action: [['measure', '改进措施'], ['owner', '责任人'], ['due', '计划期限', 'date'], ['evidence', '验证记录'], ['postS', '复评 S', 'score'], ['postO', '复评 O', 'score'], ['postD', '复评 D', 'score']] },
  };
  const supported = (mode) => Object.hasOwn(configs, mode);
  const safe = (v) => esc(v ?? '');
  function field(key, title, value, type = 'text') {
    const attrs = `name="skill_${key}"`;
    const numeric = type === 'score' || type === 'count';
    const input = type === 'area' ? `<textarea ${attrs} rows="3">${safe(value)}</textarea>` : `<input ${attrs} type="${numeric ? 'number' : type}"${numeric ? ` min="${type === 'score' ? '1' : '0'}" step="1"${type === 'score' ? ' max="10"' : ''}` : ''} value="${safe(value)}">`;
    return `<label class="op-field${type === 'area' ? ' full' : ''}">${title}${input}</label>`;
  }
  function select(key, title, entries, value) {
    return `<label class="op-field">${title}<select name="skill_${key}">${entries.map(([id, label]) => `<option value="${safe(id)}"${id === value ? ' selected' : ''}>${safe(label)}</option>`).join('')}</select></label>`;
  }
  const fields = (spec, values) => spec.map(([key, label, type]) => field(key, label, values[key], type)).join('');
  function repeatRow(name, row = {}) {
    const cfg = rowGroups[name];
    return `<div class="skill-row" data-skill-row><div class="skill-row-head full"><strong>${cfg.item} <span></span></strong><button type="button" class="btn btn-sm" data-skill-remove>移除</button></div>${fields(cfg.fields, row)}${cfg.scores ? `<div class="skill-scores full">${fields(cfg.scores, row)}</div><details class="full" ${cfg.action.some(([key]) => row[key]) ? 'open' : ''}><summary>改进措施和实施后复评</summary><div class="skill-row-fields">${fields(cfg.action, row)}</div></details>` : ''}</div>`;
  }
  function group(name, values) {
    const cfg = rowGroups[name];
    return `<section class="skill-group full" data-skill-group="${name}"><div class="skill-row-head"><h3>${cfg.label}</h3><button class="btn btn-sm" type="button" data-skill-add>添加${cfg.item}</button></div><div data-skill-rows>${(values?.length ? values : [{}]).map((row) => repeatRow(name, row)).join('')}</div></section>`;
  }
  function render(mode, shown, templates, editing) {
    const v = editing?.tool === mode ? editing.inputs.skill : {};
    const active = shown === mode;
    const common = fields([['product', '产品'], ['customer', '客户（客诉／FMEA 必填）'], ['process', mode === '8d' ? '车间／工序' : '分析对象（工序或设计对象）'], ['team', '团队 / 责任人'], ['problem', mode === '8d' ? '问题描述' : '已知现象', 'area'], ['requirements', '要求与限制', 'area']], v);
    const profile = select('template', '报告模板', [['', '按问题和产品自动匹配'], ...templates], v.template || '');
    const eight = mode === '8d';
    const intro = eight ? '关联工作单可带入问题、批次测量和阶段记录。检验件数与测量点数分开统计。' : '按策划、结构、功能、失效、风险、优化和沟通七步编排。评分可暂留空，参考 AP 由团队核定。';
    const specific = eight ? select('origin', '问题来源', [['internal', '内部发现'], ['customer', '客户反馈']], v.origin || 'internal') + fields([['scope', '影响与数据范围', 'area'], ['sample', '检验件数', 'count'], ['defects', '不良件数', 'count'], ['containment', '临时围堵措施', 'area'], ['root', '根因归纳（有证据再填写）', 'area'], ['yokoten', '防再发／横向展开', 'area']], v)
      : select('type', 'FMEA 类型', [['', '请选择'], ['PFMEA', 'PFMEA · 过程'], ['DFMEA', 'DFMEA · 设计']], v.type || '') + field('designOwner', '设计责任方（DFMEA）', v.designOwner) + field('scope', '工序清单／系统与组件层级', v.scope, 'area');
    return `<fieldset class="full op-mode-fields skill-fields" data-mode-fields="${mode}" ${active ? '' : 'hidden disabled'}><legend>${configs[mode].label}</legend><p class="op-note">${intro}</p><p class="skill-case-summary full" aria-live="polite"></p><div class="skill-main full">${profile}${common}${specific}</div><details class="skill-extended full" ${editing?.tool === mode || !eight ? 'open' : ''}><summary>${eight ? '补充 5 Why 与永久措施' : '编辑失效链及评分'}</summary>${configs[mode].steps.map((k) => group(k, v[rowGroups[k].key])).join('')}</details></fieldset>`;
  }
  // Reapply work-order values only where the user has not overridden the last autofill.
  function prefill(form, cases, preserve) {
    const c = cases.find((row) => row.id === form.elements.caseId.value);
    for (const box of form.querySelectorAll('.skill-fields')) {
      const eight = box.dataset.modeFields === '8d';
      const business = c?.business || {};
      const defaults = { product: c?.product, problem: c?.description, process: c?.location, customer: business.customer, team: c?.owner };
      if (eight) {
        const sample = business.baselineChecked ?? business.checkedQty;
        const defects = business.baselineChecked == null ? business.failedQty : business.baselineFailed;
        Object.assign(defaults, { origin: c?.kind === 'complaint' ? 'customer' : 'internal', scope: [c?.location, c?.batch && '批次 ' + c.batch].filter(Boolean).join(' · '), sample: sample > 0 && defects != null && defects <= sample ? sample : '', defects: sample > 0 && defects != null && defects <= sample ? defects : '' });
      }
      for (const [key, value] of Object.entries(defaults)) {
        const el = box.querySelector(`[name="skill_${key}"]`);
        const prior = el.dataset.autofill ?? (key === 'origin' ? 'internal' : '');
        const next = String(value ?? '');
        if (preserve && form.dataset.editingMode === box.dataset.modeFields) {
          if (el.value === next) el.dataset.autofill = next;
          continue;
        }
        if (!el.value || el.value === prior) { el.value = next; el.dataset.autofill = next; }
      }
      const m = c?.measurement;
      const audit = c ? `${c.number} · ${c.title}。${(c.submissions || []).filter((s) => s.acceptedBy).length} 条执行记录已复核。` : '可手动录入资料生成草稿。';
      const measure = eight && m ? `同特性同批次当前记录 ${m.n} 个测量点，超规格 ${m.out} 点，生成时保存快照。` : '';
      box.querySelector('.skill-case-summary').textContent = audit + measure;
    }
  }
  function updateGroup(container) {
    const index = Array.from(container.querySelectorAll('[data-skill-row]'));
    for (const [i, row] of index.entries()) row.querySelector('.skill-row-head strong span').textContent = i + 1;
    container.querySelector('[data-skill-add]').disabled = index.length >= rowGroups[container.dataset.skillGroup].max;
  }
  function updateMode(form) {
    const mode = form.elements.mode.value;
    for (const el of form.querySelectorAll('[data-mode-fields]')) {
      el.hidden = el.dataset.modeFields !== mode;
      el.disabled = el.hidden;
    }
    const question = form.elements.question;
    question.closest('label').hidden = supported(mode);
    question.disabled = supported(mode);
    form.querySelector('button[type=submit]').textContent = form.dataset.editingMode ? '保存修订版本' : supported(mode) ? '生成并保存报告草稿' : '生成并保存分析记录';
  }
  function mount(form, cases) {
    prefill(form, cases, true);
    updateMode(form);
    for (const group of form.querySelectorAll('[data-skill-group]')) updateGroup(group);
    form.addEventListener('change', (e) => {
      if (e.target.name === 'mode') updateMode(form);
      if (e.target.name === 'caseId') prefill(form, cases, false);
    });
    form.addEventListener('click', (e) => {
      const button = e.target.closest('[data-skill-add], [data-skill-remove]');
      if (!button) return;
      const wrap = button.closest('[data-skill-group]');
      if (button.hasAttribute('data-skill-add')) {
        const rows = wrap.querySelector('[data-skill-rows]');
        rows.insertAdjacentHTML('beforeend', repeatRow(wrap.dataset.skillGroup));
        rows.lastElementChild.querySelector('input').focus();
      } else button.closest('[data-skill-row]').remove();
      form.dataset.dirty = '1';
      updateGroup(wrap);
    });
  }
  function read(form, mode) {
    const box = form.querySelector(`[data-mode-fields="${mode}"]`);
    const readFields = (scope) => Object.fromEntries([...scope.querySelectorAll('input, textarea, select')].map((el) => [el.name.slice("skill_".length), el.value]));
    const skill = readFields(box.querySelector('.skill-main'));
    for (const container of box.querySelectorAll('[data-skill-group]')) {
      skill[rowGroups[container.dataset.skillGroup].key] = [...container.querySelectorAll('[data-skill-row]')].map(readFields);
    }
    return skill;
  }
  function preview(r) {
    return `<div class="skill-report">${r.skillReport.sections.map((s, i) => `<details ${i === 0 ? 'open' : ''}><summary>${esc(s.title)}</summary>${s.tables.map((t) => `<h4>${esc(t.title)}</h4>${t.rows.length ? `<div class="op-table-wrap"><table class="op-table"><thead><tr>${t.header.map((v) => `<th scope="col">${esc(v)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((cells) => `<tr>${cells.map((v) => `<td>${esc(v === 0 ? '0' : v || '待补充')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p>待补充</p>'}`).join('')}</details>`).join('')}</div>`;
  }
  g.QSkills = { supported, render, mount, read, preview };
})(window);
