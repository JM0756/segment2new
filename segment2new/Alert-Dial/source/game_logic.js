function evaluateSelection(m,picks) {
  const flagged = m.records.filter(([score]) => score >= m.cutoffs[picks[0]]);
  return picks.length === 1 && flagged.length >= m.minHits && flagged.every(([,label]) => label === 1);
}
if(typeof module !== 'undefined') module.exports={evaluateSelection};
