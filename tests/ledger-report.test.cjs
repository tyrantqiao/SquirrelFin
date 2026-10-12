const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../app/src/main/assets/engine.js');
const report=(period,date,transactions=[],today=date)=>F.ledgerReport({...F.blank(),transactions},period,date,today);
const tx=(date,type,amount,extra={})=>({date,type,amount,...extra});

test('daily overview includes account-free spending and income only on the selected day',()=>{
 const transactions=[tx('2026-10-12','expense',1234,{asset:null}),tx('2026-10-12','income',2000,{asset:'cash'}),tx('2026-10-12','expense',900,{linked:'funding'}),tx('2026-10-12','deposit',900),tx('2026-10-12','withdraw',500),tx('2026-10-12','transfer',200),tx('2026-10-11','expense',100),tx('2026-10-13','income',100)];
 const r=F.dailyLedger({...F.blank(),transactions},'2026-10-12');
 assert.equal(r.income,2000);assert.equal(r.expense,1234);assert.equal(r.net,766);assert.equal(r.count,2);assert.deepEqual(r.rows,transactions.slice(0,2));
 const month=report('month','2026-10-12',transactions);assert.equal(month.expense,r.expense+100);assert.equal(month.income,r.income);
});

test('daily overview handles deficit, empty day and invalid dates without mutating records',()=>{
 const s=F.blank();s.transactions=[tx('2026-10-12','expense',1),tx('2026-10-12','expense',2)];const before=JSON.stringify(s);
 assert.equal(F.dailyLedger(s,'2026-10-12').net,-3);assert.deepEqual(F.dailyLedger(s,'2026-10-11'),{date:'2026-10-11',rows:[],income:0,expense:0,net:0,count:0});assert.throws(()=>F.dailyLedger(s,'2026-02-30'));assert.equal(JSON.stringify(s),before);
});

test('source and account breakdown exclude funding and keep unassigned entries separate',()=>{
 const r=report('month','2026-10-12',[tx('2026-10-01','income',1000,{asset:'cash',sourceCategory:'工资'}),tx('2026-10-02','income',200),tx('2026-10-02','income',50,{sourceCategory:'__proto__'}),tx('2026-10-03','expense',300,{asset:'cash'}),tx('2026-10-03','expense',100),tx('2026-10-03','expense',900,{asset:'cash',linked:'investment'}),tx('2026-10-03','transfer',400,{asset:'cash'})]);
 assert.equal(r.incomeSources['工资'],1000);assert.equal(r.incomeSources['未标注来源'],200);assert.equal(r.incomeSources.__proto__,50);assert.equal(r.incomeCount,3);
 assert.deepEqual(r.accounts,[{asset:'cash',income:1000,expense:300,count:2,net:700},{asset:null,income:250,expense:100,count:3,net:150}]);
});

test('weekday averages use all covered dates, not only days with spending',()=>{
 const r=report('week','2026-10-11',[tx('2026-10-05','expense',100),tx('2026-10-10','expense',600),tx('2026-10-10','expense',101)]);
 assert.deepEqual(r.workdays,{days:5,expense:100,average:20});assert.deepEqual(r.weekend,{days:2,expense:701,average:351});assert.equal(r.weekdays[5].count,2);assert.equal(r.weekdays[5].average,701);assert.equal(r.noExpenseDays,5);assert.deepEqual(r.peakDay,{date:'2026-10-10',expense:701});
 const partial=report('week','2026-10-05');assert.equal(partial.weekdays[1].average,null);assert.equal(partial.weekend.average,null);assert.equal(partial.workdays.average,0);
});

test('category changes include vanished categories and sort by absolute change',()=>{
 const r=report('month','2026-10-02',[tx('2026-09-01','expense',1000,{category:'居住'}),tx('2026-09-02','expense',100,{category:'餐饮'}),tx('2026-09-03','expense',900,{category:'交通'}),tx('2026-10-01','expense',301,{category:'餐饮'}),tx('2026-10-02','expense',50)]);
 assert.deepEqual(r.categoryChanges,[{category:'居住',current:0,previous:1000,delta:-1000,count:0},{category:'餐饮',current:301,previous:100,delta:201,count:1},{category:'未分类',current:50,previous:0,delta:50,count:1}]);
});

test('median and top five concentration handle outliers, cents and empty spending',()=>{
 const r=report('month','2026-10-12',[1,2,3,4,5,10000].map(amount=>tx('2026-10-01','expense',amount)));
 assert.equal(r.medianExpense,4);assert.equal(r.topExpenseShare,10014/10015);assert.equal(report('week','2026-10-12',[tx('2026-10-12','income',100)]).medianExpense,null);assert.equal(report('week','2026-10-12').topExpenseShare,null);
 assert.equal(report('week','2026-10-12',[tx('2026-10-12','expense',101)]).medianExpense,101);
});
test('weekly report starts Monday and crosses year boundary; comparison uses elapsed days',()=>{
 const r=report('week','2026-01-01',[tx('2025-12-28','expense',99),tx('2025-12-29','expense',100),tx('2026-01-01','income',400),tx('2026-01-02','expense',50)]);
 assert.equal(r.start,'2025-12-29');assert.equal(r.end,'2026-01-01');assert.equal(r.days,4);assert.equal(r.expense,100);assert.equal(r.net,300);assert.equal(r.previous.start,'2025-12-22');assert.equal(r.previous.end,'2025-12-25');assert.equal(r.buckets.length,4);
});
test('current month compares same elapsed days and includes zero activity days in average',()=>{
 const r=report('month','2026-03-03',[tx('2026-03-01','expense',101),tx('2026-02-03','expense',50),tx('2026-02-04','expense',200)]);
 assert.equal(r.previous.end,'2026-02-03');assert.equal(r.previous.expense,50);assert.equal(r.dailyExpense,34);assert.equal(r.averageExpense,101);assert.equal(r.activeDays,1);assert.equal(r.netRatio,null);
});
test('complete month handles leap February and caps shorter comparison month',()=>{
 const r=report('month','2024-03-15',[],'2024-04-01');assert.equal(r.days,31);assert.equal(r.previous.end,'2024-02-29');assert.equal(r.buckets.length,31);
 assert.equal(report('month','2024-02-02',[],'2024-03-01').days,29);
});
test('annual trend groups leap year months and truncates current month',()=>{
 const r=report('year','2024-03-02',[tx('2024-02-29','expense',300),tx('2024-03-02','income',500),tx('2024-03-03','income',900)]);
 assert.equal(r.days,62);assert.equal(r.buckets.length,3);assert.equal(r.buckets[1].expense,300);assert.equal(r.buckets[2].income,500);assert.equal(r.previous.end,'2023-03-03');
});
test('spending excludes internal transfers and investment funding; legacy entries remain unclassified',()=>{
 const d='2026-10-01',r=report('month',d,[tx(d,'expense',29),tx(d,'expense',100,{category:'餐饮',nature:'variable'}),tx(d,'expense',900,{linked:'deposit'}),tx(d,'transfer',200),tx(d,'deposit',900),tx(d,'withdraw',500),tx(d,'income',100)]);
 assert.equal(r.count,3);assert.equal(r.expense,129);assert.equal(r.natures.unclassified,29);assert.equal(r.categories['餐饮'],100);assert.equal(r.net,-29);assert.equal(r.netRatio,-.29);assert.equal(r.topExpenses[0].amount,100);
});
test('empty report has unavailable ratios, zero sums and no invented ranking',()=>{
 const r=report('year','2026-01-01');assert.equal(r.income,0);assert.equal(r.averageExpense,null);assert.equal(r.netRatio,null);assert.deepEqual(r.topExpenses,[]);assert.throws(()=>report('week','2026-02-30'));assert.throws(()=>report('year','2027-01-01',[],'2026-01-01'));
});
