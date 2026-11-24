const test=require('node:test');
const assert=require('node:assert/strict');
const scenes=require('../environment.js');
function recorder(){
  const commands=[];
  const ctx=new Proxy({commands},{get(target,key){
    if(key in target)return target[key];
    return (...args)=>commands.push([key,target.fillStyle,...args]);
  }});
  return ctx;
}
test('legacy themes select the same architecture as explicit layouts',()=>{
  for(const [hint,layout,landmark] of [
    ['Space Station','space-station','#dea97a'],['Reactor Core','reactor-core','#ffe28a'],
    ['Observation Deck','observation-deck','#847886'],['Speakeasy','speakeasy','#641f39'],
    ['Frat Party','party','#fb68ba'],['Fallout','wasteland','#b4dc58'],
    ['Autoimmune','clinical','#6fd8cf'],['research laboratory','laboratory','#6fd8cf'],
    ['Newsroom','newsroom','#be9369'],['Archive','archive','#be9369']
  ]){
    for(const theme of [{setting:hint},{name:hint},{environment:{layout},setting:'unknown'}]){
      assert.equal(scenes.layoutFor(theme),layout);
      const ctx=recorder();
      scenes.drawArenaBackground(ctx,320,140,theme);
      assert.ok(ctx.commands.some(([,color])=>color===landmark),layout);
      assert.ok(!ctx.commands.some(([,color])=>color==='#795f49'));
    }
  }
  assert.equal(scenes.layoutFor({setting:'Fallout',environment:{layout:'party'}}),'party');
});
test('station icons have crew visor, android antenna and separate boots; PNGs use the same box',()=>{
  const theme=require('../Feature-Classifier/source/default.json').theme;
  for(const slot of [0,1]){
    const ctx=recorder();
    scenes.drawAvatarIcon(ctx,null,{theme,slot},32);
    const pixels=ctx.commands.filter(([name])=>name==='fillRect');
    assert.ok(pixels.some(([,color])=>color===(slot?'#ffbd56':'#acffff')));
    for(const x of [9,18])assert.ok(pixels.some(([,color,left,top])=>color==='#182637'&&left===x&&top===26));
    const sprite={naturalWidth:128,naturalHeight:128};
    const imageCtx=recorder();
    scenes.drawAvatarIcon(imageCtx,sprite,{theme,slot,facing:-1},32);
    assert.ok(imageCtx.commands.some(([name,,image,...bounds])=>name==='drawImage'&&image===sprite&&bounds.join()==='0,0,32,32'));
    assert.ok(!imageCtx.commands.some(([name])=>name==='fillRect'));
  }
});
test('custom floors and props change the procedural scene',()=>{
  function render(style,props){
    const ctx=recorder();
    scenes.drawArenaBackground(ctx,320,140,{environment:{floor_style:style,props,primary_color:'#aabbcc'}});
    return ctx.commands;
  }
  const parquet=render('parquet',['brass_rail','velvet_booths']);
  assert.notDeepEqual(parquet,render('dance_tiles',['brass_rail','velvet_booths']));
  assert.notDeepEqual(parquet,render('parquet',['red_cups','dj_booth']));
  assert.ok(parquet.some(([cmd,color])=>cmd==='fillRect'&&color==='#aabbcc'));
});
test('background cover crop, tint and sprite blits restore text smoothing',()=>{
  const operations=[];
  const ctx={imageSmoothingEnabled:true,drawImage(...args){operations.push([this.imageSmoothingEnabled,...args.slice(1)]);},fillRect(){operations.push(['tint']);}};
  scenes.backdrop(ctx,320,140,{naturalWidth:320,naturalHeight:180});
  assert.deepEqual(operations,[[false,0,-20,320,180],['tint']]);
  assert.equal(ctx.imageSmoothingEnabled,true);
});

test('Target contact draws a pixel burst without glowing zone rings',()=>{
  const world=require('../Feature-Classifier/source/default.json').world_physics;
  const render=(low,gates)=>{
    const ctx=recorder();
    scenes.drawFixtures(ctx,1000,600,world,'classifier','hatch','#abcded',{scan:0,gates},null,low,100,.5);
    return ctx.commands;
  };
  const idle=render(true,[0,0]),contact=render(true,[.5,0]);
  assert.ok(render(false,[0,0]).some(([cmd,color])=>cmd==='fillRect'&&color==='#495e73'));

  const z=world.structures.leftTarget;
  const rings=ops=>ops.filter(([cmd,,x,y])=>cmd==='ellipse'&&x===1000*z.x&&y===600*z.y);
  assert.equal(rings(contact).length,0);assert.equal(rings(idle).length,0);
  assert.equal(contact.filter(([cmd,color,,,w,h])=>cmd==='fillRect'&&color==='#abcded'&&w===3&&h===3).length,8);
});

test('the entry closes after spawn, and pixel props and inspection add no zone ellipses',()=>{
  const animation=require('../animation'),world=require('../Feature-Classifier/source/default.json').world_physics;
  assert.deepEqual([0,150,410,500,700].map(t=>animation.spawnOpening(t,500)),[0,1,.5,0,0]);
  const render=(part,spawn,scan=0)=>{
    const ctx=recorder();
    scenes.drawFixtures(ctx,800,400,world,'classifier','hatch','#abcdef',{spawn,scan,gates:[0,0]},null,false,0,.5,part);
    return ctx.commands;
  };
  const panels=ops=>ops.filter(([name,color])=>name==='fillRect'&&color==='#495e73').map(op=>op[4]);
  assert.deepEqual(panels(render('entry',0)),[19,19]);assert.deepEqual(panels(render('entry',1)),[4,4]);
  for(const part of ['checkpoint','leftTarget','rightTarget']){
    assert.ok(!render(part,0,1).some(([name])=>name==='ellipse'));
  }
  const ctx=recorder();
  scenes.solid(ctx,{kind:'boulder',x:.2,y:.8,w:.05,h:.07},800,400,'#abcdef','grove');
  assert.ok(ctx.commands.some(([name])=>name==='fillRect'));assert.ok(!ctx.commands.some(([name])=>name==='ellipse'));
});

test('slippery tiles have no floor artwork and generated scenes omit idle fixtures',()=>{
  const config=require('../Feature-Classifier/source/level3.json');
  const world={...config.world_physics,grid:config.tilemap};
  assert.ok(world.grid.some(row=>row.includes('~')));
  for(const low of [true,false]){
    const ctx=recorder();
    scenes.drawFixtures(ctx,800,450,world,'classifier','hatch','#abcdef',
      {scan:0,gates:[0,0]},null,low,0,.5,low?undefined:'floor');
    assert.ok(!ctx.commands.some(([cmd])=>['fillRect','stroke','fillText','drawImage'].includes(cmd)));
  }
});
