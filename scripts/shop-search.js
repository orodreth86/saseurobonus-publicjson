(()=>{
 const query=document.getElementById('shop-query'),results=document.getElementById('shop-results'),detail=document.getElementById('shop-detail'),status=document.getElementById('search-status');
 let data,selected,provider='all',page=0;const pageSize=50;
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node};
 const label=p=>p==='flight'?'Flight points':'Trumf';
 const fmt=at=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',dateStyle:'medium',timeStyle:'short'}).format(new Date(at));
 const changes=events=>events.filter(e=>e.kind==='change'&&e.before&&e.after);
 function showShop(shop){selected=shop;provider='all';page=0;history.replaceState(null,'','#'+encodeURIComponent(shop.id));renderDetail();}
 function renderResults(){
  const term=query.value.normalize('NFKC').toLocaleLowerCase().trim();
  const matches=data.shops.filter(s=>[s.name,s.domain,s.id,...s.aliases].join(' ').normalize('NFKC').toLocaleLowerCase().includes(term));
  results.replaceChildren();status.textContent=matches.length+' matching shops'+(matches.length>50?' · Showing the first 50; type more to narrow your search.':'');
  for(const shop of matches.slice(0,50)){
   const button=el('button',shop.name+(shop.domain?' · '+shop.domain:''),'search-result');button.type='button';button.addEventListener('click',()=>showShop(shop));results.append(button);
  }
 }
 function renderDetail(){
  const shop=selected;detail.replaceChildren(el('h2',shop.name));
  if(shop.domain){try{const url=new URL('https://'+shop.domain);if(url.pathname==='/'&&!url.username&&!url.password){const a=el('a','Visit '+shop.domain);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';detail.append(a);}}catch{}}
  detail.append(el('p',shop.current?`Current published bonuses: Flight points: ${shop.current.flight||'Not available'} · Trumf: ${shop.current.trumf||'Not available'} (feed updated ${fmt(shop.current.at)}, Norway time)`:'Not in the current feed. Values below are historical.'));
  const controls=el('div',undefined,'history-controls'),filterLabel=el('label','Show offers: '),filter=el('select');
  for(const [v,t] of [['all','Both programmes'],['flight','Flight points'],['trumf','Trumf']]){const option=el('option',t);option.value=v;filter.append(option);}filter.value=provider;filter.addEventListener('change',()=>{provider=filter.value;page=0;renderDetail();});filterLabel.append(filter);controls.append(filterLabel);detail.append(controls);
  const patterns=el('section',undefined,'pattern-summary');patterns.append(el('h3','Bonus patterns'));
  for(const p of (provider==='all'?['flight','trumf']:[provider])){
   const analysis=shop.patterns?.[p];patterns.append(el('strong',label(p)));
   patterns.append(el('p',analysis?.summary||'Pattern analysis is not available for this shop yet.'));
   if(analysis?.lastEndedAt)patterns.append(el('small','Most recent completed period in this pattern ended around '+fmt(analysis.lastEndedAt)+' (Norway time).'));
   if(analysis?.note)patterns.append(el('small',analysis.note));
  }
  detail.append(patterns);
  const events=shop.events.filter(e=>provider==='all'||e.provider===provider), actual=changes(events),days=new Set(actual.map(e=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.at))));
  const stats=el('div',undefined,'history-stats');
  stats.append(el('strong',`${actual.length} recorded bonus changes across ${days.size} days`));
  if(events.length){const first=events.at(-1).at,last=events[0].at;stats.append(el('p',`Records from ${fmt(first)} to ${fmt(last)} (Norway time).`));
   const since=new Date(data.updatedAt)-new Date(first),duration=since/86400000;
   if(duration>=30)stats.append(el('p',`${(actual.length*30/duration).toFixed(1)} recorded changes per 30 days on average across this coverage period.`));
  }else stats.append(el('p','No historical observations for this selection yet.'));detail.append(stats);
  const wrap=el('div',undefined,'table-wrap'),table=el('table'),head=el('thead'),tr=el('tr');for(const title of ['Recorded (Norway time)','Programme','Previous','New value','Record'])tr.append(el('th',title));head.append(tr);table.append(head);const tbody=el('tbody');
  for(const event of events.slice(page*pageSize,(page+1)*pageSize)){
   const row=el('tr');let kind=event.kind==='observation'?'Observed bonus':event.before&&event.after?'Bonus change':event.after?'Offer became available':'Offer unavailable';
   for(const value of [fmt(event.at),label(event.provider),event.before||'—'])row.append(el('td',value));
   const valueCell=el('td',event.after||'Not available');
   if(event.direction===1||event.direction===-1){
    const up=event.direction===1,mark=el('span',undefined,'direction '+(up?'up':'down'));
    mark.setAttribute('role','img');mark.setAttribute('aria-label','Bonus '+(up?'increased':'decreased'));mark.title='Bonus '+(up?'increased':'decreased');
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
    for(const [k,v] of Object.entries({viewBox:'0 0 16 16',width:'14',height:'14','aria-hidden':'true',focusable:'false'}))svg.setAttribute(k,v);
    for(const [k,v] of Object.entries({fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round',d:up?'M4 12 12 4M5 4H12V11':'M4 4 12 12M5 12H12V5'}))path.setAttribute(k,v);
    svg.append(path);mark.append(svg);valueCell.append(document.createTextNode(' '),mark);
   }
   row.append(valueCell,el('td',kind+' · '+event.source));tbody.append(row);
  }table.append(tbody);wrap.append(table);detail.append(wrap);
  if(events.length>pageSize){const nav=el('div',undefined,'history-pages');for(const [text,step] of [['Newer records',-1],['Older records',1]]){const b=el('button',text);b.type='button';b.disabled=step<0?page===0:(page+1)*pageSize>=events.length;b.addEventListener('click',()=>{page+=step;renderDetail();});nav.append(b);}nav.append(el('span',`Page ${page+1} of ${Math.ceil(events.length/pageSize)}`));detail.append(nav);}
 }
 query.addEventListener('input',()=>{if(data)renderResults()});
 fetch('shop-history.json').then(r=>{if(!r.ok)throw Error('History unavailable');return r.json()}).then(value=>{
  data=value;renderResults();let id='';try{id=decodeURIComponent(location.hash.slice(1))}catch{}const shop=data.shops.find(s=>s.id===id);if(shop)showShop(shop);
 }).catch(()=>{status.textContent='Could not load shop history. Please refresh to try again.';});
})();
