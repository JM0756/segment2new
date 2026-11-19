const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const L=require('../game_logic.js');
for(const file of ['example1.json','example2.json']) {
 const c=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'..',file)));
 test(file+': biased selection fails; counterexamples repair it',()=>{
  const p=L.makePool(c), s=c.features.find(f=>f.role==='spurious');
  const biased=p.initial.filter(r=>r.item[s.name]===s.values[r.label==='a'?0:1]);
  const bad=L.train(c,biased);assert.equal(bad.feature,s.name);
  assert(L.evaluate(c,bad).some(r=>!r.passed));
  assert(L.hint(c,bad,false).includes(bad.feature));
  const good=L.train(c,[...p.initial,...p.extra]);
  assert.equal(good.feature,c.class_rule.feature);
  assert(L.evaluate(c,good).every(r=>r.passed));
  assert.equal(L.evaluate(c,good).length,c.curveballs.length);
 });
 test(file+': empty and one-class training rejected',()=>{
  const p=L.makePool(c);assert.throws(()=>L.train(c,[]));
  assert.throws(()=>L.train(c,p.initial.filter(r=>r.label==='a')));
 });
 test(file+': initial pool deterministic and exact size',()=>{
  assert.deepEqual(L.makePool(c),L.makePool(c));assert.equal(L.makePool(c).initial.length,c.training_pool.size);
 });
}
