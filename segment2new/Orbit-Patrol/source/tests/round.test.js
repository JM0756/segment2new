const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSelection}=require('../game_logic.js');
for (const file of ['default', 'fallout', 'party']) {
  const {mechanics}=require('../'+file+'.json');
  test(file+' accepts a winning attempt and rejects a missed goal',()=>{
    assert.equal(evaluateSelection(mechanics,[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),true);
    assert.equal(evaluateSelection(mechanics,[0,1]),false);
  });
}
