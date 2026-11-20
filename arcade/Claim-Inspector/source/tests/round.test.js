const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSelection}=require('../game_logic.js');
for (const file of ['default']) {
  const {mechanics}=require('../'+file+'.json');
  test(file+' accepts a winning attempt and rejects a missed goal',()=>{
    assert.equal(evaluateSelection(mechanics,[0, 1, 2]),true);
    assert.equal(evaluateSelection(mechanics,[]),false);
  });
}

test('verification requires inspecting evidence and distinguishes extrapolation',()=>{
  const cfg=require('../level2.json');
  const round=require('../game.js').createRound(cfg);
  round.act(0);round.submit();assert.equal(round.view().target,0);
  for(const n of cfg.mechanics.answers){round.inspect();round.act(n);round.submit();}
  assert.equal(round.view().value,100);assert.ok(round.view().done);
});
