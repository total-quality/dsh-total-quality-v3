'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { setTimeout: sleep } = require('node:timers/promises');
const { Store } = require('../src/lib/store');
const { createLibrary } = require('../src/lib/knowledge-library');
const { createBackups } = require('../src/lib/business-backup');
const office = require('../src/lib/office');

async function waitIndexed(list) {
  for (let i=0; i<100; i++) {
    const rows=await list();
    if (rows.length && rows.every((d)=>d.status==='ready')) return rows;
    await sleep(30);
  }
  throw Error('knowledge library did not finish indexing');
}

test('real signed actors, delegation, effective documents and portable backup round trip', async (t) => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'qip-release-'));
  process.env.QIP_REAL_V3_DATA_DIR=path.join(tmp,'src');
  const host=require('../host.cjs');
  await host.init();
  const server=http.createServer((req,res)=>{req.url=req.url.replace(/^\/qip-real-v3/,'');host.handle(req,res);}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>{host.operations.stop();server.closeAllConnections();server.close();host.store.persist.close();});
  const root='http://127.0.0.1:'+server.address().port+'/qip-real-v3/api/';
  const api=async (endpoint,method='GET',body,cookie,status=200) => {
    const r=await fetch(root+endpoint,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:body?JSON.stringify(body):undefined});
    const data=await r.json();
    assert.equal(r.status,status,endpoint+' '+JSON.stringify(data));
    return { ...data, cookie:r.headers.get('set-cookie')?.split(';')[0] };
  };
  await api('data/clear','POST',{});
  const members=[];
  for (const name of ['主管甲','班组张工','代理李工']) members.push((await api('members','POST',{name,dept:'质量',role:'质量'},null,201)).row);
  const password='test-account-secret-only';
  const manager=(await api('signing/setup','POST',{username:'manager',memberId:members[0].id,password},null,201)).cookie;
  await api('operations','GET',null,null,401);
  await api('signing/login','POST',{username:'manager',password:'wrong'},null,401);
  for (const [i,username] of ['operator','deputy'].entries()) {
    await api('signing/accounts','POST',{username,memberId:members[i+1].id,password,role:'worker'},manager,201);
  }
  const worker=(await api('signing/login','POST',{username:'operator',password},null)).cookie;
  const deputy=(await api('signing/login','POST',{username:'deputy',password},null)).cookie;
  const accounts=await api('signing/accounts','GET',null,manager);
  assert(accounts.accounts.every((a)=>!a.password && !a.passwordHash && !a.salt));
  const deputyId=accounts.accounts.find((a)=>a.username==='deputy').id;
  const grant=(await api('signing/delegations','POST',{accountId:deputyId,until:new Date(Date.now()+86400000).toISOString(),reason:'夜班临时交接'},worker,201)).row;
  const addFile=async (filename,value)=>(await api('library','POST',{filename,base64:Buffer.from(value).toString('base64')},manager,202)).document.id;
  const textA='抽样规则 进料 检验，轴套每批抽 3 件。';
  const revisionA=await addFile('WI-01-A.txt',textA);
  const revisionB=await addFile('WI-01-B.txt','抽样规则 进料 检验，轴套每批抽 5 件。');
  await waitIndexed(async ()=>(await api('library','GET',null,manager)).documents);
  const older=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
  const recent=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const meta={documentNumber:'WI-01',product:'轴套',process:'机加工'};
  const version=(id, revision, effectiveFrom, supersedes='', revisionState='released')=>api('library/'+id+'/version','PUT',{...meta,revision,effectiveFrom,supersedes,revisionState},manager);
  await version(revisionB,'B',recent,revisionA,'draft');
  await version(revisionA,'A',older);
  const hits=async (scope='轴套')=>(await api('library/search?q='+encodeURIComponent('轴套 抽样规则')+'&product='+encodeURIComponent(scope),'GET',null,manager)).excerpts;
  assert.deepEqual([...new Set((await hits()).map((x)=>x.documentId))],[revisionA]);
  assert.equal((await hits('齿轮')).length,0);

  let c=(await api('operations/cases','POST',{title:'轴套外径试点',description:'现场发现尺寸偏差，需核对实际批次和原始检验记录。',owner:members[1].name,product:'轴套',location:'机加工'},worker,201)).row;
  const act=async (action,who,extra={},status=200)=> {
    const res=await api('operations/cases/'+encodeURIComponent(c.id)+'/'+action,'POST',{version:c.version,...extra},who,status);
    if (res.row) c=res.row;
    return res;
  };
  await act('library',manager,{documentIds:[revisionA]});
  await act('approve',worker,{author:'主管甲'},403);
  await act('approve',manager,{author:'伪造名字'});
  assert.equal(c.planRevisions[0].signature.name,'主管甲');
  assert.equal(c.planRevisions[0].libraryRefs[0].id,revisionA);
  await version(revisionB,'B',recent,revisionA);
  assert.deepEqual([...new Set((await hits()).map((x)=>x.documentId))],[revisionB]);
  assert.equal((await api('library/'+revisionA+'/parts/1','GET',null,worker)).excerpt.revision,'A');
  await api('library/'+revisionA,'DELETE',null,manager,409);
  const record='试点复检附件原件';
  const attachment=(await api('operations/cases/'+encodeURIComponent(c.id)+'/files','POST',{
    version:c.version,filename:'proof.txt',base64:Buffer.from(record).toString('base64')
  },worker,201));
  c.version=attachment.version;
  const evidence={ author:'伪造名字',result:'现场完成隔离与复检，按工单阶段记录批次和数量。',
    evidence:'量具复检明细表已完成并核对所有签字和批次标识。',files:[attachment.file.id]};
  await act('submit',deputy,evidence,403);
  await act('submit',deputy,{...evidence,delegationId:grant.id});
  assert.equal(c.submissions[0].signature.name,'代理李工');
  assert.equal(c.submissions[0].signature.actingFor.name,'班组张工');
  await act('return',manager,{note:'请补交实际工序范围与照片'});
  for (let i=0;i<4;i++) {await act('submit',worker,evidence); await act('approve',manager);}
  await act('approve',manager);
  assert.equal(c.status,'closed');
  assert(c.signatures.every((s)=>s.verified));
  const signedAudit=(await api('audit','GET',null,manager)).rows.find((row)=>row.params?.signature?.delegationId===grant.id);
  assert.equal(signedAudit.params.signature.actingFor.name,'班组张工');
  host.store.transaction(()=>host.store.audit({ts:'2020-01-01T00:00:00Z',user:'历史操作人',action:'保留期验证'}));
  await api('audit/retention','PUT',{days:30},manager);
  assert((await api('audit?archive=1','GET',null,manager)).rows.some((row)=>row.action==='保留期验证'));
  const sourceReport=host.store.col('reports').get(c.reportId);
  const reportXml=office.zipReadFile(sourceReport.path)['word/document.xml'].toString();
  assert.match(reportXml,/代理李工/);
  assert.match(reportXml,/WI-01/);
  await api('backups','POST',{},worker,403);
  const portable=await api('backups','POST',{},manager,201);
  const saved=await fetch(root+'backups/'+portable.id,{headers:{cookie:manager}});
  assert.equal(saved.status,200);
  const archive=Buffer.from(await saved.arrayBuffer());

  const dest=new Store();
  await dest.init(path.join(tmp,'new-directory'),{scale:'sme'});
  t.after(()=>dest.persist.close());
  const library=createLibrary(dest);
  const reports=path.join(dest.dir,'reports');
  const managerBackup=createBackups({store:dest,library,reports});
  const preview=await managerBackup.receive(Readable.from([archive]),'local');
  assert.equal(preview.documents,2);
  assert.equal(preview.cases,1);
  assert.equal(dest.col('operationCases').count(),0);
  const save=dest.persist.save;
  dest.persist.save=()=>{throw Error('restore persistence interrupted');};
  assert.throws(()=>managerBackup.restore(preview.id),/interrupted/);
  dest.persist.save=save;
  assert.equal(dest.col('operationCases').count(),0);
  assert.equal(library.list().length,0);
  await sleep(50);
  const restored=managerBackup.restore(preview.id);
  assert.equal(restored.cases,1);
  assert.equal(dest.col('operationCases').get(c.id).signatures[1].actingFor.name,'班组张工');
  assert.equal(fs.readFileSync(path.join(reports,'evidence',attachment.file.storageName),'utf8'),record);
  assert.deepEqual(fs.readFileSync(dest.col('reports').get(c.reportId).path),fs.readFileSync(sourceReport.path));
  assert.equal(fs.readFileSync(library.original(revisionA).file,'utf8'),textA);
  assert.deepEqual([...new Set(library.search('抽样规则').map((x)=>x.documentId))],[revisionB]);
  assert.throws(()=>managerBackup.restore(preview.id),/过期/);
});

test('incremental save leaves historical measurement rows and snapshots alone until needed', async (t) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qip-incremental-'));
  const store=new Store();
  await store.init(dir,{scale:'sme'});
  t.after(()=>{clearTimeout(store._timer);store.persist.close();fs.rmSync(dir,{recursive:true,force:true});});
  const issue=store.col('issues').insert({title:'测试问题',description:'原始备注'});
  const char=store.col('spcChars').insert({name:'厚度',lsl:9,usl:11});
  store.transaction(()=>{
    for (let i=0;i<50000;i++) store.col('measurements').insert({id:'sample-'+i,charId:char.id,value:10,ts:'2026-11-01T00:00:00Z'},true);
  });
  store.snapshot();
  const first=store.persist.query("SELECT rowid FROM records WHERE collection='measurements' AND id='sample-20000'")[0].rowid;
  const start=performance.now();
  store.transaction(()=>store.col('issues').update(issue.id,{description:'更新备注'}));
  const ms=performance.now()-start;
  assert.equal(store.persist.query("SELECT rowid FROM records WHERE collection='measurements' AND id='sample-20000'")[0].rowid,first);
  assert.equal(JSON.parse(fs.readFileSync(store.file,'utf8')).issues[0].description,'原始备注');
  assert.equal(store.persist.load().issues[0].description,'更新备注');
  store.transaction(()=>store.col('spcChars').update(char.id,{usl:12}));
  assert.equal(store.persist.query("SELECT usl FROM measurements WHERE id='sample-20000'")[0].usl,12);
  assert.equal(store.persist.query("SELECT rowid FROM records WHERE collection='measurements' AND id='sample-20000'")[0].rowid,first);
  store.transaction(()=>store.col('measurements').remove('sample-20000'));
  assert.equal(store.persist.query("SELECT id FROM measurements WHERE id='sample-20000'").length,0);
  t.diagnostic('50,000 measurements; single-note transaction ' + ms.toFixed(1) + ' ms');
});
