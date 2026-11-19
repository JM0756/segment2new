const panel=document.querySelector('section'), statusLine=document.querySelector('[role=status]'), dialog=document.querySelector('dialog');
let m,t,picks,origin,revision=0;
function emit(event,detail={}) {
  if(origin) parent.postMessage({type:'GAME_EVENT',archetype:'retrieval',event,detail},origin);
}
function button(parent,label,action) {
  const b=document.createElement('button');
  b.textContent=label; b.onclick=action; parent.append(b); return b;
}
function choices() { return t.options; }
function tutorial() {
  dialog.replaceChildren();
  const prompt=document.createElement('p'); prompt.textContent=t.tutorial+' '+t.practice; dialog.append(prompt);
  button(dialog,choices()[0],()=>{advance.disabled=false;});
  const advance=button(dialog,t.begin,()=>dialog.close()); advance.disabled=true;
  button(dialog,t.skip,()=>dialog.close()); dialog.showModal();
}
function render() {
  panel.replaceChildren();
  const description=document.createElement('p'); description.textContent=t.setting; panel.append(description);
  choices().forEach((label,i)=>{
    const b=button(panel,label,()=>{
      picks=picks.includes(i)?picks.filter(n=>n!==i):[...picks,i];
      emit('action',{kind:'select',index:i}); render();
    });
    if(picks.includes(i)) b.textContent=(picks.indexOf(i)+1)+'. '+label;
    b.setAttribute('aria-pressed',String(picks.includes(i)));
  });
  button(panel,t.check,()=>{
    const won=evaluateSelection(m,picks);
    emit('action',{kind:'submit',picks:[...picks]});
    statusLine.textContent=won?t.success:t.failure; emit(won?'win':'fail');
    if(won){panel.replaceChildren(); button(panel,t.again,()=>start(false));}
  });
  button(panel,t.hintLabel,()=>{statusLine.textContent=t.hint; emit('hint_shown');});
  button(panel,t.guide,tutorial);
}
function start(showGuide) {
  picks=[]; statusLine.textContent=''; document.querySelector('h1').textContent=t.title;
  document.documentElement.style.setProperty('--accent',t.accent); render(); emit('start');
  if(dialog.open) dialog.close();
  if(showGuide) tutorial();
}
function load(config) {
  if(config.archetype!=='retrieval') throw Error('Wrong archetype');
  m=config.mechanics;t=config.theme;start(true);
}
window.addEventListener('message',e=>{
  if(e.source!==parent || parent===window || e.data?.type!=='LOAD_CONFIG') return;
  if(origin && origin!==e.origin) return;
  origin=e.origin; revision++; load(e.data.config);
});
const configPath = new URLSearchParams(window.location.search).get('config') || 'default.json';
fetch(configPath).then(r=>r.json()).then(c=>{if(!revision) load(c);});
