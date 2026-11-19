(function (g) {
  'use strict';
  const { esc, dt, modal, closeModal, toast } = g.UI;
  const prefix = '/qip-real-v3/api';
  const signing = prefix + '/signing';
  const backups = prefix + '/backups';
  const state = {};
  const btn = (action, label, key = '', primary = false) => `<button type="button" class="btn ${primary ? 'btn-primary' : ''}" data-rollout="${action}" data-key="${esc(key)}">${esc(label)}</button>`;
  const field = (name, label, type='text', value='') => `<label class="op-field">${esc(label)}<input class="inp" required type="${type}" name="${name}" value="${esc(value)}"></label>`;
  const select = (name, label, choices) => `<label class="op-field">${esc(label)}<select class="inp" name="${name}" required>${choices.map(([id, title])=>`<option value="${esc(id)}">${esc(title)}</option>`).join('')}</select></label>`;
  function prompt(title, body, action, { container, after, label='保存' }={}) {
    const formHtml = `<form class="op-form">${body}<p class="op-error full" role="alert"></p><button class="btn btn-primary" type="submit">${label}</button></form>`;
    const form = container ? (container.innerHTML = `<section class="card" style="max-width:440px;margin:5vh auto;padding:24px"><h2>${esc(title)}</h2>${formHtml}</section>`, container.querySelector('form')) :
      modal({title,body:formHtml}).querySelector('form');
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        const result = await action(Object.fromEntries(new FormData(form)));
        if (!container) closeModal();
        if (after) await after(result);
      } catch (error) { form.querySelector('[role=alert]').textContent=error.message; }
      finally { button.disabled=false; }
    };
  }
  const load = async () => Object.assign(state, await API.get(signing));
  const roles = {manager:'质量主管',worker:'班组执行人'};
  const canManage = () => !state.configured || state.actor?.role === 'manager';
  const delegateField = () => state.availableDelegations?.length ?
    `<label class="op-field full">签核身份<select class="inp" data-signing-delegation><option value="">本人 ${esc(state.actor.name)}</option>${state.availableDelegations.map((d)=>`<option value="${esc(d.id)}">代 ${esc(d.name)}（至 ${esc(dt(d.until))}）</option>`).join('')}</select></label>` : '';
  const canSubmit = (task) => {
    if (!state.configured) return true;
    const owns = (person) => task.ownerMemberId ? person?.memberId===task.ownerMemberId : person?.name===task.owner;
    return owns(state.actor) || state.availableDelegations.some(owns);
  };
  const signingData = () => {
    const delegationId=document.querySelector('.dm-panel [data-signing-delegation]')?.value;
    return delegationId ? {delegationId} : {};
  };
  function login(container) {
    prompt('员工账号登录', field('username','员工账号') + field('password','密码','password'),
      (values)=>API.post(signing+'/login',values), {container, after:()=>g.location.reload(),label:'登录'});
  }
  async function boot() {
    await load();
    if (state.configured && !state.actor) {
      login(document.getElementById('content'));
      return false;
    }
    return true;
  }
  function cards() {
    const signingInfo = !state.configured ? '启用后，工作单的提交和批准会关联具体员工。' :
      '当前签核人 ' + (state.actor?.name || '') + ' · ' + roles[state.actor?.role];
    const signingButtons = !state.configured ?
      (state.setupAllowed ? btn('setup','启用员工签核','',true) : '') :
      [canManage()?btn('account','新增员工账号')+btn('resetPassword','重设员工密码'):'',btn('changePassword','修改密码'),btn('delegations','签核代理'),btn('logout','退出登录')].join('');
    const wrap = (title,text,buttons) => `<section class="card"><div class="card-hd"><span class="t">${title}</span></div><div style="padding:14px"><p>${esc(text)}</p><div class="op-actions">${buttons}</div></div></section>`;
    return wrap('员工签核',signingInfo,signingButtons) + (canManage() ? wrap('业务备份与审计归档',
      '业务备份包含工作单、测量、附件、报告和知识库原件。员工密码和模型密钥保留在各自的本机配置中。',
      btn('backup','创建并下载备份','',true)+btn('restore','从备份还原')+btn('archive','审计与归档')) : '');
  }
  const whoFields = (members) => select('memberId','对应员工',members.map(({id,name})=>[id,name])) +
    field('username','登录账号') + field('password','密码（至少 12 字符）','password');
  function download(id) {
    const a = document.createElement('a');
    a.href = backups + '/' + encodeURIComponent(id);
    a.download = '';
    a.click();
  }
  const actions = {
    async setup() {
      await load();
      if (!state.members.length) throw Error('请先在员工成长中心建立团队成员');
      prompt('启用员工签核',whoFields(state.members),(v)=>API.post(signing+'/setup',v),{after:()=>g.location.reload(),label:'启用并登录'});
    },
    async account() {
      await load();
      const {accounts}=await API.get(signing+'/accounts');
      const free=state.members.filter((m)=>!accounts.some((a)=>a.memberId===m.id));
      if (!free.length) throw Error('请先新增待绑定的团队成员');
      prompt('新增员工账号',whoFields(free)+select('role','签核角色',Object.entries(roles)),
        (v)=>API.post(signing+'/accounts',v),{after:()=>toast('员工账号已登记','ok')});
    },
    async changePassword() {
      prompt('修改我的密码',field('currentPassword','当前密码','password')+field('password','新密码（至少 12 字符）','password'),
        (v)=>API.put(signing+'/accounts/'+encodeURIComponent(state.actor.id)+'/password',v),{after:()=>g.location.reload()});
    },
    async resetPassword() {
      const {accounts}=await API.get(signing+'/accounts');
      const others=accounts.filter((a)=>a.id!==state.actor.id);
      if (!others.length) throw Error('当前只有您的账号，可使用修改密码');
      prompt('重设员工密码',select('id','员工账号',others.map((a)=>[a.id,a.name+' · '+a.username]))+field('password','新密码（至少 12 字符）','password'),
        (v)=>API.put(signing+'/accounts/'+encodeURIComponent(v.id)+'/password',{password:v.password}),
        {after:()=>toast('密码已重设，员工需重新登录','ok')});
    },
    async logout() { await API.post(signing+'/logout'); g.location.reload(); },
    async delegations() {
      await load();
      const existing=state.ownDelegations.filter((d)=>!d.revokedAt && Date.parse(d.until)>Date.now());
      const list=existing.map((d)=>`<p>代理人 ${esc(d.name)} · 至 ${esc(dt(d.until))} ${btn('revokeDelegate','撤销代理',d.id)}</p>`).join('');
      if (!state.peers.length) return modal({title:'签核代理',body:list+'<p>请先建立同角色的员工账号，再授权代理。</p>'});
      const until = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
      prompt('签核代理', list + select('accountId','代理人',state.peers.map((a)=>[a.id,a.name])) +
        field('until','代理截止日','date',until) + field('reason','代理原因'),
        (v)=>API.post(signing+'/delegations',{...v,until:new Date(v.until+'T23:59:59').toISOString()}),
        {after:async()=>{await load();toast('签核代理权限已保存','ok');}});
    },
    async revokeDelegate(id) {
      await API.del(signing+'/delegations/'+encodeURIComponent(id));
      await actions.delegations();
    },
    async backup() {
      const record = await API.post(backups);
      download(record.id);
      toast('业务备份已创建','ok');
    },
    async restore() {
      const input=document.createElement('input');
      input.type='file'; input.accept='.qipbackup';
      input.onchange=async()=> {
        const file=input.files[0]; if (!file) return;
        toast('正在上传并校验业务备份…','ok');
        try {
          const r=await fetch(backups+'/restore/prepare',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
          const preview=await r.json();
          if (!r.ok) throw Error(preview.error);
          prompt('核对并还原业务备份',
            `<p class="full">备份时间 ${esc(dt(preview.createdAt))} · ${preview.cases} 条工作单 · ${preview.measurements} 条测量 · ${preview.documents} 份资料</p>` +
            '<p class="full">还原会替换当前业务数据。执行前将自动保存一份当前数据备份。</p>' +
            field('confirm','输入「还原」完成确认') + btn('cancelRestore','取消还原',preview.id),
            (v)=>API.post(backups+'/restore/'+encodeURIComponent(preview.id),v),{label:'确认还原',after:(result)=>{
              modal({title:'业务备份已还原',body:'<p>可打开还原后的工作单、附件、报告和知识库。</p>',
                footer:btn('download', '下载还原前备份', result.previousBackupId) + btn('reload','刷新查看','',true)});
            }});
        } catch (error) { toast(error.message,'err',8000); }
      };
      input.click();
    },
    async cancelRestore(id) { await API.del(backups+'/restore/'+encodeURIComponent(id)); closeModal(); },
    download, reload:()=>g.location.reload(),
    async archive(scope) {
      const [tab, index]=String(scope || 'recent').split(':');
      const archive=tab==='archive',offset=Number(index) || 0;
      const data=await API.get(prefix+'/audit',{archive:archive?'1':'0',limit:50,offset});
      const list='<div class="full">'+btn('archive',archive?'查看近期':'查看归档',archive?'recent':'archive')+
        `<p> ${archive?'归档记录':'近期记录'} · 共 ${data.total} 条</p>`+
        data.rows.map((r)=>`<div class="op-event"><div><p>${esc(r.action)}</p><small>${esc(dt(r.ts))} · ${esc(r.user)}</small></div></div>`).join('') +
        (offset>0?btn('archive','上一页',tab+':'+(offset-50)):'') + (offset+50<data.total?btn('archive','下一页',tab+':'+(offset+50)):'') + '</div>';
      prompt('审计与归档',field('days','近期审计保留天数（到期转入归档）','number',data.retentionDays)+list,
        (v)=>API.put(prefix+'/audit/retention',{days:Number(v.days)}),
        {after:(r)=>toast('保留期已保存，已归档 '+r.archived+' 条','ok')});
    },
  };
  document.addEventListener('click',async(event)=>{
    const button=event.target.closest('[data-rollout]');
    const handler=actions[button?.dataset.rollout];
    if (!handler) return;
    event.preventDefault();
    button.disabled=true;
    try { await handler(button.dataset.key); } catch(error) { toast(error.message,'err',8000); }
    finally { button.disabled=false; }
  });
  g.Signing = { state, load, boot, cards, canManage, canSubmit, delegateField, signingData };
})(window);
