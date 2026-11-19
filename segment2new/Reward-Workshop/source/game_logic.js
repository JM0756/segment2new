function evaluateSelection(m,picks) {
  if (picks.length !== 1) return false;
  const weights = m.weights[picks[0]];
  const scores = m.routes.map(route => route.reduce((sum,x,i) => sum+x*weights[i],0));
  return scores.every((score,i) => i === m.goal || score < scores[m.goal]);
}
if(typeof module !== 'undefined') module.exports={evaluateSelection};
