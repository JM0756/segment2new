const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('./progression.js');
test('first entry for any requested tier uses tutorial and hides AI',()=>{
  for(const request of [0,1,2]){
    const level=p.enter(0,request);
    assert.equal(level,0);
    assert.equal(p.canRemix(level,0),false);
  }
});
test('tutorial completion opens level one and enables remix only outside tutorial',()=>{
  const unlocked=p.complete(0,0,{passed:true,accuracy:50,stars:1});
  assert.equal(unlocked,1);
  assert.equal(p.enter(unlocked,2),1);
  assert.ok(p.canRemix(1,unlocked));
  assert.equal(p.canRemix(0,unlocked),false);
});
test('level two unlock requires a completed level one and at least 80 percent',()=>{
  assert.equal(p.complete(0,1,{passed:true,accuracy:100,stars:3}),0);
  assert.equal(p.complete(1,1,{passed:false,accuracy:90,stars:3}),1);
  assert.equal(p.complete(1,1,{passed:true,accuracy:79.9,stars:3}),1);
  assert.equal(p.complete(1,1,{passed:true,accuracy:80,stars:3}),2);
  assert.equal(p.enter(2,2),2);
});

async function mountStudio(){
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const records=new Map(),nodes=new Map(),listeners={};
  const intervals=new Map();
  function element(){return {
    value:'',dataset:{},classList:{add(){},remove(){},toggle(){}},focus(){},scrollIntoView(){},addEventListener(){},
    children:[],style:{setProperty(){}},contentWindow:{},
    getContext:()=>({fillRect(){},scale(){},ellipse(){},beginPath(){},fill(){},stroke(){},save(){},restore(){},translate(){}}),toDataURL:()=>'',matches:()=>false,setAttribute(){},
    append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}
  };}
  const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const game='Feature-Classifier',levels={1:'/arcade/Feature-Classifier/source/default.json',2:'/arcade/Feature-Classifier/source/level2.json',3:'/arcade/Feature-Classifier/source/level3.json'};
  const item={game,title:'Orbital Station',levels};
  const context=vm.createContext({document:{addEventListener:(k,f)=>listeners[k]=f,documentElement:element(),body:element(),createElement:element,getElementById:get},
    location:{origin:'http://localhost:8000'},window:{matchMedia:()=>({matches:false}),addEventListener:(k,f)=>listeners[k]=f},
    localStorage:{getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v)},
    fetch:async()=>({ok:true,json:async()=>({items:[item],health:{model:'auto'}})}),
    Option:class{},URL,URLSearchParams,crypto:require('node:crypto'),setInterval(fn,ms){intervals.set(ms,fn);return ms;},clearInterval(ms){intervals.delete(ms);}});
  for(const file of ['../arcade/environment.js','progression.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  return {get,context,intervals,listeners,game,levels,records,item};
}

test('Studio mounts the default tutorial first and gates the floating remix control',async()=>{
  const {get,listeners,game,levels,records}=await mountStudio();
  get('catalog').children[0].onclick();
  const stage=get('stage');
  assert.equal(stage.src.searchParams.get('mode'),'tutorial');
  assert.equal(stage.src.searchParams.get('config'),levels[1]);
  assert.equal(get('remixToggle').hidden,true);
  assert.equal(get('stageChat').hidden,true);
  function message(type,passed=true,accuracy=100){
    listeners.message({origin:'http://localhost:8000',source:stage.contentWindow,data:{
      type,archetype:game,level:Number(stage.src.searchParams.get('level')),
      run:stage.src.searchParams.get('run'),accuracy,stars:accuracy>=80?3:2,passed}});
  }
  message('ARCADE_NEXT');assert.equal(stage.src.searchParams.get('level'),'0');
  message('ARCADE_PROGRESS');assert.equal(stage.src.searchParams.get('level'),'0');
  message('ARCADE_NEXT');assert.equal(stage.src.searchParams.get('level'),'1');
  get('remixToggle').onclick();assert.equal(get('stageChat').hidden,false);
  listeners.fullscreenchange();assert.equal(get('stageChat').hidden,true);
  get('remixToggle').onclick();assert.equal(get('stageChat').hidden,false);
  listeners.fullscreenchange();assert.equal(get('stageChat').hidden,true);
  message('ARCADE_PROGRESS',false,60);message('ARCADE_NEXT');
  assert.equal(stage.src.searchParams.get('level'),'1');
  for(const next of [2,3]){
    message('ARCADE_PROGRESS');message('ARCADE_NEXT');
    assert.equal(stage.src.searchParams.get('config'),levels[next]);
    assert.equal(get('stageChat').hidden,true);
  }
  assert.equal(Number(records.get('arcade-progress-v1/'+game)),3);
});

test('plain Enter sends and modified or composing Enter leaves the text alone',async()=>{
  const {get}=await mountStudio();
  let sent=0,prevented=0;
  get('composer').requestSubmit=()=>sent++;
  for(const flags of [{shiftKey:true},{ctrlKey:true},{metaKey:true},{isComposing:true},{}]){
    get('theme').onkeydown({key:'Enter',preventDefault:()=>prevented++,...flags});
  }
  assert.deepEqual([sent,prevented],[1,1]);
});

test('submitting immediately replaces the hub with a user turn and cycling assistant status',async()=>{
  const {get,context,intervals,item}=await mountStudio();
  let finish;
  context.fetch=async url=>{
    if(url==='/api/generate')return new Promise(resolve=>finish=resolve);
    return {ok:true,json:async()=>({items:[item],health:{model:'auto'}})};
  };
  get('theme').value='Run a space station';
  const request=get('composer').onsubmit({preventDefault(){}});
  assert.equal(get('home').hidden,true);assert.equal(get('thread').hidden,false);
  assert.equal(get('thread').children[0].textContent,'Run a space station');
  const bubble=get('thread').children[1].children[0];
  assert.equal(bubble.textContent,'Thinking…');intervals.get(1600)();
  assert.equal(bubble.textContent,'Designing world…');
  assert.equal(get('theme').value,'');
  finish({ok:true,json:async()=>({ok:true,config_path:item.levels[1],config:{theme:{setting:'Station'}},summary:'Welcome aboard.'})});
  await request;
  assert.equal(intervals.has(1600),false);
  assert.equal(get('thread').children[1].children[0].textContent,'Welcome aboard.');
  assert.equal(get('play').hidden,false);
});

test('theme selection and Alt+T cycle and persist the three themes',async()=>{
  const {get,context,listeners,records}=await mountStudio();
  const doc=context.document.documentElement;
  assert.equal(doc.dataset.theme,'dark');
  for(const mode of ['light','invert','dark']){
    listeners.keydown({target:get('help'),key:'t',altKey:true,preventDefault(){}});
    assert.equal(doc.dataset.theme,mode);assert.equal(records.get('studio-theme'),mode);
  }
  get('mode-invert').onclick();assert.equal(doc.dataset.theme,'invert');
});

test('Studio text tokens meet 4.5:1 against all three surfaces in each theme',()=>{
  const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'style.css'),'utf8');
  function luminance(hex){
    let rgb=hex.slice(1);
    if(rgb.length===3)rgb=[...rgb].map(x=>x+x).join('');
    const values=rgb.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
    return values[0]*.2126+values[1]*.7152+values[2]*.0722;
  }
  function ratio(a,b){
    const [lo,hi]=[luminance(a),luminance(b)].sort((x,y)=>x-y);
    return (hi+.05)/(lo+.05);
  }
  for(const selector of [':root{',':root[data-theme=light]{',':root[data-theme=invert]{']){
    const rule=css.split(selector)[1].split('}')[0];
    const color=Object.fromEntries([...rule.matchAll(/--([\w-]+):(#[a-f0-9]+)/gi)].map(m=>[m[1],m[2]]));
    for(const fg of ['text-primary','text-secondary','accent']){
      for(const bg of ['bg','surface','surface-elevated'])assert.ok(ratio(color[fg],color[bg])>=4.5,selector+fg+'/'+bg);
    }
    assert.ok(ratio(color['on-accent'],color.accent)>=4.5);
  }
});

test('card banners keep both facing characters when background or sprite art loads',async()=>{
  const {context}=await mountStudio();
  const vm=require('node:vm'),images=[],draws=[];
  context.Image=class {constructor(){this.naturalWidth=128;this.naturalHeight=128;images.push(this);}};
  context.location.href='http://localhost:8000/';
  const create=context.document.createElement;
  context.document.createElement=tag=>{
    const el=create(tag),ctx=el.getContext();
    ctx.drawImage=(image)=>draws.push(image);el.getContext=()=>ctx;
    return el;
  };
  const art=vm.runInContext(`renderCardBanner({config:{theme:{setting:'Fallout',backgroundSprite:'assets/yard.png',
    class0Sprite:'assets/hero.png',sprites:{class1_asset:'assets/scout.png'}}}},'/generated/test/activity.json',true)`,context);
  assert.equal(art.className,'card-banner result-banner');
  assert.equal(art.children.length,3);
  const [,left,right]=art.children;
  assert.equal(left.children.length,1);
  assert.equal(right.children.length,1);
  const fallback=right.children[0];
  assert.deepEqual(images.map(i=>i.src),['yard','hero','scout'].map(n=>'http://localhost:8000/generated/test/assets/'+n+'.png'));
  images[1].onload();images[0].onload();
  assert.deepEqual(draws,[images[1],images[0]]);
  assert.equal(right.children[0],fallback);
  assert.equal(art.children[1],left);
});
