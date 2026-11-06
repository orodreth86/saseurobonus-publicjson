export const nameIdentity=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const domainId=d=>'domain:'+String(d||'').trim().toLowerCase().replace(/^www\./,'');
function sourceId(url,provider){
 try{const u=new URL(url);if(u.protocol!=='https:')return '';
  if(provider==='trumf'&&u.hostname==='trumfnetthandel.no'){const m=u.pathname.match(/^\/cashback\/([^/]+)\/?$/);return m?'trumf:'+m[1]:'';}
  if(provider==='flight'&&u.hostname==='onlineshopping.flysas.com'){const m=u.pathname.match(/\/(?:butikker|shops)\/([^/]+)\/([^/]+)\/?$/);return m?'flight:'+m[2]:'';}
 }catch{}return '';
}
function ids(row){
 const out=[];if(row.domain)out.push(domainId(row.domain));if(row.slug)out.push('slug:'+row.slug);
 for(const p of ['trumf','flight']){const id=sourceId(row[p==='trumf'?'trumfurl':'sasurl']||row[p+'URL'],p);if(id)out.push(id);}
 if(row.key||row.id){const key=row.key||row.id;out.push(key);if(key.startsWith('trumf:https://')){const id=sourceId(key.slice(6),'trumf');if(id)out.push(id);}}
 return [...new Set(out)];
}
export function historyRows(history){return [...(history?.snapshots||[]).flatMap(s=>s.shops),...(history?.editions||[]).flatMap(e=>[...(e.added||[]),...(e.removed||[]),...(e.changed||[])])];}
export function createShopResolver(rows,aliases=[]){
 const parent=new Map();const find=x=>{if(!parent.has(x))parent.set(x,x);if(parent.get(x)!==x)parent.set(x,find(parent.get(x)));return parent.get(x);};
 const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(a,b);};
 for(const [a,b] of aliases)union(a,b);
 const ownership=new Map();
 for(const row of rows){const keys=ids(row),domain=keys.find(k=>k.startsWith('domain:'));if(!domain)continue;for(const key of keys){if(key.startsWith('domain:'))continue;if(!ownership.has(key))ownership.set(key,new Set());ownership.get(key).add(find(domain));}}
 for(const row of rows){const keys=ids(row);for(const id of keys)if((ownership.get(id)?.size||0)<=1)union(keys[0],id);}
 const domains=()=>{const m=new Map();for(const key of parent.keys())if(key.startsWith('domain:')&&key!=='domain:'){const root=find(key);if(!m.has(root))m.set(root,[]);m.get(root).push(key);}return m;};
 const withDomain=domains(), names=new Map();
 for(const row of rows){const key=ids(row)[0],name=nameIdentity(row.name);if(!key||!name||!withDomain.has(find(key)))continue;if(!names.has(name))names.set(name,new Set());names.get(name).add(find(key));}
 const proposals=[];
 for(const row of rows){const key=ids(row)[0],name=nameIdentity(row.name),matches=names.get(name);if(key&&name&&!withDomain.has(find(key))&&matches?.size===1)proposals.push([key,[...matches][0]]);}
 const targets=new Map();for(const [key,target] of proposals){const root=find(key);if(!targets.has(root))targets.set(root,new Set());targets.get(root).add(target);}
 const accepted=proposals.filter(([key])=>targets.get(find(key))?.size===1);
 for(const [key,target] of accepted)union(key,target);
 // Rows are current feed first, followed by older records: prefer the current domain.
 const preferred=new Map();for(const row of rows){if(!row.domain)continue;const key=domainId(row.domain),root=find(key);if(!preferred.has(root))preferred.set(root,key);}
 for(const [root,keys] of domains())if(!preferred.has(root))preferred.set(root,keys[0]);
 const canonical=id=>preferred.get(find(id))||find(id);
 return {key:row=>{const key=ids(row)[0];return key?canonical(key):'';},canonical,aliases:()=>[...parent.keys()].map(key=>[key,canonical(key)]).filter(([a,b])=>a!==b)};
}
export function consolidateSnapshots(rows,resolver,canonicalReward){
 const out=new Map();
 for(const s of rows){const key=resolver.key(s),domain=key.startsWith('domain:')?key.slice(7):s.domain||'';
  if(!out.has(key)){out.set(key,{...s,key,domain});continue;}
  const old=out.get(key);
  for(const p of ['flight','trumf']){
   if(old[p]&&s[p]&&canonicalReward(old[p],p)!==canonicalReward(s[p],p))throw Error(`Conflicting ${p} rewards for consolidated shop ${s.name}`);
   if(!old[p]&&s[p]){old[p]=s[p];old[p+'URL']=s[p+'URL'];}
  }
 }
 return [...out.values()];
}
