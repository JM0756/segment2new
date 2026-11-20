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
      return {slot,label,sample:archetype==='sorter'?slot:undefined};
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
          labels[rule.class_b_value]+' identifies '+second+', even when the surface looks similar.'];break;
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
    return [t.setting+' Meet '+first+' and '+second+'.','[1] '+why[0],'[2] '+why[1],'Ready to play. Use what you practiced in the arena.'];
  },
  next(step,input) {
    return (step===0&&input==='continue')||(step===1&&input===0)||(step===2&&input===1)?step+1:step;
  }
};
if(typeof module!=='undefined')module.exports=ArcadeNarrator;
