const test=require('node:test'),assert=require('node:assert/strict');
const hud=require('../animation.js'),motion=require('../world');
const world=require('../Feature-Classifier/source/default.json').world_physics;
test('legacy forest games retain their setting when inheriting a map',()=>{
  const legacy=motion.forLegacyConfig({archetype:'classifier',theme:{environment:{layout:'forest-edge',setting_name:'Orchard'}}},
    world,require('../world_materials.json'));
  assert.equal(legacy.surface.type,'grass');
  assert.equal(legacy.structures.leftTarget.style,'wooden corral');
  assert.equal(legacy.structures.entry.label,'Orchard');
  assert.equal(world.structures.leftTarget.style,'airlock');
});
test('feedback originates at the specific actor and retains its appearance',()=>{
  for(const [x,y,slot] of [[72,55,0],[190,68,1]]) {
    const e=hud.spawnCallout({x,y,slot},{correct:true,text:'+100 MATCH!'},100);
    assert.deepEqual([e.x,e.y,e.entity.slot],[x,y,slot]);
    const calls=[];
    const ctx=new Proxy({measureText:()=>({width:50})},{get:(obj,key)=>obj[key]||((...args)=>calls.push([key,...args]))});
    hud.drawCallout(ctx,e,200);
    assert.deepEqual(calls.find(([name])=>name==='translate'),['translate',x,y]);
    assert.ok(calls.some(([name])=>name==='ellipse'));
  }
});
test('facing, stride and feedback use distinct transformations',()=>{
  const right=hud.pose(110,0,1,500),left=hud.pose(110,0,-1,500);
  assert.equal(right.sx,-left.sx);assert.ok(right.tilt>0 && right.dy<0);
  const success=hud.pose(310,0,1,500,{start:100,correct:true});
  const miss=hud.pose(310,0,1,500,{start:100,correct:false});
  assert.equal(success.dy,miss.dy);assert.equal(success.shadow,miss.shadow);
  assert.equal(success.dx,0);assert.notEqual(miss.dx,0);
});

test('classified actors ease toward their chosen lane and remain in arrival order',()=>{
  const cohort=hud.createCohort(world);
  const actor={slot:1,badge:1,aura:0};
  cohort.add(actor,0,false,100,.5,.5);
  cohort.add(actor,1,true,150,.5,.5);
  assert.equal(cohort.frame(100,2).actors[0].x,.5);
  const halfway=cohort.frame(290,2);
  assert.ok(halfway.actors[0].x<.5 && halfway.actors[0].walking);
  assert.deepEqual(halfway.arrived,[0,0]);
  assert.equal(halfway.actors[0].sinceContact<0,true);
  const finished=cohort.frame(10000,2);
  assert.deepEqual(finished.arrived,[1,1]);
  assert.ok(finished.actors.every(a=>!a.walking && a.size===24));
  assert.equal(finished.actors[0].actor,actor);
  assert.equal(finished.actors[0].correct,false);
  assert.ok(finished.actors[1].x>.65);
});

test('a four-frame sheet uses square source rects at eight FPS and wraps',()=>{
  global.ArcadeEnvironment=require('../environment');
  const image={naturalWidth:512,naturalHeight:128};
  const draws=[],ctx=new Proxy({drawImage:(...args)=>draws.push(args)},{
    get:(obj,key)=>obj[key]||(()=>{})
  });
  for(const t of [0,124,125,250,375,500])hud.drawEntitySprite(ctx,image,{},32,t,'walk');
  assert.deepEqual(draws.map(d=>d.slice(1,5)),[0,0,128,256,384,0].map(x=>[x,0,128,128]));
  hud.drawEntitySprite(ctx,{naturalWidth:128,naturalHeight:128},{},32,500);
  assert.equal(draws.at(-1).length,5);
});

test('footprints detour around a solid on every frame; material changes speed, glide and fading trails',()=>{
  const {checkpoint,leftTarget}=world.structures;
  const o={...world.obstacles[0],x:.38,y:.48};
  const blocked={...world,obstacles:[o]};
  const path=motion.route(checkpoint,leftTarget,blocked);
  assert.ok(path.points.length>2);
  for(let t=0;t<path.duration;t+=2){
    const p=motion.position(path,t);
    assert.ok(Math.abs(p.x-o.x)>=o.w/2+.011 || Math.abs(p.y-o.y)>=o.h/2+.011);
  }
  assert.equal(motion.position(path,path.duration).x,leftTarget.x);
  const fast=motion.route(checkpoint,leftTarget,{...world,surface:{...world.surface,speedMultiplier:1.3,drag:.98}});
  assert.ok(fast.duration<path.duration);
  assert.notDeepEqual(motion.position(fast,fast.duration*.25),motion.position(path,path.duration*.25));
  assert.ok(motion.trail(path,230).every(m=>m.alpha>0&&m.alpha<=1));
  assert.deepEqual(motion.trail(path,path.duration+451),[]);
  assert.equal(motion.targetAt(world,leftTarget),0);
  assert.equal(motion.targetAt(world,checkpoint),'checkpoint');
  assert.equal(motion.targetAt(world,world.structures.rightTarget),1);
  assert.equal(motion.targetAt(world,o),null);
});
test('active actors and cohort members are drawn together in ground-contact order',()=>{
  const drawn=[];
  const entries=[[60,'anchor'],[69,'settled'],[35,'incoming'],[54,'walking'],[50,'inspection desk'],[65,'gate frame'],[40,'tree']];
  hud.paintByDepth(entries.map(([footY,id])=>({footY,draw:()=>drawn.push(id)})));
  assert.deepEqual(drawn,['incoming','tree','inspection desk','walking','anchor','gate frame','settled']);
});

test('inspection pulses decay and only the receiving class gate opens on arrival',()=>{
  const cohort=hud.createCohort(world);
  cohort.add({slot:0},1,true,100,.5,.5);
  const state=now=>hud.structureActivity(now,100,cohort.frame(now,2).actors,2);
  assert.deepEqual(state(100),{scan:1,gates:[0,0]});
  assert.ok(state(375).scan>0 && state(375).scan<1);
  const contact=cohort.frame(100,2).actors[0].approach.duration+100;
  assert.deepEqual(state(contact+.01).gates.map(x=>Math.round(x)),[0,1]);
  assert.deepEqual(state(contact+600),{scan:0,gates:[0,0]});
});

test('station representatives and approaching specimens paint over the target door',()=>{
  const station=world.structures.leftTarget,x=station.x*800,y=station.y*400;
  const actors=[{x,footY:y},{x:x+5,footY:y-28}];
  assert.ok(hud.stationDepth(station,actors,800,400)<Math.min(...actors.map(a=>a.footY)));
});

test('passive glow, conduit dots and 24 ambient particles advance without theme assets',()=>{
  function frame(ms){
    const dots=[];
    const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
      fillRect(...bounds){assert.ok(bounds.every(Number.isFinite));dots.push(bounds);}};
    const phase=hud.ambientPhase(ms);
    hud.drawAtmosphere(ctx,800,450,ms);
    hud.drawConduits(ctx,800,160,world.structures,phase,'#ace');
    return {phase,dots};
  }
  const a=frame(0),b=frame(500);
  assert.notEqual(a.phase.glow,b.phase.glow);
  assert.ok(b.phase.travel>a.phase.travel);
  assert.equal(b.dots.length,26);
  for(let i=0;i<26;i++)assert.notDeepEqual(a.dots[i],b.dots[i]);
});

test('classifier presentation frames the playable map and honors atmospheric layer choices',()=>{
  const layouts=['compact','balanced','panoramic'].map(sceneryLayout=>hud.deckBounds(900,500,{sceneryLayout}));
  assert.ok(layouts[0].y<layouts[1].y&&layouts[1].y<layouts[2].y);
  const calls=[];
  const ctx=new Proxy({}, {get:(obj,k)=>obj[k]||((...args)=>calls.push([k,...args]))});
  const draw=(weather,particles)=>{
    calls.length=0;
    hud.drawClimate(ctx,900,500,550,{weather:{type:weather,intensity:.6,angle:-20,tint:'#adf'},
      particles:{type:particles,density:.4,tint:'#abc'}},layouts[1]);
    return calls.map(c=>c[0]);
  };
  assert.deepEqual(draw('none','none'),['save','restore']);
  for(const [type,op] of Object.entries({rain:'ellipse',snow:'fillRect',fog:'fillRect',embers:'fillRect',bubbles:'arc',dust:'fillRect'}))
    assert.ok(draw(type,'none').includes(op));
  for(const type of ['sun_rays','clouds','wind_streaks','stars','spores','neon_glints'])
    assert.ok(draw('none',type).length>2);
  const textures=new Set();
  for(const [i,material] of ['lab_tile','steel_grating','cobblestone','wood_deck','stone_slate','noir_concrete'].entries()){
    const {x,y,width,height}=layouts[i%3];assert.ok(x>0&&y>0&&x+width<900&&y+height<500);
    assert.ok(width/900>=.60 && width/900<=.65 && height/500>=.52 && height/500<=.58);
    assert.equal(x,(900-width)/2);
    calls.length=0;hud.drawDeck(ctx,480,220,{material,borderStyle:'stone_curb',deckFill:'#134',gridLine:'#789',borderAccent:'#abc'});
    textures.add(JSON.stringify(calls));
    assert.ok(calls.filter(c=>c[0]==='fillRect').length>10);
  }
  assert.equal(textures.size,6);
});

test('novel scenery uses authored texture, motion and prop attributes',()=>{
  const calls=[];
  const ctx=new Proxy({}, {get:(obj,key)=>obj[key]||((...args)=>calls.push([key,...args]))});
  hud.drawDeck(ctx,240,120,{material:{name:'basalt_lace',pattern:'cobble'},groutColor:'#456',deckFill:'#123',borderAccent:'#789'});
  assert.ok(calls.some(([k])=>k==='ellipse'));
  const climate={particles:{density:1,type:'golden_pollen'},particleConfig:{shape:'ring',count:3,size:4,vx:5,vy:-2,color:'#fed'}};
  calls.length=0;hud.drawClimate(ctx,200,100,1000,climate);
  assert.equal(calls.filter(([k])=>k==='arc').length,3);
  assert.deepEqual(calls.find(([k])=>k==='arc').slice(1,4),[5,98,4]);
  calls.length=0;hud.drawScenery(ctx,{name:'stone_planters',primaryColor:'#a22',accentColor:'#ba4'},20,30,null,'#fff');
  assert.ok(calls.some(([k,label])=>k==='fillText'&&label==='stone planters'));
  calls.length=0;hud.drawScenery(ctx,{name:'custom'},20,30,{},'#fff');
  assert.equal(calls[0][0],'drawImage');
});
