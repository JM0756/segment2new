const test=require('node:test'),assert=require('node:assert/strict');
const hud=require('../animation.js');
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
  const cohort=hud.createCohort();
  const actor={slot:1,badge:1,aura:0};
  cohort.add(actor,0,false,100,.5,.5);
  cohort.add(actor,1,true,150,.5,.5);
  assert.equal(cohort.frame(100,2).actors[0].x,.5);
  const halfway=cohort.frame(290,2);
  assert.ok(halfway.actors[0].x<.35 && halfway.actors[0].walking);
  assert.deepEqual(halfway.arrived,[0,0]);
  assert.deepEqual(cohort.frame(480,2).arrived,[1,0]);
  const finished=cohort.frame(10000,2);
  assert.deepEqual(finished.arrived,[1,1]);
  assert.ok(finished.actors.every(a=>!a.walking && a.size===17));
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
