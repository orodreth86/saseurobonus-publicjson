import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {canonical,compare,normalize,updateHistory,renderSite,dayInOslo,rewardDirection,topIncreases} from '../scripts/build-daily-news.mjs';
const at = day => new Date(`2026-10-${day}T20:00:00Z`);
const shop=(overrides={})=>({name:'LEGO',domain:'lego.com',slug:'lego',sasbonus:'25 poeng / 100kr',trumfbonus:'1,5 % (20.3 poeng / 100kr)',sasurl:'https://example.com/lego',trumfurl:'https://example.com/trumf',...overrides});
const feed=(date,shops=[shop()])=>({generated_at:date.toISOString(),shops});
test('baseline does not announce every shop; rerun keeps previous day as baseline',()=>{
 let h=updateHistory(null,feed(at('20')),at('20'));assert(h.editions[0].baseline);assert.equal(h.editions[0].added.length,0);
 h=updateHistory(h,feed(at('21'),[shop({sasbonus:'50 poeng / 100kr'})]),at('21'));
 assert.equal(h.editions[0].changed[0].offers[0].before,'25 poeng / 100kr');
 h=updateHistory(h,feed(at('21'),[shop({sasbonus:'75 poeng / 100kr'})]),at('21'));
 assert.equal(h.editions[0].changed[0].offers[0].before,'25 poeng / 100kr');assert.equal(h.editions.length,2);
});
test('formatting, decimal style and derived conversion are quiet',()=>{
 assert.equal(canonical('1,50 % (20.3 poeng / 100kr)','trumf'),canonical('1.5% (99 poeng / 100kr)','trumf'));
 const a=normalize(feed(at('20')),at('20')).shops;
 const b=normalize(feed(at('20'),[shop({sasbonus:'25 poeng/100kr',trumfbonus:'1.5% (99 poeng / 100kr)',name:'New name',slug:'new-slug'})]),at('20')).shops;
 assert.equal(compare(a,b).changed.length,0);
});
test('added, removed, provider availability and up-to qualifiers',()=>{
 const a=normalize(feed(at('20'),[shop(),shop({domain:'old.no'})]),at('20')).shops;
 const b=normalize(feed(at('20'),[shop({sasbonus:'',trumfbonus:'Opptil 1,5 %'}),shop({domain:'new.no'})]),at('20')).shops;
 const d=compare(a,b);assert.equal(d.added.length,1);assert.equal(d.removed.length,1);assert.equal(d.changed[0].offers.length,2);
});
test('stale feed, empty feed, corrupt state, conflicting duplicate and mass removal rejected',()=>{
 assert.throws(()=>normalize(feed(at('20'),[]),at('20')));
 assert.throws(()=>normalize(feed(at('20')),at('22')));
 assert.throws(()=>updateHistory({version:8},feed(at('20')),at('20')));
 assert.throws(()=>normalize(feed(at('20'),[shop(),shop({sasbonus:'50'})]),at('20')));
 const h=updateHistory(null,feed(at('20'),[shop(),shop({domain:'second.no'})]),at('20'));
 assert.throws(()=>updateHistory(h,feed(at('21')),at('21')));
});
test('duplicate complementary rows merge; zero reward stays visible',()=>{
 const rows=normalize(feed(at('20'),[shop({sasbonus:''}),shop({trumfbonus:'',sasbonus:'0 poeng'})]),at('20')).shops;
 assert.equal(rows.length,1);assert.equal(rows[0].flight,'0 poeng');assert(rows[0].trumf);
});
test('Oslo date boundaries and missing-day comparison',()=>{
 assert.equal(dayInOslo(new Date('2026-10-20T22:30:00Z')),'2026-10-21');
 let h=updateHistory(null,feed(at('20')),at('20'));h=updateHistory(h,feed(at('23')),at('23'));
 assert.equal(h.editions[0].comparedWith,'2026-10-20');
});
test('HTML escaping, direct shop links, timeline, archive and RSS removal',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'bonus-news-test-'));
 let h=updateHistory(null,feed(at('20')),at('20'));
 h=updateHistory(h,feed(at('21'),[shop({name:'<script>&Shop',sasbonus:'50 poeng',sasurl:'javascript:alert(1)'})]),at('21'));
 h=updateHistory(h,feed(at('22'),[shop({name:'<script>&Shop',sasbonus:'50 poeng',sasurl:'javascript:alert(1)'})]),at('22'));
 await fs.writeFile(path.join(out,'rss.xml'),'old feed');
 await renderSite(h,out,'https://example.com/news/');
 const html=await fs.readFile(path.join(out,'days/2026-10-21.html'),'utf8');
 assert(html.includes('&lt;script&gt;&amp;Shop'));assert(!html.includes('javascript:'));assert(!html.includes('<script>'));
 await assert.rejects(fs.access(path.join(out,'rss.xml')));
 assert(html.includes('href="https://lego.com/"'));
 const front=await fs.readFile(path.join(out,'index.html'),'utf8');
 assert(!front.includes('Link to this day'));
 assert(!front.includes('What changed?'));
 assert(front.includes('Get Flight Bonus Notifier Extension'));
 assert(front.includes('See the latest changes in bonus point changes for Trumf and EB points.'));
 assert((await fs.readFile(path.join(out,'index.html'),'utf8')).includes('No bonus or shop changes'));
 assert((await fs.readFile(path.join(out,'archive.html'),'utf8')).includes('2026-10-20'));
 await fs.rm(out,{recursive:true});
});

test('arrows only compare like-for-like rewards',()=>{
 assert.equal(rewardDirection('25 poeng / 100kr','50 poeng / 100kr','flight'),1);
 assert.equal(rewardDirection('6,2 % (83.7 poeng / 100kr)','3,1 % (41.9 poeng / 100kr)','trumf'),-1);
 assert.equal(rewardDirection('Opptil 5%','Opptil 10%','trumf'),1);
 for(const [a,b] of [['10%','100kr'],['','10%'],['10-20%','30%'],['Opptil 10%','5%'],['20 poeng','30 poeng / 100kr']]) assert.equal(rewardDirection(a,b,'trumf'),0);
});

test('highlights rank increases by relative growth, skipping decreases and zero baselines',()=>{
 const offer=(name,before,after)=>({name,before,after,provider:'flight'});
 const top=topIncreases([offer('Small','100 poeng','110 poeng'),offer('Double','25 poeng','50 poeng'),offer('Triple','10 poeng','30 poeng'),offer('Decrease','20 poeng','10 poeng'),offer('Zero','0 poeng','10 poeng')]);
 assert.deepEqual(top.map(o=>o.name),['Triple','Double']);
 assert.equal(top[0].growth,2);
});

test('private changelog import preserves timestamps, filters formatting, and joins explicit domains',async()=>{
 const {importChangelog,buildShopIndex}=await import('../scripts/shop-history.mjs');
 const text='## 2025-09-01T12:00:00.000Z\n### Added\n- **computersalg** (Computersalg) — bonus: `10 points/100kr`, url: https://example.com\n## 2026-10-20T12:00:00.000Z\n### Changed\n- **computersalg** (CS Megastore): **domain**: `∅` → `csmegastore.no`; **sasbonus**: `10 poeng / 100kr` → `20 poeng / 100kr`\n- **@csmegastore.no** (CS Megastore): **trumfbonus**: `1,5% (20.3 poeng / 100kr)` → `1,5 % (20.3 poeng / 100kr)`';
 const seed=importChangelog(text);assert.equal(seed.events.length,2);assert.equal(seed.report.ignoredFormatting,1);assert.equal(seed.events[0].at,'2025-09-01T12:00:00.000Z');
 const current={generated_at:'2026-10-21T12:00:00Z',shops:[{name:'CS Megastore',slug:'computersalg',domain:'csmegastore.no',sasbonus:'20 poeng / 100kr'}]};
 const e={date:'2026-10-20',publishedAt:'2026-10-20T21:45:00Z',added:[],changed:[{key:'domain:csmegastore.no',name:'CS Megastore',offers:[{provider:'flight',before:'10 poeng / 100kr',after:'20 poeng / 100kr'}]}]};
 const index=buildShopIndex(seed,{editions:[e]},current);
 assert.equal(index.shops.length,1);assert.equal(index.shops[0].events.length,2);assert.equal(index.shops[0].current.flight,'20 poeng / 100kr');assert(index.shops[0].aliases.includes('Computersalg'));
 // Another intraday change must survive, even if the daily summary has the same ending value.
 const seed2=importChangelog(text+'\n## 2026-10-20T14:00:00.000Z\n### Changed\n- **computersalg** (CS Megastore): **sasbonus**: `20 poeng / 100kr` → `30 poeng / 100kr`');
 assert.equal(buildShopIndex(seed2,{editions:[]},current).shops[0].events.length,3);
});
test('search page is generated with data and navigation',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'shop-search-test-'));
 const h=updateHistory(null,feed(at('20')),at('20'));await renderSite(h,out,'https://example.com/');
 const page=await fs.readFile(path.join(out,'shops.html'),'utf8');assert(page.includes('Search shop changes'));assert(page.includes('shop-search.js'));
 const index=JSON.parse(await fs.readFile(path.join(out,'shop-history.json'),'utf8'));assert(index.shops.find(s=>s.domain==='lego.com'&&s.current));assert(index.shops.every(s=>s.patterns?.flight&&s.patterns?.trumf));
 assert((await fs.readFile(path.join(out,'index.html'),'utf8')).includes('shops.html'));
 await fs.rm(out,{recursive:true});
});

test('recurring promotions require three complete consistent cycles and matching units',async()=>{
 const {analyzeBonusPatterns}=await import('../scripts/bonus-patterns.mjs');
 const start=Date.parse('2026-01-01T00:00:00Z'),day=86400000;
 const event=(d,before,after,provider='trumf',kind='change')=>({at:new Date(start+d*day).toISOString(),before,after,provider,kind});
 const cycles=[0,56,112].flatMap(d=>[event(d,'3,5%','5%'),event(d+7,'5%','3,5%')]);
 const good=analyzeBonusPatterns({events:cycles},'trumf');assert.equal(good.status,'possible-pattern');assert.equal(good.count,3);assert.deepEqual(good.spacingDays,[56,56]);assert.deepEqual(good.durationDays,[7,7,7]);assert(good.summary.includes('8 weeks'));
 assert.equal(analyzeBonusPatterns({events:cycles.slice(0,5)},'trumf').status,'insufficient-pattern');
 const irregular=[0,35,140].flatMap(d=>[event(d,'3,5%','5%'),event(d+7,'5%','3,5%')]);assert.equal(analyzeBonusPatterns({events:irregular},'trumf').status,'insufficient-pattern');
 const interrupted=cycles.flatMap(e=>e.after==='5%'?[e,event((Date.parse(e.at)-start)/day+2,'5%','')]:[e]);assert.equal(analyzeBonusPatterns({events:interrupted},'trumf').status,'insufficient-pattern');
 const mixed=cycles.map(e=>({...e,after:e.after==='5%'?'500kr':e.after}));assert.equal(analyzeBonusPatterns({events:mixed},'trumf').status,'insufficient-pattern');
 assert.equal(analyzeBonusPatterns({events:cycles},'flight').status,'insufficient-pattern');
 const formatted=cycles.flatMap(e=>[e,event((Date.parse(e.at)-start)/day+.1,e.after,e.after+' (67.5 poeng / 100kr)')]);assert.equal(analyzeBonusPatterns({events:formatted},'trumf').count,3);
 const conflicting=cycles.flatMap(e=>e.after==='5%'?[e,event((Date.parse(e.at)-start)/day+3,'9%','5%')]:[e]);assert.equal(analyzeBonusPatterns({events:conflicting},'trumf').status,'insufficient-pattern');
 assert.equal(analyzeBonusPatterns({events:[]},'trumf').status,'insufficient-pattern');
});

test('pattern ignores redundant availability assertions from merged rows',async()=>{
 const {analyzeBonusPatterns}=await import('../scripts/bonus-patterns.mjs');
 const start=Date.parse('2026-01-01T00:00:00Z'),day=86400000;
 const ev=(d,before,after)=>({at:new Date(start+d*day).toISOString(),before,after,provider:'trumf',kind:'change'});
 const events=[0,56,112].flatMap(d=>[ev(d,'3,5%','5%'),ev(d+2,'','5%'),ev(d+7,'5%','3,5%')]);
 assert.equal(analyzeBonusPatterns({events},'trumf').count,3);
});
