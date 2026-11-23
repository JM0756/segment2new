const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSelection}=require('../game_logic.js');
for (const file of ['default']) {
  const {mechanics}=require('../'+file+'.json');
  test(file+' accepts a winning attempt and rejects a missed goal',()=>{
    assert.equal(evaluateSelection(mechanics,[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),true);
    assert.equal(evaluateSelection(mechanics,[0]),false);
  });
}

const {createRound}=require('../game.js');
test('accurately training both classes passes all field cases without an audit',()=>{
  const round=createRound(require('../default.json'));
  for(let i=0;i<6;i++)round.act(round.view().actors[1].badge);
  assert.ok(round.view().locked);
  const scores=[...round.view().score];round.act(0);assert.deepEqual(round.view().score,scores);
  for(let i=0;i<4;i++)round.submit();
  assert.equal(round.view().accuracy,100);assert.equal(round.view().stars,3);
  assert.equal(round.view().auditAvailable,false);
});
