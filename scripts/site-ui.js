(()=>{
 const panel=document.getElementById('extension-promo');if(!panel)return;
 const ua=navigator.userAgent||'';
 const excluded=/Edg(?:e|A|iOS)?\/|OPR\/|Opera|SamsungBrowser|Vivaldi|Brave|CriOS|FxiOS|Mobile|Android|iPhone|iPad/i.test(ua)||!!navigator.brave;
 const brands=navigator.userAgentData?.brands;
 const browser=!excluded&&/Firefox\//.test(ua)?'firefox':!excluded&&/Chrome\//.test(ua)&&(!brands||brands.some(b=>b.brand==='Google Chrome'))?'chrome':'';
 let installed=false;
 const show=()=>{for(const a of panel.querySelectorAll('[data-extension-browser]'))a.hidden=a.dataset.extensionBrowser!==browser;panel.hidden=!browser||installed;};
 const token=crypto.randomUUID();
 const check=()=>window.postMessage({type:'flight-bonus-notifier:check-installed',token},location.origin);
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin)return;
  if(event.data?.type==='flight-bonus-notifier:installed'&&event.data.token===token){installed=true;show();}
  if(event.data?.type==='flight-bonus-notifier:ready')check();
 });
 window.addEventListener('pageshow',()=>{installed=false;show();check();});
 show();check();
 // Covers content scripts starting after this deferred script.
 setTimeout(check,300);setTimeout(check,1200);
})();
