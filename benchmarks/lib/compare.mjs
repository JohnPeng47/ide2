const metrics=['mainThreadMs','frameP95Ms','frameMaxMs','elapsedMs'];
const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};

export function compareReports(baseline,candidate){
  for(const field of ['fixtureSha256'])if(!baseline[field]||baseline[field]!==candidate[field])throw new Error(`Incomparable ${field}`);
  for(const field of ['product','revision'])if(!baseline.browser?.[field]||baseline.browser[field]!==candidate.browser?.[field])throw new Error(`Incomparable browser ${field}`);
  for(const field of ['width','height','dpr','renderer'])if(baseline.environment?.[field]!==candidate.environment?.[field])throw new Error(`Incomparable environment ${field}`);
  const group=report=>{
    if(!Array.isArray(report.measurements))throw new Error('Missing measurements array');
    const groups=new Map();
    for(const measurement of report.measurements){
      if(measurement.profile)continue;
      if(!Number.isInteger(measurement.panes)||measurement.panes<1||!measurement.gesture)throw new Error('Invalid scenario');
      for(const metric of metrics)if(!Number.isFinite(measurement[metric])||measurement[metric]<0)throw new Error(`Invalid ${metric}`);
      const key=JSON.stringify([measurement.panes,measurement.gesture]);
      groups.set(key,[...(groups.get(key)??[]),measurement]);
    }
    if(!groups.size)throw new Error('No unprofiled measurements');
    return groups;
  };
  const a=group(baseline),b=group(candidate),comparison=[];
  if(a.size!==b.size)throw new Error('Scenario sets differ');
  for(const [key,left] of a){
    const right=b.get(key);if(!right||left.length!==right.length)throw new Error(`Missing comparable trials for ${key}`);
    const [panes,gesture]=JSON.parse(key);
    for(const metric of metrics){
      const baselineMedian=median(left.map(m=>m[metric])),candidateMedian=median(right.map(m=>m[metric]));
      comparison.push({panes,gesture,metric,baselineMedian,candidateMedian,deltaPercent:baselineMedian?100*(candidateMedian-baselineMedian)/baselineMedian:null});
    }
  }
  return comparison;
}
