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
  const expenseCategories=['餐饮','居住','交通','购物','水电通讯','医疗','教育','健身','娱乐','人情','保险','其他'];
  const expenseNatures={fixed:'固定支出',variable:'日常可变',occasional:'偶发支出'};
  function blank() { return {version:1,assets:[],transactions:[],plans:[],executions:[],expenseTemplates:[]}; }
  function validateEnergyProfile(p) {
    if(!p||typeof p.id!=='string'||!p.id.trim()||p.id.length>100||!validDate(p.effective)||typeof p.month!=='string'||!validDate(p.month+'-01'))throw Error('时薪档案日期无效');
    for(const k of ['income','cost'])if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>1e14)throw Error('收入与成本须为非负金额');
    for(const k of ['incomeSource','costSource'])if(p[k]!==undefined&&!['manual','ledger'].includes(p[k]))throw Error('时薪来源无效');
    for(const k of ['work','commute','recovery'])if(!Number.isSafeInteger(p[k])||p[k]<0)throw Error('投入时间须为非负整数分钟');
    const minutes=p.work+p.commute+p.recovery,days=new Date(Date.UTC(Number(p.month.slice(0,4)),Number(p.month.slice(5)),0)).getUTCDate();
    if(!Number.isSafeInteger(minutes)||minutes<=0||minutes>days*1440)throw Error('总投入时间须大于零且不超过参考月份总时长');
    if(p.daily!==undefined){
      if(!p.daily||!Number.isInteger(p.daily.days)||p.daily.days<1||p.daily.days>days)throw Error('工作天数无效');
      for(const k of ['work','commute','recovery'])if(!Number.isInteger(p.daily[k])||p.daily[k]<0||p.daily[k]*p.daily.days!==p[k])throw Error('每日时长与月度合计不一致');
      if(p.daily.work+p.daily.commute+p.daily.recovery>1440)throw Error('每日投入不能超过 24 小时');
    }
    return p;
  }
  function energyInputs(state,p) {
    validateEnergyProfile(p);let salary=0,costs=0,salaryCount=0,costCount=0;
    for(const t of state.transactions){if(t.date.slice(0,7)!==p.month||t.linked)continue;
      if(t.type==='income'&&t.workTag==='salary'){salary+=t.amount;salaryCount++;}
      if(t.type==='expense'&&['commute','meal','work'].includes(t.workTag)){costs+=t.workCost;costCount++;}
    }
    const income=p.income+(p.incomeSource==='ledger'?salary:0),cost=p.cost+(p.costSource==='ledger'?costs:0);
    if(!Number.isSafeInteger(income)||!Number.isSafeInteger(cost)||income>1e14||cost>1e14)throw Error('关联金额合计超出范围');
    return {income,cost,salary,costs,salaryCount,costCount};
  }
  function energyRate(p,state={transactions:[]}) {
    const inputs=energyInputs(state,p),net=inputs.income-inputs.cost,minutes=p.work+p.commute+p.recovery;
    return {...inputs,net,minutes,hourly:net>0?net*60/minutes:null,reason:net<=0?'本期工作净收入不为正，暂不换算消费时间':''};
  }
  function energyFor(state,t) {
    if(!state.lifeEnergy?.enabled||t.type!=='expense'||t.linked)return null;
    const profile=state.lifeEnergy.profiles.filter(p=>p.effective<=t.date).sort((a,b)=>b.effective.localeCompare(a.effective))[0];
    if(!profile)return {reason:'此日期尚无生效的参考时薪'};
    const rate=energyRate(profile,state);if(rate.reason)return {profile,...rate};
    if(!Number.isSafeInteger(t.amount)||t.amount<0||t.amount>1e14)throw Error('换算金额无效');
    const amount=profile.costSource==='ledger'&&t.date.slice(0,7)===profile.month&&['commute','meal','work'].includes(t.workTag)?t.amount-t.workCost:t.amount;
    const numerator=BigInt(amount)*BigInt(rate.minutes),denominator=BigInt(rate.net),rounded=(numerator*2n+denominator)/(denominator*2n);
    // Keep exact integer arithmetic until display; cap results that cannot be represented safely.
    if(rounded>BigInt(Number.MAX_SAFE_INTEGER))return {profile,...rate,reason:'折合时间超出显示范围'};
    return {profile,...rate,convertedAmount:amount,excludedCost:t.amount-amount,minutesRounded:Number(rounded),underMinute:numerator>0n&&numerator<denominator};
  }
  function ledgerRows(state,from,to) {return state.transactions.filter(t=>t.date>=from&&t.date<=to&&!t.linked&&['income','expense'].includes(t.type));}
  function dailyLedger(state,date) {
    if(!validDate(date))throw Error('统计日期无效');
    const rows=ledgerRows(state,date,date);let income=0,expense=0;
    for(const t of rows){if(t.type==='income')income+=t.amount;else expense+=t.amount;}
    return {date,rows,income,expense,net:income-expense,count:rows.length};
  }
  function recentActivity(state,date,kind='all',page=1,size=5) {
    if(!validDate(date)||!['all','assets','income','expense'].includes(kind)||!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1||size>50)throw Error('明细参数无效');
    const start=new Date((day(date)-6)*86400000).toISOString().slice(0,10),rows=[];
    for(const a of state.assets)for(const v of a.snapshots)if(v.date>=start&&v.date<=date)rows.push({key:'snapshot:'+a.id+':'+v.date,date:v.date,savedAt:v.savedAt||0,order:rows.length,kind:'assets',asset:a.id,amount:v.value,opening:!!v.opening,record:'snapshot'});
    for(const t of state.transactions)if(t.date>=start&&t.date<=date)rows.push({key:'tx:'+t.id,date:t.date,savedAt:t.savedAt||0,order:rows.length,kind:!t.linked&&['income','expense'].includes(t.type)?t.type:'assets',asset:t.asset,id:t.id,amount:t.amount,type:t.type,linked:!!t.linked,note:t.note,category:t.category,to:t.to,record:'transaction'});
    const filtered=rows.filter(r=>kind==='all'||r.kind===kind).sort((a,b)=>b.date.localeCompare(a.date)||b.savedAt-a.savedAt||b.order-a.order);
    const count=filtered.length,pages=Math.max(1,Math.ceil(count/size)),current=Math.min(page,pages);
    return {start,end:date,count,pages,page:current,rows:filtered.slice((current-1)*size,current*size)};
  }
  function markActivitySaved(previous,next,now=Date.now()) {
    const snapshots=new Map(previous.assets.flatMap(a=>a.snapshots.map(v=>[a.id+':'+v.date,v]))),transactions=new Map(previous.transactions.map(t=>[t.id,t]));
    // A monotonic save time also preserves ordering when the device clock moves back.
    let savedAt=now;
    for(const v of [...snapshots.values(),...transactions.values()])savedAt=Math.max(savedAt,(v.savedAt||0)+1);
    for(const a of next.assets)for(const v of a.snapshots){const old=snapshots.get(a.id+':'+v.date);if(!old||old.value!==v.value||!!old.opening!==!!v.opening||old.savedAt!==v.savedAt)v.savedAt=savedAt;}
    for(const t of next.transactions){const old=transactions.get(t.id);if(!old||['date','type','asset','to','amount','note','category','nature','sourceCategory','linked'].some(k=>old[k]!==t[k]))t.savedAt=savedAt;}
    return next;
  }
  function expenseSummary(state,month) {
    const expenses=state.transactions.filter(t=>t.type==='expense'&&!t.linked&&t.date.slice(0,7)===month);
    const categories={},natures={fixed:0,variable:0,occasional:0,unclassified:0};
    for(const t of expenses) {const category=t.category||'未分类';categories[category]=(categories[category]||0)+t.amount;natures[t.nature||'unclassified']+=t.amount;}
    return {total:expenses.reduce((n,t)=>n+t.amount,0),categories,natures};
  }
  function monthlyOverview(state,month,today) {
    if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!validDate(month+'-01')||!validDate(today)||month>today.slice(0,7))throw Error('请选择有效的年月，不能晚于当前月份');
    const report=ledgerReport(state,'month',month+'-01',today),assets={cash:0,investment:0,item:0,debt:0};
    let missing=0,recorded=0;
    for(const a of state.assets){
      if(!a.snapshots.some(v=>v.date<=report.end)){missing++;continue;}
      assets[a.kind]+=balance(state,a,report.end);recorded++;
    }
    assets.financial=assets.cash+assets.investment-assets.debt;assets.net=assets.financial+assets.item;
    return {month,start:report.start,end:report.end,income:report.income,expense:report.expense,net:report.net,assets,missing,recorded};
  }
  function assetHistory(state,at,months=6) {
    if(!validDate(at)||![6,12].includes(months))throw Error('资产历史区间无效');
    const current=state.assets.filter(a=>a.snapshots.some(v=>v.date<=at)),points=[];
    for(let i=months-1;i>=0;i--){
      const monthStart=new Date(at.slice(0,7)+'-01T00:00:00Z');monthStart.setUTCMonth(monthStart.getUTCMonth()-i);
      const next=new Date(monthStart);next.setUTCMonth(next.getUTCMonth()+1);
      const date=i===0?at:new Date(next.getTime()-86400000).toISOString().slice(0,10),totals={cash:0,investment:0,item:0,debt:0};let missingFinancial=0,missingItem=0;
      for(const a of current){if(!a.snapshots.some(v=>v.date<=date)){if(a.kind==='item')missingItem++;else missingFinancial++;continue;}totals[a.kind]+=balance(state,a,date);}
      const financial=current.some(a=>a.kind!=='item')&&!missingFinancial?totals.cash+totals.investment-totals.debt:null;
      const net=current.length&&!missingFinancial&&!missingItem?totals.cash+totals.investment-totals.debt+totals.item:null;
      points.push({date,financial,net,missing:missingFinancial+missingItem});
    }
    return {at,months,points};
  }
  function assetReport(state,at) {
    if(!validDate(at))throw Error('统计日期无效');
    const previous=new Date((day(at.slice(0,7)+'-01')-1)*86400000).toISOString().slice(0,10),totals={cash:0,investment:0,item:0,debt:0};let missingPrevious=0;
    const rows=state.assets.map(a=>{
      const snaps=a.snapshots.filter(v=>v.date<=at).sort((a,b)=>a.date.localeCompare(b.date)),last=snaps.at(-1),current=balance(state,a,at),hasPrevious=a.snapshots.some(v=>v.date<=previous);
      if(!hasPrevious)missingPrevious++;totals[a.kind]+=current;
      const p=performance(state,{...a,snapshots:snaps});
      return {id:a.id,kind:a.kind,value:current,previous:hasPrevious?balance(state,a,previous):null,delta:hasPrevious?current-balance(state,a,previous):null,lastDate:last?.date||null,stale:last?day(at)-day(last.date)>90:true,performance:p};
    });
    totals.financial=totals.cash+totals.investment-totals.debt;totals.net=totals.financial+totals.item;
    return {at,previous,totals,rows,missingPrevious,stale:rows.filter(r=>r.stale).length};
  }
  function ledgerReport(state,period,anchor,today) {
    if(!['week','month','year'].includes(period)||!validDate(anchor)||!validDate(today)||anchor>today) throw Error('统计区间无效');
    const iso=n=>new Date(n*86400000).toISOString().slice(0,10);
    const bounds=date=>{
      const y=Number(date.slice(0,4)),m=Number(date.slice(5,7));
      if(period==='week') {const start=day(date)-(new Date(day(date)*86400000).getUTCDay()+6)%7;return [iso(start),iso(start+6)];}
      const start=period==='year'?`${date.slice(0,4)}-01-01`:date.slice(0,7)+'-01';
      const next=period==='year'?Date.UTC(y+1,0,1):Date.UTC(y,m,1);
      return [start,iso(next/86400000-1)];
    };
    const [start,periodEnd]=bounds(anchor),end=periodEnd<today?periodEnd:today,days=day(end)-day(start)+1;
    const [previousStart,previousFullEnd]=bounds(iso(day(start)-1));
    const previousEnd=iso(Math.min(day(previousFullEnd),day(previousStart)+days-1));
    const summarize=(from,to)=>{
      const rows=ledgerRows(state,from,to);
      const categories={},natures={fixed:0,variable:0,occasional:0,unclassified:0};let income=0,expense=0;
      for(const t of rows) {if(t.type==='income')income+=t.amount;else{expense+=t.amount;const c=t.category||'未分类';categories[c]=(categories[c]||0)+t.amount;natures[t.nature||'unclassified']+=t.amount;}}
      return {rows,income,expense,net:income-expense,categories,natures};
    };
    const current=summarize(start,end),previous=summarize(previousStart,previousEnd),buckets=[];
    for(let n=day(start);n<=day(end);) {
      const from=iso(n),to=period==='year'?iso(Math.min(day(boundsMonthEnd(from)),day(end))):from;
      const s=summarize(from,to);buckets.push({date:from,label:period==='year'?Number(from.slice(5,7))+'月':from.slice(5),income:s.income,expense:s.expense});n=day(to)+1;
    }
    const expenses=current.rows.filter(t=>t.type==='expense'),incomes=current.rows.filter(t=>t.type==='income');
    const incomeSources=Object.create(null),accounts=new Map(),daily=new Map();
    const weekdays=Array.from({length:7},(_,i)=>({label:['周一','周二','周三','周四','周五','周六','周日'][i],days:0,count:0,expense:0}));
    for(let n=day(start);n<=day(end);n++)weekdays[(new Date(n*86400000).getUTCDay()+6)%7].days++;
    for(const t of current.rows){
      const key=t.asset||null;
      if(!accounts.has(key))accounts.set(key,{asset:key,income:0,expense:0,count:0});
      const account=accounts.get(key);account[t.type]+=t.amount;account.count++;
      if(t.type==='income'){const source=t.workTag==='salary'?'工资 / 劳动收入':t.sourceCategory||t.category||'未标注来源';incomeSources[source]=(incomeSources[source]||0)+t.amount;}
      else{const w=weekdays[(new Date(day(t.date)*86400000).getUTCDay()+6)%7];w.expense+=t.amount;w.count++;daily.set(t.date,(daily.get(t.date)||0)+t.amount);}
    }
    weekdays.forEach(w=>w.average=w.days?Math.round(w.expense/w.days):null);
    const rhythmGroup=rows=>{const days=rows.reduce((s,w)=>s+w.days,0),expense=rows.reduce((s,w)=>s+w.expense,0);return {days,expense,average:days?Math.round(expense/days):null};};
    const sortedAmounts=expenses.map(t=>t.amount).sort((a,b)=>a-b),mid=Math.floor(sortedAmounts.length/2);
    const categoryChanges=[...new Set([...Object.keys(current.categories),...Object.keys(previous.categories)])].map(category=>({category,current:current.categories[category]||0,previous:previous.categories[category]||0,delta:(current.categories[category]||0)-(previous.categories[category]||0),count:expenses.filter(t=>(t.category||'未分类')===category).length})).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||b.current-a.current||a.category.localeCompare(b.category));
    const peakDay=[...daily].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
    const topExpenses=[...expenses].sort((a,b)=>b.amount-a.amount||b.date.localeCompare(a.date)).slice(0,5);
    return {...current,start,end,periodEnd,days,previous:{...previous,start:previousStart,end:previousEnd},buckets,
      incomeSources,incomeCount:incomes.length,categoryChanges,weekdays,workdays:rhythmGroup(weekdays.slice(0,5)),weekend:rhythmGroup(weekdays.slice(5)),
      accounts:[...accounts.values()].map(a=>({...a,net:a.income-a.expense})).sort((a,b)=>b.expense-a.expense||b.income-a.income),
      medianExpense:sortedAmounts.length?(sortedAmounts.length%2?sortedAmounts[mid]:Math.round((sortedAmounts[mid-1]+sortedAmounts[mid])/2)):null,
      peakDay:peakDay?{date:peakDay[0],expense:peakDay[1]}:null,
      topExpenseShare:current.expense?topExpenses.reduce((s,t)=>s+t.amount,0)/current.expense:null,
      noExpenseDays:days-daily.size,
      count:current.rows.length,expenseCount:expenses.length,activeDays:new Set(expenses.map(t=>t.date)).size,
      dailyExpense:Math.round(current.expense/days),averageExpense:expenses.length?Math.round(current.expense/expenses.length):null,
      netRatio:current.income?current.net/current.income:null,
      topExpenses};
  }
  function boundsMonthEnd(date) {return new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).toISOString().slice(0,10);}
  function suggestExpense(source,note) {
    const aliases={吃饭:'餐饮',出行:'交通',学习:'教育',玩:'娱乐',礼物:'人情',日常:'其他',吃:'餐饮',餐饮:'餐饮',交通:'交通',购物:'购物',居住:'居住',娱乐:'娱乐',人情:'人情',医疗:'医疗',教育:'教育',健身:'健身',保险:'保险',水电通讯:'水电通讯'};
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
  function snapshotReview(state,a,date,value) {
    const previous=[...a.snapshots].filter(v=>v.date<date).sort((x,y)=>x.date.localeCompare(y.date)).at(-1);
    if(!previous)return {hasFlows:false,unusual:false};
    const ts=state.transactions.filter(t=>(t.date>previous.date||(previous.opening&&t.date===previous.date))&&t.date<=date&&flow(t,a.id)!==0);
    const expected=previous.value+ts.reduce((n,t)=>n+flow(t,a.id),0),difference=value-expected;
    return {hasFlows:ts.length>0,expected,difference,unusual:expected<=0?difference!==0:Math.abs(difference)/expected>=0.2};
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
    const savedTime=v=>v===undefined||Number.isSafeInteger(v)&&v>0&&v<Number.MAX_SAFE_INTEGER;
    if(!s||s.version!==1||!['assets','transactions','plans','executions'].every(k=>Array.isArray(s[k])&&s[k].length<=20000)) fail();
    if(s.lifeEnergy!==undefined){
      const e=s.lifeEnergy;if(!e||![1,2].includes(e.schema)||typeof e.enabled!=='boolean'||!Array.isArray(e.profiles)||e.profiles.length>1000)fail();
      const pids=new Set(),dates=new Set();for(const p of e.profiles){validateEnergyProfile(p);if(e.schema===1&&(p.incomeSource!==undefined||p.costSource!==undefined||p.daily!==undefined))fail();if(pids.has(p.id)||dates.has(p.effective))fail();pids.add(p.id);dates.add(p.effective);}
    }
    const ids=new Set();
    for(const a of s.assets) {
      if(typeof a.id!=='string'||ids.has(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>100||!['cash','investment','item','debt'].includes(a.kind)||typeof a.place!=='string'||typeof a.risk!=='string'||!Array.isArray(a.snapshots)||a.snapshots.length<1) fail();
      ids.add(a.id);const dates=new Set();
      for(const v of a.snapshots) {if(!validDate(v.date)||!money(v.value)||v.value<0||dates.has(v.date)||typeof v.confirmed!=='boolean'||!savedTime(v.savedAt)) fail();dates.add(v.date);}
      if(a.cost!==undefined&&(!money(a.cost)||a.cost<0)) fail();
      if(a.note!==undefined&&(typeof a.note!=='string'||a.note.length>100)) fail();
    }
    const tids=new Set();
    for(const t of s.transactions) {
      if(!savedTime(t.savedAt)) fail();
      if(typeof t.id!=='string'||tids.has(t.id)||!(ids.has(t.asset)||t.asset===null&&['income','expense'].includes(t.type)&&!t.linked&&!t.to)||!validDate(t.date)||!money(t.amount)||t.amount<=0||typeof t.note!=='string'||!['income','expense','transfer','deposit','withdraw'].includes(t.type)) fail();
      const a=s.assets.find(a=>a.id===t.asset);
      if(a&&(['item','debt'].includes(a.kind)||t.date<a.snapshots.map(v=>v.date).sort()[0])) fail();
      if(t.category!==undefined&&(t.type!=='expense'||t.linked||!expenseCategories.includes(t.category))) fail();
      if(t.nature!==undefined&&(t.type!=='expense'||t.linked||!Object.hasOwn(expenseNatures,t.nature))) fail();
      if(t.sourceCategory!==undefined&&(!['income','expense'].includes(t.type)||t.linked||typeof t.sourceCategory!=='string'||!t.sourceCategory.trim()||t.sourceCategory.length>40)) fail();
      if(t.workTag!==undefined){
        if(t.linked||!['salary','commute','meal','work'].includes(t.workTag)||t.workTag==='salary'&&t.type!=='income'||t.workTag!=='salary'&&t.type!=='expense')fail();
        if(t.workTag!=='salary'&&(!money(t.workCost)||t.workCost<0||t.workCost>t.amount))fail();
        if(t.workTag==='salary'&&t.workCost!==undefined)fail();
      }else if(t.workCost!==undefined)fail();
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
    for(const p of s.lifeEnergy?.profiles||[])energyInputs(s,p);
    return s;
  }
  const api={day,validDate,cents,blank,flow,balance,xirr,performance,snapshotReview,occurrences,planStats,validate,expenseCategories,expenseNatures,expenseSummary,dailyLedger,recentActivity,markActivitySaved,monthlyOverview,assetHistory,assetReport,ledgerReport,parseLedgerText,ledgerImportPreview,importLedger,validateEnergyProfile,energyInputs,energyRate,energyFor};
  if(typeof module!=='undefined') module.exports=api; else root.Fin=api;
})(typeof globalThis!=='undefined'?globalThis:this);
