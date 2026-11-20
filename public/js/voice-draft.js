(function (global) {
  'use strict';

  const base = '/qip-real-v3/api/voice';
  const rate = 16000;
  const maxSeconds = 45;
  let disposeCurrent;

  function resample(chunks, count, sourceRate, maxSeconds) {
    const source = new Float32Array(count);
    let offset = 0;
    for (const block of chunks) { source.set(block,offset); offset += block.length; }
    const ratio = sourceRate / rate;
    const pcm = new Float32Array(Math.min(Math.floor(count / ratio),rate * maxSeconds));
    for (let i = 0; i < pcm.length; i++) {
      const left = Math.floor(i * ratio);
      const fraction = i * ratio - left;
      pcm[i] = source[left] + (source[Math.min(left+1,source.length-1)] - source[left]) * fraction;
    }
    return pcm;
  }

  function insertAtDraft(input, previous, cursor, text) {
    // Add the transcription without replacing selected text or typing done during recording.
    const index = input.value === previous ? cursor : input.value.length;
    const before = input.value.slice(0,index);
    const after = input.value.slice(index);
    const prefix = before && !/\s$/.test(before) ? ' ' : '';
    const suffix = after && !/^\s|^[，。！？、；：,.!?]/.test(after) ? ' ' : '';
    input.setRangeText(prefix + text + suffix,index,index,'end');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.focus({preventScroll:true});
  }

  function mount() {
    dispose();
    const button = document.getElementById('chatVoice');
    const label = document.getElementById('chatVoiceLabel');
    const status = document.getElementById('chatVoiceStatus');
    const input = document.getElementById('chatInput');
    const cancelButton = document.getElementById('chatVoiceCancel');
    const meter = document.getElementById('chatVoiceMeter');
    if (!button || !input) return;

    let current, tick, closed = false;
    const canRecord = Boolean(global.isSecureContext && navigator.mediaDevices?.getUserMedia && global.AudioContext && global.AudioWorkletNode);
    const ui = (phase, message = '') => {
      button.dataset.phase = phase;
      button.setAttribute('aria-pressed',String(phase === 'recording'));
      button.disabled = ['opening','processing'].includes(phase);
      label.textContent = ({ opening:'开启麦克风', recording:'结束录音', processing:'正在转写' })[phase] || '语音听写';
      cancelButton.hidden = !['opening','recording','processing'].includes(phase);
      meter.hidden = phase !== 'recording';
      status.dataset.phase = phase;
      status.textContent = message;
    };
    function release(capture) {
      if (capture.released) return;
      capture.released = true;
      clearInterval(tick);
      clearTimeout(capture.flushTimeout);
      capture.stream?.getTracks().forEach((track)=>track.stop());
      capture.source?.disconnect();
      capture.node?.disconnect();
      capture.gain?.disconnect();
      capture.node?.port.close();
      if (capture.context?.state !== 'closed') capture.context?.close().catch(() => {});
    }
    function cancel(message = '已取消听写') {
      if (current) {
        const capture = current;
        current = null;
        capture.abort.abort();
        release(capture);
      }
      if (!closed) ui('idle',message);
    }
    async function request(url, options, signal) {
      const r = await fetch(base+url,{ ...options, signal, cache:'no-store' });
      const payload = await r.json().catch(() => null);
      if (r.status === 404) throw Error('当前 Harness 尚未加载语音接口。请重启 Harness Web 后刷新页面。');
      if (!r.ok || !payload?.ok) throw Error(payload?.error || '语音服务暂不可用，请重试。');
      return payload;
    }
    async function start() {
      if (!canRecord) return ui('error','当前页面无法访问麦克风，请使用 localhost 或 HTTPS 下的新版浏览器。');
      const capture = current = {
        abort:new AbortController(), chunks:[], count:0, rms:0,
        draft:input.value, cursor:input.selectionEnd,
      };
      try {
        ui('opening','正在开启麦克风…');
        const stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true }, video:false });
        if (current !== capture) { stream.getTracks().forEach((track)=>track.stop()); return; }
        capture.stream = stream;
        stream.getAudioTracks().forEach((track)=>track.addEventListener('ended',() => {
          if (current === capture && button.dataset.phase === 'recording') cancel('麦克风已断开，请重试。');
        },{once:true}));
        capture.context = new AudioContext();
        await capture.context.audioWorklet.addModule('/qip-real-v3/js/voice-capture-worklet.js');
        if (current !== capture) return;
        await capture.context.resume();
        if (current !== capture) return;
        capture.source = capture.context.createMediaStreamSource(stream);
        capture.node = new AudioWorkletNode(capture.context,'qip-draft-voice',{ channelCount:1, channelCountMode:'explicit' });
        capture.gain = capture.context.createGain();
        capture.gain.gain.value = 0;
        capture.source.connect(capture.node).connect(capture.gain).connect(capture.context.destination);
        capture.node.port.onmessage = ({data}) => onAudio(capture,data);
        capture.started = performance.now();
        ui('recording','正在录音 00:00');
        capture.ready = prepare(capture).catch((error) => {
          if (current === capture && !capture.stopping) {
            cancel('');
            ui('error',error.message);
          }
          return error;
        });
        tick = setInterval(() => {
          const seconds = Math.floor((performance.now() - capture.started)/1000);
          const time = '正在录音 00:' + String(seconds).padStart(2,'0');
          if (status.textContent !== time) status.textContent = time;
          if (seconds >= maxSeconds) stop(capture);
        },250);
      } catch (error) {
        if (current !== capture) return;
        cancel('');
        const hints = { NotAllowedError:'未取得麦克风权限，请在浏览器放行后重试。',
          NotFoundError:'没有找到可用麦克风。', NotReadableError:'麦克风暂不可用，请检查设备或其他录音应用。' };
        ui('error',hints[error.name] || '无法开启录音，请检查麦克风后重试。');
      }
    }
    async function prepare(capture) {
      const signal = capture.abort.signal;
      let state = await request('/prepare',{method:'POST'},signal);
      while (current === capture && state.phase !== 'ready') {
        if (state.phase === 'error') throw Error(state.error || '本地听写暂不可用，请重试。');
        capture.preparing = state.phase === 'downloading'
          ? '已录好，正在下载首次使用所需的中文识别模型。' : '已录好，正在启动本地听写…';
        if (capture.processing) ui('processing',capture.preparing);
        await new Promise((resolve) => setTimeout(resolve,700));
        if (signal.aborted) return;
        state = await request('',{},signal);
      }
      capture.preparing = '';
    }
    function onAudio(capture,data) {
      if (current !== capture) return;
      if (data === 'finished') { void transcribe(capture); return; }
      if (!(data instanceof Float32Array)) return;
      const capacity = capture.context.sampleRate * maxSeconds;
      const available = Math.min(capacity - capture.count,data.length);
      if (available <= 0) return;
      const chunk = data.subarray(0,available);
      capture.chunks.push(chunk);
      capture.count += available;
      let square = 0;
      for (const sample of chunk) square += sample * sample;
      const level = Math.sqrt(square/chunk.length);
      capture.rms = Math.max(level,capture.rms * 0.72);
      meter.style.setProperty('--level',String(Math.min(1,capture.rms * 9)));
    }
    function stop(capture) {
      if (current !== capture || capture.stopping || !capture.node) return;
      capture.stopping = true;
      clearInterval(tick);
      ui('processing',capture.preparing || '正在整理录音…');
      capture.node.port.postMessage('finish');
      capture.flushTimeout = setTimeout(() => transcribe(capture),300);
    }
    async function transcribe(capture) {
      if (current !== capture || capture.processing) return;
      capture.processing = true;
      const sourceRate = capture.context.sampleRate;
      release(capture);
      try {
        const pcm = resample(capture.chunks,capture.count,sourceRate,maxSeconds);
        capture.chunks = [];
        if (pcm.length < rate / 4) throw Error('录音太短，请再说一次。');
        if (capture.preparing) ui('processing',capture.preparing);
        const error = await capture.ready;
        if (current !== capture) return;
        if (error) throw error;
        ui('processing','正在本机转写…');
        const result = await request('/transcribe',{ method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:pcm.buffer },capture.abort.signal);
        if (current !== capture || !input.isConnected) return;
        const text = String(result.text || '').trim();
        if (!text) throw Error('没听清这次录音，请靠近麦克风再试。');
        insertAtDraft(input,capture.draft,capture.cursor,text);
        current = null;
        ui('idle','已填入草稿，可检查后发送。');
      } catch (error) {
        if (current !== capture) return;
        current = null;
        capture.abort.abort();
        ui('error',error.message);
      }
    }
    const pageHide = () => cancel('');
    button.onclick = () => {
      if (button.dataset.phase === 'recording') stop(current);
      else if (!current) void start();
    };
    cancelButton.onclick = () => cancel();
    global.addEventListener('pagehide',pageHide);
    disposeCurrent = () => { closed = true; cancel(''); global.removeEventListener('pagehide',pageHide); };
    ui('idle');
  }

  function dispose() { disposeCurrent?.(); disposeCurrent = null; }
  global.ChatVoice = { mount, dispose };
})(window);
