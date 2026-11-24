const shuffleDeck=typeof module==='undefined'?shuffled:require('../../shuffle.js');
/* Pure, deterministic decision-stump simulation, shared by browser and Node tests. */
(function (root) {
  'use strict';
  const role = (cfg, r) => cfg.features.find(f => f.role === r);
  function themeFor({mechanics, theme}) {
    if (!theme.class0 && !theme.class1 && !theme.trueFeature && !theme.spuriousFeatures) return theme;
    const options = theme.options.map((name, i) => theme['class'+i]?.name || name);
    const featureLabels = {...theme.featureLabels};
    const rule = mechanics.class_rule;
    for (const [kind, spec] of [['true',theme.trueFeature], ['spurious',theme.spuriousFeatures?.[0]]]) {
      const feature = role(mechanics, kind);
      const values = kind === 'true' ? [rule.class_a_value,rule.class_b_value] : feature.values;
      if (spec) featureLabels[feature.name] = typeof spec === 'string' ? spec : spec.name;
      values.forEach((key,i) => {
        if (Array.isArray(spec?.values)) featureLabels[key] = spec.values[i];
      });
    }
    return {...theme, options, featureLabels};
  }
  function label(cfg, item) {
    const r = cfg.class_rule;
    if (![r.class_a_value, r.class_b_value].includes(item[r.feature])) throw Error('Unknown class-defining value');
    return item[r.feature] === r.class_a_value ? 'a' : 'b';
  }
  function makePool(cfg, random=Math.random) {
    const t = role(cfg, 'true'), s = role(cfg, 'spurious'), n = role(cfg, 'noise');
    const size = cfg.training_pool.size;
    const aligned = size===6?4:Math.min(size-2,Math.round(size * cfg.training_pool.bias_strength));
    const offset=Number(random()<.5);
    const initial = Array.from({length: size}, (_, i) => {
      const cls = (i+offset)%2;
      const item = {[t.name]: cls ? cfg.class_rule.class_b_value : cfg.class_rule.class_a_value,
        [s.name]: s.values[i < aligned ? cls : 1 - cls]};
      if (n) item[n.name] = n.values[Math.floor(random()*2)];
      return {id: 'train-' + i, item, label: label(cfg, item), counterExample:i>=aligned, extra:false};
    });
    // Enumerate all combinations, ensuring a perfectly biased pool can always be repaired.
    let combinations = [{}];
    for (const f of cfg.features) combinations = combinations.flatMap(x => f.values.map(v => ({...x, [f.name]: v})));
    const extra = combinations.map((item, i) => ({id: 'extra-' + i, item, label: label(cfg, item), extra: true}));
    return {initial:shuffleDeck(initial,random), extra, actualBias: aligned / size};
  }
  function fitFeature(feature, rows) {
    const mapping = Object.create(null), confidence = Object.create(null);
    let matches = 0;
    for (const value of feature.values) {
      const group = rows.filter(row => row.item[feature.name] === value);
      const a = group.filter(row => row.label === 'a').length;
      const majority = Math.max(a, group.length - a);
      mapping[value] = a >= group.length - a ? 'a' : 'b';
      confidence[value] = Math.round(100 * (1 + majority) / (2 + group.length));
      matches += majority;
    }
    return {feature: feature.name, mapping, confidence, accuracy: rows.length ? matches / rows.length : 0};
  }
  function featureWeights(features, rows) {
    return features.map(feature => Math.round(100 * fitFeature(feature, rows).accuracy));
  }
  function cueKey(label) {
    return label.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  }
  function train(cfg, rows, features=cfg.features) {
    if (rows.length < 2 || new Set(rows.map(r => r.label)).size !== 2) throw Error('Choose examples from both classes before training.');
    const candidates = features.map((f, order) => ({
      ...fitFeature(f, rows),
      priority: f.role === 'spurious' ? -2 : f.role === 'true' ? -1 : order
    }));
    // Deliberate shortcut preference on ties makes perfect correlations ambiguous.
    candidates.sort((a,b) => b.accuracy - a.accuracy || a.priority - b.priority);
    return candidates[0];
  }
  function evaluateCase(cfg, model, item) {
    const expected = label(cfg, item), predicted = model.mapping[item[model.feature]];
    return {item, expected, predicted, passed:expected === predicted};
  }
  function evaluate(cfg, model) {
    return cfg.curveballs.map(cb => ({id:cb.id, ...evaluateCase(cfg, model, cb.item)}));
  }
  function hint(cfg, model, passed) {
    const values = {true_feature: role(cfg,'true').name, spurious_feature: role(cfg,'spurious').name, learned_feature: model.feature};
    return cfg.hints[passed ? 'on_success' : 'on_failure'].replace(/\{(\w+)\}/g, (m,k) => values[k] ?? m);
  }
  const api = {themeFor, label, makePool, featureWeights, cueKey, train, evaluateCase, evaluate, hint};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GameLogic = api;
})(globalThis);

function evaluateSelection(m,picks) {
  const pool = GameLogic.makePool(m);
  const rows = [...pool.initial,...pool.extra];
  const selected = picks.map(i => rows[i]);
  if (new Set(selected.map(row => row.label)).size < 2) return false;
  const model = GameLogic.train(m,selected);
  return GameLogic.evaluate(m,model).every(row => row.passed);
}
if(typeof module !== 'undefined') module.exports.evaluateSelection=evaluateSelection;
