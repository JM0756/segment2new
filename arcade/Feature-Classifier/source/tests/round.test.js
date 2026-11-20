const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSelection}=require('../game_logic.js');
for (const file of ['default']) {
  const {mechanics}=require('../'+file+'.json');
  test(file+' accepts a winning attempt and rejects a missed goal',()=>{
    assert.equal(evaluateSelection(mechanics,[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),true);
    assert.equal(evaluateSelection(mechanics,[0,1]),false);
  });
}

const {createRound}=require('../game.js');
test('classify, test broken shortcut, retrain on balanced examples',()=>{
  const round=createRound(require('../default.json'));
  [0,1,0].forEach(n=>round.act(n));
  assert.equal(round.view().value,75);
  round.submit();assert.match(round.view().note,/OVERFIT/);
  round.retrain();assert.match(round.view().note,/CAUSAL MATCH/);
});
