'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const office = require('../src/lib/office');
const { Store } = require('../src/lib/store');

test('business modules persist actual inputs and keep approval and todo states connected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'total-quality-audit-'));
  process.env.QIP_REAL_V3_DATA_DIR = dir;
  const host = require('../host.cjs');
  await host.init();
  const server = http.createServer((req, res) => {
    req.url = req.url.replace(/^\/qip-real-v3\//, '/');
    host.handle(req, res);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = 'http://127.0.0.1:' + server.address().port + '/qip-real-v3';
  const api = async (url, method = 'GET', payload, status = 200) => {
    const response = await fetch(root + '/api/' + url, { method,
      headers:payload == null ? {} : {'Content-Type':'application/json'},
      body:payload == null ? undefined : JSON.stringify(payload) });
    const body = await response.json();
    assert.equal(response.status, status, url + ': ' + JSON.stringify(body));
    if (status < 400) assert.equal(body.ok, true, url + ': ' + JSON.stringify(body));
    return body;
  };
  const tool = async (name, args) => (await api('tools/' + name,'POST',args)).result;
  const importCsv = (target, text) => api('import', 'POST', {
    target, filename:target+'.csv', base64:Buffer.from(text).toString('base64'),
  });
  const download = async (url) => {
    const response = await fetch(new URL(url, root));
    assert.equal(response.status,200);
    return Buffer.from(await response.arrayBuffer());
  };
  try {
    await api('data/clear','POST',{});
    assert.equal((await api('bootstrap')).hasSampleData,false);
    const {row:member} = await api('members','POST',{name:'测试班长',dept:'机加工',role:'工艺',seniority:5},201);
    assert.equal((await api('members/'+member.id,'PUT',{phone:'0000-0000-0000'})).row.name, member.name);
    await api('members/'+member.id+'/growth','POST',{stage:'30 天',summary:'完成首件复检并登记量具编号',reviewer:'质量老师'},201);

    const q = (await tool('qrqc_create',{topic:'装配复检',problem:'定位偏差件需要隔离',tempAction:'复测定位销',owner:member.name,dueHours:18})).QRQC编号;
    let row = (await api('qrqc/'+q)).row;
    assert.equal(row.responseAt,null);
    assert.equal(row.tasks.length,1);
    await api('qrqc/'+q+'/decision','POST',{action:'respond',author:member.name,note:'现场已停用该夹具'});
    const payload = {id:q,items:[{problem:'定位偏差',tempAction:'复测定位销',owner:member.name,dueHours:18}]};
    assert.equal((await tool('qrqc_minutes',payload)).生成任务数,0);
    assert.equal((await tool('qrqc_minutes',{...payload,items:[{...payload.items[0],tempAction:'更新点检单'}]})).生成任务数,1);
    await api('qrqc/'+q+'/decision','POST',{action:'close',author:member.name,note:'现场复核通过'},400);
    const {rows:tasks} = await api('todos?link='+encodeURIComponent(q));
    assert.equal(tasks.length,2);
    for (const task of tasks) await api('todos/'+task.id,'PUT',{done:true});
    assert((await api('qrqc/'+q)).row.tasks.every((task) => task.done));
    row = (await api('qrqc/'+q+'/decision','POST',{action:'close',author:member.name,note:'点检与复测均有原始记录'})).row;
    assert.equal(row.status,'closed');

    const w = (await tool('oa_start_workflow',{type:'临时措施审批',title:'核对隔离方案',approvers:['审批甲','审批乙']})).审批单号;
    const approvalTodo = (await api('todos?link='+encodeURIComponent(w))).rows[0];
    await api('todos/'+approvalTodo.id,'PUT',{done:true},409);
    assert.equal((await api('workflows/'+w+'/decision','POST',{action:'approve',author:'审批甲',note:'已核对现场记录'})).row.status,'pending');
    assert.equal((await api('workflows/'+w+'/decision','POST',{action:'approve',author:'审批乙',note:'已核对隔离清单'})).row.status,'approved');
    assert((await api('todos?link='+encodeURIComponent(w))).rows.every((todo)=>todo.done));

    assert.equal((await tool('erp_material_cost',{})).物料.length,0);
    assert.equal((await importCsv('materials','编码,物料名称,单价,单位,供应商\nM-01,端盖,12.5,元/件,实际供应商')).imported,1);
    assert.equal((await importCsv('bom','产品,零件,编码,层级,用量\nS-01,端盖,M-01,1,2')).imported,1);
    assert.equal((await tool('erp_material_cost',{material:'M-01'})).物料[0].单价,12.5);
    assert.equal((await tool('erp_bom',{model:'不存在'})).条目数,0);
    assert.equal((await tool('erp_bom',{model:'S-01'})).BOM[0].数量,2);
    const values = [10,10.04,9.98,10.03,10.05,9.97,10.21,10.02,10.01,9.98];
    const measured = '特性编号,特性名称,测量值,规格下限,规格上限,批次,工位,产品,供应商,操作者,班次,VIN,子组\n'
      + values.map((v,i)=>['CT-REAL','端盖外径',v,9.9,10.1,'B-01','线体1','S-01','实际供应商','测量员','一班','WVWZZZ1JZXW000001',Math.floor(i/2)].join(',')).join('\n');
    assert.equal((await importCsv('measurements',measured)).imported,10);
    assert.equal((await tool('mes_trace_by_vin',{vin:'WVWZZZ1JZXW000001'})).测量记录[0].操作者,'测量员');
    assert.equal((await tool('erp_batch_trace',{batch:'B-01'})).明细[0].供应商,'实际供应商');
    const spc = await api('spc/detail?charId=CT-REAL');
    assert.equal(spc.capability.ok,true);
    assert.equal((await tool('mes_scrap_summary',{})).合计.超差事件数,1);
    assert.equal((await importCsv('defects','缺陷类型,产品,批次,检出时间,置信度\n外径标签错误,S-01,B-01,2026-11-18,0.98')).imported,1);
    assert((await api('defects')).rows[0].ts);
    const calc = await tool('fin_benefit_calc',{baselineRate:0.08,targetRate:0.03,annualVolume:2000,unitLoss:50});
    assert.equal(calc.结果.年化收益元,5000);
    const b = (await tool('fin_submit_benefit',{amount:0.5,formula:calc.测算过程})).收益单号;
    await api('benefits/'+b,'PUT',{status:'verified'},409);
    const verified = (await api('benefits/'+b+'/decision','POST',{action:'verify',author:'财务测试',note:'实际发票及停线工单已核验',amount:0.42})).row;
    assert.equal(verified.amount,0.42);
    assert.equal(verified.submittedAmount,0.5);
    const rejected = (await tool('fin_submit_benefit',{amount:5})).收益单号;
    await api('benefits/'+rejected+'/decision','POST',{action:'reject',author:'财务测试',note:'同一收益已重复申报'});
    const ledger = await tool('fin_benefit_ledger',{});
    assert.equal(ledger.合计万元,0.42);
    assert.equal(ledger.已驳回笔数,1);

    const {row:knowledge} = await api('knowledge','POST',{title:'换型点检',type:'经验卡',problem:'蓝色夹具过紧'});
    assert.equal((await tool('kb_search',{query:'蓝色夹具过紧'})).结果[0].编号,knowledge.id);
    await api('knowledge/'+encodeURIComponent(knowledge.id),'PUT',{problem:'绿色量具卡滞'});
    assert.equal((await tool('kb_search',{query:'绿色量具卡滞'})).结果[0].编号,knowledge.id);

    const {row:project} = await api('projects','POST',{title:'端盖改进',description:'实际项目',model:'S-01',workshop:'机加工',stage:'D4',d4:'以量具重复性记录为依据'});
    const report = await tool('report_generate',{type:'8D报告',projectId:project.id});
    const xml = office.zipRead(await download(report.下载链接))['word/document.xml'].toString();
    assert.match(xml,/端盖改进/);
    assert.match(xml,/量具重复性记录/);
    const workbook = office.xlsxRead(await download((await tool('data_export',{dataset:'measurements',charId:'CT-REAL'})).下载链接));
    assert(workbook.sheets[0].rows[0].includes('规格下限'));
    assert(workbook.sheets[0].rows.some((r)=>r.includes('实际供应商')));
    const week = await tool('report_generate',{type:'质量周报'});
    assert.match(office.zipRead(await download(week.下载链接))['word/document.xml'].toString(),/10 个在线测量点/);
    await new Promise((resolve) => setTimeout(resolve,200));
    const reopened = new Store();
    await reopened.init(dir,{scale:'sme'});
    assert.equal(reopened.col('members').get(member.id).growth[0].stage,'30 天');
    assert.equal(reopened.col('qrqc').get(q).closureNote,'点检与复测均有原始记录');
    assert.equal(reopened.col('workflows').get(w).approvers[1].status,'approved');
    assert.equal(reopened.col('benefits').get(b).verifiedBy,'财务测试');
  } finally {
    host.operations.stop();
    server.closeAllConnections();
    server.close();
  }
});

test('engineering calculations use explicit data and honor requested DOE and schedule definitions', async () => {
  const registry = require('../host.cjs').registry;
  const run = (name, args) => registry.get(name).run(args);
  assert.equal(run('quality_cost_calc',{}).ok,false);
  const costs = run('quality_cost_calc',{prevention:0,appraisal:3,internalFailure:9,externalFailure:2,salesRevenue:200});
  assert.equal(costs.构成万元.合计,14);
  assert.equal(costs.不良质量成本万元,11);
  assert.equal(costs.质量成本率,'7.00%');

  const tasks = [{name:'A',duration:3},{name:'B',duration:1},{name:'C',duration:2,deps:['A','B']}];
  const gantt = run('gantt_plan',{tasks,startDate:'2026-11-18'});
  assert.equal(gantt.计划完成,'2026-11-22');
  assert.deepEqual(gantt.甘特表.map((row) => [row.关键路径,row.总时差天]), [[true,0],[false,2],[true,0]]);
  assert.match(run('gantt_plan',{tasks:[{name:'A',deps:['B']},{name:'B',deps:['A']}]}).error,/循环依赖/);

  const factors = Array.from({length:11},(_, index) => ({name:'因子 '+index}));
  assert.equal(run('doe_design',{factors:factors.slice(0,5),design:'full',replicates:1}).基础运行次数,32);
  assert.equal(run('doe_design',{factors:factors.slice(0,5),design:'frac',replicates:1}).基础运行次数,16);
  for (const [k, n] of [[7,8],[11,12]]) {
    const design = run('doe_design',{factors:factors.slice(0,k),design:'pb',replicates:1});
    assert.equal(design.总试验次数,n);
    const codes = design.试验矩阵.map((row) => row._code.split(',').map(Number));
    for (let i=0; i<k; i++) {
      assert.equal(codes.reduce((sum,row) => sum+row[i],0),0);
      for (let j=0; j<i; j++) assert.equal(codes.reduce((sum,row) => sum+row[i]*row[j],0),0);
    }
  }
  assert.equal(run('fmea_analyze',{items:[{failureMode:'卡滞',s:10,o:2,d:4}]}).明细[0].AP,'待核对');
  assert.equal(run('fmea_analyze',{items:[{failureMode:'卡滞',s:10,o:2,d:4,ap:'H'}]}).明细[0].RPN,80);
  const filter = registry.assistantFilter({plugins:{mes:{name:'@MES 制造执行',enabled:false}}});
  assert.equal(filter(registry.get('mes_query_measurements')),false);
  assert.equal(filter(registry.get('spc_capability')),true);
});
