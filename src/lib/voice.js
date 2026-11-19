'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const { homedir } = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const https = require('node:https');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const { Worker } = require('node:worker_threads');

const REPO = 'csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30';
const MODEL = {
  'encoder.int8.onnx': '5ac51e27981bb4dab01bb9be4958453ba50c3b61c063ddda0eab23fd3671aa4f',
  'decoder.onnx': '06522ad63cec0fdf6809f4e1db9bb4f7d710c34582e3b35db62ac60eccafac7e',
  'joiner.int8.onnx': 'b34584dc6f561089e1d747fedebb3765f2caa72c927ef54d7ca55e5ae40a814b',
  'tokens.txt': '6193c7ea1c96d0d9a1e9652789b40d13a8a913b434a5451e93158f5a09fd6652',
};
const SOURCES = ['https://huggingface.co', 'https://hf-mirror.com'];
const RATE = 16000;
const MAX_SECONDS = 45;
const LIMIT = RATE * MAX_SECONDS * Float32Array.BYTES_PER_ELEMENT;
const fail = (message, status) => Object.assign(new Error(message), { status });
const supportDir = (app) => process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), app)
  : path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), app);

async function matches(file, wanted) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 180 * 1024 * 1024) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file,{highWaterMark:4 * 1024 * 1024})) hash.update(chunk);
    return hash.digest('hex') === wanted;
  } catch { return false; }
}

async function modelAgent() {
  const proxyEnv = { ...process.env };
  if (process.platform === 'win32' && !proxyEnv.HTTPS_PROXY && !proxyEnv.https_proxy) {
    // Respect the Windows manual proxy for these model downloads without changing Harness networking.
    try {
      const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
      const { stdout } = await promisify(execFile)('reg.exe',['query',key],{windowsHide:true,timeout:3000});
      if (/ProxyEnable\s+REG_DWORD\s+0x1\s/i.test(stdout)) {
        const raw = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(stdout)?.[1]?.trim();
        const proxy = raw?.includes('=') ? /(?:^|;)https=([^;]+)/i.exec(raw)?.[1] : raw;
        if (proxy) {
          const url = new URL(proxy.includes('://') ? proxy : 'http://' + proxy);
          if (['http:','https:'].includes(url.protocol)) proxyEnv.HTTPS_PROXY = url.href;
        }
      }
    } catch { /* Proxy unavailable, use direct HTTPS. */ }
  }
  return new https.Agent({ proxyEnv });
}

async function openModel(url, abort, agent) {
  const allowed = (hostname) => ['huggingface.co','hf.co','hf-mirror.com'].some((name) =>
    hostname === name || hostname.endsWith('.' + name));
  for (let hop = 0; hop < 6; hop++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !allowed(target.hostname)) throw Error('unrecognized model host');
    const response = await new Promise((resolve,reject) => {
      https.get(target,{agent,signal:abort.signal},resolve).once('error',reject);
    });
    if (![301,302,303,307,308].includes(response.statusCode)) return response;
    const next = response.headers.location;
    response.resume();
    if (!next) throw Error('invalid model redirect');
    url = new URL(next, target).href;
  }
  throw Error('too many model redirects');
}

async function downloadModel(file, wanted, dest, onProgress, agent) {
  const work = dest + '.' + randomUUID() + '.part';
  for (const host of SOURCES) {
    const abort = new AbortController();
    let timer;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => abort.abort(), 45000);
      timer.unref();
    };
    try {
      resetTimer();
      const source = await openModel(host + '/' + REPO + '/resolve/main/' + file + '?download=true', abort, agent);
      if (source.statusCode !== 200) {
        source.resume();
        throw Error('model HTTP ' + source.statusCode);
      }
      const total = Number(source.headers['content-length']) || 0;
      const hash = createHash('sha256');
      let received = 0;
      const tap = new Transform({
        transform(chunk, encoding, callback) {
          resetTimer();
          received += chunk.length;
          if (received > 180 * 1024 * 1024) return callback(Error('unexpected model size'));
          hash.update(chunk);
          onProgress({ file, received, total });
          callback(null, chunk);
        },
      });
      await pipeline(source, tap, createWriteStream(work, { flags:'wx' }), { signal:abort.signal });
      if (hash.digest('hex') !== wanted) throw Error('model checksum mismatch');
      await fs.rename(work,dest);
      return;
    } catch {
      await fs.rm(work, { force:true }).catch(() => {});
    } finally { clearTimeout(timer); abort.abort(); }
  }
  throw fail('本地听写模型下载失败。请检查到 Hugging Face 或镜像站的连接，再点听写重试。', 503);
}

function createVoice({ directory = path.join(supportDir('dsh-total-quality-v3'),'models','zipformer-zh-2025-06-30') } = {}) {
  const upstream = path.join(supportDir('dsh-voice-mode'), 'models', ...REPO.split('/'));
  let task, modelDir, worker, idleTimer, nextId = 0, receiving = 0;
  const pending = new Map();
  let state = { phase:'setup' };

  async function verify(dir) {
    for (const [file, wanted] of Object.entries(MODEL)) if (!await matches(path.join(dir,file),wanted)) return false;
    return true;
  }

  function prepare() {
    if (state.phase === 'ready' || task) return;
    state = { phase:'checking' };
    task = (async () => {
      try {
        require.resolve('sherpa-onnx-node');
        if (!modelDir && await verify(directory)) modelDir = directory;
        if (!modelDir && await verify(upstream)) modelDir = upstream;
        if (!modelDir) {
          await fs.mkdir(directory, { recursive:true });
          const agent = await modelAgent();
          try {
            for (const [file, digest] of Object.entries(MODEL)) {
              const dest = path.join(directory,file);
              if (await matches(dest,digest)) continue;
              state = { phase:'downloading', file, received:0, total:0 };
              await downloadModel(file,digest,dest,(progress) => { state = { phase:'downloading', ...progress }; },agent);
            }
          } finally { agent.destroy(); }
          modelDir = directory;
        }
        state = { phase:'warming' };
        await processAudio(getWorker(), null, new AbortController().signal);
        state = { phase:'ready' };
      } catch (error) {
        state = { phase:'error', error: error.status ? error.message :
          '本地语音识别组件暂不可用。请检查插件安装或本机磁盘空间。' };
        console.warn('[quality-voice] preparation:', error.code || error.message);
      }
    })().finally(() => { task = null; });
  }

  function discard(instance, error) {
    if (worker !== instance) return;
    worker = null;
    if (state.phase === 'ready') state = { phase:'setup' };
    clearTimeout(idleTimer);
    for (const row of pending.values()) row.finish(error);
    void instance.terminate();
  }

  function getWorker() {
    clearTimeout(idleTimer);
    if (worker) return worker;
    const instance = new Worker(path.join(__dirname, 'voice-worker.js'), { workerData:{ modelDir, rate:RATE } });
    worker = instance;
    instance.on('error', () => discard(instance, fail('本地识别引擎启动失败，请重试。', 502)));
    instance.on('exit', () => discard(instance, fail('本地识别进程已退出，请重试。', 502)));
    instance.on('message', ({ id, text, error }) => {
      if (worker !== instance) return;
      pending.get(id)?.finish(error ? fail('本地识别本段录音失败，请重试。', 502) : null, text);
    });
    instance.unref();
    return instance;
  }

  async function transcribe(req, signal) {
    if (state.phase !== 'ready') throw fail('请先准备本地语音模型。', 409);
    if (req.headers['content-type'] !== 'application/octet-stream') throw fail('音频格式不正确。', 415);
    const declared = Number(req.headers['content-length']);
    if (declared > LIMIT) { req.resume(); throw fail('单次听写最多 45 秒。', 413); }
    if (pending.size + receiving >= 2) { req.resume(); throw fail('本地识别正在处理其他录音，请稍后重试。', 429); }
    const chunks = [];
    let size = 0;
    receiving++;
    try {
      for await (const chunk of req.iterator({ destroyOnReturn:false })) {
        size += chunk.length;
        if (size > LIMIT) { req.resume(); throw fail('单次听写最多 45 秒。', 413); }
        chunks.push(chunk);
      }
    } finally { receiving--; }
    signal.throwIfAborted();
    if (size < RATE || size % Float32Array.BYTES_PER_ELEMENT) throw fail('录音太短，请再说一次。', 400);
    if (pending.size >= 2) throw fail('本地识别正在处理其他录音，请稍后重试。', 429);
    const raw = Buffer.concat(chunks,size);
    const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    return processAudio(getWorker(),bytes,signal);
  }

  function processAudio(instance,bytes,signal) {
    instance.ref();
    const id = ++nextId;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => discard(instance, fail(bytes ? '本地转写超时，请说短一点再试。' : '本地识别引擎启动超时，请重试。', 504)), 60000);
      timer.unref();
      const cancel = () => {
        // Keep the slot occupied until the worker finishes this utterance.
        reject(signal.reason);
      };
      const finish = (error,text) => {
        signal.removeEventListener('abort',cancel);
        clearTimeout(timer);
        pending.delete(id);
        if (!pending.size && worker === instance) {
          instance.unref();
          idleTimer = setTimeout(() => discard(instance), 5 * 60000);
          idleTimer.unref();
        }
        if (error) reject(error);
        else resolve({ text });
      };
      pending.set(id,{finish});
      signal.addEventListener('abort',cancel,{once:true});
      try { instance.postMessage({ id, bytes }, bytes ? [bytes] : []); }
      catch (error) { finish(error); }
    });
  }

  return { prepare, status:() => ({ ...state, maxSeconds:MAX_SECONDS }), transcribe };
}

module.exports = { createVoice };
