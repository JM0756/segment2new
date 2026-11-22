function correctSort(sample, choice) {
  return sample === choice;
}
function fitSortRule(rows) {
  function fit(cue) {
    const predictions=[0,1].map(value=>{
      const votes=rows.filter(row=>row[cue]===value);
      return Number(votes.filter(row=>row.choice===1).length>votes.length/2);
    });
    const matches=rows.filter(row=>predictions[row[cue]]===row.choice).length;
    return {cue,predictions,matches};
  }
  const sample=fit('sample'), aura=fit('aura');
  return aura.matches>sample.matches?aura:sample;
}
if(typeof module!=='undefined')module.exports={correctSort,fitSortRule};
