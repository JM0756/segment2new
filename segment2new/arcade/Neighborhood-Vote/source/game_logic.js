function evaluateSelection(m,picks) {
  const nearest = m.positions.map((x,i) => i).sort((a,b) =>
    Math.abs(m.positions[a]-m.target) - Math.abs(m.positions[b]-m.target)).slice(0,m.k);
  return picks.length === m.k && nearest.every(i => picks.includes(i));
}
if(typeof module !== 'undefined') module.exports={evaluateSelection};

function majority(m,picks) {
  const votes=new Map();
  for(const i of picks) votes.set(m.classes[i],(votes.get(m.classes[i]) || 0)+1);
  return [...votes].sort((a,b)=>b[1]-a[1])[0][0];
}
