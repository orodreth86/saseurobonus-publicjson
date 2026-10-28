import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {canonical,compare,normalize,updateHistory,renderSite,dayInOslo,rewardDirection} from '../scripts/build-daily-news.mjs';
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
