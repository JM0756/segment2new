const test=require('node:test'),assert=require('node:assert/strict');
global.correctSort=require('../game_logic').correctSort;
const {createRound}=require('../game');
for(const file of ['default','level2','level3'])test('sorts the '+file+' wave and records errors',()=>{
  const cfg=require('../'+file+'.json'),round=createRound(cfg);
  cfg.mechanics.samples.forEach((sample,i)=>{
    assert.equal(round.view().actors[0].sample,sample);
    round.act(i===0?1-sample:sample);
  });
  assert.ok(round.view().done);
  assert.deepEqual(round.view().score,[cfg.mechanics.samples.length-1,1]);
});
