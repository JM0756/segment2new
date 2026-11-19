/* Pure, deterministic decision-stump simulation, shared by browser and Node tests. */
(function (root) {
  'use strict';
  const role = (cfg, r) => cfg.features.find(f => f.role === r);
  function label(cfg, item) {
    const r = cfg.class_rule;
    if (![r.class_a_value, r.class_b_value].includes(item[r.feature])) throw Error('Unknown class-defining value');
    return item[r.feature] === r.class_a_value ? 'a' : 'b';
  }
  function makePool(cfg) {
    const t = role(cfg, 'true'), s = role(cfg, 'spurious'), n = role(cfg, 'noise');
    const size = cfg.training_pool.size;
    const aligned = Math.round(size * cfg.training_pool.bias_strength);
    const initial = Array.from({length: size}, (_, i) => {
      const cls = i % 2;
      const item = {[t.name]: cls ? cfg.class_rule.class_b_value : cfg.class_rule.class_a_value,
        [s.name]: s.values[i < aligned ? cls : 1 - cls]};
      if (n) item[n.name] = n.values[Math.floor(i / 2) % 2];
      return {id: 'train-' + i, item, label: label(cfg, item), extra: false};
    });
    // Enumerate all combinations, ensuring a perfectly biased pool can always be repaired.
    let combinations = [{}];
    for (const f of cfg.features) combinations = combinations.flatMap(x => f.values.map(v => ({...x, [f.name]: v})));
    const extra = combinations.map((item, i) => ({id: 'extra-' + i, item, label: label(cfg, item), extra: true}));
    return {initial, extra, actualBias: aligned / size};
  }
  function train(cfg, rows) {
    if (rows.length < 2 || new Set(rows.map(r => r.label)).size !== 2) throw Error('Choose examples from both classes before training.');
    const candidates = cfg.features.map((f, order) => {
      const mapping = {};
      for (const v of f.values) {
        const matching = rows.filter(r => r.item[f.name] === v);
        const a = matching.filter(r => r.label === 'a').length;
        mapping[v] = a >= matching.length - a ? 'a' : 'b';
      }
      const correct = rows.filter(r => mapping[r.item[f.name]] === r.label).length;
      return {feature: f.name, mapping, accuracy: correct / rows.length,
        priority: f.role === 'spurious' ? -1 : order};
    });
    // Deliberate shortcut preference on ties makes perfect correlations ambiguous.
    candidates.sort((a,b) => b.accuracy - a.accuracy || a.priority - b.priority);
    return candidates[0];
  }
  function evaluate(cfg, model) {
    return cfg.curveballs.map(cb => {
      const expected = label(cfg, cb.item), predicted = model.mapping[cb.item[model.feature]];
      return {id: cb.id, item: cb.item, expected, predicted, passed: expected === predicted};
    });
  }
  function hint(cfg, model, passed) {
    const values = {true_feature: role(cfg,'true').name, spurious_feature: role(cfg,'spurious').name, learned_feature: model.feature};
    return cfg.hints[passed ? 'on_success' : 'on_failure'].replace(/\{(\w+)\}/g, (m,k) => values[k] ?? m);
  }
  const api = {label, makePool, train, evaluate, hint};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GameLogic = api;
})(globalThis);
