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
  assert.ok(success.dy<miss.dy && success.shadow<miss.shadow);
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
  const path=motion.route(checkpoint,leftTarget,world),o=world.obstacles[0];
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
  const entries=[[60,'anchor'],[69,'settled'],[35,'incoming'],[54,'walking']];
  hud.paintByDepth(entries.map(([footY,id])=>({footY,draw:()=>drawn.push(id)})));
  assert.deepEqual(drawn,['incoming','walking','anchor','settled']);
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
