(function (global) {
  'use strict';
  const { esc, act, input, dt, toast } = UI;
  const Pages = global.Pages;
  const base = '/qip-real-v3/api';
  let response;
  let draft;
  let selected = 'basis';
  let saving = false;

  function header(page, title, subtitle) {
    const tab = (name, label) => `<button type="button" data-act="goto"
      data-args='${esc(JSON.stringify({ page: name }))}' ${name === page ? 'class="survey-current" aria-current="page"' : ''}>${label}</button>`;
    return `<header class="survey-hero">
      <div><h1>${title}</h1><p>${subtitle}</p></div>
      <div class="survey-switch">
        ${tab('qmsSurvey', '体系调研')}
        ${tab('init', '企业设置')}
      </div>
    </header>`;
  }

  function departmentRow(row = {}) {
    return `<div class="survey-department" data-department>
      <label>部门名称<input name="dept" maxlength="160" value="${esc(row.dept || '')}" placeholder="如 客户服务组"></label>
      <label>负责人<input name="owner" maxlength="100" value="${esc(row.owner || '')}"></label>
      <label>职责<textarea name="duty" rows="2" maxlength="1000" placeholder="负责哪些过程与记录">${esc(row.duty || '')}</textarea></label>
      <button class="btn btn-sm" type="button" data-remove-department>移除</button>
    </div>`;
  }

  function field(spec, survey, data) {
    const [key, label, type, hint] = spec;
    const required = data.schema.requiredForCompletion.includes(key);
    const value = survey[key] ?? '';
    const mark = required ? '<span class="survey-required">必填</span>' : '';
    if (type === 'orgs') {
      return `<fieldset class="survey-wide" data-survey-field="orgs"><legend>${label}</legend>
        <div data-departments>${(survey.orgs || []).map(departmentRow).join('')}</div>
        <button class="btn btn-sm" type="button" data-add-department>增加部门</button>
      </fieldset>`;
    }
    if (type === 'certs') {
      const options = new Map(data.schema.certificates);
      const checked = new Set(survey.certs || []);
      for (const code of checked) if (!options.has(code)) options.set(code, code);
      return `<fieldset class="survey-wide" data-survey-field="certs"><legend>${label}${mark}</legend>
        <div class="survey-certificates">${[...options].map(([code, title]) =>
          `<label><input name="certs" type="checkbox" value="${esc(code)}" ${checked.has(code) ? 'checked' : ''}> ${esc(title)}</label>`).join('')}</div>
        <small>可多选，也可通过下方「其他体系或版本」填写。</small>
      </fieldset>`;
    }
    if (type === 'company') {
      return `<div class="survey-wide survey-company" data-survey-field="company">
        <label>公司名称${mark}<input name="company" value="${esc(data.defaults.company)}" readonly></label>
        ${act('修改企业名称', 'goto', { page: 'init' }, 'btn btn-sm')}
      </div>`;
    }
    let control;
    if (type === 'area') {
      control = `<textarea name="${key}" rows="3" maxlength="4000" placeholder="${esc(hint || '')}">${esc(value)}</textarea>`;
    } else if (type === 'schedule' || type === 'design') {
      const options = type === 'schedule' ? data.schema.schedules : ['有', '无'];
      control = `<select name="${key}"><option value="">请选择</option>${options.map(option =>
        `<option ${option === value ? 'selected' : ''}>${option}</option>`).join('')}</select>`;
    } else {
      const inputType = ['tel', 'date'].includes(type) ? type : 'text';
      const numericMode = type === 'integer' ? 'numeric' : type === 'decimal' ? 'decimal' : '';
      const placeholder = type === 'period' ? 'YYYY-MM 或 YYYY-MM-DD' : hint || '';
      control = `<input name="${key}" type="${inputType}" maxlength="${type === 'prefix' ? 8 : 400}" value="${esc(value)}"
        ${numericMode ? `inputmode="${numericMode}"` : ''} placeholder="${esc(placeholder)}">`;
    }
    const useProducts = key === 'products' && data.defaults.products.length
      ? '<button type="button" class="btn btn-sm" data-use-products>带入企业产品</button>' : '';
    return `<div class="survey-field ${key === 'otherCert' ? 'survey-wide' : ''}" data-survey-field="${key}"><label>${label}${mark}${control}</label>${useProducts}</div>`;
  }

  function readSurvey(form) {
    const fields = new FormData(form);
    const survey = Object.fromEntries(fields);
    for (const key of ['dept', 'owner', 'duty']) delete survey[key];
    survey.certs = fields.getAll('certs');
    survey.orgs = [...form.querySelectorAll('[data-department]')].map(row =>
      Object.fromEntries(['dept', 'owner', 'duty'].map(key => [key, row.querySelector(`[name="${key}"]`).value.trim()])));
    return survey;
  }

  function hasValue(survey, key) {
    if (key === 'certs') return Boolean(survey.certs.length || survey.otherCert?.trim());
    if (key === 'orgs') return survey.orgs.some(row => row.dept);
    return Boolean(survey[key]?.trim());
  }

  function updateProgress(form) {
    const survey = readSurvey(form);
    const { keyFields, requiredForCompletion, sections } = response.schema;
    const done = keyFields.filter(key => hasValue(survey, key)).length;
    const progress = form.querySelector('progress');
    progress.value = done;
    form.querySelector('[data-survey-count]').textContent = done + ' / ' + keyFields.length;
    const missing = requiredForCompletion.filter(key => !hasValue(survey, key));
    const fields = sections.flatMap(section => section.fields);
    const caption = form.querySelector('[data-survey-needed]');
    caption.textContent = missing.length
      ? '待补必填：' + missing.map(key => fields.find(field => field[0] === key)[1]).join('、')
      : '必填资料已齐。';
    for (const section of sections) {
      const focus = section.fields.map(([key]) => key).filter(key => key !== 'otherCert');
      const count = focus.filter(key => hasValue(survey, key)).length;
      const next = form.querySelector(`[data-survey-step="${section.id}"] small`);
      next.textContent = count + '/' + focus.length;
    }
    return missing;
  }

  function selectSection(form, id) {
    selected = id;
    form.querySelectorAll('[data-survey-panel]').forEach(panel => { panel.hidden = panel.dataset.surveyPanel !== id; });
    form.querySelectorAll('[data-survey-step]').forEach(link => {
      link.setAttribute('aria-pressed', String(link.dataset.surveyStep === id));
    });
    const ids = response.schema.sections.map(section => section.id);
    const index = ids.indexOf(id);
    form.querySelector('[data-survey-back]').hidden = index === 0;
    form.querySelector('[data-survey-next]').hidden = index === ids.length - 1;
  }

  function changed(form) {
    draft = { revision: response.survey?.revision || 0, values: readSurvey(form) };
    form.querySelector('[data-survey-status]').textContent = '有未保存的修改';
    updateProgress(form);
  }

  function showMissing(form, key) {
    const section = response.schema.sections.find(item => item.fields.some(spec => spec[0] === key));
    if (!section) return;
    selectSection(form, section.id);
    form.querySelector(`[data-survey-field="${key}"] input, [data-survey-field="${key}"] textarea`)?.focus();
  }

  async function save(form, completed) {
    if (saving) return;
    const missing = updateProgress(form);
    if (completed && missing.length) {
      showMissing(form, missing[0]);
      toast('请补齐标注「必填」的项目。', 'warn');
      return;
    }
    saving = true;
    const buttons = form.querySelectorAll('[data-survey-save]');
    buttons.forEach(button => { button.disabled = true; });
    form.inert = true;
    try {
      const values = readSurvey(form);
      const revision = response.survey?.revision || 0;
      const saved = await API.post(base + '/qms/survey', { survey: values, completed, revision });
      if (!form.isConnected) return;
      response = saved;
      draft = null;
      form.querySelector('[data-survey-status]').textContent = (completed ? '填写完毕' : '草稿已保存') + ' · ' + dt(saved.survey.updatedAt);
      toast(completed ? '调研已保存，可以生成质量手册。' : '草稿已保存', 'ok');
      if (completed) await global.goPage('qmsManual');
    } catch (error) {
      toast(error.message, 'err', 8000);
    } finally {
      saving = false;
      form.inert = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  Pages.qmsSurvey = {
    title: '体系调研',
    sub: '保存调研后，可生成质量手册、程序文件与作业文件草稿',
    async render() {
      const navigation = global.State.navigation;
      const data = await API.get(base + '/qms/survey');
      if (navigation === global.State.navigation) response = data;
      const { schema, survey } = data;
      const values = draft?.revision === (survey?.revision || 0) ? draft.values : survey || {};
      return `<div class="survey-shell">
        ${header('qmsSurvey', '体系调研', '按模块填写企业资料，保存后供体系文件引用。')}
        <form class="survey-form" id="qmsSurveyForm" novalidate>
          <div class="survey-layout">
            <aside class="survey-side">
              <div class="survey-progress"><span>关键资料</span><strong data-survey-count></strong>
                <progress max="${schema.keyFields.length}" value="0" aria-label="关键资料完成度"></progress>
                <p data-survey-needed></p>
              </div>
              <nav class="survey-steps" aria-label="调研模块">${schema.sections.map(section =>
                `<button type="button" data-survey-step="${section.id}" aria-pressed="false">${section.title}<small></small></button>`).join('')}</nav>
            </aside>
            <div class="survey-main">
              ${schema.sections.map(section => `<section class="survey-panel" data-survey-panel="${section.id}" hidden>
                <h2>${section.title}</h2>
                <div class="survey-fields">${section.fields.map(spec => field(spec, values, data)).join('')}</div>
              </section>`).join('')}
              <div class="survey-footer">
                <div class="survey-navigation">
                  <button type="button" class="btn" data-survey-back>上一组</button>
                  <button type="button" class="btn" data-survey-next>下一组</button>
                </div>
                <span class="survey-status" data-survey-status aria-live="polite">${values === draft?.values ? '有未保存的修改' : survey?.updatedAt ? '上次保存 · ' + esc(dt(survey.updatedAt)) : '尚未保存'}</span>
                <div class="survey-buttons">
                  <button type="button" class="btn" data-survey-save="draft">暂存草稿</button>
                  <button type="button" class="btn btn-primary" data-survey-save="complete">填写完毕，去生成手册</button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>`;
    },
    mount() {
      const form = document.getElementById('qmsSurveyForm');
      selectSection(form, selected);
      updateProgress(form);
      form.addEventListener('input', () => changed(form));
      form.addEventListener('submit', event => event.preventDefault());
      form.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.surveyStep) selectSection(form, button.dataset.surveyStep);
        if (button.hasAttribute('data-survey-back') || button.hasAttribute('data-survey-next')) {
          const ids = response.schema.sections.map(section => section.id);
          const offset = button.hasAttribute('data-survey-back') ? -1 : 1;
          selectSection(form, ids[ids.indexOf(selected) + offset]);
        }
        if (button.hasAttribute('data-use-products')) {
          const products = form.elements.products;
          if (!products.value.trim()) {
            products.value = response.defaults.products.join('、');
            changed(form);
          } else {
            toast('产品栏已有内容，请先清空再带入企业产品。', 'warn');
          }
          products.focus();
        }
        if (button.hasAttribute('data-add-department')) {
          const list = form.querySelector('[data-departments]');
          if (list.childElementCount >= 29) return toast('最多填写 29 个部门', 'warn');
          list.insertAdjacentHTML('beforeend', departmentRow());
          list.lastElementChild.querySelector('input').focus();
        }
        if (button.hasAttribute('data-remove-department')) {
          button.closest('[data-department]').remove();
          changed(form);
        }
        if (button.dataset.surveySave) save(form, button.dataset.surveySave === 'complete');
      });
    },
  };

  function namingRows(values, defaults, kind, label) {
    const field = kind === 'Ws' ? 'ws' : 'pd';
    return values.map((value, index) => `<div class="survey-name-row">
      <label>${label} ${index + 1}${input(field + index, value, { placeholder: defaults[index] || label + '名称' })}</label>
      ${values.length > 1 ? act('移除', 'del' + kind, { i: index }, 'btn btn-sm') : ''}
    </div>`).join('');
  }

  Pages.init = {
    title: '企业设置',
    sub: '统一公司、部门、产品和车间名称',
    async render() {
      const data = await API.get(base + '/naming');
      const naming = global.SetState.initDraft || data.naming;
      const workshopRows = namingRows(naming.workshops, data.defaults.workshops, 'Ws', '车间');
      const productRows = namingRows(naming.products, data.defaults.products, 'Pd', '产品');
      return `<div class="survey-shell">
        ${header('init', '企业设置', '在这里维护企业名称。体系调研、看板和报表沿用已保存的设置。')}
        <section class="survey-panel survey-enterprise">
          <h2>公司与部门</h2>
          <div class="survey-fields">
            <label>公司名称${input('nmCompany', naming.company)}</label>
            <label>归口部门${input('nmDept', naming.dept)}</label>
          </div>
          <div class="survey-enterprise-lists">
            <section><h3>产品</h3>${productRows}${act('增加产品', 'addPd', {}, 'btn btn-sm')}</section>
            <section><h3>车间</h3>${workshopRows}${act('增加车间', 'addWs', {}, 'btn btn-sm')}</section>
          </div>
          <details class="survey-details">
            <summary>根据企业说明整理命名建议</summary>
            <label>补充说明${input('nmNote', naming.note ?? data.note?.text ?? '', { type: 'textarea', rows: 3, placeholder: '例如：一厂负责冲压，二厂负责装配。' })}</label>
            ${act('生成调整建议', 'aiNaming', {}, 'btn')}
          </details>
          <div class="survey-footer">
            <p class="survey-status">改名会更新现有数据。移除产品或车间时保留历史名称。</p>
            <div class="survey-buttons">${act('恢复默认名称', 'resetNaming', {}, 'btn')}${act('保存并应用到数据', 'saveNaming', {}, 'btn btn-primary')}</div>
          </div>
        </section>
        <div class="survey-preferences"><span>本机使用者</span>${act('账号与偏好', 'goto', { page: 'settings' }, 'btn btn-sm')}</div>
      </div>`;
    },
  };
})(window);
