import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReports } from '../lib/compare.mjs';
const report=values=>({fixtureSha256:'fixture',browser:{product:'Chromium',revision:'1'},environment:{width:100,height:100,dpr:1,renderer:'same'},measurements:values.map((value,i)=>({panes:1,gesture:'pan',trial:i+1,profile:false,mainThreadMs:value,frameP95Ms:value,frameMaxMs:value,elapsedMs:value}))});
test('comparison excludes profiler passes and averages middle values for even trial counts',()=>{
  const baseline=report([10,20]),candidate=report([5,10]);
  baseline.measurements.push({...baseline.measurements[0],mainThreadMs:1000,profile:true});
  const comparison=compareReports(baseline,candidate);
  assert.equal(comparison[0].baselineMedian,15);assert.equal(comparison[0].candidateMedian,7.5);assert.equal(comparison[0].deltaPercent,-50);
});
test('comparison rejects mismatched fixtures, scenarios, browsers and invalid metrics',()=>{
  const baseline=report([10]);
  assert.throws(()=>compareReports(baseline,{...report([10]),fixtureSha256:'different'}),/Incomparable/);
  assert.throws(()=>compareReports(baseline,{...report([10]),browser:{product:'Other',revision:'1'}}),/Incomparable/);
  assert.throws(()=>compareReports(baseline,report([10,20])),/comparable trials/);
  assert.throws(()=>compareReports(baseline,report([NaN])),/Invalid/);
});
