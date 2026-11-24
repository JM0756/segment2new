// The walkthrough uses two practice actors, leaving the scored round untouched.
const ArcadeNarrator = {
  actors({archetype,theme,mechanics}){
    const names=theme.options||Object.values(theme.classLabels||{});
    return names.slice(0,2).map((name,slot)=>{
      let label=name;
      if(archetype==='classifier'){
        const rule=mechanics.class_rule;
        label+=' · '+theme.featureLabels[slot?rule.class_b_value:rule.class_a_value];
      }
      return {slot,label,badge:archetype==='classifier'?slot:undefined,aura:archetype==='classifier'?1-slot:undefined,sample:archetype==='sorter'?slot:undefined};
    });
  },
  lines(config) {
    const {theme:t,mechanics:m}=config;
    const names=t.options||Object.values(t.classLabels||{});
    let first=names[0],second=names[1],why;
    switch(config.archetype){
      case 'classifier': {
        const rule=m.class_rule,labels=t.featureLabels;
        why=[labels[rule.class_a_value]+' identifies '+first+'. Check '+labels[rule.feature]+'.',
          labels[rule.class_b_value]+' identifies '+second+'. '+labels[m.features.find(f=>f.role==='spurious').name]+' can mislead.'];break;
      }
      case 'threshold':
        why=['Lower the cutoff to catch more incidents. More clear cases may trigger alerts too.',
          'Raise it to filter out low scores. Watch how many real incidents you miss.'];break;
      case 'audit':
        why=['Choose '+first+' when the record backs the claim.',
          'Choose '+second+' when the evidence rules it out. Missing evidence has its own verdict.'];break;
      case 'sorter':
        why=['Accept the whole '+first+'. A reliable label helps the model learn.',
          'Filter the broken '+second+'. A noisy label teaches the wrong pattern.'];break;
      case 'neighbors':why=['Choose a nearby example. Distance determines who gets a vote.','Compare the second neighbor. The majority among the closest examples wins.'];break;
      case 'reward':why=['Try the first weights and compare route scores.','Try the second weights. The robot follows the largest reward.'];break;
      default:why=['Inspect the first source. Rank it by how well it answers the question.','Compare the second source. A matching word alone does not make it relevant.'];
    }
    const classifier=config.archetype==='classifier',sorter=config.archetype==='sorter';
    if(!classifier)return [
      'Part 1 · 1/6 · Move around '+t.title+' with WASD, arrows or a floor click.',
      'Part 1 · 2/6 · Press E near the center to inspect. '+why[0],
      'Part 1 · 3/6 · Click a target or walk to it and press E to practice your decision.',
      'Part 2 · 4/6 · '+why[0],
      'Part 2 · 5/6 · '+why[1],
      'Part 2 · 6/6 · '+t.hint+' Use Space to evaluate your work.'
    ];
    const inspect=classifier?why[0]+' '+why[1]:why[0];
    return [
      'Part 1 · 1/6 · Move. In '+t.title+', use WASD or the arrow keys to walk around props. You can also click the floor. Try a few steps.',
      'Part 1 · 2/6 · Inspect. Approach the specimen at the center, then press E or Space to inspect and tether it. Press E again for a deep scan. '+inspect,
      'Part 1 · 3/6 · Classify. Escort the tethered specimen to a bay and press E or Space to deliver it. Clicking a leader walks you there. Practice now. After training, Space starts the Field Test.',
      'Part 2 · 4/6 · Signals and shortcuts. '+(classifier?inspect:why.join(' '))+' A classifier learns from your decisions. An outfit or a patch of static can predict a class in training by coincidence.',
      'Part 2 · 5/6 · Counter-examples. Look for a familiar identity with an unusual surface cue. Correctly labeling these exceptions helps the model generalize as Levels 2 and 3 change the environment.',
      'Part 2 · 6/6 · Test the model. '+(classifier?'Watch the live feature weights as you label counter-examples. Press Space once to launch all four field cases. ':sorter?'Compare field accuracy with your training decisions. ':'Compare your decisions with the field results. In Feature-Classifier, watch the Spurious Reliance bar. ')+'If a shortcut causes a failed Field Test, Model Audit lets you prune the misleading cue and retry for two stars. Removing the true signal loses the audit.'
    ];
  },
  next(step,input){
    const expected=['move','inspect','classify','continue','continue'];
    return step>=0 && step<5 && expected[step]===input?step+1:step;
  }
};
if(typeof module!=='undefined')module.exports=ArcadeNarrator;
