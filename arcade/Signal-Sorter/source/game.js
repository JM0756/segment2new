const shuffleDeck=typeof module==='undefined'?shuffled:require('../../shuffle.js');
function createRound({mechanics,theme}) {
  const samples=shuffleDeck(mechanics.samples);
  const auras=samples.map(()=>Number(Math.random()<0.5));
  const decisions=[];
  let pruned=false;
  function reliance(){
    if(!decisions.length)return 0;
    const agree=decisions.filter(d=>d.aura===d.choice).length;
    return Math.round(100*Math.abs(2*agree-decisions.length)/decisions.length);
  }
  let index=0, correct=0, note='';
  return {
    view(){
      const slot=samples[Math.min(index,samples.length-1)];
      return {phase:'Training set',auditChoices:['Sample integrity','Aura'],spuriousReliance:reliance(),lanes:theme.options,target:index,names:theme.options,actions:['Accept into Training Set','Filter Out Noise'],
        traits:[['Signal',theme.options[slot]],['Aura',auras[Math.min(index,samples.length-1)]?'Amber':'Cyan']],
        actors:[{slot,label:theme.options[slot],sample:slot,aura:auras[Math.min(index,samples.length-1)]}],
        accuracy:100*correct/(index||1),metric:'Model accuracy',value:Math.round(100*correct/samples.length),
        score:[correct,index-correct],teamNames:['Clean decisions','Errors'],subject:theme.options[slot],detail:theme.hint,
        note,done:index===samples.length,instant:true};
    },
    act(choice){
      if(index===samples.length || ![0,1].includes(choice))return;
      const match=correctSort(samples[index],choice);
      decisions.push({sample:samples[index],aura:auras[index],choice});index++;
      if(match)correct++;
      note=match?'Training set improved.':choice?'A clean example was filtered out.':'A noisy label entered the training set.';
      return {actor:0,destination:choice,correct:match,text:match?'CLEAN SORT':'CHECK THE CORE'};
    },submit(){},
    prune(){pruned=true;},
    fieldCases(){
      const model=fitSortRule(decisions,pruned);
      return [0,1].flatMap(sample=>[0,1].map(aura=>{
        const label=theme.options[sample];
        return {subject:label,actors:[{slot:sample,sample,aura,label}],evaluate(){
          const cue=model.cue==='sample'?'True Signal ('+label+')':'Spurious Cue ('+(aura?'amber':'cyan')+' aura)';
          const predicted=model.predictions[model.cue==='sample'?sample:aura],correct=predicted===sample;
          return {correct,text:cue+' → '+(predicted?'filter':'accept')+' · '+(correct?'ACCURATE':'MISCLASSIFIED')};
        }};
      }));
    }
  };
}
if(typeof module!=='undefined')module.exports={createRound};
