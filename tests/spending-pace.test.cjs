const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../app/src/main/assets/engine.js');
const tx=(amount,date='2026-10-01',extra={})=>({amount,date,type:'expense',...extra});
const fixture=()=>({...F.blank(),transactions:[tx(74400)],lifeEnergy:{schema:2,enabled:true,profiles:[{id:'p',month:'2026-10',effective:'2026-10-01',income:120000,cost:24000,work:1200,commute:600,recovery:600}]}});

test('spending windows use elapsed calendar days, leap months and three complete months',()=>{
 assert.deepEqual(F.spendingWindow('2026-01-19'),{start:'2026-01-01',end:'2026-01-19'});
 assert.deepEqual(F.spendingWindow('2024-03-19','previous'),{start:'2024-02-01',end:'2024-02-29'});
 assert.deepEqual(F.spendingWindow('2026-01-19','quarter'),{start:'2025-10-01',end:'2025-12-31'});
 assert.throws(()=>F.spendingWindow('2026-02-30'));assert.throws(()=>F.spendingWindow('2026-01-01','all'));
});
test('spending hourly rate includes unrecorded days and work costs but excludes capital movements',()=>{
 const s=fixture();s.transactions=[tx(2400,'2026-10-01',{workTag:'commute',workCost:2400}),tx(2400,'2026-10-01'),tx(50000,'2026-10-02',{type:'income'}),tx(30000,'2026-10-02',{type:'transfer'}),tx(10000,'2026-10-02',{type:'deposit'}),tx(9000,'2026-10-02',{type:'withdraw'}),tx(60000,'2026-10-02',{linked:'x'}),tx(10000,'2026-09-30')];
 const before=JSON.stringify(s),p=F.spendingPace(s,'2026-10-01','2026-10-02');
 assert.equal(p.expense,4800);assert.equal(p.hourly,100);assert.equal(p.days,2);assert.equal(p.recordedDays,1);assert.equal(p.count,2);assert.equal(JSON.stringify(s),before);
});
test('three-month pace weights calendar hours rather than averaging unequal monthly rates',()=>{
 const s=F.blank();s.transactions=[tx(3100,'2026-07-01'),tx(6200,'2026-08-01'),tx(9000,'2026-09-01')];
 const w=F.spendingWindow('2026-10-19','quarter'),p=F.spendingPace(s,w.start,w.end);
 assert.equal(p.days,92);assert.equal(p.hourly,18300/(92*24));assert.equal(F.spendingSupport(18300,p).minutesRounded,92*1440);
});
test('no salary is needed for runway; zero expenses cannot imply infinite support',()=>{
 const s=F.blank();s.transactions=[tx(2400)];const p=F.spendingPace(s,'2026-10-01','2026-10-01');
 assert.equal(F.spendingSupport(7200,p).minutesRounded,4320);assert.match(F.salaryComparison(s,p,'2026-10-01').reason,/档案/);
 for(const transactions of [[],[tx(0)]]){s.transactions=transactions;const empty=F.spendingPace(s,'2026-10-01','2026-10-01');assert.match(F.spendingSupport(100,empty).reason,/暂无正值支出/);}
});
test('negative net assets have zero runway instead of absolute-value support',()=>{
 const p=F.spendingPace(fixture(),'2026-10-01','2026-10-31');
 assert.equal(F.spendingSupport(-10000,p).minutesRounded,0);assert.equal(F.spendingSupport(-10000,p).deficit,true);
 assert.equal(F.spendingSupport(0,p).minutesRounded,0);assert.equal(F.spendingSupport(1,p).underMinute,true);
});

test('all net assets support living expenses, including investments and item residuals less debt',()=>{
 const s=F.blank();s.transactions=[tx(300000,'2026-09-01')];
 s.assets=[['cash',300000],['investment',1200000],['item',600000],['debt',300000]].map(([kind,value],i)=>({id:'a'+i,kind,cost:kind==='item'?2000000:0,snapshots:[{date:'2026-08-01',value,opening:true}]}));
 const p=F.spendingPace(s,'2026-09-01','2026-09-30'),t=F.assetReport(s,'2026-09-30').totals,r=F.spendingSupport(t.net,p);
 assert.equal(p.daily,10000);assert.equal(p.monthly,300000);
 assert.equal(t.net,1800000);assert.equal(r.days,180);assert.equal(r.months,6);
 assert.equal(F.spendingSupport(t.cash,p).days,30);
 // Investments and items still support the estimate without a cash account.
 s.assets=s.assets.filter(a=>a.kind!=='cash');assert.equal(F.spendingSupport(F.assetReport(s,'2026-09-30').totals.net,p).months,5);
 s.assets.find(a=>a.kind==='debt').snapshots[0].value=3000000;
 const debt=F.spendingSupport(F.assetReport(s,'2026-09-30').totals.net,p);assert.equal(debt.days,0);assert.equal(debt.months,0);assert.equal(debt.deficit,true);
});

test('daily and 30-day monthly estimates handle partial months, zero expenses and overflow',()=>{
 const s=F.blank();s.transactions=[tx(210000)];const p=F.spendingPace(s,'2026-10-01','2026-10-21');
 assert.equal(p.daily,10000);assert.equal(p.monthly,300000);assert.equal(F.spendingSupport(100000,p).days,10);
 s.transactions=[];const empty=F.spendingPace(s,p.start,p.end);assert.equal(empty.daily,0);assert.equal(empty.monthly,0);assert.match(F.spendingSupport(100000,empty).reason,/暂无正值支出/);
 s.transactions=[tx(Number.MAX_SAFE_INTEGER)];const huge=F.spendingPace(s,'2026-10-01','2026-10-01');assert.equal(huge.monthly,null);assert.equal(F.spendingSupport(Number.MAX_SAFE_INTEGER,huge).days,1);
});
test('salary coverage uses gross after-tax pay and distinguishes work-hour wage from true hourly wage',()=>{
 const s=fixture(),p=F.spendingPace(s,'2026-10-01','2026-10-31'),r=F.salaryComparison(s,p,'2026-10-19');
 assert.equal(p.hourly,100);assert.equal(r.wageHourly,6000);assert.equal(r.realHourly,2400);
 assert.equal(r.coverage.minutesRounded,72000);assert.equal(r.workCoverage.minutesRounded,3600);
 // Ledger work costs remain in spending, while coverage never subtracts them a second time.
 s.lifeEnergy.profiles[0].incomeSource='ledger';s.lifeEnergy.profiles[0].costSource='ledger';s.lifeEnergy.profiles[0].income=0;s.lifeEnergy.profiles[0].cost=0;
 s.transactions.push(tx(120000,'2026-10-10',{type:'income',workTag:'salary'}),tx(24000,'2026-10-10',{workTag:'commute',workCost:24000}));
 const linked=F.salaryComparison(s,F.spendingPace(s,p.start,p.end),'2026-10-19');
 assert.equal(linked.income,120000);assert.equal(linked.cost,24000);assert.equal(linked.wageHourly,6000);assert.equal(linked.coverage.minutesRounded,Math.round(120000/(98400/(31*1440))));
});
test('zero working time or nonpositive net income only limits the affected comparison',()=>{
 const s=fixture(),p=F.spendingPace(s,'2026-10-01','2026-10-31');s.lifeEnergy.profiles[0].work=0;
 let r=F.salaryComparison(s,p,'2026-10-19');assert.equal(r.wageHourly,null);assert.match(r.workCoverage.reason,/工作时间/);assert.equal(r.coverage.minutesRounded,72000);
 s.lifeEnergy.profiles[0].work=1200;s.lifeEnergy.profiles[0].cost=120000;
 r=F.salaryComparison(s,p,'2026-10-19');assert.equal(r.realHourly,null);assert.equal(r.wageHourly,6000);assert.equal(r.coverage.minutesRounded,72000);
});
test('latest effective salary is independent of expense period and respects its income month',()=>{
 const s=fixture();s.lifeEnergy.profiles.push({...s.lifeEnergy.profiles[0],id:'new',month:'2026-11',effective:'2026-10-15',income:240000});
 const p=F.spendingPace(s,'2026-10-01','2026-10-31');assert.equal(F.salaryComparison(s,p,'2026-10-14').income,120000);assert.equal(F.salaryComparison(s,p,'2026-10-15').income,240000);
 assert.match(F.salaryComparison(s,p,'2026-09-30').reason,/档案/);
});
test('editing or deleting ledger entries recalculates pace and coverage without mutating state',()=>{
 const s=fixture(),before=JSON.stringify(s),p=F.spendingPace(s,'2026-10-01','2026-10-31');F.salaryComparison(s,p,'2026-10-19');assert.equal(JSON.stringify(s),before);
 s.transactions[0].amount*=2;assert.equal(F.spendingPace(s,p.start,p.end).hourly,200);
 s.transactions=[];assert.match(F.spendingPace(s,p.start,p.end).reason,/暂无/);
});
test('large products use exact integers and safe overflow reports instead of Infinity',()=>{
 const s=F.blank();s.transactions=[tx(1)];let p=F.spendingPace(s,'2026-10-01','2026-10-31');
 assert.match(F.spendingSupport(Number.MAX_SAFE_INTEGER,p).reason,/范围/);
 s.transactions=Array.from({length:100},()=>tx(100000000000000));p=F.spendingPace(s,'2026-10-01','2026-10-31');assert.equal(p.expense,null);assert.equal(p.hourly,null);assert.match(p.reason,/范围/);
 assert.match(F.spendingSupport(NaN,p).reason,/范围/);assert.throws(()=>F.spendingPace(s,'2026-10-02','2026-10-01'));
});
