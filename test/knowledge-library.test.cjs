'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { createLibrary, answer, suggestions } = require('../src/lib/knowledge-library');
const office = require('../src/lib/office');

const makeLibrary = (options) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qip-library-'));
  return createLibrary({ dir, scale: 'sme' }, options);
};
const add = (library, filename, data) => library.upload({ filename, base64: Buffer.from(data).toString('base64') });
async function settled(library, id, check = (row) => ['ready', 'failed'].includes(row.status)) {
  for (let i = 0; i < 120; i++) {
    const row = library.list().find((doc) => doc.id === id);
    if (row && check(row)) return row;
    await wait(25);
  }
  throw Error('Library worker did not settle');
}

test('empty file library, durable intake, duplicate detection, Office parsing, retry and removal', async () => {
  const library = makeLibrary();
  assert.deepEqual(library.list(), []);
  const bytes = office.docxWrite([{ type: 'h1', text: '装配检验规范' }, { type: 'p', text: 'M8 固定螺栓扭矩 24 N·m。' }]);
  const { document } = add(library, '装配.docx', bytes);
  assert.equal(document.status, 'queued');
  assert.deepEqual(library.search('固定螺栓'), []);
  assert.equal(add(library, '重命名.docx', bytes).duplicate, true);
  assert.equal((await settled(library, document.id)).status, 'ready');
  assert.deepEqual(Buffer.from(library.original(document.id).original), bytes);
  assert.equal(library.search('固定螺栓')[0].documentId, document.id);
  library.retry(document.id);
  assert.deepEqual(library.search('螺栓'), []);
  assert.equal((await settled(library, document.id)).status, 'ready');
  const xlsx = office.xlsxWrite([{ name: '复检', rows: [['项目', '规格'], ['外径复检', '12.10 mm']] }]);
  const x = add(library, '复检.xlsx', xlsx).document;
  assert.equal((await settled(library, x.id)).status, 'ready');
  assert.match(library.search('外径复检')[0].label, /复检/);
  library.remove(document.id);
  assert.deepEqual(library.search('固定螺栓'), []);
  assert.throws(() => library.excerpt(document.id, 1), /不存在/);

  const invalid = add(library, '损坏.docx', 'invalid zip').document;
  assert.equal((await settled(library, invalid.id)).status, 'failed');
  library.retry(invalid.id);
  assert.equal((await settled(library, invalid.id)).status, 'failed');
});

test('keyword and vector retrieval fuse and the answer only returns verified references', async () => {
  const library = makeLibrary({ embeddingModel: 'test-embed', embed: async (input) =>
    input.map((text) => /卡死|无法转动|卡滞/.test(text) ? [0, 1] : [1, 0]) });
  const doc1 = add(library, '阀门.docx', office.docxWrite([{ type: 'p', text: '卡滞排查：首先确认转矩是否偏大。' }])).document;
  const doc2 = add(library, '外观.txt', '外观颜色按图号确定。').document;
  await Promise.all([doc1, doc2].map((doc) => settled(library, doc.id, (row) => row.vectorStatus === 'ready')));
  const llm = {
    async complete({ system, user }) {
      if (system.startsWith('将用户')) return { text: '{"query":"无法转动","keywords":""}' };
      assert.equal(JSON.parse(user).excerpts[0].file, '阀门.docx');
      return { text: '{"answer":"应确认转矩是否偏大。[1]","sources":[1]}' };
    },
  };
  const reply = await answer(library, llm, '卡死怎么办？', [], new AbortController().signal);
  assert.equal(reply.sources[0].documentId, doc1.id);
  assert.match(library.excerpt(reply.sources[0].documentId, 1).content, /转矩/);
});

test('profile extraction keeps only allowed fields supported by a real quote', async () => {
  const library = makeLibrary();
  const doc = add(library, '企业简介.txt', '公司名称：春山制造有限公司\n生产车间：冲压车间、装配车间\n主要产品：精密端盖\n质量方针：全程预防、持续改进。').document;
  await settled(library, doc.id);
  const llm = { complete: async () => ({ text: JSON.stringify({ candidates: [
    { field: 'company', value: '春山制造有限公司', source: 1, quote: '公司名称：春山制造有限公司' },
    { field: 'dept', value: '虚构部门', source: 1, quote: '生产车间：冲压车间、装配车间' },
    { field: 'workshops', value: ['冲压车间', '装配车间'], source: 1, quote: '生产车间：冲压车间、装配车间' },
    { field: 'contactPhone', value: '1234567890', source: 1, quote: '公司名称：春山制造有限公司' },
  ] }) }) };
  const values = await suggestions(library, llm, 'naming', doc.id, new AbortController().signal);
  assert.deepEqual(values.map((r) => r.field), ['company', 'workshops']);
  assert(values.every((r) => r.source.documentId === doc.id));
});

test('an interrupted ingest is resumed from the stored original, and citations have nearby context', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qip-library-resume-'));
  const store = { dir, scale: 'sme' };
  const library = createLibrary(store);
  library.list();
  const writer = new DatabaseSync(path.join(dir, 'knowledge-library-sme.db'));
  try {
    const content = '密封圈检验判定仅在蓝色标记时适用。\n' + '这一行是不相关的过程记录。\n'.repeat(75) + '若投料批次更换，应当重新确认。';
    const raw = Buffer.from(content);
    writer.prepare("INSERT INTO documents (id,name,sha,size,createdAt,original,status) VALUES (?,?,?,?,?,?,'processing')").run(
      'pending', '规范.txt', 'fixture', raw.length, '2026-11-18', raw);
  } finally { writer.close(); }
  library.start();
  await settled(library, 'pending');
  const hit = library.search('密封圈检验判定')[0];
  assert(!hit.content.includes('若投料批次更换'));
  assert(library.context(hit).context.includes('若投料批次更换'));
  library.remove('pending');
  assert.deepEqual(library.search('密封圈检验判定'), []);
});

test('a DOCX exceeding the former per-file upload limit can be indexed and downloaded', async () => {
  const library = makeLibrary();
  const parts = office.zipRead(office.docxWrite([{ type: 'p', text: '进料合格标签应保留原批号。' }]));
  parts['word/media/fixture.bin'] = require('node:crypto').randomBytes(9 * 1024 * 1024);
  const bytes = office.zipWrite(Object.entries(parts).map(([name, data]) => ({ name, data })));
  assert(bytes.length > 9 * 1024 * 1024);
  const { document } = library.upload({ filename: '大文件.docx', bytes });
  assert.equal((await settled(library, document.id)).status, 'ready');
  assert.equal(library.search('合格标签')[0].documentId, document.id);
  assert.deepEqual(Buffer.from(library.original(document.id).original), bytes);
});
