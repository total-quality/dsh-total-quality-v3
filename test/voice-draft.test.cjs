'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { setTimeout: wait } = require('node:timers/promises');
const { createVoice } = require('../src/lib/voice');

test('dictation waits for verified speech models before accepting audio', async () => {
  const voice = createVoice();
  const audio = Readable.from([Buffer.alloc(16000)]);
  audio.headers = { 'content-type':'application/octet-stream' };
  assert.equal(voice.status().phase,'setup');
  await assert.rejects(voice.transcribe(audio,new AbortController().signal),
    (error) => error.status === 409 && /模型/.test(error.message));
});

test('voice worklet flushes the final partial buffer once and stops collecting', () => {
  let Capture;
  const messages = [];
  const ctx = {
    Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port={ postMessage:(value)=>messages.push(value) }; } },
    registerProcessor(name, processor) { assert.equal(name,'qip-draft-voice'); Capture=processor; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/voice-capture-worklet.js'),'utf8'),ctx);
  const recorder = new Capture();
  recorder.process([[new Float32Array(2304).fill(0.125)]]);
  assert.equal(messages.length,1);
  assert.equal(messages[0].length,2048);
  recorder.port.onmessage({data:'finish'});
  assert.deepEqual(messages.slice(1).map((x)=>x==='finished'?x:x.length),[256,'finished']);
  assert.equal(messages[1][255],0.125);
  recorder.process([[new Float32Array(2304)]]);
  assert.equal(messages.length,3);
});

function browserVoice({ request, openMicrophone }) {
  const elements = Object.fromEntries(['chatVoice','chatVoiceLabel','chatVoiceStatus','chatInput','chatVoiceCancel','chatVoiceMeter']
    .map((id) => [id, { dataset: {}, style: { setProperty() {} }, setAttribute() {} }]));
  const input = elements.chatInput;
  Object.assign(input, { value: '班组：', selectionEnd: 3, isConnected: true,
    setRangeText(text,index) { this.value = this.value.slice(0,index) + text + this.value.slice(index); },
    dispatchEvent() {}, focus() {},
  });
  const afterRecording = { trackStops: 0, node: null };
  const track = { stop() { afterRecording.trackStops++; }, addEventListener() {} };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  class AudioContext {
    sampleRate = 16000;
    audioWorklet = { addModule: async () => {} };
    resume = async () => {};
    close = async () => {};
    createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
    createMediaStreamSource = () => ({ connect: (node) => node, disconnect() {} });
  }
  class AudioWorkletNode {
    constructor() { afterRecording.node = this; }
    connect = (node) => node;
    disconnect() {}
    port = { postMessage: () => this.port.onmessage({ data: 'finished' }), close() {} };
  }
  const window = { isSecureContext: true, AudioContext, AudioWorkletNode, addEventListener() {}, removeEventListener() {} };
  const ctx = {
    window, AudioContext, AudioWorkletNode, AbortController, Float32Array, Event, performance,
    navigator: { mediaDevices: { getUserMedia: () => openMicrophone(stream) } },
    document: { getElementById: (id) => elements[id] },
    fetch: async (url, options) => ({
      ok: true, json: async () => ({ ok: true, ...await request(url, options) }),
    }),
    setTimeout: (callback, ms) => setTimeout(callback, ms === 700 ? 1 : ms),
    clearTimeout, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/voice-draft.js'),'utf8'),ctx);
  window.ChatVoice.mount();
  return { elements, afterRecording, dispose: window.ChatVoice.dispose };
}

async function until(check) {
  for (let n = 0; n < 100 && !check(); n++) await wait(10);
  assert.ok(check(), 'expected dictation state');
}

test('one mic click records on a cold engine and automatically fills the draft after download', async (t) => {
  const calls = [];
  let finishDownload;
  const ready = new Promise((resolve) => { finishDownload = resolve; });
  const { elements, afterRecording, dispose } = browserVoice({
    async openMicrophone(stream) { calls.push('mic'); return stream; },
    async request(url, options) {
      const route = url.split('/api/voice').at(-1);
      calls.push(route);
      if (route === '/prepare') return { phase: 'downloading' };
      if (route === '') { await ready; return { phase: 'ready' }; }
      assert.equal(route, '/transcribe');
      assert.equal(options.body.byteLength, 32000);
      return { text: '已完成首件检查。' };
    },
  });
  t.after(dispose);
  assert.deepEqual(calls, []);
  elements.chatVoice.onclick();
  assert.deepEqual(calls, ['mic']);
  await until(() => elements.chatVoice.dataset.phase === 'recording' && calls.includes('/prepare'));
  afterRecording.node.port.onmessage({ data: new Float32Array(8000) });
  elements.chatVoice.onclick();
  await until(() => elements.chatVoiceStatus.textContent.includes('正在下载'));
  assert.equal(afterRecording.trackStops, 1);
  assert.equal(elements.chatInput.value, '班组：');
  assert.ok(!calls.includes('/transcribe'));
  finishDownload();
  await until(() => elements.chatVoice.dataset.phase === 'idle');
  assert.match(elements.chatInput.value, /已完成首件检查。/);
  assert.equal(calls.filter((x) => x === 'mic').length, 1);
  assert.equal(calls.filter((x) => x === '/transcribe').length, 1);
});

test('denied browser permission shows guidance without preparing the engine', async (t) => {
  let requests = 0;
  const { elements, dispose } = browserVoice({
    async openMicrophone() { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); },
    async request() { requests++; },
  });
  t.after(dispose);
  elements.chatVoice.onclick();
  await until(() => elements.chatVoice.dataset.phase === 'error');
  assert.match(elements.chatVoiceStatus.textContent, /浏览器放行/);
  assert.equal(requests, 0);
});
