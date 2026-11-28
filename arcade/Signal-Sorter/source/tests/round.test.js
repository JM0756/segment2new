const test=require('node:test'),assert=require('node:assert/strict');
const {createRound}=require('../game');
for(const [i,file] of ['default','level2','level3'].entries())test('streams the '+file+' wave',()=>{
  const round=createRound(require('../'+file+'.json'),i+1);
  assert.equal(round.lookahead().length,2);
  round.tick(1.1);assert.equal(round.state.pulses.length,1);
  assert.equal(Boolean(round.state.points.INV),i===2);
  for(let j=0;j<3000&&!round.state.done;j++)round.tick(.1);
  assert.ok(round.state.done);
});
