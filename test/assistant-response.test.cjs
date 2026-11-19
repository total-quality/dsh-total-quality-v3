'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { once } = require('node:events');
const { createBridge } = require('../llm-bridge.cjs');

test('workbench distinguishes clarification, valid calls, and incomplete model replies', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-assistant-'));
  process.env.QIP_REAL_V3_DATA_DIR = dir;
  const host = require('../host.cjs');
  const agent = require('../agent-host.cjs');
  await host.init();
  const server = http.createServer(host.handle).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    host.operations.stop();
    server.closeAllConnections();
    server.close();
    host.store.persist.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const chat = async (text, scope = 'tools', sessionId = 'assistant-test') => {
    const res = await fetch(base + '/api/chat/stream', {
      method: 'POST', body: JSON.stringify({ text, scope, sessionId, history: [{ role: 'user', content: '分析晨报' }] }),
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 200);
    const lines = (await res.text()).split('\n').filter((line) => line.startsWith('data: '));
    assert.equal(lines.pop(), 'data: [DONE]');
    return lines.map((line) => JSON.parse(line.slice(6)));
  };
  let toolCalls = 0;
  agent.registry.define({
    name: 'assistant_test_read', label: '测试数据', run: () => {
      toolCalls++;
      return { ok: true, batch: 'XZ01', readings: 37 };
    },
  });
  const attempts = [];
  let replies = [];
  agent.setRuntime({ llm: { async complete(opts) {
    attempts.push(opts);
    assert.ok(replies.length, 'unexpected model call');
    const reply = replies.shift();
    return typeof reply === 'string' ? { text: reply } : reply;
  } } });
  for (const scope of ['tools', 'library']) {
    const events = await chat(' ？ ？！ ', scope);
    assert.deepEqual(events.map((e) => e.type), ['connected', 'content', 'done', 'finish']);
    assert.equal(events[2].clarification, true);
    assert.match(events[2].content, scope === 'tools' ? /工作单编号/ : /文件名/);
  }
  assert.equal(attempts.length, 0);
  assert.equal(toolCalls, 0);

  const call = '{"tool":"assistant_test_read","args":{}}';
  const full = '## 批次 XZ01\n\n| 样本 | 数量 |\n|---|---|\n| 测量点 | 37 |\n\n**验证**\n核对 XZ01 的原始测量记录。';
  replies = [call, { text: '{"thought":"内部调度","final":"## 批次 XZ01', finishReason: 'max-tokens' }, full];
  const events = await chat('列出 XZ01 测量数并给出验证方式');
  const done = events.find((e) => e.type === 'done');
  assert.equal(done.content, full);
  assert.equal(done.incomplete, false);
  assert.equal(toolCalls, 1);
  assert.equal(attempts.at(-1).reasoning, false);
  assert.match(attempts.at(-1).user, /"readings":37/);
  assert.doesNotMatch(JSON.stringify(events), /内部调度|"type":"reasoning"/);

  const duplicate = call + '\n\n' + call;
  replies = [duplicate, duplicate, '{"thought":"内部调度","final":"中断'];
  const fallback = await chat('检查指定批次');
  assert.equal(toolCalls, 1);
  assert.equal(fallback.find((e) => e.type === 'done').incomplete, true);
  assert.match(fallback.find((e) => e.type === 'content').text, /未能生成完整回答/);
  assert.doesNotMatch(JSON.stringify(fallback), /内部调度|assistant_test_read/);

  host.store.col('chats').insert({ id: 'old', messages: [
    { role: 'user', content: '查询批次' },
    { role: 'assistant', content: '{"thought":"旧内部内容","final":"保留正常结论"}' },
    { role: 'assistant', content: '{"thought":"旧内部内容","final":"曾经被截断' },
  ] });
  const { row } = await (await fetch(base + '/api/chats/old')).json();
  assert.equal(row.messages[1].content, '保留正常结论');
  assert.equal(row.messages[2].incomplete, true);
  assert.doesNotMatch(JSON.stringify(row), /旧内部内容/);
  const voice = await (await fetch(base + '/api/voice')).json();
  assert.equal(voice.ok, true);
});

test('bridge forwards Harness max-tokens stop reason', async () => {
  const llm = { prepareCall: async () => ({
    config: {}, async *stream() {
      yield { type: 'text-delta', text: '未写完' };
      yield { type: 'finish', reason: { kind: 'max-tokens' } };
    },
  }) };
  const bridge = createBridge({ get: (id) => id === 'llm' ? llm : null });
  assert.equal((await bridge.complete({ user: '测试' })).finishReason, 'max-tokens');
});

test('browser chat rejects early EOF and decodes long replies split over chunks', async () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/js/api.js'), 'utf8');
  const read = async (input, handler) => {
    const bytes = new TextEncoder().encode(input);
    const window = {};
    const fetch = async () => new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 31) controller.enqueue(bytes.slice(i, i + 31));
      controller.close();
    } }));
    vm.runInNewContext(script, { window, fetch, TextDecoder });
    return window.API.chat({}, handler);
  };
  const event = { type: 'done', content: '测量结果已核实。'.repeat(800) + '\n\n**结尾已显示。**' };
  const body = 'data: ' + JSON.stringify(event) + '\r\n\r\n';
  const events = [];
  await read(body + 'data: [DONE]\r\n\r\n', (value) => events.push(value));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, event.type);
  assert.equal(events[0].content, event.content);
  await assert.rejects(read(body, () => {}), /提前结束/);
});

test('workbench renders the full reply without reasoning or tool details', () => {
  const window = {};
  const UI = { esc: String, md: String };
  const script = fs.readFileSync(path.join(__dirname, '../public/js/pages-core.js'), 'utf8');
  vm.runInNewContext(script, { window, UI });
  const view = window.renderMsgFn({
    role: 'assistant',
    content: '正文'.repeat(3500) + '\n结尾已显示。',
    thinking: '内部推理',
    trace: [{ label: '内部工具调用', ok: true }],
  }, 0);
  assert.match(view, /结尾已显示。/);
  assert.doesNotMatch(view, /内部推理|内部工具调用|插件调用链|一键立项/);
});
