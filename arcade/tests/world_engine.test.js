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

test('generated scenery does not acquire synthetic props on the left border',()=>{
  const rows=config.tilemap.map(row=>row.replaceAll('#','.'));
  rows[2]='#'+rows[2].slice(1);
  const scene=engine.project(rows,config.world_physics,true);
  assert.deepEqual(scene.obstacles,[]);
  assert.ok(scene.grid.every(row=>!row.startsWith('#')));
});

test('the classifier has open onboarding and collision-safe hazards in later tiers',()=>{
  const fs=require('node:fs'),path=require('node:path'),base=path.resolve(__dirname,'..');
  {
    const name='Feature-Classifier';
    for(const tier of [1,2,3]){
      const cfg=require(path.join(base,name,'source',tier===1?'default.json':'level'+tier+'.json'));
      for(const generated of [false,true]){
        const map=engine.project(cfg.tilemap,cfg.world_physics,generated,tier);
        assert.equal(map.obstacles.length,tier-1);assert.equal(map.hazards.length,tier-1);
        for(const obstacle of map.obstacles){
          const start={x:obstacle.x-.9/20,y:obstacle.y};
          const p=engine.controller(map,start);
          const first=p.step(1,0,.016),second=p.step(1,0,.016);
          assert.ok(second.x-first.x>first.x-start.x);
          assert.ok(p.step(0,0,.016).x>second.x);
          const slide=move(p,1,1,.10);
          assert.ok(slide.y>start.y && slide.x<=obstacle.x-.69/20);
        }
        for(const v of map.hazards){
          assert.equal(engine.nearby(v,Object.values(map.structures)),null);
          assert.equal(engine.nearby(v,map.obstacles),null);
          const pushed=move(engine.controller(map,v),0,0,.25);
          assert.ok((pushed.y-v.y)*v.dy>0);
          v.active=false;
          const still=move(engine.controller(map,v),0,0,.25);
          assert.equal(still.y,v.y);
          v.active=true;
        }
      }
    }
  }
});

test('classifier vent acceleration follows the full directed corridor and vanishes when off',()=>{
  for(const tier of [2,3]){
    const map=engine.project(config.tilemap,config.world_physics,false,tier);
    for(const vent of map.hazards){
      const inside=engine.flowPoint(vent,2,.3);
      const pilot=engine.controller(map,inside);
      const first=pilot.step(0,0,.016),next=pilot.step(0,0,.016);
      assert.ok(next.vy*vent.dy>first.vy*vent.dy && first.vy*vent.dy>0);
      for(const [along,across] of [[-.1,0],[vent.length+.1,0],[2,vent.width/2+.1]]){
        const outside=engine.flowPoint(vent,along,across);
        assert.equal(engine.controller(map,outside).step(0,0,.05).vy,0);
      }
      vent.active=false;
      assert.equal(engine.controller(map,inside).step(0,0,.05).vy,0);
      assert.ok(Math.abs(pilot.step(0,0,.05).vy)<Math.abs(next.vy));
    }
  }
});
