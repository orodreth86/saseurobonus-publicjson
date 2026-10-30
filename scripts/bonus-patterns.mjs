// A conservative historical heuristic, not a campaign forecast.
const DAY=86400000;
function reward(value,provider){
 let text=String(value||'').normalize('NFKC').toLowerCase().replace(/\bpoints\b/g,'poeng').trim();
 if(provider==='trumf')text=text.replace(/\([^)]*poeng[^)]*\)/g,'').trim();
 const m=text.match(/^(opptil\s+)?(\d+(?:[.,]\d+)?)\s*(%|kr|poeng)(?:\s*(?:\/|per)\s*(\d+(?:[.,]\d+)?)\s*(?:nok|kr))?$/);
 if(!m)return null;
 const valueNumber=Number(m[2].replace(',','.'));
 const unit=[!!m[1],m[3],m[4]?Number(m[4].replace(',','.')):null].join('|');
 return {value:valueNumber,unit,key:unit+'|'+valueNumber,text:String(value).replace(/\s*\([^)]*poeng[^)]*\)/g,'').trim()};
}
const same=(a,b)=>a&&b&&a.key===b.key;
const median=xs=>{const a=[...xs].sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2};
const range=(xs,unit)=>{const vals=xs.map(v=>unit==='days'&&v>=1?Math.round(v):Math.max(.1,Math.round(v*10)/10));const min=Math.min(...vals),max=Math.max(...vals);return `${min===max?min:min+'–'+max} ${unit}`};
export function analyzeBonusPatterns(shop,provider){
 const events=shop.events.filter(e=>e.provider===provider).sort((a,b)=>a.at.localeCompare(b.at));
 const groups=new Map();let previous=null,active=null;
 for(const e of events){
  const at=Date.parse(e.at),before=reward(e.before,provider),after=reward(e.after,provider);
  if(!Number.isFinite(at))continue;
  // Observations establish state but cannot establish a promotion's starting time.
  if(e.kind!=='change'){if(!same(previous,after))active=null;previous=after;continue;}
  // A merged row can reassert an already recorded rate with an empty old value.
  if(!before&&same(previous,after))continue;
  if(!before||!after||before.unit!==after.unit){active=null;previous=after;continue;}
  // Conflicting daily summaries, missing transitions, and availability gaps break chains.
  if(previous&&!same(previous,before)){active=null;previous=after;continue;}
  if(same(before,after)){previous=after;continue;}
  if(active){
   if(same(after,active.base)){
    const duration=(at-active.start)/DAY;
    if(duration>=.25&&duration<=60){
     const key=active.base.key+'>'+active.high.key;
     if(!groups.has(key))groups.set(key,[]);
     groups.get(key).push({...active,end:at,duration});
    }
    active=null;
   }else if(!same(after,active.high))active=null; // Multi-tier or changing baselines are ambiguous.
  }else if(after.value>before.value){active={base:before,high:after,start:at};}
  previous=after;
 }
 const candidates=[...groups.values()].filter(g=>g.length>=3).map(g=>g.slice(-6)).sort((a,b)=>b.at(-1).end-a.at(-1).end);
 for(const cycles of candidates){
  const durations=cycles.map(c=>c.duration),gaps=cycles.slice(1).map((c,i)=>(c.start-cycles[i].start)/DAY);
  const period=median(gaps),duration=median(durations);
  const regularGaps=gaps.every(g=>Math.abs(g-period)<=Math.max(2,period*.25));
  const regularDuration=durations.every(d=>Math.abs(d-duration)<=Math.max(2,duration*.35));
  if(!regularGaps||!regularDuration)continue;
  const recent=cycles.at(-1);
  return {status:'possible-pattern',count:cycles.length,base:recent.base.text,high:recent.high.text,durationDays:durations,spacingDays:gaps,lastEndedAt:new Date(recent.end).toISOString(),
   summary:`Possible recurring promotion in these records: ${recent.base.text} → ${recent.high.text}, seen ${cycles.length} completed times. Higher bonuses lasted about ${range(durations,'days')}, with starts ${range(gaps.map(g=>g/7),'weeks')} apart.`,
   note:'Historical pattern only. Times are observations, gaps can hide changes, and older campaign rates may be missing. This does not predict the next promotion.'};
 }
 const completed=[...groups.values()].reduce((n,g)=>n+g.length,0);
 return {status:'insufficient-pattern',completed,
  summary:completed<3?`Not enough history to identify a recurring promotion (${completed} completed comparable higher-bonus periods found; at least 3 matching periods are needed).`:'Higher bonuses have occurred, but their rates, duration or spacing are not consistent enough to identify a recurring pattern.',
  note:'Incomplete promotions, availability gaps, mixed reward units and formatting-only changes are excluded.'};
}
