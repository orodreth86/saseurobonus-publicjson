import fs from 'node:fs/promises';
import {createShopResolver} from './shop-identities.mjs';
import path from 'node:path';

// Explicit ranking conversions. Existing feed display/conversions are unchanged.
export const FIXED_TRUMF_POINTS_PER_KR=13.5;
export const SHOPPING_TRUMF_POINTS_PER_PERCENT=13.5;
export function parseRankedReward(raw,provider,category){
 const label=String(raw||'').normalize('NFKC').replace(/\s*\([^)]*(?:poeng|points)[^)]*\)/gi,'').trim();
 // Only simple amounts/rates; do not guess values from ranges or product-specific text.
 const m=label.match(/^(?:(opptil|up to)\s+)?(\d+(?: \d{3})*(?:[.,]\d+)?)\s*(poeng|points|kr|nok|%)(?:\s*(?:\/|per)\s*(\d+(?:[.,]\d+)?)\s*(?:kr|nok))?$/i);
 if(!m)return null;
 const value=Number(m[2].replaceAll(' ','').replace(',','.')),denominator=m[4]?Number(m[4].replace(',','.')):null,unit=m[3].toLowerCase();
 if(!Number.isFinite(value)||value<=0||(denominator!==null&&(!Number.isFinite(denominator)||denominator<=0)))return null;
 let points;
 if(category==='fixed'){
  if(denominator!==null)return null;
  if(provider==='flight'&&['poeng','points'].includes(unit))points=value;
  else if(provider==='trumf'&&['kr','nok'].includes(unit))points=value*FIXED_TRUMF_POINTS_PER_KR;
  else return null;
 }else if(category==='shopping'){
  if(provider==='flight'&&['poeng','points'].includes(unit)&&denominator!==null)points=value*100/denominator;
  else if(provider==='trumf'&&unit==='%'&&denominator===null)points=value*SHOPPING_TRUMF_POINTS_PER_PERCENT;
  else return null;
 }else return null;
 return {label,points,upTo:!!m[1],provider};
}
const safeURL=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:''}catch{return ''}};
function storefront(domain){
 const d=String(domain||'').trim();if(!d||/[\s/:?#@\\]/.test(d))return '';
 return safeURL('https://'+d);
}
export function rankShops(feed,category){
 const rows=new Map(),resolver=createShopResolver(feed.shops);
 for(const [i,s] of feed.shops.entries()){
  const key=resolver.key(s)||'row:'+i;
  for(const provider of ['flight','trumf']){
   const offer=parseRankedReward(s[provider==='flight'?'sasbonus':'trumfbonus'],provider,category);if(!offer)continue;
   offer.url=safeURL(s[provider==='flight'?'sasurl':'trumfurl']);
   if(!rows.has(key)){const domain=key.startsWith('domain:')?key.slice(7):s.domain||'';rows.set(key,{name:s.name,domain,url:storefront(domain),offers:[]});}
   const row=rows.get(key),old=row.offers.find(o=>o.provider===provider);
   if(!old)row.offers.push(offer);else if(offer.points>old.points)Object.assign(old,offer);
  }
 }
 return [...rows.values()].map(s=>({...s,offers:s.offers.sort((a,b)=>b.points-a.points||a.provider.localeCompare(b.provider))})).sort((a,b)=>b.offers[0].points-a.offers[0].points||a.name.localeCompare(b.name,'nb')).slice(0,10);
}
export async function renderBonusRankings(feed,output,base,shell,escape){
 const fmt=n=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(n);
 for(const category of ['fixed','shopping']){
  const fixed=category==='fixed',title=fixed?'Top 10 fixed bonuses':'Top 10 shopping rewards',rows=rankShops(feed,category);
  const description=fixed?'The largest fixed bonuses in the current feed, ranked by their equivalent points value. Percentage cashback and points earned per amount spent are excluded.':'The highest rewards per 100 kr spent in the current feed. Fixed bonuses are excluded.';
  const conversion=fixed?'100 kr Trumf = 1,350 points (13.5 points per kr).':'1% Trumf = 13.5 points.';
  const table=rows.length?`<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Shop</th><th>Available ${fixed?'fixed bonuses':'shopping rewards'}</th></tr></thead><tbody>${rows.map((s,i)=>`<tr><td><strong>#${i+1}</strong></td><td><strong>${s.url?`<a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.name)}</a>`:escape(s.name)}</strong><small>${escape(s.domain)}</small></td><td>${s.offers.map((o,j)=>`<div class="rank-offer"><strong>${o.provider==='flight'?'Flight points':'Trumf'}</strong> · ${o.url?`<a href="${escape(o.url)}" target="_blank" rel="noopener noreferrer">${escape(o.label)}</a>`:escape(o.label)}<br><span class="rank-score">${o.upTo?'Up to ':''}${fmt(o.points)} points${fixed?'':' / 100 kr'}</span>${j===0?'<small>Used for ranking</small>':''}</div>`).join('')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="notice">No eligible bonuses in the current feed.</p>';
  const html=`<h1>${title}</h1><p class="intro">${description}</p><p><small>Feed updated: ${escape(feed.generated_at)} · ${rows.length} ranked shops</small></p><p class="notice">${conversion} Each shop appears once, ranked by its highest eligible offer. Rewards from different programmes are alternatives and are not added together. “Up to” offers are ranked at their advertised maximum.</p>${table}<p class="intro">Check the linked offer for eligibility, new-customer restrictions, purchase or subscription requirements, exclusions and current rates. A fixed bonus is not necessarily a sign-up bonus; this feed does not identify every qualifying action.</p><style>.rank-offer{margin-bottom:12px}.rank-offer:last-child{margin-bottom:0}.rank-score{font-weight:750;font-size:17px}</style>`;
  await fs.writeFile(path.join(output,fixed?'top-fixed.html':'top-shopping.html'),shell(title,html,base));
 }
}
