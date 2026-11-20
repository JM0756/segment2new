function createRound({mechanics,theme}) {
  const samples=mechanics.samples;
  let index=0, correct=0, note='';
  return {
    view(){
      const slot=samples[Math.min(index,samples.length-1)];
      return {phase:'Training set',target:index,names:theme.options,actions:['Accept into Training Set','Filter Out Noise'],
        actors:[{slot,label:theme.options[slot],sample:slot,pace:mechanics.pace}],
        accuracy:100*correct/(index||1),metric:'Model accuracy',value:Math.round(100*correct/samples.length),
        score:[correct,index-correct],teamNames:['Clean decisions','Errors'],subject:theme.options[slot],detail:theme.hint,
        note,done:index===samples.length,instant:true};
    },
    act(choice){
      if(index===samples.length || ![0,1].includes(choice))return;
      const match=correctSort(samples[index++],choice);
      if(match)correct++;
      note=match?'Training set improved.':choice?'A clean example was filtered out.':'A noisy label entered the training set.';
      return {actor:0,correct:match,text:match?'CLEAN SORT':'CHECK THE CORE'};
    },submit(){}
  };
}
if(typeof module!=='undefined')module.exports={createRound};
