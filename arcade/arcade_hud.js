'use strict';
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
let configPath=params.get('config')||'default.json', generation=0, config, round, images=[], view;
let reported=false;
let feedback=null, pulse=0, arrival=0, tutorial=true, origin, hits=[];
const canvas=$('arena'),ctx=canvas.getContext('2d');
function emit(event,detail={}) {
  if(origin) parent.postMessage({type:'GAME_EVENT',archetype:config.archetype,event,detail},origin);
}
function button(label,fn) {
  const b=document.createElement('button');b.textContent=label;b.onclick=fn;return b;
}
function action(fn) {
  if(!round)return;
  const last=view.target;
  const outcome=fn();pulse=performance.now();
  if(outcome && hits[outcome.actor])feedback=ArcadeHUD.spawnCallout(hits[outcome.actor],outcome,pulse);
  view=round.view();
  if(last!==view.target)arrival=pulse;
  if(view.done&&!reported&&params.has('mode')){
    reported=true;
    const level=Number(params.get('level')),accuracy=view.accuracy;
    const stars=accuracy>=80?3:accuracy>=60?2:1;
    window.parent.postMessage({type:'ARCADE_PROGRESS',archetype:params.get('game'),level,accuracy,
      stars,passed:level===0||stars===3,run:params.get('run')},'*');
  }
  emit('action');if(view.done)emit(view.success===false?'fail':'win');else if(view.note.includes('OVERFIT'))emit('fail');
  render();
}
function submit(){action(()=>round.submit());}
function render() {
  view=round.view();
  $('title').textContent=config.theme.title;
  $('phase').textContent=view.phase+(typeof view.target==='number'?' · '+(view.target+1):'');
  const scoreLabels=view.teamNames||(config.archetype==='threshold'?['Hits','False alarms']:['Verified','Errors']);
  for(let i=0;i<2;i++)$('team'+i).textContent=scoreLabels[i]+'  '+view.score[i];
  $('subject').textContent=view.subject;$('detail').textContent=view.detail||config.theme.setting;
  $('metric').textContent=view.metric+'   '+view.value+'%';
  $('meter').style.setProperty('--value',view.value+'%');
  $('skip').hidden=params.get('mode')==='tutorial';
  $('guide').hidden=!tutorial;
  $('legend').replaceChildren(...view.legend.map(label=>{
    const cue=document.createElement('span');cue.textContent=label;return cue;
  }));
  const controls=view.guide.match(/\[[^\]]+\]/g)||[];
  $('instruction').textContent=view.guide.replace(/\s*\[[^\]]+\]/g,'');
  for(const control of controls){
    const badge=document.createElement('kbd');badge.textContent=control.slice(1,-1);$('instruction').append(badge);
  }
  document.querySelector('.spotlight')?.classList.remove('spotlight');
  if(!$('guide').hidden)$(view.spotlight||(view.sources?'sources':view.range?'dial':'actions')).classList.add('spotlight');
  $('callout').textContent=view.note;
  $('actions').replaceChildren();
  view.actions.forEach((label,i)=>{
    const b=button('['+(i+1)+'] '+label,()=>action(()=>round.act(i)));
    b.disabled=view.done||view.field;b.setAttribute('aria-pressed',String(view.selected===i));
    if(i<2)ArcadeSprites.draw(b,i,images);
    $('actions').append(b);
  });
  if(!view.done)$('actions').append(button('[SPACE] '+view.submit,submit));
  if(view.field)$('actions').append(button('Retrain Balanced',()=>action(()=>round.retrain())));
  if(view.done)$('actions').append(button('Replay',()=>start(config,configPath)));
  if((view.field||view.done)&&!params.has('advanced')&&!params.has('mode'))$('actions').append(button('Advance to Level 2',advance));
  $('dial').hidden=!view.range;
  if(view.range){$('slider').max=view.range[1];$('slider').value=view.range[0];}
  if(view.sources && $('sources').childElementCount===0){
    view.sources.forEach((source,i)=>{
      const b=button('Source '+(i+1),()=>{b.textContent=source;action(()=>round.inspect());});
      $('sources').append(b);
    });
  }
}
async function advance(){
  const url=new URL(location.href);
  const next=params.get('next')||(/_L1\.json$/.test(configPath)?configPath.replace(/_L1\.json$/,'_L2.json'):'level2.json');
  const response=await fetch(next);
  url.searchParams.set('config',response.ok?next:'level2.json');url.searchParams.set('advanced','1');location.assign(url);
}
function paint(now){
  requestAnimationFrame(paint);if(!round)return;
  const w=canvas.width,h=canvas.height,p=config.theme.palette||{};
  ctx.imageSmoothingEnabled=false;ctx.save();
  if(feedback&&now-feedback.start>=700)feedback=null;
  for(let y=0;y<h;y+=16){
    ctx.fillStyle=y%32?(p.floor||'#315656'):(p.stripe||'#365f5b');ctx.fillRect(0,y,w,16);
    ctx.fillStyle='#0002';for(let x=y%32;x<w;x+=32)ctx.fillRect(x,y,1,16);
  }
  ctx.strokeStyle='#c6efcc66';ctx.strokeRect(16,14,w-32,h-28);
  ctx.fillStyle='#f5d68377';ctx.fillRect(w*.74,18,2,h-36);
  const actors=view.actors||view.names.slice(0,2).map((label,slot)=>({slot,label}));
  hits=[];
  actors.forEach((actor,i)=>{
    const effect=feedback?.actor===i?feedback:null;
    const {label,slot,station}=effect?.entity||actor;
    const vx=station?0:(i%2?-1:1),age=Math.max(0,now-arrival);
    const x=effect?.x??Math.round((i+1)*w/(actors.length+1)-vx*45*Math.max(0,1-age/900));
    const y=effect?.y??(h/2+(i%2?12:-6));
    const pose=ArcadeHUD.pose(now,i,vx,age,effect);
    ctx.fillStyle='#142d3680';ctx.beginPath();ctx.ellipse(x,y+12,14*pose.shadow,4*pose.shadow,0,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.translate(x+pose.dx,y+11+pose.dy);ctx.rotate(pose.tilt);ctx.scale(pose.sx,pose.sy);
    const img=images[(effect?.entity||actor).art??slot];
    if(img?.naturalWidth){
      const framed=img.width===128&&img.height===128;
      const scale=framed?32/92:39/Math.max(img.width,img.height);
      ctx.drawImage(img,-img.width*scale/2,-(framed?116:img.height)*scale,img.width*scale,img.height*scale);
    }else{
      const team=(effect?.entity||actor).art??slot;
      const suit=team===1?(p.team1||'#ffab71'):(p.team0||'#8cddc1');
      ctx.fillStyle='#172333';ctx.fillRect(-10,-32,20,20);ctx.fillRect(-8,-12,16,12);
      ctx.fillStyle=suit;ctx.fillRect(-8,-30,16,16);ctx.fillRect(-6,-10,12,7);
      ctx.fillStyle=team===1?'#233544':'#38425a';ctx.fillRect(-9,-25,18,6);
      ctx.fillStyle='#ace9fa';ctx.fillRect(-6,-24,4,2);ctx.fillRect(3,-24,3,2);
      ctx.fillStyle=config.theme.accent||suit;
      if(team===1){ctx.fillRect(8,-32,2,8);ctx.fillRect(7,-34,4,3);}
      else{ctx.fillRect(-11,-30,22,3);ctx.fillRect(-7,-33,13,4);}
      ctx.fillStyle='#172333';ctx.fillRect(-5,-22,2,2);ctx.fillRect(4,-22,2,2);
      ctx.fillStyle='#eee4ba';ctx.fillRect(2,-9,3,2);
    }
    ctx.restore();
    ctx.font='bold 9px monospace';ctx.textAlign='center';const name=String(label).slice(0,22),width=ctx.measureText(name).width+8;
    ctx.fillStyle='#162831';ctx.fillRect(x-width/2,y+16,width,14);ctx.strokeStyle='#abcdad';ctx.strokeRect(x-width/2,y+16,width,14);
    ctx.fillStyle='#fff';ctx.fillText(name,x,y+26);
    hits.push({x,y,...actor});
  });
  if(feedback)ArcadeHUD.drawCallout(ctx,feedback,now);
  ctx.restore();
}
async function start(data,path){
  const id=++generation;
  const loaded=data.theme.sprites?await ArcadeSprites.preload(data.theme.sprites,path):[];
  if(id!==generation)return;
  reported=false;feedback=null;hits=[];config=data;configPath=path;images=loaded;round=createRound(data);arrival=performance.now();tutorial=true;
  $('sources').replaceChildren();render();emit('start');
}
canvas.onclick=e=>{
  const b=canvas.getBoundingClientRect(),x=(e.clientX-b.left)*canvas.width/b.width,y=(e.clientY-b.top)*canvas.height/b.height;
  const hit=hits.find(h=>Math.abs(x-h.x)<22&&Math.abs(y-h.y)<32);
  if(hit&&hit.slot<2&&typeof round.retrain==='function')action(()=>round.act(hit.slot));
};
$('help').onclick=()=>{tutorial=true;render();};
$('skip').onclick=()=>{tutorial=false;render();};
$('slider').oninput=e=>action(()=>round.tune(Number(e.target.value)));
window.addEventListener('keydown',e=>{
  if(!round||e.repeat||e.target.matches('input')&&e.code!=='Space')return;
  if(e.code==='Space'){e.preventDefault();submit();return;}
  const n=({'1':0,'2':1,'3':2,ArrowLeft:0,ArrowRight:1})[e.key];
  if(n!==undefined){e.preventDefault();action(()=>round.act(n));}
});
window.addEventListener('message',e=>{
  if(parent===window||e.source!==parent||e.data?.type!=='LOAD_CONFIG'||origin&&e.origin!==origin)return;
  origin=e.origin;start(e.data.config,configPath);
});
fetch(configPath).then(r=>r.json()).then(c=>{if(!generation)return start(c,configPath);}).catch(e=>{$('subject').textContent='Unable to load activity: '+e.message;});
requestAnimationFrame(paint);
