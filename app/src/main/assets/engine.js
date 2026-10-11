(function(root) {
  'use strict';
  const day = d => Date.parse(d+'T00:00:00Z') / 86400000;
  const validDate = d => typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(day(d)) && new Date(day(d)*86400000).toISOString().slice(0,10)===d;
  function cents(value) {
    if(!/^-?\d+(\.\d{1,2})?$/.test(String(value))) throw Error('金额最多保留两位小数');
    const n = Math.round(Number(value)*100);
    if(!Number.isSafeInteger(n)||Math.abs(n)>1e14) throw Error('金额超出范围');
    return n;
  }
  const expenseCategories=['餐饮','居住','交通','购物','水电通讯','医疗','教育','娱乐','人情','保险','其他'];
  const expenseNatures={fixed:'固定支出',variable:'日常可变',occasional:'偶发支出'};
  function blank() { return {version:1,assets:[],transactions:[],plans:[],executions:[],expenseTemplates:[]}; }
  function expenseSummary(state,month) {
    const expenses=state.transactions.filter(t=>t.type==='expense'&&!t.linked&&t.date.slice(0,7)===month);
    const categories={},natures={fixed:0,variable:0,occasional:0,unclassified:0};
    for(const t of expenses) {const category=t.category||'未分类';categories[category]=(categories[category]||0)+t.amount;natures[t.nature||'unclassified']+=t.amount;}
    return {total:expenses.reduce((n,t)=>n+t.amount,0),categories,natures};
  }
  function suggestExpense(source,note) {
    const aliases={吃饭:'餐饮',出行:'交通',学习:'教育',玩:'娱乐',礼物:'人情',日常:'其他',吃:'餐饮',餐饮:'餐饮',交通:'交通',购物:'购物',居住:'居住',娱乐:'娱乐',人情:'人情',医疗:'医疗',教育:'教育',保险:'保险',水电通讯:'水电通讯'};
    let category=aliases[source]||'其他',nature='variable';
    if(!aliases[source]||['日常','居住','其他','投资'].includes(source)) {
      if(/房租|租金|月租/.test(note)) {category='居住';nature='fixed';}
      else if(/骑自行车|打车|地铁|公交/.test(note))category='交通';
      else if(/早餐|午餐|晚餐|吃饭/.test(note))category='餐饮';
      else if(/水费|电费|话费|网费/.test(note))category='水电通讯';
      else if(/ChatGPT|GPT|服务器|域名|云服务/i.test(note)) {category='教育';nature='fixed';}
      else if(/衣服|鞋|裤|沐浴露|牙线|手机|耳机|电脑|买东西/.test(note))category='购物';
      else if(/医院|看病|药费|挂号/.test(note))category='医疗';
      else if(/机票|动车|高铁|改签|火车/.test(note))category='交通';
      else if(/电影|冲浪|游戏/.test(note))category='娱乐';
      else if(/会员|订阅/.test(note)) {category='娱乐';nature='fixed';}
    }
    if(source==='礼物')nature='occasional';
    return {category,nature};
  }
  function parseLedgerText(text,at) {
    if(typeof text!=='string'||text.length>150000)throw Error('账单文字最多 15 万字');
    if(!validDate(at))throw Error('当前日期无效');
    const lines=text.replace(/^\uFEFF/,'').replace(/^(\s*)[“"']/,'$1').replace(/[”"'](\s*)$/,'$1').split(/\r?\n/);
    if(lines.length>1000)throw Error('每次最多导入 1000 行，请分批处理');
    const rows=[],errors=[];
    lines.forEach((raw,i)=>{
      const line=raw.trim().replace(/^[-*•]\s*/, '');if(!line)return;
      try {
        const m=line.match(/^(\d{4}-\d{2}-\d{2})\s+(收入|支出)([^\s]*)\s+(\S+)\s+(.+?)\s+(\d+(?:\.\d{1,2})?)(?:\s*元)?$/u);
        if(!m)throw Error('格式应为：日期 收入/支出 分类 备注 金额（最多两位小数）');
        const clean=v=>v.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0e\ufe0f]/gu,'');
        if(clean(m[3]))throw Error('收入/支出后只支持表情标记');
        if(!validDate(m[1])||m[1]>at)throw Error('日期无效或晚于今天');
        const amount=cents(m[6]);if(amount<=0)throw Error('金额需大于 0');
        const sourceCategory=clean(m[4]),note=m[5].trim();
        if(!sourceCategory||sourceCategory.length>40||!note||note.length>100)throw Error('分类最多 40 字，备注需为 1–100 字');
        const row={line:i+1,date:m[1],type:m[2]==='收入'?'income':'expense',sourceCategory,note,amount};
        if(row.type==='expense')Object.assign(row,suggestExpense(sourceCategory,note));
        rows.push(row);
      }catch(e){errors.push({line:i+1,message:e.message});}
    });
    if(!rows.length&&!errors.length)errors.push({line:1,message:'请粘贴至少一笔账单'});
    return {rows,errors};
  }
  const ledgerKey=t=>JSON.stringify([t.asset,t.date,t.type,t.amount,t.note.trim().replace(/\s+/g,' ')]);
  function ledgerImportPreview(state,rows,at) {
    const existing=new Set(state.transactions.filter(t=>['income','expense'].includes(t.type)&&!t.linked).map(ledgerKey)),seen=new Set();
    return rows.map(row=>{
      const a=state.assets.find(a=>a.id===row.asset);let error='';
      if(row.asset!==null&&(!a||a.kind!=='cash'))error='请选择现金账户';
      else if(!validDate(row.date)||row.date>at)error='日期无效或晚于今天';
      else if(a&&row.date<a.snapshots.map(v=>v.date).sort()[0])error='早于该账户初始盘点，请更换账户或登记历史账户';
      else if(!['income','expense'].includes(row.type)||!Number.isSafeInteger(row.amount)||row.amount<=0||row.amount>1e14||typeof row.note!=='string'||!row.note.trim()||row.note.length>100)error='收支或金额、备注无效';
      else if(row.type==='expense'&&(!expenseCategories.includes(row.category)||!Object.hasOwn(expenseNatures,row.nature)))error='请核对支出分类';
      const key=!error?ledgerKey(row):null,duplicate=!!key&&(existing.has(key)||seen.has(key));
      if(key)seen.add(key);
      return {...row,error,duplicate};
    });
  }
  function importLedger(state,rows,at,makeId) {
    if(!Array.isArray(rows)||!rows.length||rows.length>1000||!validDate(at))throw Error('请选择 1–1000 笔有效账单');
    const preview=ledgerImportPreview(state,rows,at),bad=preview.find(r=>r.error);if(bad)throw Error('第 '+bad.line+' 行：'+bad.error);
    const next=JSON.parse(JSON.stringify(state));
    for(const r of preview) {
      const t={id:makeId(),type:r.type,asset:r.asset,to:null,date:r.date,amount:r.amount,note:r.note,sourceCategory:r.sourceCategory};
      if(r.type==='expense'){t.category=r.category;t.nature=r.nature;}
      next.transactions.push(t);
      next.assets.find(a=>a.id===t.asset)?.snapshots.filter(v=>v.date>=t.date).forEach(v=>v.confirmed=false);
    }
    return validate(next);
  }
  function flow(t,id) {
    if(t.type==='transfer') return (t.to===id?t.amount:0)-(t.asset===id?t.amount:0);
    return t.asset===id ? (t.type==='income'||t.type==='deposit'?t.amount:-t.amount):0;
  }
  function balance(state,a,at) {
    const snaps = a.snapshots.filter(s=>s.date<=at).sort((x,y)=>x.date.localeCompare(y.date));
    const last = snaps.at(-1);
    if(!last) return 0;
    if(a.kind==='item') return last.value;
    return last.value+state.transactions.filter(t=>(t.date>last.date||(last.opening&&t.date===last.date))&&t.date<=at).reduce((sum,t)=>sum+flow(t,a.id),0);
  }
  function xirr(cash) {
    if(cash.length<2||!cash.some(c=>c.value<0)||!cash.some(c=>c.value>0)) return null;
    const first=Math.min(...cash.map(c=>day(c.date)));
    if(Math.max(...cash.map(c=>day(c.date)))===first) return null;
    // Search in log-rate space; never silently select one root if multiple exist.
    const f = y=>cash.reduce((sum,c)=>sum+c.value*Math.exp(-y*(day(c.date)-first)/365),0);
    const roots=[];
    let lo=-16, fl=f(lo);
    for(let hi=-15.9;hi<=16.0001;hi+=0.1) {
      const fh=f(hi);
      if(Number.isFinite(fl)&&Number.isFinite(fh)&&(fl===0||fl*fh<0)) {
        let l=lo,h=hi;
        for(let n=0;n<80;n++) { const mid=(l+h)/2; if(f(l)*f(mid)<=0) h=mid; else l=mid; }
        const y=(l+h)/2;
        if(!roots.some(r=>Math.abs(r-y)<1e-5)) roots.push(y);
      }
      lo=hi;fl=fh;
    }
    return roots.length===1 ? Math.expm1(roots[0]):null;
  }
  function performance(state,a) {
    if(a.kind!=='investment') return null;
    const snaps=[...a.snapshots].sort((x,y)=>x.date.localeCompare(y.date));
    if(snaps.length<2) return null;
    const first=snaps[0],last=snaps.at(-1);
    const ts=state.transactions.filter(t=>(t.date>first.date||(first.opening&&t.date===first.date))&&t.date<=last.date&&flow(t,a.id)!==0);
    const net=ts.reduce((n,t)=>n+flow(t,a.id),0);
    const gain=last.value-first.value-net;
    const days=day(last.date)-day(first.date);
    const complete=snaps.slice(1).every(s=>s.confirmed===true);
    const cash=[{date:first.date,value:-first.value},...ts.map(t=>({date:t.date,value:-flow(t,a.id)})),{date:last.date,value:last.value}];
    return {gain,days,complete,rate:complete&&ts.length===0&&first.value>0?last.value/first.value-1:null,annual:complete?xirr(cash):null,first,last};
  }
  function occurrences(plan,until) {
    const end=plan.end&&plan.end<until?plan.end:until;
    const out=[]; if(!validDate(plan.start)||plan.start>end) return out;
    let date=plan.start;
    const initial=new Date(plan.start+'T00:00:00Z');
    for(let i=0;i<50000&&date<=end;i++) {
      out.push(date);
      if(plan.frequency==='monthly') {
        const m=initial.getUTCMonth()+i+1;
        const d=new Date(Date.UTC(initial.getUTCFullYear(),m,1));
        const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
        d.setUTCDate(Math.min(initial.getUTCDate(),max));date=d.toISOString().slice(0,10);
      } else date=new Date((day(date)+(plan.frequency==='weekly'?7:1))*86400000).toISOString().slice(0,10);
    }
    if(date<=end) throw Error('定投日期跨度过大，请缩短记录区间');
    return out;
  }
  function planStats(state,plan,today) {
    const dates=occurrences(plan,today);
    const executions=dates.map(date=>state.executions.find(e=>e.plan===plan.id&&e.date===date)).filter(Boolean);
    const done=executions.filter(e=>e.status==='confirmed');
    return {due:dates.length,done:done.length,expected:dates.length*plan.amount,actual:done.reduce((n,e)=>n+e.amount,0),pending:dates.filter(d=>!executions.some(e=>e.date===d&&e.status==='confirmed'))};
  }
  function validate(s) {
    const fail=()=>{throw Error('备份格式或数据关联无效');};
    const money=n=>Number.isSafeInteger(n)&&Math.abs(n)<=1e14;
    if(!s||s.version!==1||!['assets','transactions','plans','executions'].every(k=>Array.isArray(s[k])&&s[k].length<=20000)) fail();
    const ids=new Set();
    for(const a of s.assets) {
      if(typeof a.id!=='string'||ids.has(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>100||!['cash','investment','item','debt'].includes(a.kind)||typeof a.place!=='string'||typeof a.risk!=='string'||!Array.isArray(a.snapshots)||a.snapshots.length<1) fail();
      ids.add(a.id);const dates=new Set();
      for(const v of a.snapshots) {if(!validDate(v.date)||!money(v.value)||v.value<0||dates.has(v.date)||typeof v.confirmed!=='boolean') fail();dates.add(v.date);}
      if(a.cost!==undefined&&(!money(a.cost)||a.cost<0)) fail();
    }
    const tids=new Set();
    for(const t of s.transactions) {
      if(typeof t.id!=='string'||tids.has(t.id)||!(ids.has(t.asset)||t.asset===null&&['income','expense'].includes(t.type)&&!t.linked&&!t.to)||!validDate(t.date)||!money(t.amount)||t.amount<=0||typeof t.note!=='string'||!['income','expense','transfer','deposit','withdraw'].includes(t.type)) fail();
      const a=s.assets.find(a=>a.id===t.asset);
      if(a&&(['item','debt'].includes(a.kind)||t.date<a.snapshots.map(v=>v.date).sort()[0])) fail();
      if(t.category!==undefined&&(t.type!=='expense'||t.linked||!expenseCategories.includes(t.category))) fail();
      if(t.nature!==undefined&&(t.type!=='expense'||t.linked||!Object.hasOwn(expenseNatures,t.nature))) fail();
      if(t.sourceCategory!==undefined&&(!['income','expense'].includes(t.type)||t.linked||typeof t.sourceCategory!=='string'||!t.sourceCategory.trim()||t.sourceCategory.length>40)) fail();
      if(t.type==='transfer') {const to=s.assets.find(a=>a.id===t.to);if(!to||to.id===a.id||['item','debt'].includes(to.kind)||t.date<to.snapshots.map(v=>v.date).sort()[0]) fail();}
      tids.add(t.id);
    }
    if(s.expenseTemplates!==undefined) {
      if(!Array.isArray(s.expenseTemplates)||s.expenseTemplates.length>2000) fail();
      const templateIds=new Set();
      for(const t of s.expenseTemplates) {
        if(typeof t.id!=='string'||!t.id||templateIds.has(t.id)||typeof t.name!=='string'||!t.name.trim()||t.name.length>100||!money(t.amount)||t.amount<=0||!expenseCategories.includes(t.category)||!Object.hasOwn(expenseNatures,t.nature)||!['none','monthly','yearly'].includes(t.frequency)||!(t.asset===null||ids.has(t.asset)&&s.assets.find(a=>a.id===t.asset).kind==='cash')) fail();
        templateIds.add(t.id);
      }
    }
    const pids=new Set();
    for(const p of s.plans) {
      if(typeof p.id!=='string'||pids.has(p.id)||!ids.has(p.asset)||s.assets.find(a=>a.id===p.asset).kind!=='investment'||!money(p.amount)||p.amount<=0||!validDate(p.start)||!['monthly','weekly','daily'].includes(p.frequency)||(p.end&&(!validDate(p.end)||p.end<p.start))||typeof p.name!=='string'||!p.name.trim()) fail();
      pids.add(p.id);
    }
    const es=new Set();
    for(const e of s.executions) {
      const key=e.plan+e.date;
      if(es.has(key)||!pids.has(e.plan)||!validDate(e.date)||!['confirmed','failed','skipped'].includes(e.status)||!money(e.amount)||e.amount<0) fail();
      const p=s.plans.find(p=>p.id===e.plan);
      if(!occurrences(p,e.date).includes(e.date)) fail();
      if(e.status==='confirmed') {
        const t=s.transactions.find(t=>t.id===e.transaction);if(!t||t.date!==e.actualDate||t.amount!==e.amount||t.asset!==p.asset||t.type!=='deposit') fail();
        if(e.sourceTransaction) {const source=s.transactions.find(t=>t.id===e.sourceTransaction);if(!source||source.linked!==t.id||source.type!=='expense'||source.amount!==t.amount||source.date!==t.date||s.assets.find(a=>a.id===source.asset).kind!=='cash') fail();}
      }
      es.add(key);
    }
    for(const t of s.transactions) if(t.linked) {const target=s.transactions.find(x=>x.id===t.linked);if(!target||target.type!=='deposit'||t.type!=='expense'||target.amount!==t.amount||target.date!==t.date) fail();}
    for(const a of s.assets) if(a.sold) {const t=s.transactions.find(t=>t.id===a.sold);if(a.kind!=='item'||!t||t.type!=='income'||!a.snapshots.some(v=>v.date===t.date&&v.value===0)||a.snapshots.some(v=>v.date>=t.date&&v.value!==0)) fail();}
    return s;
  }
  const api={day,validDate,cents,blank,flow,balance,xirr,performance,occurrences,planStats,validate,expenseCategories,expenseNatures,expenseSummary,parseLedgerText,ledgerImportPreview,importLedger};
  if(typeof module!=='undefined') module.exports=api; else root.Fin=api;
})(typeof globalThis!=='undefined'?globalThis:this);
