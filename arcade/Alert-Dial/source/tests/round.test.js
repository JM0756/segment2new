const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSelection}=require('../game_logic.js');
for (const file of ['default']) {
  const {mechanics}=require('../'+file+'.json');
  test(file+' accepts a winning attempt and rejects a missed goal',()=>{
    assert.equal(evaluateSelection(mechanics,[6]),true);
    assert.equal(evaluateSelection(mechanics,[]),false);
  });
}

test('threshold minimizes asymmetric costs after the distribution shifts',()=>{
  const round=require('../game.js').createRound(require('../level2.json'));
  round.submit();assert.equal(round.view().done,false);
  round.tune(5);round.submit();assert.equal(round.view().done,true);
});
