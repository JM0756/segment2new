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
