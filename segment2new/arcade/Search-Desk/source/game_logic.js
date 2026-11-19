function evaluateSelection(m,picks) {
  return JSON.stringify(picks) === JSON.stringify(m.order);
}
if(typeof module !== 'undefined') module.exports={evaluateSelection};
