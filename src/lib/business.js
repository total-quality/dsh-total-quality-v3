
const QBusiness=(function(){// Shared by the host, frontend and offline V3. No network or automatic business release.
const businessRoutes = {
  incoming: {name:'来料异常',fields:['productCode','lot','purchaseOrder','supplier','supplierLot','standard']},
  production: {name:'生产异常',fields:['productCode','lot','productionOrder','operation','standard']},
  customer: {name:'客户投诉',fields:['productCode','lot','customer','shipment','standard']},
  change: {name:'变更申请',fields:['productCode','operation','changeRequest','standard']},
};
const businessFields = [
 ['productCode','产品 / 物料编码'],['productRevision','图纸 / 产品版本'],['lot','产品批次'],
 ['productionOrder','生产工单'],['purchaseOrder','采购 / 收货单'],['supplier','供应商'],
 ['supplierLot','供应商批次'],['customer','客户'],['shipment','发货单 / 发货批次'],
 ['operation','工序'],['equipment','设备编号'],['fixture','工装 / 刀具编号'],
 ['gauge','量具编号'],['gaugeValidUntil','量具有效期'],['standard','检验标准 / 版本'],['changeRequest','变更申请编号'],
];
const quantityFields = [
 ['totalQty','影响范围总数'],['stockQty','库存数量'],['wipQty','在制数量'],['shippedQty','已发货数量'],
 ['heldQty','已隔离数量'],['checkedQty','已复检数量'],['failedQty','复检不良数'],
 ['returnedQty','已退回数量'],['reworkQty','安排返工数'],['scrapQty','安排报废数'],
];
const changeFields = [['risk','风险分析'],['control','控制计划 / 检验要求'],['instruction','作业指导书'],['training','培训记录']];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function fail(message){const e=new Error(message);e.status=400;throw e;}
function txt(v,label,max=200){if(v==null)return'';if(typeof v!=='string'||v.length>max)fail(label+'应为不超过'+max+'字的文本');return v.trim();}
function number(v,label){if(v==null||v==='')return null;if(!['string','number'].includes(typeof v)||!/^\d+(?:\.\d+)?$/.test(String(v).trim()))fail(label+'应为非负数');const n=Number(v);if(!Number.isSafeInteger(n))fail(label+'应为有效的非负整数');return n;}
function date(v,label){const raw=txt(v,label,10);if(raw){const d=new Date(raw+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==raw)fail(label+'不是有效日期');}return raw;}
function businessDefault(c={}){
 return {route:c.kind==='application'?'change':c.kind==='complaint'?'customer':'production',enforce:false,lot:c.batch||'',operation:c.location||'',productCode:'',customer:c.customer||'',requiredBatches:3,allowedDefectRate:0,verificationLots:[],changes:[]};
}
function normalizeBusiness(input={},c={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('业务关联格式不正确');
 const b={...businessDefault(c)};
 b.route=input.route||b.route;if(!businessRoutes[b.route])fail('请选择有效业务类型');
 if(c.kind==='application'&&b.route!=='change')fail('业务申请应使用变更申请路径');
 if(c.kind==='complaint'&&b.route!=='customer')fail('客户反馈应使用客户投诉路径');
 if(c.kind&&c.kind!=='application'&&b.route==='change')fail('质量问题不能改为变更申请路径');
 if(input.enforce!==undefined&&typeof input.enforce!=='boolean')fail('业务结案核对开关格式不正确');
 b.enforce=input.enforce===true;
 for(const [key,label]of businessFields)b[key]=key==='gaugeValidUntil'?date(input[key],label):txt(input[key]??b[key],label);
 for(const [key,label]of quantityFields)b[key]=number(input[key],label);
 b.baselineChecked=number(input.baselineChecked,'改善前样本数');b.baselineFailed=number(input.baselineFailed,'改善前不良数');
 b.actionDate=date(input.actionDate,'措施实施日期');
 b.requiredBatches=input.requiredBatches==null||input.requiredBatches===''?3:number(input.requiredBatches,'验证批次数');
 if(b.requiredBatches<1||b.requiredBatches>12)fail('验证批次数应为1至12');
 const rate=input.allowedDefectRate??0;b.allowedDefectRate=Number(rate);
 if(!['number','string'].includes(typeof rate)||String(rate).trim()===''||!Number.isFinite(b.allowedDefectRate)||b.allowedDefectRate<0||b.allowedDefectRate>100)fail('允许不良率应为0至100的百分数');
 if(input.verificationLots!==undefined&&!Array.isArray(input.verificationLots))fail('验证批次应为列表');
 if((input.verificationLots||[]).length>12)fail('最多记录12个验证批次');
 b.verificationLots=(input.verificationLots||[]).map((row,i)=>{if(!row||typeof row!=='object')fail('验证批次格式无效');return{batch:txt(row.batch,'验证批次',100),date:date(row.date,'验证日期'),checked:number(row.checked,'验证样本数'),failed:number(row.failed,'验证不良数'),record:txt(row.record,'验证记录编号',200)};}).filter(r=>r.batch||r.date||r.checked!==null||r.failed!==null||r.record);
 if(input.changes!==undefined&&!Array.isArray(input.changes))fail('文件联动应为列表');
 b.changes=changeFields.map(([key,label])=>{const row=(input.changes||[]).find(x=>x?.key===key)||{};const status=row.status||'pending';if(!['pending','done','na'].includes(status))fail(label+'状态不正确');return{key,status,record:txt(row.record,label+'记录 / 不适用理由',400)};});
 b.dispositionRecord=txt(input.dispositionRecord,'处置 / 隔离记录',400);
 const q=assessBusiness(b,c);
 if(q.invalid.length)fail(q.invalid.join('；'));
 return b;
}
function assessBusiness(input,c={}){
 const b=input||businessDefault(c),route=businessRoutes[b.route]||businessRoutes.production;
 const label=Object.fromEntries(businessFields),traceMissing=route.fields.filter(k=>!b[k]).map(k=>label[k]);
 const invalid=[],quantityMissing=[],verificationMissing=[],changeMissing=[],warnings=[];
 const has=n=>typeof b[n]==='number'&&Number.isFinite(b[n]);
 if(b.route!=='change'){
  for(const key of ['totalQty','stockQty','wipQty','shippedQty','heldQty','checkedQty','failedQty'])if(!has(key))quantityMissing.push(Object.fromEntries(quantityFields)[key]);
  if(['totalQty','stockQty','wipQty','shippedQty'].every(has)&&b.totalQty!==b.stockQty+b.wipQty+b.shippedQty)invalid.push('影响总数须等于库存＋在制＋已发货，退回数量单独记录，不重复加总');
  if(has('checkedQty')&&has('failedQty')&&b.failedQty>b.checkedQty)invalid.push('复检不良数不能超过复检数量');
  if(has('checkedQty')&&has('totalQty')&&b.checkedQty>b.totalQty)invalid.push('复检数量不能超过影响范围总数');
  if(has('returnedQty')&&has('shippedQty')&&b.returnedQty>b.shippedQty)invalid.push('退回数量不能超过已发货数量');
  if(['heldQty','stockQty','wipQty'].every(has)&&b.heldQty>b.stockQty+b.wipQty+(b.returnedQty||0))invalid.push('隔离数量不能超过库存、在制与已退回数量合计');
  if(has('failedQty')&&(b.reworkQty||0)+(b.scrapQty||0)>b.failedQty)invalid.push('安排返工与报废数量合计不能超过复检不良数');
  if(!b.dispositionRecord)quantityMissing.push('处置 / 隔离记录编号');
  if((b.shippedQty||0)>(b.returnedQty||0))warnings.push('仍有已发货产品未退回，须核对客户通知、流向与处置记录');
 }
 if(b.gauge&&(!b.gaugeValidUntil||b.gaugeValidUntil<new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})))warnings.push('量具有效期缺失或已到期，测量结果须核查');
 if(!b.actionDate)verificationMissing.push('措施实施日期');
 if(b.route!=='change'&&(!(b.baselineChecked>0)||b.baselineFailed==null))verificationMissing.push('改善前有效样本数与不良数');
 if(b.baselineChecked!=null&&b.baselineFailed!=null&&b.baselineFailed>b.baselineChecked)invalid.push('改善前不良数不能超过样本数');
 const batches=b.verificationLots||[],seen=new Set();let checked=0,failed=0,complete=0;
 for(const r of batches){
  if(r.batch&&seen.has(r.batch))invalid.push('验证批次不能重复：'+r.batch);if(r.batch)seen.add(r.batch);
  if(r.checked!==null&&r.failed!==null&&r.failed>r.checked)invalid.push('验证不良数不能超过样本数');
  if(r.date&&b.actionDate&&r.date<b.actionDate)invalid.push('验证日期不能早于措施实施日期');
  if(r.date&&r.date>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}))invalid.push('实际验证日期不能填写未来日期');
  const full=r.batch&&r.date&&r.record&&r.checked>0&&r.failed!==null;
  if(full){complete++;checked+=r.checked;failed+=r.failed;}
 }
 const required=b.route==='change'?1:(b.requiredBatches||3);
 if(complete<required)verificationMissing.push('需要'+required+'个独立批次的验证记录，当前完整'+complete+'个');
 const rate=checked?failed/checked*100:null;
 if(rate!==null&&rate>(b.allowedDefectRate??0))verificationMissing.push('验证不良率'+rate.toFixed(2)+'%高于设定值'+(b.allowedDefectRate??0)+'%');
 if(!batches.length)warnings.push('暂无结构化验证数据；文字“已完成”不能代替实测记录');
 for(const [key,name]of changeFields){const row=(b.changes||[]).find(r=>r.key===key);if(!row||row.status==='pending'||!row.record)changeMissing.push(name+'的更新记录或不适用理由');}
 const missing=[...traceMissing,...quantityMissing,...verificationMissing,...changeMissing];
 return{route:route.name,traceMissing,quantityMissing,verificationMissing,changeMissing,invalid,warnings,gateReady:missing.length===0&&invalid.length===0,missing,verification:{complete,required,checked,failed,rate},quantityBalanced:!invalid.some(x=>x.includes('影响总数'))&&['totalQty','stockQty','wipQty','shippedQty'].every(has)};
}
function businessSummary(input,c={}){
 const b=input||businessDefault(c),a=assessBusiness(b,c);
 return ['业务路径：'+a.route,...businessFields.filter(([k])=>b[k]).map(([k,label])=>label+'：'+b[k]),...quantityFields.filter(([k])=>b[k]!=null).map(([k,label])=>label+'：'+b[k]),b.dispositionRecord?'处置记录：'+b.dispositionRecord:'',b.actionDate?'措施实施：'+b.actionDate:'',...((b.verificationLots||[]).map(r=>'验证批次 '+r.batch+' / '+r.date+' / '+r.checked+'件、不良'+r.failed+' / '+r.record)),...((b.changes||[]).map(r=>(changeFields.find(x=>x[0]===r.key)?.[1]||r.key)+'：'+r.status+' / '+r.record)),'待核对：'+([...a.missing,...a.invalid].join('；')||'当前结构化核对通过'),...a.warnings].filter(Boolean).join('\n');
}
function demoBusiness(c={}){
 const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),route=c.kind==='application'?'change':c.kind==='complaint'?'customer':'production';
 return normalizeBusiness({route,enforce:true,productCode:'DEMO-P001',productRevision:'B',lot:c.batch||'B-示例01',productionOrder:'DEMO-WO-001',purchaseOrder:'DEMO-PO-001',supplier:'示例供应商A',supplierLot:'DEMO-SL-001',customer:'某主机厂',shipment:'DEMO-SO-001',operation:c.location||'机加工',equipment:'DEMO-MC-01',fixture:'DEMO-JIG-01',gauge:'DEMO-GA-01',gaugeValidUntil:date,standard:'示例检验规范 V-B',changeRequest:'DEMO-EC-001',totalQty:40,stockQty:36,wipQty:4,shippedQty:0,heldQty:40,checkedQty:40,failedQty:1,returnedQty:0,reworkQty:1,scrapQty:0,dispositionRecord:'DEMO-HOLD-001（合成演示记录）',baselineChecked:40,baselineFailed:1,actionDate:date,requiredBatches:3,allowedDefectRate:0,verificationLots:[1,2,3].map(n=>({batch:'DEMO-VERIFY-'+n,date,checked:50,failed:0,record:'DEMO-QC-'+n+'（合成演示）'})),changes:changeFields.map(([key])=>({key,status:'done',record:'DEMO-'+key+'-B（合成演示记录）'}))},c);
}

function projectStageCode(project) {
  return /^D[1-8](?=\s|$)/.exec(project.stageCode || project.stage || '')?.[0] || '';
}
function projectIsClosed(project) {
  if (project.status === 'closed' || project.closedAt) return true;
  return project.status !== 'open' && projectStageCode(project) === 'D8';
}
function activeProjects(projects) {
  return projects.filter((project) => !projectIsClosed(project));
}
function projectProgress(projects) {
  const open = activeProjects(projects);
  const overdue = open.filter((p) => p.overdue).length;
  const onTimeRate = open.length ? ((open.length - overdue) / open.length * 100).toFixed(1) + '%' : '—';
  return { open, overdue, onTimeRate };
}
function taskRequirement(task) {
  return [task.planVersion ? '采用方案版本 ' + task.planVersion : '历史执行要求', task.instruction,
    task.planAction && task.planAction !== task.instruction ? '批准的处理动作：' + task.planAction : '',
    task.verification ? '验证要求：' + task.verification : ''].filter(Boolean).join('\n');
}
function planRevisionText(revision) {
  return [revision.legacy ? '历史版本，按旧记录已保留的执行指令回溯' : '批准人：' + revision.approvedBy + ' · ' + revision.approvedAt,
    '处理动作：' + revision.action, revision.verification ? '验证要求：' + revision.verification : '',
    '责任人：' + revision.owner, '期限：' + revision.due].filter(Boolean).join('\n');
}
return {projectStageCode,projectIsClosed,activeProjects,projectProgress,taskRequirement,planRevisionText,businessRoutes,businessFields,quantityFields,changeFields,businessDefault,normalizeBusiness,assessBusiness,businessSummary,demoBusiness};})();

if (typeof module !== 'undefined' && module.exports) module.exports = QBusiness;
else globalThis.QBusiness = QBusiness;
