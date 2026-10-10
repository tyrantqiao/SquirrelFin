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
  function blank() { return {version:1,assets:[],transactions:[],plans:[],executions:[]}; }
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
      if(typeof t.id!=='string'||tids.has(t.id)||!ids.has(t.asset)||!validDate(t.date)||!money(t.amount)||t.amount<=0||typeof t.note!=='string'||!['income','expense','transfer','deposit','withdraw'].includes(t.type)) fail();
      const a=s.assets.find(a=>a.id===t.asset);
      if(['item','debt'].includes(a.kind)||t.date<a.snapshots.map(v=>v.date).sort()[0]) fail();
      if(t.type==='transfer') {const to=s.assets.find(a=>a.id===t.to);if(!to||to.id===a.id||['item','debt'].includes(to.kind)||t.date<to.snapshots.map(v=>v.date).sort()[0]) fail();}
      tids.add(t.id);
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
  const api={day,validDate,cents,blank,flow,balance,xirr,performance,occurrences,planStats,validate};
  if(typeof module!=='undefined') module.exports=api; else root.Fin=api;
})(typeof globalThis!=='undefined'?globalThis:this);
