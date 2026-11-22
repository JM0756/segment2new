const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const L=require('../game_logic.js');
for(const file of ['default.json','level2.json']) {
 const c=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'..',file))).mechanics;
 test(file+': biased selection fails; counterexamples repair it',()=>{
  const p=L.makePool(c), s=c.features.find(f=>f.role==='spurious');
  const biased=p.initial.filter(r=>r.item[s.name]===s.values[r.label==='a'?0:1]);
  const bad=L.train(c,biased);assert.equal(bad.feature,s.name);
  assert(L.evaluate(c,bad).some(r=>!r.passed));
  const good=L.train(c,[...p.initial,...p.extra]);
  assert.equal(good.feature,c.class_rule.feature);
  assert(L.evaluate(c,good).every(r=>r.passed));
  assert.equal(L.evaluate(c,good).length,c.curveballs.length);
 });
 test(file+': empty and one-class training rejected',()=>{
  const p=L.makePool(c);assert.throws(()=>L.train(c,[]));
  assert.throws(()=>L.train(c,p.initial.filter(r=>r.label==='a')));
 });
 test(file+': initial pool shuffles with exact size',()=>{
  assert.notDeepEqual(L.makePool(c,()=>0),L.makePool(c,()=>0.99));assert.equal(L.makePool(c).initial.length,c.training_pool.size);
 });
}
