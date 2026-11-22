'use strict';
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
let configPath=params.get('config')||'default.json', generation=0, config, round, images=[], view;
const tier=Number(params.get('level')??(configPath.match(/(?:level|_L)([123])\.json$/)?.[1]||1));
let continuing=Boolean(params.has('mode')&&params.get('transition')==='1');
if(continuing){
  const address=new URL(location.href);
  address.searchParams.delete('transition');history.replaceState(null,'',address);
}
const tutorialMode=params.get('mode')==='tutorial';
let reported=false, passed=false, guideStep=-1, lines=[], practiceActors=[];
let cohort=ArcadeHUD.createCohort();
let feedback=null, pulse=0, arrival=0, origin, hits=[];
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
  if(outcome?.destination!==undefined){
    const actor=view.actors[outcome.actor], hit=hits[outcome.actor];
    cohort.add(actor,outcome.destination,outcome.correct,pulse,(hit?.x??worldWidth/2)/worldWidth,((hit?.y??worldHeight/2)+11)/worldHeight);
    feedback=null;
  }else if(outcome && hits[outcome.actor])feedback=ArcadeHUD.spawnCallout(hits[outcome.actor],outcome,pulse);
  view=round.view();
  if(last!==view.target){
    arrival=pulse;
    if(feedback)feedback.detached=true; // Keep the callout at the previous sample, but show the new cues immediately.
  }
  if(!view.done){passed=false;reported=false;}
  if(view.done&&!reported){
    passed=view.success&&view.accuracy>=75;
    report('ARCADE_PROGRESS',passed,view.accuracy);
    reported=true;
  }
  emit('action');
  if(view.done)emit(passed?'win':'fail');
  else if(outcome?.correct===false)emit('fail');
  render();
}
function report(type,won,accuracy){
  if(params.has('mode'))parent.postMessage({type,archetype:params.get('game'),level:tier,accuracy,
    stars:accuracy>=75?3:accuracy>=60?2:1,passed:won,run:params.get('run')},location.origin);
}
function guideInput(key){
  const next=ArcadeNarrator.next(guideStep,key);
  if(next===guideStep)return;
  if(typeof key==='number'&&hits[key]){
    const response={actor:key,correct:true,text:key===0?'FIRST EXAMPLE':'SECOND EXAMPLE'};
    feedback=ArcadeHUD.spawnCallout(hits[key],response,performance.now());
  }
  guideStep=next;
  if(guideStep===3&&tutorialMode&&!passed){passed=true;report('ARCADE_PROGRESS',true,100);}
  render();
}
function choose(i){
  if(guideStep>=0){guideInput(i);return;}
  if(!view.done&&!view.locked&&!view.field)action(()=>round.act(i));
}
function submit(){
  if(guideStep===0)guideInput('continue');
  else if(guideStep===3)finishGuide();
  else if(guideStep<0&&!view.done)action(()=>round.submit());
}
function advance(){
  if(!passed || tier>=3)return;
  if(params.has('mode')){
    report('ARCADE_NEXT',true,tutorialMode?100:view.accuracy);
    return;
  }
  const url=new URL(location.href),next=tier+1;
  const generated=configPath.match(/^(.*)_L[123]\.json$/);
  url.searchParams.set('config',params.get('next')||(generated?generated[1]+'_L'+next+'.json':'level'+next+'.json'));
  url.searchParams.set('level',next);url.searchParams.delete('next');location.assign(url);
}
function finishGuide(){
  if(tutorialMode){passed=true;report('ARCADE_PROGRESS',true,100);advance();return;}
  guideStep=-1;feedback=null;arrival=performance.now();render();
}
function render() {
  view=round.view();
  const guided=guideStep>=0;
  $('title').textContent=config.theme.title;
  $('phase').textContent=tutorialMode?'Tutorial':'Level '+tier+' · '+view.phase+(view.field?' · '+view.submit:'');
  const scoreLabels=view.teamNames||(config.archetype==='threshold'?['Hits','False alarms']:['Verified','Errors']);
  for(let i=0;i<2;i++)$('team'+i).textContent=scoreLabels[i]+' '+view.score[i];
  $('subject').textContent=guided?'':view.subject;
  $('detail').textContent=guided?'':view.detail||'';
  $('metric').textContent=view.metric+' '+view.value+'%';
  $('meter').style.setProperty('--value',view.value+'%');
  $('guide').hidden=!guided;
  $('instruction').textContent=guided?lines[guideStep]:'';
  $('continue').disabled=guideStep===1||guideStep===2;
  $('continue').textContent=guideStep===3?'PLAY THE GAME ▶':'NEXT >>';
  $('skip').hidden=guideStep===3;
  $('help').hidden=guided;
  $('callout').classList.toggle('field-verdict',Boolean(!guided&&view.verdict));
  $('callout').textContent=guided?'':view.note;
  $('actions').replaceChildren();
  const actions=guideStep===3?[]:guided?view.actions.slice(0,2):view.actions;
  actions.forEach((label,i)=>{
    const key='['+(i+1)+']';
    const b=button(guided?key:key+' '+label,()=>choose(i));
    if(guided)b.setAttribute('aria-label',key+' '+label);
    b.disabled=guided?guideStep!==i+1:view.done||view.locked||view.field;
    b.setAttribute('aria-pressed',String(view.picks?.includes(i)||view.selected===i));
    if(i<2)ArcadeHUD.drawAvatarIcon(b,images[i],{theme:config.theme,slot:i},32);
    $('actions').append(b);
  });

  if(!guided){
    if(!view.instant){const trigger=button('[SPACE] '+view.submit,submit);trigger.disabled=Boolean(view.done||view.training);if(view.locked&&!view.done)trigger.className='field-trigger';$('actions').append(trigger);}
    if(passed&&tier<3)$('actions').append(button('Next Level →',advance));
    if(view.canRetrain){
      const retrain=button(view.balanced?'Balanced Retrain Used ✓':'Retrain balanced',()=>action(()=>round.retrain()));
      retrain.disabled=Boolean(view.balanced);
      retrain.title='Re-weights training samples to ignore the trap cue';
      $('actions').append(retrain);
    }
    if(view.done)$('actions').append(button('Replay',()=>start(config,configPath)));
  }
  $('dial').hidden=guided||!view.range;
  if(view.range){$('slider').max=view.range[1];$('slider').value=view.range[0];}
  $('sources').hidden=guided||!view.sources;
  if(view.sources && $('sources').childElementCount===0){
    view.sources.forEach((source,i)=>{
      const b=button('Source '+(i+1),()=>{b.textContent=source;action(()=>round.inspect());});
      $('sources').append(b);
    });
  }
}
let worldWidth=560,worldHeight=245;
let scenery, layout;
function arenaLayout(logicalWidth,logicalHeight){
  const uiScale=Math.max(.68,Math.min(1.25,Math.min(logicalWidth/1100,logicalHeight/620)));
  const rightMargin=Math.max(210*uiScale,logicalWidth*.24);
  // Keep the whole five-member row and count pill inside the playable area.
  const playableWidth=Math.max(1,logicalWidth-rightMargin);
  const rightLane=Math.max(0,Math.min(logicalWidth*.72,playableWidth-46*uiScale))/logicalWidth;
  const leftLane=Math.min(.22,rightLane/3);
  return {logicalWidth,logicalHeight,uiScale,rightMargin,rightLane,leftLane,playableWidth};
}
function resizeCanvas(){
  const dpr=window.devicePixelRatio||1;
  const width=Math.max(1,Math.round(canvas.clientWidth*dpr));
  const height=Math.max(1,Math.round(canvas.clientHeight*dpr));
  if(canvas.width!==width || canvas.height!==height){
    canvas.width=width;canvas.height=height;
  }
  const logicalWidth=Math.max(1,canvas.clientWidth),logicalHeight=Math.max(1,canvas.clientHeight);
  if(layout?.logicalWidth!==logicalWidth || layout.logicalHeight!==logicalHeight){
    layout=arenaLayout(logicalWidth,logicalHeight);
    document.documentElement.style.setProperty('--dock-width',layout.rightMargin+'px');
  }
  // One transform scales sprites, text, particles and pointer hit boxes together.
  worldWidth=logicalWidth/layout.uiScale;
  worldHeight=logicalHeight/layout.uiScale;
  ctx.setTransform(width/worldWidth,0,0,height/worldHeight,0,0);
  ctx.imageSmoothingEnabled=true;
}
function drawCohort(now,w,h){
  if(!view.lanes || guideStep>=0)return;
  const {actors,arrived}=cohort.frame(now,view.lanes.length,layout.leftLane,layout.rightLane,Math.min(16/w,(layout.rightLane-layout.leftLane)/Math.max(5,5*(view.lanes.length-1))));
  for(const member of actors){
    const x=member.x*w,y=member.y*h,art=member.actor.art??member.actor.slot;
    ctx.save();ctx.translate(x-member.size/2,y-member.size);
    ArcadeHUD.drawEntitySprite(ctx,images[art],{theme:config.theme,slot:art,facing:member.walking&&member.side===0?-1:1},member.size,now,
      member.walking?'walk':passed?'celebrate':'idle');
    ctx.restore();
    const mark=member.actor.badge??member.actor.sample;
    if(mark!==undefined){
      ctx.save();ctx.translate(x+member.size*.21,y-member.size*.4);
      ctx.fillStyle=mark?'#ffb883':'#fff1bc';ctx.strokeStyle='#152737';ctx.lineWidth=1.5;
      ctx.beginPath();
      if(mark===0)ctx.arc(0,0,member.size*.12,0,2*Math.PI);
      else for(let k=0;k<=16;k++){
        const radius=member.size*(k%2?.08:.16);
        ctx[k?'lineTo':'moveTo'](Math.cos(k*Math.PI/8)*radius,Math.sin(k*Math.PI/8)*radius);
      }
      ctx.fill();ctx.stroke();ctx.restore();
    }
    if(member.walking){
      ctx.fillStyle='#e9dbb8a8';
      for(let i=0;i<3;i++)ctx.fillRect(x+(member.side===0?1:-1)*(4+i*4),y+1-Math.sin(member.age/45+i)*2,2,2);
    }else if(member.age<1050){
      ctx.save();ctx.textAlign='center';ctx.font='bold 11px sans-serif';
      ctx.fillStyle=member.correct?'#a3ffd3':'#ffcac1';ctx.strokeStyle='#102132';ctx.lineWidth=3;
      const text=member.correct?'+1':'Mislabelled!',ty=y-20-(member.age-380)/60;
      ctx.strokeText(text,x,ty);ctx.fillText(text,x,ty);ctx.restore();
    }
  }
  arrived.forEach((count,i)=>{
    const x=w*ArcadeHUD.laneCenter(i,arrived.length,layout.leftLane,layout.rightLane),y=h*.76+Math.floor(Math.max(count-1,0)/5)*h*.047;
    const text='Classified: '+count;
    if(!view.actors?.some(actor=>actor.station)){
      ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.lineWidth=3;
      ctx.strokeStyle='#162831';ctx.fillStyle='#fff';
      const name=view.lanes[i],available=Math.min(88,w*(layout.rightLane-layout.leftLane)/Math.max(1,arrived.length-1));
      ctx.strokeText(name,x,y+20,available);ctx.fillText(name,x,y+20,available);
    }
    ctx.font='bold 11px sans-serif';ctx.textAlign='center';
    const width=ctx.measureText(text).width+12;
    ctx.fillStyle='#162831';ctx.fillRect(x-width/2,y-10,width,16);
    ctx.fillStyle='#fff';ctx.fillText(text,x,y+2);
  });
}
function paint(now){
  requestAnimationFrame(paint);if(!round)return;
  resizeCanvas();
  const w=worldWidth,h=worldHeight;
  ctx.save();
  if(feedback&&now-feedback.start>=700)feedback=null;
  const zoom=Math.max(w/scenery.width,h/scenery.height);
  const sw=scenery.width*zoom,sh=scenery.height*zoom;
  ArcadeEnvironment.blit(ctx,scenery,(w-sw)/2,(h-sh)/2,sw,sh);
  const actors=guideStep>=0?practiceActors:view.actors||view.names.slice(0,2).map((label,slot)=>({slot,label}));
  const playWidth=layout.playableWidth/layout.uiScale;
  const columns=Math.min(actors.length,Math.max(1,Math.floor(playWidth/85)));
  const rows=Math.ceil(actors.length/columns);
  hits=[];
  actors.forEach((actor,i)=>{
    const effect=feedback?.actor===i&&!feedback.detached?feedback:null;
    const {label,slot,station}=effect?.entity||actor;
    const vx=station?0:(i%2?-1:1),age=Math.max(0,now-arrival);
    const inLane=view.lanes && guideStep<0 && actors.some(a=>a.station);
    const walking=actor.pace?Math.sin(age*actor.pace/1600)*playWidth*.20:0;
    const row=Math.floor(i/columns),rowSize=Math.min(columns,actors.length-row*columns);
    let anchor=playWidth*((i%columns)+.5)/rowSize;
    if(inLane)anchor=w*(station?(slot===0?layout.leftLane:layout.rightLane):(layout.leftLane+layout.rightLane)/2);
    const x=effect?.x??anchor+walking-vx*12*Math.max(0,1-age/450);
    const y=effect?.y??(h/2+(row-(rows-1)/2)*Math.min(66,h*.50/rows)+(i%2?6:-4));
    if(guideStep===i+1){
      ctx.strokeStyle='#ffe18c';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y+10,22,7,0,0,2*Math.PI);ctx.stroke();
    }
    const entity=effect?.entity||actor;
    if(entity.aura!==undefined){
      const pulse=(entity.aura?3:1)*Math.sin(now/(entity.aura?100:400));
      ctx.strokeStyle=entity.aura?'#ffa95e':'#7bdcf2';ctx.lineWidth=2;
      ctx.beginPath();ctx.ellipse(x,y-4,19+pulse,22+pulse,0,0,Math.PI*2);ctx.stroke();
    }
    const pose=ArcadeHUD.pose(now,i,vx,age,effect);
    ctx.fillStyle='#142d3680';ctx.beginPath();ctx.ellipse(x,y+12,14*pose.shadow,4*pose.shadow,0,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.translate(x+pose.dx,y+11+pose.dy);ctx.rotate(pose.tilt);ctx.scale(pose.sx,pose.sy);
    const art=(effect?.entity||actor).art??slot;
    const image=images[art],framed=image?.naturalHeight===128;
    const size=framed?44:36;
    ctx.translate(-size/2,-size*(framed?116/128:1));
    ArcadeHUD.drawEntitySprite(ctx,image,{theme:config.theme,slot:art},size,now,passed?'celebrate':walking?'walk':'idle');
    ctx.restore();
    if(entity.badge!==undefined){
      ctx.save();ctx.translate(x+10,y-4+pose.dy);ctx.fillStyle='#fff1bc';ctx.strokeStyle='#152737';ctx.lineWidth=2;
      ctx.beginPath();
      if(entity.badge===0)ctx.ellipse(0,0,6,6,0,0,2*Math.PI);
      else for(let k=0;k<=16;k++){
        const angle=k*Math.PI/8,radius=k%2?4:8;
        ctx[k?'lineTo':'moveTo'](Math.cos(angle)*radius,Math.sin(angle)*radius);
      }
      ctx.fill();ctx.stroke();ctx.restore();
    }
    if(entity.verified!==undefined){
      ctx.fillStyle='#182735';ctx.fillRect(x+6,y-11+pose.dy,13,14);
      ctx.fillStyle='#ffedb9';ctx.fillRect(x+8,y-9+pose.dy,9,10);
      ctx.fillStyle='#274559';ctx.fillRect(x+10,y-7+pose.dy,5,1);
      if(entity.verified){ctx.fillStyle='#15815d';ctx.fillRect(x+10,y-3+pose.dy,5,3);}
    }
    if(entity.sample!==undefined){
      ctx.save();ctx.translate(x+12,y-4+pose.dy);ctx.rotate(Math.PI/4);
      ctx.fillStyle='#132436';ctx.fillRect(-6,-6,12,12);
      ctx.fillStyle=entity.sample?'#ff936f':'#80f5c4';ctx.fillRect(-4,-4,8,8);
      if(entity.sample){ctx.fillStyle='#182c3d';ctx.fillRect(-1,-5,2,5);ctx.fillRect(0,0,3,5);}ctx.restore();
    }
    ctx.font='600 13px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign='center';
    const available=inLane?w*(layout.rightLane-layout.leftLane)/2:playWidth/rowSize;
    const width=Math.max(12,Math.min(ctx.measureText(label).width+10,available-4));
    let name=String(label);
    if(ctx.measureText(name).width>width-8){
      name=name.slice(0,36);
      while(name.length && ctx.measureText(name+'…').width>width-8)name=name.slice(0,-1);
      name+='…';
    }
    const pillHeight=20;
    const center=Math.max(width/2+2,Math.min(playWidth-width/2-2,x));
    ctx.fillStyle='#162831';ctx.beginPath();ctx.roundRect(center-width/2,y+16,width,pillHeight,pillHeight/2);ctx.fill();
    ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.fillText(name,center,y+16+pillHeight/2);ctx.textBaseline='alphabetic';
    hits.push({x,y,...actor});
  });
  drawCohort(now,w,h);
  if(feedback)ArcadeHUD.drawCallout(ctx,feedback,now);
  ctx.restore();
}
async function start(data,path){
  if(data.archetype==='orbit')data={...data,archetype:'classifier'};
  const id=++generation;
  const [loaded,background]=await Promise.all([
    ArcadeSprites.preload(data.theme,path),
    ArcadeSprites.loadImage(data.theme.backgroundSprite,path)
  ]);
  if(id!==generation)return;
  scenery=document.createElement('canvas');scenery.width=560;scenery.height=245;
  const painter=scenery.getContext('2d');
  if(background?.naturalWidth)ArcadeEnvironment.backdrop(painter,scenery.width,scenery.height,background);
  else ArcadeEnvironment.drawArenaBackground(painter,scenery.width,scenery.height,data.theme);
  reported=false;passed=false;feedback=null;hits=[];config=data;configPath=path;images=loaded;cohort=ArcadeHUD.createCohort();round=withFieldTest(createRound(data));arrival=performance.now();
  lines=ArcadeNarrator.lines(data);practiceActors=ArcadeNarrator.actors(data);guideStep=continuing?-1:0;continuing=false;
  $('sources').replaceChildren();render();emit('start');
}
canvas.onclick=e=>{
  const b=canvas.getBoundingClientRect(),x=(e.clientX-b.left)*worldWidth/b.width,y=(e.clientY-b.top)*worldHeight/b.height;
  const hit=hits.find(h=>Math.abs(x-h.x)<22&&Math.abs(y-h.y)<32);
  if(hit&&hit.slot<2&&(guideStep>=0||hit.station))choose(hit.slot);
};
function showGuide(){feedback=null;guideStep=0;emit('hint_shown');render();}
$('help').onclick=showGuide;
$('continue').onclick=()=>guideStep===3?finishGuide():guideInput('continue');
$('skip').onclick=finishGuide;
$('slider').oninput=e=>action(()=>round.tune(Number(e.target.value)));
window.addEventListener('keydown',e=>{
  if(!round)return;
  if(e.repeat){if(e.code==='Space')e.preventDefault();return;}
  if(e.target.matches('input'))return;
  if(e.code==='Space'&&e.target.matches('button')&&!e.target.classList.contains('field-trigger'))return;
  if(e.key==='?'){showGuide();return;}
  if(e.code==='Space'){e.preventDefault();submit();return;}
  const n=/^[1-9]$/.test(e.key)?Number(e.key)-1:({ArrowLeft:0,ArrowRight:1})[e.key];
  if(n!==undefined && n<view.actions.length){e.preventDefault();choose(n);}
});
window.addEventListener('message',e=>{
  if(parent===window||e.source!==parent||e.data?.type!=='LOAD_CONFIG'||origin&&e.origin!==origin)return;
  origin=e.origin;start(e.data.config,configPath);
});
fetch(configPath).then(r=>r.json()).then(c=>{if(!generation)return start(c,configPath);}).catch(e=>{$('subject').textContent='Unable to load activity: '+e.message;});
requestAnimationFrame(paint);
