const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../app/src/main/assets/engine.js');
const profile=(extra={})=>({id:'p',month:'2026-10',effective:'2026-10-01',income:1200000,cost:120000,work:10560,commute:1320,recovery:1320,...extra});
const state=(profiles=[profile()])=>({...F.blank(),lifeEnergy:{schema:profiles.some(p=>p.incomeSource!==undefined||p.costSource!==undefined||p.daily!==undefined)?2:1,enabled:true,profiles}});
const expense=(extra={})=>({type:'expense',date:'2026-10-18',amount:12000,...extra});
test('net after-tax labour income and all additional time determine expense conversion',()=>{
 const s=state(),before=JSON.stringify(s),r=F.energyFor(s,expense());
 assert.equal(r.net,1080000);assert.equal(r.minutes,13200);assert.equal(r.hourly,1080000*60/13200);assert.equal(r.minutesRounded,147);assert.equal(JSON.stringify(s),before);
 assert.equal(F.energyFor(s,expense({amount:1})).underMinute,true);
 assert.equal(F.energyFor(s,expense({amount:0})).minutesRounded,0);
 // No tax calculation, salary inference, or ledger balance mutation.
 assert.equal(F.energyRate(profile({cost:0,commute:0,recovery:0})).net,1200000);
});
test('dated profiles preserve prior conversions; excluded money movements never become time',()=>{
 const s=state([profile(),profile({id:'p2',effective:'2026-10-15',income:2280000})]);
 assert.equal(F.energyFor(s,expense({date:'2026-10-14'})).minutesRounded,147);
 assert.equal(F.energyFor(s,expense()).minutesRounded,73);
 assert.match(F.energyFor(s,expense({date:'2026-09-30'})).reason,/尚无/);
 for(const type of ['income','transfer','deposit','withdraw'])assert.equal(F.energyFor(s,expense({type})),null);
 assert.equal(F.energyFor(s,expense({linked:'investment'})),null);
 s.lifeEnergy.enabled=false;assert.equal(F.energyFor(s,expense()),null);
 assert.equal(F.energyFor(F.blank(),expense()),null);
});
test('nonpositive net income is retained but cannot convert spending',()=>{
 for(const cost of [1200000,1300000]){const s=state([profile({cost})]);assert.doesNotThrow(()=>F.validate(s));assert.match(F.energyFor(s,expense()).reason,/不为正/);assert.equal(F.energyRate(s.lifeEnergy.profiles[0]).hourly,null);}
});
test('time and backup validation reject impossible or malformed profiles and duplicate effective dates',()=>{
 assert.doesNotThrow(()=>F.validate(F.blank()));assert.deepEqual(F.validate(JSON.parse(JSON.stringify(state()))),state());
 for(const extra of [{work:0,commute:0,recovery:0},{work:-1},{work:1.5},{work:null},{work:undefined},{work:44641},{income:1.5},{cost:-1},{month:'2026-02-01'},{month:'2026-02',work:40321},{effective:'2026-02-30'},{id:''}])assert.throws(()=>F.validate(state([profile(extra)])));
 assert.doesNotThrow(()=>F.validate(state([profile({month:'2024-02',work:41760,commute:0,recovery:0})])));
 assert.throws(()=>F.validate(state([profile(),profile({id:'other'})])));
 assert.throws(()=>F.validate(state([profile(),profile({effective:'2026-11-01'})])));
 for(const e of [null,{}, {schema:3,enabled:true,profiles:[]},{schema:1,enabled:'true',profiles:[]}])assert.throws(()=>F.validate({...F.blank(),lifeEnergy:e}));
});
test('conversion uses exact ratio instead of rounded hourly rate and handles large products',()=>{
 const s=state([profile({income:100000000000000,cost:0,work:40000,commute:0,recovery:0})]);
 assert.equal(F.energyFor(s,expense({amount:100000000000000})).minutesRounded,40000);
 const huge=state([profile({income:1,cost:0,work:40000,commute:0,recovery:0})]);
 assert.match(F.energyFor(huge,expense({amount:100000000000000})).reason,/超出/);
 const half=state([profile({income:120,cost:0,work:60,commute:0,recovery:0})]);
 assert.equal(F.energyFor(half,expense({amount:3})).minutesRounded,2);
 assert.throws(()=>F.energyFor(s,expense({amount:-1})));
});
const tx=(id,type,amount,extra={})=>({id,type,amount,date:'2026-10-10',asset:null,note:'测试',...extra});
test('linked income and personal work costs use explicit monthly tags plus unrecorded supplements',()=>{
 const p=profile({income:10000,cost:1000,incomeSource:'ledger',costSource:'ledger'}),s=state([p]);
 s.transactions=[tx('salary','income',1200000,{workTag:'salary'}),tx('gift','income',90000),tx('commute','expense',10000,{workTag:'commute',workCost:10000}),tx('meal','expense',5000,{workTag:'meal',workCost:2000}),tx('travel','expense',80000),tx('prior','income',999999,{date:'2026-09-30',workTag:'salary'}),tx('reimbursement','income',3000)];
 const before=JSON.stringify(s);F.validate(s);const r=F.energyRate(p,s);
 assert.equal(r.income,1210000);assert.equal(r.cost,13000);assert.equal(r.salaryCount,1);assert.equal(r.costCount,2);assert.equal(r.net,1197000);assert.equal(JSON.stringify(s),before);
 assert.equal(F.ledgerReport(s,'month','2026-10-18','2026-10-18').incomeSources['工资 / 劳动收入'],1200000);
 const plain=F.energyRate(profile(),s);assert.equal(plain.income,1200000);assert.equal(plain.cost,120000);
});
test('editing, deleting and retagging source transactions recompute historical conversions without balance mutations',()=>{
 const p=profile({income:0,cost:0,incomeSource:'ledger',costSource:'ledger'}),s=state([p]);s.transactions=[tx('salary','income',1200000,{workTag:'salary'}),tx('cost','expense',120000,{workTag:'work',workCost:120000})];
 const first=F.energyFor(s,expense()).minutesRounded;s.transactions[0].amount=2400000;assert(F.energyFor(s,expense()).minutesRounded<first);
 s.transactions[0].date='2026-11-01';assert.match(F.energyFor(s,expense()).reason,/不为正/);s.transactions[0].date='2026-10-10';
 s.transactions[1].workCost=0;assert.equal(F.energyRate(p,s).cost,0);s.transactions=s.transactions.filter(t=>t.id!=='salary');assert.match(F.energyFor(s,expense()).reason,/不为正/);
});
test('only work costs actually deducted for the reference month are excluded from expense time',()=>{
 const p=profile({income:0,cost:0,incomeSource:'ledger',costSource:'ledger'}),s=state([p]),meal=tx('meal','expense',5000,{workTag:'meal',workCost:2000});s.transactions=[tx('salary','income',1200000,{workTag:'salary'}),meal];
 assert.equal(F.energyFor(s,meal).convertedAmount,3000);assert.equal(F.energyFor(s,meal).excludedCost,2000);
 const full={...meal,amount:2000};assert.equal(F.energyFor(s,full).minutesRounded,0);
 assert.equal(F.energyFor(s,{...meal,date:'2026-11-10'}).convertedAmount,5000);
 p.costSource='manual';assert.equal(F.energyFor(s,meal).convertedAmount,5000);
});
test('backup round trips validate tag types, personal portions, sources and daily timing',()=>{
 const p=profile({daily:{days:22,work:480,commute:60,recovery:60}}),s=state([p]);s.transactions=[tx('salary','income',1200000,{workTag:'salary'}),tx('cost','expense',10000,{workTag:'commute',workCost:5000})];assert.deepEqual(F.validate(JSON.parse(JSON.stringify(s))),s);
 for(const change of [{type:'expense',workTag:'salary'},{workCost:1},{workTag:'unknown'}]){const bad=structuredClone(s);Object.assign(bad.transactions[0],change);assert.throws(()=>F.validate(bad));}
 for(const change of [{workCost:10001},{workCost:-1},{workCost:1.5},{workCost:undefined},{workTag:undefined},{type:'income'}]){const bad=structuredClone(s);Object.assign(bad.transactions[1],change);assert.throws(()=>F.validate(bad));}
 for(const change of [{incomeSource:'auto'},{daily:{days:0,work:480,commute:60,recovery:60}},{daily:{days:22,work:481,commute:60,recovery:60}}])assert.throws(()=>F.validate(state([profile(change)])));
});
test('linked totals exceeding the supported money range fail before persistence',()=>{
 const s=state([profile({income:0,incomeSource:'ledger'})]);s.transactions=[tx('a','income',1e14,{workTag:'salary'}),tx('b','income',1,{workTag:'salary'})];assert.throws(()=>F.validate(s),/超出/);
});
test('legacy manual profiles remain manual and the new extension cannot masquerade as the old schema',()=>{
 const legacy=state();assert.equal(legacy.lifeEnergy.schema,1);const p=profile({incomeSource:'ledger'}),s=state([p]);assert.equal(s.lifeEnergy.schema,2);assert.doesNotThrow(()=>F.validate(s));s.lifeEnergy.schema=1;assert.throws(()=>F.validate(s));
 const before=F.energyRate(legacy.lifeEnergy.profiles[0]);legacy.transactions=[tx('salary','income',999999,{workTag:'salary'})];assert.equal(F.energyRate(legacy.lifeEnergy.profiles[0],legacy).hourly,before.hourly);
});
