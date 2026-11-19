const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSelection}=require('../game_logic.js');
for (const file of ['default']) {
  const {mechanics}=require('../'+file+'.json');
  test(file+' accepts a winning attempt and rejects a missed goal',()=>{
    assert.equal(evaluateSelection(mechanics,[1]),true);
    assert.equal(evaluateSelection(mechanics,[0]),false);
  });
}
