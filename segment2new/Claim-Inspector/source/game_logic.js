function evaluateSelection(m,picks) {
  return JSON.stringify(picks) === JSON.stringify(m.answers);
}
if(typeof module !== 'undefined') module.exports={evaluateSelection};
