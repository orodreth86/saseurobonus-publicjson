import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
export const dayInOslo = date => new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function canonical(value, provider) {
  let s = String(value ?? '').normalize('NFKC').toLowerCase();
  if (provider === 'trumf') s = s.replace(/\([^)]*poeng[^)]*\)/g, ''); // Derived conversion is not a cashback change.
  return s.replace(/\d+(?:[.,]\d+)?/g, n => String(Number(n.replace(',', '.')))).replace(/\s+/g, '');
}
export function normalize(feed, now) {
  if (!feed || !Array.isArray(feed.shops) || !feed.shops.length) throw Error('Empty or invalid shop feed; previous report retained.');
  const stamp = new Date(feed.generated_at);
  if (!Number.isFinite(stamp.getTime())) throw Error('Feed has no valid generated_at timestamp.');
  if (now - stamp > 36*3600000 || stamp - now > 5*60000) throw Error('Feed timestamp is stale or in the future; refusing to report misleading changes.');
  const shops = new Map();
  for (const row of feed.shops) {
    if (!row || typeof row.name !== 'string') throw Error('Invalid shop row.');
    const domain = String(row.domain || '').trim().toLowerCase().replace(/^www\./,'');
    const key = domain ? `domain:${domain}` : row.slug ? `slug:${row.slug}` : row.trumfurl ? `trumf:${row.trumfurl}` : '';
    if (!key) throw Error(`No stable identity for ${row.name}`);
    const shop = {key, domain, name:row.name, flight:String(row.sasbonus || '').trim(), trumf:String(row.trumfbonus || '').trim(), flightURL:safeURL(row.sasurl), trumfURL:safeURL(row.trumfurl)};
    if (!shops.has(key)) shops.set(key,shop);
    else {
      const old=shops.get(key);
      for (const p of ['flight','trumf']) {
        if (old[p] && shop[p] && canonical(old[p],p)!==canonical(shop[p],p)) throw Error(`Conflicting duplicate domain: ${domain}`);
        if (!old[p] && shop[p]) { old[p]=shop[p];old[p+'URL']=shop[p+'URL']; }
      }
    }
  }
  return {sourceAt:stamp.toISOString(),shops:[...shops.values()].sort((a,b)=>a.key.localeCompare(b.key))};
}
export function compare(before, after) {
  const old = new Map(before.map(s=>[s.key,s])), current = new Map(after.map(s=>[s.key,s]));
  const added=[],removed=[],changed=[];
  for (const s of after) {
    const previous=old.get(s.key);
    if (!previous) {added.push(s);continue;}
    const offers=[];
    for (const provider of ['flight','trumf']) if (canonical(previous[provider],provider)!==canonical(s[provider],provider)) {
      offers.push({provider,before:previous[provider],after:s[provider],url:s[provider+'URL']});
    }
    if (offers.length) changed.push({...s,offers});
  }
  for (const s of before) if (!current.has(s.key)) removed.push(s);
  const sort=list=>list.sort((a,b)=>a.name.localeCompare(b.name,'nb'));
  return {added:sort(added),removed:sort(removed),changed:sort(changed)};
}
export function updateHistory(history, feed, now=new Date()) {
  const date=dayInOslo(now), snapshot={date,...normalize(feed,now)};
  if (history && (history.version!==1 || !Array.isArray(history.snapshots) || !history.snapshots.length || !Array.isArray(history.editions))) throw Error('Invalid history; refusing to reset it.');
  const previous=history?.snapshots.filter(s=>s.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if (history?.snapshots.some(s=>s.date>date)) throw Error('Clock precedes recorded history.');
  if (previous && snapshot.shops.length<previous.shops.length*.8) throw Error('Shop count dropped by more than 20%; investigate before publishing.');
  const diff=previous?compare(previous.shops,snapshot.shops):{added:[],removed:[],changed:[]};
  const edition={date,comparedWith:previous?.date || null,baseline:!previous,sourceAt:snapshot.sourceAt,publishedAt:now.toISOString(),shopCount:snapshot.shops.length,...diff};
  const editions=[...(history?.editions || []).filter(e=>e.date!==date),edition].sort((a,b)=>b.date.localeCompare(a.date));
  const snapshots=[...(history?.snapshots || []).filter(s=>s.date!==date),snapshot].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,2);
  return {version:1,snapshots,editions};
}
const total=e=>e.changed.length+e.added.length+e.removed.length;
const summary=e=>e.baseline?'Tracking started':total(e)?`${e.changed.length} bonus changes · ${e.added.length} new shops · ${e.removed.length} removed`:'No bonus or shop changes';
const rate=v=>escape(v || 'Not available');
const shopName = shop => {
  const name = escape(shop.name);
  const domain = String(shop.domain || '').trim();
  // Accept a hostname only, never a path, credentials, or an arbitrary URL.
  if (!domain || /[\s/:?#@\\]/.test(domain)) return name;
  try {
    const url = new URL(`https://${domain}`);
    if (!url.hostname.includes('.') || url.username || url.password) return name;
    return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  } catch { return name; }
};
// Compare only simple rewards with the same unit, qualifier, and denominator.
// Text/range rewards and newly available offers have no numeric direction.
export function rewardDirection(before, after, provider) {
  function parse(value) {
    let text = String(value || '').normalize('NFKC').toLowerCase().trim();
    if (provider === 'trumf') text = text.replace(/\([^)]*poeng[^)]*\)/g, '').trim();
    const match = text.match(/^(opptil\s+)?(\d+(?:[.,]\d+)?)\s*(%|kr|poeng)(?:\s*(?:\/|per)\s*(\d+(?:[.,]\d+)?)\s*(?:nok|kr))?$/);
    if (!match) return null;
    return {value:Number(match[2].replace(',', '.')), unit:match[3], cap:!!match[1], denominator:match[4] ? Number(match[4].replace(',', '.')) : null};
  }
  const a=parse(before), b=parse(after);
  if (!a || !b || a.unit!==b.unit || a.cap!==b.cap || a.denominator!==b.denominator) return 0;
  return Math.sign(b.value-a.value);
}
const directionMark = offer => {
  const d=rewardDirection(offer.before,offer.after,offer.provider);
  return d ? `<span class="direction ${d>0?'up':'down'}" role="img" aria-label="Bonus ${d>0?'increased':'decreased'}" title="Bonus ${d>0?'increased':'decreased'}">${d>0?'↑':'↓'}</span>` : '';
};
function body(e) {
  if (e.baseline) return '<p class="notice">Tracking starts here. Today’s rates are saved as the baseline; the next daily report will show what changed.</p>';
  let html=!total(e)?'<p class="notice">No bonus or shop changes since the previous snapshot.</p>':'';
  if (e.changed.length) html+='<h2>Bonus changes</h2><div class="table-wrap"><table><thead><tr><th>Shop</th><th>Offer</th><th>Previous</th><th>Latest</th></tr></thead><tbody>'+e.changed.map(s=>s.offers.map((o,i)=>`<tr><td>${i===0?`<strong>${shopName(s)}</strong><small>${escape(s.domain)}</small>`:''}</td><td>${o.provider==='flight'?'Flight points':'Trumf'}</td><td class="before">${rate(o.before)}</td><td>${o.url?`<a href="${escape(o.url)}" rel="noopener noreferrer">${rate(o.after)}</a>`:rate(o.after)} ${directionMark(o)}</td></tr>`).join('')).join('')+'</tbody></table></div>';
  for (const [key,label] of [['added','New shops'],['removed','Removed from the feed']]) if(e[key].length) html+=`<h2>${label}</h2><ul class="shops">`+e[key].map(s=>`<li><strong>${shopName(s)}</strong><small>${escape(s.domain)}</small><span>Flight points: ${rate(s.flight)}<br>Trumf: ${rate(s.trumf)}</span></li>`).join('')+'</ul>';
  return html;
}
const css=`[hidden]{display:none!important}.day{background:white;border:1px solid #d5e1de;border-radius:14px;margin:16px 0;overflow:hidden}.day summary{cursor:pointer;padding:20px;list-style-position:inside}.day summary:focus-visible,button:focus-visible{outline:3px solid #006d68;outline-offset:3px}.day-title{font-weight:750;font-size:20px}.day-summary{display:block;margin:8px 0;color:#53686e;font-size:14px}.highlight{display:block;font-size:14px;margin-top:8px}.day-body{padding:0 20px 20px;border-top:1px solid #e7eeeb}.direction{font-size:22px;font-weight:900;white-space:nowrap;vertical-align:middle}.up{color:#16713d}.down{color:#bb3038}.timeline-tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.timeline-tools select,button{font:inherit;padding:10px 16px;border:1px solid #006d68;border-radius:8px;background:white;color:#006d68}.more{display:block;margin:24px auto}.day[open] summary{background:#f6faf8}.day-body h2{font-size:18px}:root{color-scheme:light;--ink:#172b31;--muted:#53686e;--accent:#006d68}*{box-sizing:border-box}body{margin:0;background:#f3f6f5;color:var(--ink);font:16px/1.6 system-ui,sans-serif}a{color:var(--accent);text-underline-offset:3px}header,main,footer{max-width:1040px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center;gap:20px;border-bottom:1px solid #d5e1de}.brand{font-weight:800;text-decoration:none;color:var(--ink)}nav{display:flex;gap:20px;font-size:14px}.extension-links{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 20px;margin-bottom:26px;background:#e7f1ed;border:1px solid #cfdfd8;border-radius:12px}.extension-links p{margin:2px 0 0;font-size:14px;color:var(--muted)}.extension-buttons{display:flex;gap:10px;flex-wrap:wrap}.extension-buttons a{display:inline-block;padding:9px 14px;border:1px solid var(--accent);border-radius:8px;font-size:14px;font-weight:650;text-decoration:none;background:white}.extension-buttons a:hover{background:#dcece6}.extension-buttons a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.eyebrow{font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:var(--accent);font-weight:750;margin:16px 0 8px}h1{font-size:clamp(30px,5vw,52px);line-height:1.12;letter-spacing:-.04em;margin:0 0 16px}h2{font-size:21px;margin:30px 0 14px}.intro{max-width:720px;color:var(--muted)}.stats{display:flex;gap:12px;margin:24px 0;flex-wrap:wrap}.stat{flex:1;min-width:140px;background:white;border:1px solid #dce5e2;border-radius:12px;padding:16px}.stat b{display:block;font-size:32px;line-height:1.2}.stat span{color:var(--muted);font-size:13px}.table-wrap{overflow:auto;background:white;border:1px solid #dce5e2;border-radius:12px}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}th{background:#e7efec;font-size:12px;text-transform:uppercase;letter-spacing:.04em}th,td{padding:14px 16px;vertical-align:top;border-bottom:1px solid #e7eeeb}tbody tr:last-child td{border:0}small{display:block;color:var(--muted);font-size:12px;font-weight:400}.before{color:var(--muted)}.shops{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;list-style:none;padding:0}.shops li{padding:16px;background:white;border:1px solid #dce5e2;border-radius:12px}.shops span{display:block;margin-top:10px;font-size:13px}.notice{padding:20px;border-left:4px solid var(--accent);background:#e7f1ed;border-radius:4px}.archive{list-style:none;padding:0}.archive li{padding:16px 0;border-bottom:1px solid #d5e1de;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.archive span{font-size:14px;color:var(--muted)}footer{font-size:13px;color:var(--muted);border-top:1px solid #d5e1de;margin-top:32px}.subscribe{padding:20px;background:white;border:1px solid #dce5e2;border-radius:12px;margin-top:32px;overflow-wrap:anywhere}code{font-size:13px}@media(max-width:600px){header,main,footer{padding:18px}header{align-items:flex-start;flex-direction:column;gap:8px}th,td{padding:10px}.stat{min-width:90px;padding:12px}.stat b{font-size:26px}nav{gap:16px}}`;
function shell(title, content, base) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Flight Bonus Notifier</title><meta name="description" content="Daily changes to shopping rewards, cashback and participating shops."><style>${css}</style></head><body><header><a class="brand" href="${escape(base)}">Flight Bonus Notifier</a><nav><a href="${escape(base)}">Latest</a></nav></header><main><aside class="extension-links" aria-label="Get Flight Bonus Notifier"><div><strong>Get Flight Bonus Notifier</strong><p>See available rewards while you shop.</p></div><div class="extension-buttons"><a href="https://chromewebstore.google.com/detail/flight-bonus-notifier/ehejhmfpckifdnhbjkkpifljglejmjen" target="_blank" rel="noopener noreferrer">Get it for Chrome ↗</a><a href="https://addons.mozilla.org/en-US/firefox/addon/flight-bonus-notifier/" target="_blank" rel="noopener noreferrer">Get it for Firefox ↗</a></div></aside>${content}</main><footer>Daily snapshots of published offers. Check the linked shop offer for current rates, exclusions and conditions. A removed shop means it is absent from the feed, not necessarily closed. No email address or account required.</footer></body></html>`;
}
function editionContent(e,base) {
  return `<p class="eyebrow">Daily briefing · ${escape(e.date)} · Norway</p><h1>Daily bonus changes</h1><p class="intro">${e.baseline?'Your daily view of shopping rewards starts here.':`Compared with the snapshot from ${escape(e.comparedWith)}. Changes that reverse between snapshots are not included.`}</p><div class="stats"><div class="stat"><b>${e.changed.length}</b><span>Shops with bonus changes</span></div><div class="stat"><b>${e.added.length}</b><span>New shops</span></div><div class="stat"><b>${e.removed.length}</b><span>Removed shops</span></div></div><p><small>Source updated: ${escape(e.sourceAt)} · ${e.shopCount} shops tracked</small></p>${body(e)}`;
}
function highlights(e) {
  const offers=e.changed.flatMap(s=>s.offers.map(o=>({...o,name:s.name})));
  const up=offers.filter(o=>rewardDirection(o.before,o.after,o.provider)>0).length;
  const down=offers.filter(o=>rewardDirection(o.before,o.after,o.provider)<0).length;
  const other=offers.length-up-down;
  const counts=[up?`${up} increases`:null,down?`${down} decreases`:null,other?`${other} other offer changes`:null,e.added.length?`${e.added.length} added shops`:null,e.removed.length?`${e.removed.length} removed shops`:null].filter(Boolean);
  const examples=offers.slice().sort((a,b)=>rewardDirection(b.before,b.after,b.provider)-rewardDirection(a.before,a.after,a.provider)).slice(0,2).map(o=>`<span class="highlight">${escape(o.name)} · ${o.provider==='flight'?'Flight points':'Trumf'}: ${rate(o.before)} → <strong>${rate(o.after)}</strong> ${directionMark(o)}</span>`).join('');
  const names=[e.added.length?`Added: ${e.added.slice(0,3).map(s=>s.name).join(', ')}${e.added.length>3?'…':''}`:'',e.removed.length?`Removed: ${e.removed.slice(0,3).map(s=>s.name).join(', ')}${e.removed.length>3?'…':''}`:''].filter(Boolean).map(t=>`<span class="highlight">${escape(t)}</span>`).join('');
  return `<span class="day-summary">${escape(e.baseline?'Tracking started':counts.join(' · ') || 'No changes recorded')}</span>${examples}${names}`;
}
function timeline(editions,base) {
  const months=[...new Set(editions.map(e=>e.date.slice(0,7)))];
  const cards=editions.map((e,i)=>`<details class="day" data-date="${escape(e.date)}"${i===0?' open':''}><summary><span class="day-title">${escape(new Intl.DateTimeFormat('en-GB',{dateStyle:'full',timeZone:'UTC'}).format(new Date(e.date+'T12:00:00Z')))}</span>${highlights(e)}<small>Expand for all changes</small></summary><div class="day-body"><p><small>${e.baseline?'Initial snapshot':`Compared with ${escape(e.comparedWith)}`} · ${e.shopCount} shops tracked</small></p>${body(e)}<p><a href="${escape(base)}days/${escape(e.date)}.html">Link to this day</a></p></div></details>`).join('');
  return `<p class="eyebrow">Your daily shopping update</p><h1>What changed?</h1><p class="intro">Catch up on the latest bonuses and shops. Expand any day for the full picture. Shop names take you straight to the store.</p><div class="timeline-tools"><label for="month">Jump to month</label><select id="month"><option value="">Latest updates</option>${months.map(m=>`<option value="${escape(m)}">${escape(m)}</option>`).join('')}</select><span id="range" role="status" aria-live="polite"></span></div><div id="timeline">${cards}</div><button id="more" class="more" type="button" hidden>Load 7 more days</button><noscript><p>All recorded days are shown below when JavaScript is disabled.</p></noscript><script>
  (()=>{
    const cards=Array.from(document.querySelectorAll('.day'));
    const more=document.getElementById('more'), month=document.getElementById('month'), status=document.getElementById('range');
    let shown=7;
    function render(){
      const selected=cards.filter(c=>!month.value || c.dataset.date.startsWith(month.value));
      cards.forEach(c=>{c.hidden=true});
      selected.slice(0,shown).forEach(c=>{c.hidden=false});
      more.hidden=shown>=selected.length;
      status.textContent='Showing '+Math.min(shown,selected.length)+' of '+selected.length+' recorded days';
    }
    more.addEventListener('click',()=>{shown+=7;render()});
    month.addEventListener('change',()=>{shown=7;render()});
    render();
  })();
  </script>`;
}
export async function renderSite(history, output, siteURL) {
  const base=new URL(siteURL.endsWith('/')?siteURL:siteURL+'/').href;
  if (!/^https?:/.test(base)) throw Error('SITE_URL must be an HTTP(S) URL.');
  await fs.mkdir(path.join(output,'days'),{recursive:true});
  const latest=history.editions[0];
  await fs.writeFile(path.join(output,'index.html'),shell('Daily bonus changes',timeline(history.editions,base),base));
  for(const e of history.editions) await fs.writeFile(path.join(output,'days',e.date+'.html'),shell(e.date,editionContent(e,base),base));
  const archive='<p class="eyebrow">The daily record</p><h1>Previous updates</h1><ul class="archive">'+history.editions.map(e=>`<li><a href="${escape(base)}days/${e.date}.html">${e.date}</a><span>${escape(summary(e))}</span></li>`).join('')+'</ul>';
  await fs.writeFile(path.join(output,'archive.html'),shell('Archive',archive,base));
  await fs.rm(path.join(output,'rss.xml'),{force:true});
  await fs.writeFile(path.join(output,'.nojekyll'),'');
}
export async function main() {
  const input=process.env.NEWS_INPUT || 'data/sasshops.json', historyPath=process.env.NEWS_HISTORY || '.daily-news/history.json';
  let history=null;
  try {history=JSON.parse(await fs.readFile(historyPath,'utf8'));} catch(e){if(e.code!=='ENOENT')throw e;}
  const feed=JSON.parse(await fs.readFile(input,'utf8'));
  const updated=updateHistory(history,feed);
  await renderSite(updated,process.env.NEWS_OUTPUT || '_site',process.env.SITE_URL || 'https://orodreth86.github.io/saseurobonus-publicjson/');
  await fs.mkdir(path.dirname(historyPath),{recursive:true});
  await fs.writeFile(historyPath,JSON.stringify(updated,null,2)+'\n');
  console.log(`${updated.editions[0].date}: ${summary(updated.editions[0])}`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(e=>{console.error(e);process.exitCode=1;});
