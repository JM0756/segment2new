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
