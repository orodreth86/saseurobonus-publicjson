import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const cleanReward=v=>String(v??'').replace(/^∅$/,'').replace(/\bpoints\b/gi,'poeng').trim();
export function comparable(v,provider) {
 let text=cleanReward(v).normalize('NFKC').toLowerCase();
 if(provider==='trumf')text=text.replace(/\([^)]*poeng[^)]*\)/g,'');
 return text.replace(/\d+(?:[.,]\d+)?/g,n=>String(Number(n.replace(',','.')))).replace(/\s+/g,'');
}
const identity=(id)=>id.startsWith('@')?`domain:${id.slice(1).toLowerCase().replace(/^www\./,'')}`:`slug:${id}`;
export function importChangelog(text) {
 const events=[],aliases=[],names={};let at='',section='',lines=0,ignoredFormatting=0;
 for(const line of text.split(/\r?\n/)){
  const stamp=line.match(/^## (\d{4}-\d\d-\d\dT\S+)/);if(stamp){at=new Date(stamp[1]).toISOString();section='';continue;}
  const heading=line.match(/^### (.+)/);if(heading){section=heading[1];continue;}
  const row=line.match(/^- \*\*(.+?)\*\* \((.*?)\)(.*)$/);if(!row||!at)continue;
  lines++;const [,raw,name,rest]=row,id=identity(raw);names[id]=name;
  const domain=rest.match(/\*\*domain\*\*: `([^`]*)` → `([^`]*)`/);
  if(domain)for(const d of domain.slice(1))if(d&&d!=='∅')aliases.push([id,identity('@'+d)]);
  const push=(provider,before,after,kind)=>{
   before=cleanReward(before);after=cleanReward(after);
   if(!before&&!after)return;
   if(kind==='change'&&comparable(before,provider)===comparable(after,provider)){ignoredFormatting++;return;}
   events.push({id,name,at,provider,before,after,kind,source:'Imported changelog'});
  };
  if(section==='Added'){
   const single=rest.match(/— bonus: `([^`]*)`/);if(single)push('flight','',single[1],'observation');
   for(const [field,provider] of [['sas','flight'],['trumf','trumf']]){const m=rest.match(new RegExp(field+': `([^`]*)`'));if(m)push(provider,'',m[1],'observation');}
  }
  if(section==='Changed')for(const [field,provider] of [['sasbonus','flight'],['trumfbonus','trumf']]){
   const m=rest.match(new RegExp('\\*\\*'+field+'\\*\\*: `([^`]*)` → `([^`]*)`'));if(m)push(provider,m[1],m[2],'change');
  }
 }
 return {version:1,through:at,events,aliases,names,report:{shopRows:lines,events:events.length,ignoredFormatting}};
}
export function buildShopIndex(seed,history,feed) {
 const parent=new Map();const find=x=>{if(!parent.has(x))parent.set(x,x);if(parent.get(x)!==x)parent.set(x,find(parent.get(x)));return parent.get(x)};
 const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(a,b)};
 for(const [a,b] of seed.aliases||[])union(a,b);
 const domainId=d=>'domain:'+String(d).toLowerCase().replace(/^www\./,'');
 for(const s of feed.shops)if(s.slug&&s.domain)union('slug:'+s.slug,domainId(s.domain));
 // Old daily snapshots may omit the slug, but the current feed provides that join.
 const all=[...(seed.events||[])];
 for(const e of history.editions){
  for(const s of e.changed)for(const o of s.offers)all.push({id:s.key,name:s.name,at:e.publishedAt,day:e.date,provider:o.provider,before:o.before,after:o.after,kind:'change',source:'Daily snapshot'});
  for(const s of e.added)for(const provider of ['flight','trumf'])if(s[provider])all.push({id:s.key,name:s.name,at:e.publishedAt,day:e.date,provider,before:'',after:s[provider],kind:'observation',source:'Daily snapshot'});
 }
 const shops=new Map();const get=(id,name)=>{id=find(id);if(!shops.has(id))shops.set(id,{id,name,aliases:[],domain:'',current:null,events:[]});return shops.get(id)};
 const signatures=new Set();
 // Keep precise imported runs over daily summaries for the SAME day/provider transition.
 const signature=e=>[find(e.id),e.day||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.at)),e.provider,comparable(e.before,e.provider),comparable(e.after,e.provider)].join('|');
 const imported=new Set((seed.events||[]).map(signature));
 for(const e of all.sort((a,b)=>a.at.localeCompare(b.at))){
  const s=get(e.id,e.name);s.name=e.name;if(!s.aliases.includes(e.name))s.aliases.push(e.name);
  if(e.source==='Daily snapshot'&&imported.has(signature(e)))continue;
  const before=cleanReward(e.before),after=cleanReward(e.after);
  if(e.kind==='change'&&comparable(before,e.provider)===comparable(after,e.provider))continue;
  const sig=[s.id,e.at,e.provider,before,after,e.kind].join('|');if(signatures.has(sig))continue;signatures.add(sig);
  s.events.push({...e,id:s.id,before,after});
 }
 for(const s of feed.shops){const id=s.domain?domainId(s.domain):'slug:'+s.slug;const shop=get(id,s.name);shop.name=s.name;shop.domain=s.domain||'';shop.current={flight:cleanReward(s.sasbonus),trumf:cleanReward(s.trumfbonus),at:feed.generated_at};if(!shop.aliases.includes(s.name))shop.aliases.push(s.name);}
 return {version:1,updatedAt:feed.generated_at,importThrough:seed.through||null,shops:[...shops.values()].map(s=>({...s,events:s.events.sort((a,b)=>b.at.localeCompare(a.at))})).sort((a,b)=>a.name.localeCompare(b.name,'nb'))};
}
export async function renderShopSearch(history,feed,output,base,shell,escape){
 let seed={events:[],aliases:[]};try{seed=JSON.parse(await fs.readFile('data/shop-history-seed.json','utf8'));if(seed.version!==1||!Array.isArray(seed.events)||!Array.isArray(seed.aliases))throw Error('Invalid shop history seed');}catch(e){if(e.code!=='ENOENT')throw e;}
 const index=buildShopIndex(seed,history,feed);
 await fs.writeFile(path.join(output,'shop-history.json'),JSON.stringify(index));
 const content=`<h1>Search shop changes</h1><p class="intro">Look up previous bonuses and how often they changed in our records.</p><label for="shop-query">Shop name or domain</label><input id="shop-query" type="search" placeholder="Try LEGO, CS Megastore or lego.com" autocomplete="off"><p id="search-status" role="status" aria-live="polite">Loading shop history…</p><div id="shop-results"></div><section id="shop-detail" aria-live="polite"></section><p class="intro"><small>Timestamps show when we recorded an offer, not its exact start or end. Earlier campaign offers may be missing. Formatting changes and derived Trumf point conversions are excluded. Removed shops remain searchable; imported observations do not establish that a shop was newly opened. Counts reflect available records, not a prediction.</small></p><noscript>Enable JavaScript to search shop history.</noscript><style>#shop-query{display:block;box-sizing:border-box;width:100%;max-width:640px;font:inherit;padding:12px;margin:8px 0;border:1px solid #aabdb8;border-radius:8px}.search-result{display:block;width:100%;text-align:left;margin:8px 0;cursor:pointer}.history-controls{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.history-controls select{font:inherit;padding:8px}.history-stats{padding:16px;background:#e7f1ed;border-radius:10px;margin:16px 0}.history-pages{display:flex;gap:12px;margin:16px 0}</style><script src="shop-search.js" defer></script>`;
 await fs.writeFile(path.join(output,'shops.html'),shell('Search shop changes',content,base));
 await fs.copyFile(new URL('./shop-search.js',import.meta.url),path.join(output,'shop-search.js'));
 return index;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output='data/shop-history-seed.json']=process.argv.slice(2);if(!input)throw Error('Usage: node scripts/shop-history.mjs CHANGELOG.md [output.json]');
 const seed=importChangelog(await fs.readFile(input,'utf8'));await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(seed,null,2)+'\n');console.log(JSON.stringify(seed.report));
}
