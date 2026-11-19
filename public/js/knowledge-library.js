(function (global) {
  'use strict';
  const { esc, act, dt, modal, closeModal, toast } = UI;
  const base = '/qip-real-v3/api/library';
  const size = (bytes) => bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB';
  const download = (id) => base + '/' + encodeURIComponent(id) + '/download';
  const status = { queued: '等待解析', processing: '正在解析', ready: '可检索', failed: '解析失败' };

  function sourceButton(ref, text) {
    return act(text || '[' + ref.number + '] ' + ref.name + ' · ' + ref.label, 'librarySource', { id: ref.documentId, part: ref.part }, 'btn btn-sm library-cite');
  }

  async function showSource({ id, part }) {
    const { excerpt } = await API.get(base + '/' + encodeURIComponent(id) + '/parts/' + Number(part));
    modal({
      title: excerpt.name, sub: excerpt.label + ' · 片段 ' + excerpt.part,
      body: '<pre class="library-excerpt">' + esc(excerpt.context || excerpt.content) + '</pre>',
      footer: '<a class="btn" href="' + download(id) + '">下载原文件</a>',
    });
  }

  function table(documents) {
    if (!documents.length) return '<div class="library-empty"><strong>文件库还是空的</strong><p>从企业简介、产品目录、质量手册或作业指导书开始，就能在 AI 工作助手按原文问答。</p></div>';
    return `<div class="op-table-wrap"><table class="op-table"><thead><tr><th>文件</th><th>状态</th><th>片段</th><th>操作</th></tr></thead><tbody>${documents.map((doc) =>
      `<tr><td><strong>${esc(doc.name)}</strong><small>${esc(size(doc.size))} · ${esc(dt(doc.createdAt))}</small></td>
        <td><span class="library-status" data-state="${esc(doc.status)}">${esc(status[doc.status] || doc.status)}</span>
        ${doc.error ? '<small>' + esc(doc.error) + '</small>' : ''}
        ${doc.vectorStatus === 'ready' ? '<small>关键词和向量</small>' : doc.vectorStatus === 'failed' ? '<small>向量化失败，可继续关键词检索</small>' : ''}</td>
        <td>${doc.chunkCount}</td><td><div class="op-actions">
          <a class="btn btn-sm" href="${download(doc.id)}">下载</a>
          ${doc.status === 'failed' || doc.status === 'ready' ? act('重新索引', 'libraryRetry', { id: doc.id }, 'btn btn-sm') : ''}
          ${act('移除', 'libraryDelete', { id: doc.id, name: doc.name }, 'btn btn-sm')}
        </div></td></tr>`).join('')}</tbody></table></div>`;
  }

  async function uploadFile(file) {
    const query = new URLSearchParams({ filename: file.name });
    const response = await fetch(base + '?' + query, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw Error(result?.error || '上传失败（HTTP ' + response.status + '）');
    return result;
  }

  global.Pages.library = {
    title: '知识库文件', sub: '上传企业资料，检索原文，按来源引用',
    async render() {
      const data = await API.get(base);
      return `<section class="library-hero"><div><span>企业资料</span><h1>知识库文件</h1><p>质量手册、产品目录、作业规范随用随传。入库后可在 AI 工作助手按原文提问。</p></div><div class="op-actions">
        <label class="btn btn-primary library-upload">上传文件<input id="libraryUpload" type="file" multiple accept="${esc(data.formats.join(','))}"></label>
        ${act('在助手里查', 'libraryChat', {}, 'btn')}
      </div></section>
      <div id="libraryNotice" class="library-notice" role="status"></div>
      <div class="library-layout"><section class="card"><div class="card-hd"><span class="t">已上传文件</span><span class="s" id="libraryCount">${data.documents.length} 个</span></div><div id="libraryDocuments">${table(data.documents)}</div></section>
      <aside class="card"><div class="card-hd"><span class="t">检索原文</span></div>
        <form id="librarySearch" class="library-search"><label>文件名、产品、工序或关键词<input class="inp" name="query" required maxlength="500" placeholder="例如：进料检验抽样规则"></label><button class="btn" type="submit">检索</button></form>
        <div id="libraryHits"></div>
        <p class="library-tip">支持 TXT、Markdown、CSV、DOCX、XLSX${data.formats.includes('.pdf') ? '、有文字层的 PDF' : ''}。文件库总容量为 100 MB。原文件与索引保存在本机。使用问答或资料提取时，相关片段会发送到 Harness 当前配置的模型。</p>
        <p class="library-tip">${data.embeddingEnabled ? '已配置本机向量索引，问答会同时使用向量和关键词召回。' : '关键词索引已启用，助手会通过模型改写问题和重排片段。'}</p>
        ${act('查看经验卡', 'goto', { page: 'knowledge' }, 'btn btn-sm')}
      </aside></div>`;
    },
    mount() {
      const input = document.getElementById('libraryUpload');
      const documents = document.getElementById('libraryDocuments');
      const listCount = document.getElementById('libraryCount');
      const notices = document.getElementById('libraryNotice');
      const form = document.getElementById('librarySearch');
      let polling = 0;
      let uploading = false;
      async function refresh() {
        clearTimeout(polling);
        if (!documents.isConnected) return;
        const { documents: rows, embeddingEnabled } = await API.get(base);
        if (!documents.isConnected) return;
        documents.innerHTML = table(rows);
        listCount.textContent = rows.length + ' 个';
        if (rows.some((row) => ['queued', 'processing'].includes(row.status) || (embeddingEnabled && row.vectorStatus === 'queued'))) {
          polling = setTimeout(() => refresh().catch((error) => { notices.textContent = error.message; }), 850);
        }
      }
      input.addEventListener('change', async () => {
        if (uploading) return;
        const files = [...input.files];
        if (!files.length) return;
        uploading = true;
        const messages = [];
        input.disabled = true;
        try {
          for (const file of files) {
            if (!documents.isConnected) break;
            notices.textContent = '正在上传 ' + file.name + '…';
            try {
              const result = await uploadFile(file);
              messages.push(file.name + (result.duplicate ? '：内容已入库，未重复添加' : '：已接收'));
            } catch (error) { messages.push(file.name + '：' + error.message); }
          }
          notices.textContent = messages.join('\n');
          await refresh();
        } catch (error) { notices.textContent = error.message; }
        finally { input.value = ''; input.disabled = false; uploading = false; }
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const hits = document.getElementById('libraryHits');
        const q = form.elements.query.value.trim();
        if (!q) return;
        const button = form.querySelector('button');
        button.disabled = true;
        hits.textContent = '检索中…';
        try {
          const { excerpts } = await API.get(base + '/search', { q });
          hits.innerHTML = excerpts.length ? excerpts.map((ref) => `<article class="library-hit">${sourceButton(ref, ref.name + ' · ' + ref.label)}
            <p>${esc(ref.content.slice(0, 220))}${ref.content.length > 220 ? '…' : ''}</p></article>`).join('') : '<p class="library-tip">没有找到匹配片段。</p>';
        } catch (error) { hits.textContent = error.message; }
        finally { button.disabled = false; }
      });
      document.addEventListener('qip-library-changed', () => refresh().catch((error) => { notices.textContent = error.message; }), { signal: watchPage(documents) });
      refresh().catch((error) => { notices.textContent = error.message; });
    },
  };

  function watchPage(node) {
    const ctrl = new AbortController();
    const observer = new MutationObserver(() => {
      if (node.isConnected) return;
      observer.disconnect();
      ctrl.abort();
    });
    observer.observe(document.getElementById('content'), { childList: true });
    return ctrl.signal;
  }
  const changed = () => document.dispatchEvent(new Event('qip-library-changed'));

  async function remove({ id, name }) {
    const box = modal({ title: '移除知识库文件', body: '<p>移除「' + esc(name) + '」及其索引。历史回答会保留文字，引用将无法打开。</p>',
      footer: '<button class="btn btn-primary" type="button" data-delete-file>确认移除</button>' });
    box.querySelector('[data-delete-file]').onclick = async (event) => {
      event.target.disabled = true;
      try {
        await API.del(base + '/' + encodeURIComponent(id));
        if (box.isConnected) closeModal();
        changed();
        toast('文件及索引已移除', 'ok');
      } catch (error) { toast(error.message, 'err'); event.target.disabled = false; }
    };
  }
  async function retry({ id }) {
    await API.post(base + '/' + encodeURIComponent(id) + '/retry');
    changed();
    toast('已加入解析队列', 'ok');
  }

  const display = (v) => Array.isArray(v) ? v.join('、') : String(v ?? '');
  const equal = (a, b) => display(a).trim() === display(b).trim();
  async function openSuggestions(target, opts) {
    const { documents } = await API.get(base);
    if (!opts.isCurrent()) return;
    const ready = documents.filter((row) => row.status === 'ready');
    if (!ready.length) {
      modal({
        title: '从知识库带入',
        body: '<p>现在还没有可检索的文件。先上传企业简介、公司手册或产品目录，等索引完成后再回来提取。</p>',
        footer: act('去上传文件', 'goto', { page: 'library' }, 'btn btn-primary'),
      });
      return;
    }
    const box = modal({
      title: target === 'naming' ? '从资料提取企业设置' : '从资料提取体系调研',
      sub: '只把选中的候选值填进表单，核对后再保存。已有非默认值需要手动勾选。',
      body: `<form class="library-suggest-search"><label>检索范围<select class="inp" name="documentId"><option value="">全部已索引文件</option>${ready.map((d) =>
        '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>').join('')}</select></label><button type="submit" class="btn btn-primary">提取候选值</button></form>
        <div class="library-suggest-result" aria-live="polite"></div>`,
      footer: '<button type="button" class="btn btn-primary" data-use-suggestions disabled>填入选中的字段</button>',
    });
    const form = box.querySelector('form');
    const results = box.querySelector('.library-suggest-result');
    const apply = box.querySelector('[data-use-suggestions]');
    let candidates = [];
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      apply.disabled = true;
      const button = form.querySelector('button');
      button.disabled = true;
      results.textContent = '正在检索原文并提取明确写出的字段…';
      try {
        const { candidates: values } = await API.post(base + '/suggestions', { target, documentId: form.elements.documentId.value });
        if (!box.isConnected || !opts.isCurrent()) return;
        const current = opts.read();
        candidates = values.filter((row) => (target !== 'survey' || row.field !== 'company') && !equal(current[row.field], row.value));
        results.innerHTML = candidates.length ? candidates.map((row, i) => {
          const original = display(current[row.field]);
          const checked = !original.trim() || equal(original, opts.defaults?.[row.field]);
          return `<div class="library-suggestion"><label><input type="checkbox" data-index="${i}" ${checked ? 'checked' : ''}>
            <strong>${esc(row.label)}</strong></label>
            <div><span>当前</span><p>${esc(original || '未填写')}</p></div><div><span>候选</span><p>${esc(display(row.value))}</p></div>
            <details><summary>${esc(row.source.name)} · ${esc(row.source.label)} · 片段 ${row.source.part}</summary><blockquote>${esc(row.quote)}</blockquote></details></div>`;
        }).join('') : '<p class="library-tip">没有找到有明确出处且与当前表单不同的字段。</p>';
        apply.disabled = !results.querySelector('input:checked');
      } catch (error) { results.textContent = error.message; }
      finally { button.disabled = false; }
    });
    results.addEventListener('change', () => { apply.disabled = !results.querySelector('input:checked'); });
    apply.addEventListener('click', () => {
      if (!opts.isCurrent()) return;
      const picked = [...results.querySelectorAll('input:checked')].map((input) => candidates[Number(input.dataset.index)]);
      if (!picked.length) return;
      closeModal();
      opts.apply(Object.fromEntries(picked.map(({ field, value }) => [field, value])));
      toast('已填入 ' + picked.length + ' 个字段，请核对后保存', 'ok');
    });
  }

  global.QipLibrary = { sourceButton, showSource, remove, retry, openSuggestions };
})(window);
