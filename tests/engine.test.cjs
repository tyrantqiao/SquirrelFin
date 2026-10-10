const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../app/src/main/assets/engine.js');
const asset=(id='a',kind='investment')=>({id,name:id,kind,place:'本地',risk:'未知',snapshots:[{date:'2026-01-01',value:10000,confirmed:false},{date:'2026-02-01',value:10200,confirmed:true}]});
test('100 → 102 is 2% for 31 days, not 2% annual',()=>{const s=F.blank(),a=asset();s.assets=[a];const p=F.performance(s,a);assert.equal(p.gain,200);assert.ok(Math.abs(p.rate-.02)<1e-12);assert.equal(p.days,31);assert.ok(Math.abs(p.annual-(1.02**(365/31)-1))<1e-8);});
test('new principal is not investment gain',()=>{const s=F.blank(),a=asset();s.assets=[a];s.transactions=[{date:'2026-01-15',type:'deposit',asset:'a',amount:200}];const p=F.performance(s,a);assert.equal(p.gain,0);assert.equal(p.rate,null);assert.ok(Math.abs(p.annual)<1e-8);});
test('withdrawn dividend contributes to return; end valuation already includes retained dividends',()=>{const s=F.blank(),a=asset();s.transactions=[{date:'2026-01-20',type:'withdraw',asset:'a',amount:100}];assert.equal(F.performance(s,a).gain,300);});
test('unverified cash flows must not display return',()=>{const s=F.blank(),a=asset();a.snapshots[1].confirmed=false;assert.equal(F.performance(s,a).annual,null);assert.equal(F.performance(s,a).rate,null);});
test('day-end valuation includes same-day transactions, later flows update balance',()=>{const s=F.blank(),a=asset();s.transactions=[{date:'2026-02-01',type:'deposit',asset:'a',amount:200},{date:'2026-02-02',type:'deposit',asset:'a',amount:500}];assert.equal(F.balance(s,a,'2026-02-02'),10700);});
test('internal transfer leaves combined wealth unchanged',()=>{const s=F.blank(),a=asset('a','cash'),b=asset('b','cash');s.transactions=[{date:'2026-02-02',type:'transfer',asset:'a',to:'b',amount:500}];assert.equal(F.balance(s,a,'2026-02-02')+F.balance(s,b,'2026-02-02'),20400);});
test('month-end and leap dates remain anchored',()=>{assert.deepEqual(F.occurrences({start:'2024-01-31',frequency:'monthly'},'2024-04-30'),['2024-01-31','2024-02-29','2024-03-31','2024-04-30']);});
test('due plan alone does not create investment or successful execution',()=>{const s=F.blank(),p={id:'p',start:'2026-01-01',frequency:'monthly',amount:10000};const x=F.planStats(s,p,'2026-02-01');assert.equal(x.due,2);assert.equal(x.done,0);assert.equal(x.actual,0);});
test('partial contributions affect amount completion independently of count',()=>{const s=F.blank(),p={id:'p',start:'2026-01-01',frequency:'monthly',amount:10000};s.executions=[{plan:'p',date:'2026-01-01',status:'confirmed',amount:5000},{plan:'p',date:'2026-02-01',status:'failed',amount:0}];const x=F.planStats(s,p,'2026-02-01');assert.equal(x.done,1);assert.equal(x.actual/x.expected,.25);});
test('XIRR with multiple roots is unavailable',()=>{assert.equal(F.xirr([{date:'2021-01-01',value:-100},{date:'2022-01-01',value:230},{date:'2023-01-01',value:-132}]),null);});
test('money uses integer cents and rejects excess precision',()=>{assert.equal(F.cents('0.29'),29);assert.throws(()=>F.cents('1.001'));assert.throws(()=>F.cents('NaN'));});
test('backup validation rejects dangling or duplicate records',()=>{const s=F.blank();s.assets=[asset()];F.validate(s);s.assets.push(asset());assert.throws(()=>F.validate(s));const t=F.blank();t.transactions=[{id:'x',asset:'missing',date:'2026-01-01',amount:100,type:'deposit',note:''}];assert.throws(()=>F.validate(t));});
test('backup cannot claim successful execution without real investment transaction',()=>{const s=F.blank();s.assets=[asset()];s.plans=[{id:'p',name:'计划',asset:'a',start:'2026-01-02',frequency:'monthly',amount:100}];s.executions=[{plan:'p',date:'2026-01-02',status:'confirmed',amount:100,transaction:'missing'}];assert.throws(()=>F.validate(s));});
test('valid dates reject impossible calendar dates',()=>{assert.equal(F.validDate('2026-02-30'),false);assert.equal(F.validDate('2024-02-29'),true);});
test('opening balance supports immediate same-day recording',()=>{const s=F.blank(),a=asset('a','cash');a.snapshots=[{date:'2026-01-01',value:10000,confirmed:false,opening:true}];s.transactions=[{id:'t',date:'2026-01-01',type:'expense',asset:'a',amount:500,note:''}];s.assets=[a];F.validate(s);assert.equal(F.balance(s,a,'2026-01-01'),9500);});
test('same-day opening contribution is excluded from profit',()=>{const s=F.blank(),a=asset();a.snapshots[0].opening=true;s.transactions=[{date:'2026-01-01',type:'deposit',asset:'a',amount:200}];assert.equal(F.performance(s,a).gain,0);});
test('paired local funding preserves wealth while counting actual investment',()=>{const s=F.blank(),a=asset(),b=asset('b','cash');s.assets=[a,b];s.transactions=[{id:'in',type:'deposit',asset:'a',date:'2026-02-02',amount:1000,note:''},{id:'out',type:'expense',asset:'b',date:'2026-02-02',amount:1000,note:'',linked:'in'}];F.validate(s);assert.equal(F.balance(s,a,'2026-02-02')+F.balance(s,b,'2026-02-02'),20400);});
test('backup rejects dangling funding links and sold assets with nonzero residual',()=>{const s=F.blank();s.assets=[asset('a','cash')];s.transactions=[{id:'t',type:'expense',asset:'a',date:'2026-01-02',amount:100,note:'',linked:'missing'}];assert.throws(()=>F.validate(s));const b=F.blank();const a=asset('item','item');a.sold='sale';b.assets=[a,asset('cash','cash')];b.transactions=[{id:'sale',type:'income',asset:'cash',date:'2026-02-01',amount:100,note:''}];assert.throws(()=>F.validate(b));});
test('expense breakdown excludes transfers and paired investment funding, retaining legacy expenses',()=>{
 const s=F.blank();s.assets=[asset('cash','cash'),asset('invest')];
 const tx=(id,type,amount,extra={})=>({id,type,amount,asset:'cash',date:'2026-02-02',note:'',...extra});
 s.transactions=[tx('rent','expense',300000,{category:'居住',nature:'fixed'}),tx('food','expense',2500,{category:'餐饮',nature:'variable'}),tx('repair','expense',10000,{category:'其他',nature:'occasional'}),tx('old','expense',1500),tx('transfer','transfer',5000,{to:'invest'}),tx('deposit','deposit',20000,{asset:'invest'}),tx('funding','expense',20000,{linked:'deposit'}),tx('prior','expense',999,{date:'2026-01-02'})];
 F.validate(s);const summary=F.expenseSummary(s,'2026-02');assert.equal(summary.total,314000);assert.equal(summary.natures.fixed,300000);assert.equal(summary.categories['餐饮'],2500);assert.equal(summary.natures.unclassified,1500);assert.equal(F.expenseSummary(s,'2026-03').total,0);
});
test('optional expense metadata remains backward compatible and rejects invalid classification',()=>{
 const s=F.blank();delete s.expenseTemplates;s.assets=[asset('cash','cash')];s.transactions=[{id:'t',type:'expense',asset:'cash',date:'2026-02-02',amount:100,note:''}];F.validate(s);
 const bad=patch=>{const copy=structuredClone(s);Object.assign(copy.transactions[0],patch);assert.throws(()=>F.validate(copy));};
 bad({category:'未知分类'});bad({nature:'automatic'});bad({type:'income',category:'餐饮'});bad({nature:null});
 s.transactions[0].category='餐饮';s.transactions[0].nature='variable';F.validate(JSON.parse(JSON.stringify(s)));
});
test('fixed expense templates never change balances or generate transactions by themselves',()=>{
 const s=F.blank();s.assets=[asset('cash','cash')];s.expenseTemplates=[{id:'rent',name:'房租',asset:'cash',amount:300000,category:'居住',nature:'fixed',frequency:'monthly'}];F.validate(s);assert.equal(s.transactions.length,0);assert.equal(F.balance(s,s.assets[0],'2026-03-01'),10200);assert.equal(F.expenseSummary(s,'2026-03').total,0);F.validate(JSON.parse(JSON.stringify(s)));
 for(const patch of [{asset:'missing'},{amount:0},{amount:10.5},{category:'unknown'},{nature:'unknown'},{frequency:'daily'}]){const copy=structuredClone(s);Object.assign(copy.expenseTemplates[0],patch);assert.throws(()=>F.validate(copy));}
 s.expenseTemplates.push({...s.expenseTemplates[0]});assert.throws(()=>F.validate(s));
});
test('text ledger accepts emoji markers, bullets, spacing and cents without turning investment-labelled income into deposits',()=>{
 const input='“2026-09-25 收入✔️ 投资💵  测试收入 100\n\n- 2026-09-24 支出❌ 玩🎮  测试活动 20\n- 2026-09-17 收入✔️ 投资💵  测试转卖 30\n- 2026-09-13 支出❌ 礼物🎁  测试礼物 15\n- 2026-09-10 收入✔️ 劳动💪🏻  测试工资 200\n- 2026-09-09 支出❌ 日常  骑自行车 0.29\n- 2026-09-09 支出❌ 礼物🎁  测试月饼 10\n- 2026-09-09 支出❌ 日常  测试房租 80”';
 const parsed=F.parseLedgerText(input,'2026-10-10');assert.deepEqual(parsed.errors,[]);assert.equal(parsed.rows.length,8);assert.equal(parsed.rows[0].type,'income');assert.equal(parsed.rows[0].sourceCategory,'投资');assert.equal(parsed.rows[5].amount,29);assert.equal(parsed.rows[5].category,'交通');assert.equal(parsed.rows[7].category,'居住');assert.equal(parsed.rows[7].nature,'fixed');assert.equal(parsed.rows[3].sourceCategory,'礼物');assert.equal(parsed.rows[3].category,'人情');
});
test('text ledger reports bad lines without silently fixing dates, amounts or incomplete records',()=>{
 const lines=['2026-02-30 支出❌ 日常 早餐 10','2026-10-11 收入✔️ 劳动 工资 10','2026-09-01 支出❌ 日常 早餐 1.001','2026-09-01 支出❌ 日常 早餐 -1','2026-09-01 支出❌ 日常 早餐 0','2026-09-01 支出XX 日常 早餐 10','2026-09-01 支出❌ 日常 10','2026-09-01 支出❌ 日常 早餐 0.29'];
 const parsed=F.parseLedgerText(lines.join('\r\n'),'2026-10-10');assert.equal(parsed.errors.length,7);assert.deepEqual(parsed.errors.map(e=>e.line),[1,2,3,4,5,6,7]);assert.equal(parsed.rows[0].line,8);assert.equal(parsed.rows[0].amount,29);assert.throws(()=>F.parseLedgerText('x'.repeat(150001),'2026-10-10'));assert.throws(()=>F.parseLedgerText('x\n'.repeat(1001),'2026-10-10'));assert.equal(F.parseLedgerText('  ','2026-10-10').errors.length,1);
});
test('import preview finds same-account repeats in the ledger and batch, while allowing separate accounts',()=>{
 const s=F.blank();s.assets=[asset('cash','cash'),asset('other','cash')];s.transactions=[{id:'old',type:'expense',date:'2026-09-01',asset:'cash',amount:1000,note:'测试 早餐'}];
 const r={date:'2026-09-01',type:'expense',asset:'cash',amount:1000,note:'测试   早餐',category:'餐饮',nature:'variable',sourceCategory:'日常'};
 const preview=F.ledgerImportPreview(s,[r,{...r},{...r,asset:'other'}],'2026-10-10');assert.deepEqual(preview.map(r=>r.duplicate),[true,true,false]);assert.ok(preview.every(r=>!r.error));
});
test('import errors retain original line numbers and unknown labels remain traceable',()=>{
 const parsed=F.parseLedgerText('\n\n2026-09-01 支出❌ 日常 早餐 1.001\n2026-09-02 支出❌ 自定义🌱 测试记录 1','2026-10-10');assert.equal(parsed.errors[0].line,3);assert.equal(parsed.rows[0].line,4);assert.equal(parsed.rows[0].sourceCategory,'自定义');assert.equal(parsed.rows[0].category,'其他');
});
test('import rejects dates before opening and non-cash targets, preserving the original state on every failure',()=>{
 const s=F.blank();s.assets=[asset('cash','cash'),asset('invest')];s.assets[0].snapshots=[{date:'2026-09-10',value:10000,confirmed:false,opening:true}];const before=JSON.stringify(s);
 const rows=F.parseLedgerText('2026-09-09 支出❌ 日常 早餐 10\n2026-09-11 收入✔️ 劳动 测试工资 100','2026-10-10').rows.map(r=>({...r,asset:'cash'}));
 assert.match(F.ledgerImportPreview(s,rows,'2026-10-10')[0].error,/初始盘点/);assert.throws(()=>F.importLedger(s,rows,'2026-10-10',()=>String(Math.random())));assert.equal(JSON.stringify(s),before);
 assert.throws(()=>F.importLedger(s,[{...rows[1],asset:'invest'}],'2026-10-10',()=> 'x'));assert.throws(()=>F.importLedger(s,[{...rows[1],date:'2026-10-11'}],'2026-10-10',()=> 'x'));assert.equal(JSON.stringify(s),before);
});
test('import is atomic, uses integer cents, retains source labels and invalidates later cash-flow verification',()=>{
 const s=F.blank();s.assets=[asset('cash','cash')];const before=JSON.stringify(s),rows=F.parseLedgerText('2026-01-10 收入✔️ 劳动 测试工资 20\n2026-01-11 支出❌ 日常 早餐 0.29','2026-10-10').rows.map(r=>({...r,asset:'cash'}));let n=0;
 const next=F.importLedger(s,rows,'2026-10-10',()=> 'import'+ ++n);assert.equal(JSON.stringify(s),before);assert.equal(next.transactions.length,2);assert.equal(next.transactions[1].amount,29);assert.equal(next.transactions[0].sourceCategory,'劳动');assert.equal(next.assets[0].snapshots[1].confirmed,false);F.validate(JSON.parse(JSON.stringify(next)));assert.equal(F.balance(next,next.assets[0],'2026-01-20'),11971);
 assert.throws(()=>F.importLedger(s,rows,'2026-10-10',()=> 'duplicate-id'));assert.equal(JSON.stringify(s),before);
 const bad=structuredClone(next);bad.transactions[0].sourceCategory='x'.repeat(41);assert.throws(()=>F.validate(bad));
});
