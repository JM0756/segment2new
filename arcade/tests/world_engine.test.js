const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../world_engine');
const config=require('../Feature-Classifier/source/level3.json');
const world=engine.project(config.tilemap,config.world_physics);
const open={...world,grid:Array(12).fill('.'.repeat(20))};
function move(p,dx,dy,time){
  let state;
  for(let i=0;i<Math.round(time*60);i++)state=p.step(dx,dy,1/60);
  return state;
}
test('all eight directions have equal tile speed and a blocked axis slides along a wall',()=>{
  for(const dx of [-1,0,1])for(const dy of [-1,0,1]){
    if(!dx&&!dy)continue;
    const p=engine.controller(open,{x:.5,y:.5}),end=move(p,dx,dy,.2);
    assert.equal(Math.sign(end.x-.5),dx);assert.equal(Math.sign(end.y-.5),dy);
    const reference=move(engine.controller(open,{x:.5,y:.5}),1,0,.2);
    assert.ok(Math.abs(Math.hypot((end.x-.5)*20,(end.y-.5)*12)-(reference.x-.5)*20)<1e-8);
  }
  const wall={...world,grid:Array(12).fill('.'.repeat(10)+'#'+'.'.repeat(9))};
  const end=move(engine.controller(wall,{x:.48,y:.3}),1,1,1);
  assert.ok(end.x*20<=9.8 && end.y>.45);
});
test('all themes retain momentum on slippery tiles',()=>{
  const ice={...world,surface:{...world.surface,type:'stone',drag:.8},grid:Array(12).fill('~'.repeat(20))};
  for(const [map,expected] of [[ice,.96],[{...ice,grid:open.grid},.8]]){
    const p=engine.controller(map,{x:.5,y:.5});
    assert.equal(engine.surfaceAt(map,p.pos()).drag,expected);
    move(p,1,0,.5);const first=p.step(0,0,.016),next=p.step(0,0,.016);
    assert.ok(next.x>first.x);
    const ratio=(p.step(0,0,.016).x-next.x)/(next.x-first.x);
    assert.ok(Math.abs(ratio-expected**.96)<.01);
  }
  assert.equal(engine.surfaceAt({...ice,surface:{...ice.surface,type:'snow'}},{x:.5,y:.5}).drag,.96);
});
test('walking is independent of interaction and a leader click interacts only upon arrival',()=>{
  const p=engine.controller(world,world.structures.checkpoint);
  assert.equal(p.step(0,0,.016).contact,'');
  assert.equal(engine.nearby({x:.03,y:.95},[world.structures.leftTarget]),null);
  for(const side of ['leftTarget','rightTarget']){
    p.walkTo(world.structures[side],'interact');
    let arrivals=0;
    for(let i=0;i<500;i++){
      const s=p.step(0,0,1/60);
      assert.notEqual(world.grid[Math.floor(s.y*12)][Math.floor(s.x*20)],'#');
      if(s.contact){assert.equal(s.contact,'interact');assert.equal(s.x,world.structures[side].x);arrivals++;}
    }
    assert.equal(arrivals,1);
  }
});

test('all seven maps share foot geometry, landmarks and velocity on both surfaces',()=>{
  const fs=require('node:fs'),path=require('node:path'),base=path.resolve(__dirname,'..');
  const games=fs.readdirSync(base).filter(name=>fs.existsSync(path.join(base,name,'source/game.js')));
  assert.equal(games.length,7);
  const trajectories=games.map(name=>{
    const config=require(path.join(base,name,'source/default.json'));
    const map=engine.project(config.tilemap,config.world_physics);
    const geometry=Object.values(map.structures).map(({x,y,radius,width,height})=>[x,y,radius,width,height]);
    const points=[];
    for(const tile of ['.','~']){
      const pilot=engine.controller({...map,grid:Array(12).fill(tile.repeat(20))},{x:.5,y:.5});
      for(const [dx,dy] of [[1,0],[1,1],[0,-1],[0,0]])points.push(pilot.step(dx,dy,.1));
    }
    return {geometry,points};
  });
  for(const result of trajectories)assert.deepEqual(result,trajectories[0]);
});
