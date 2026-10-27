import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildModel,runChains,diagnostics,validateSettings} from '../engine.js';

const ref=JSON.parse(await readFile(new URL('./fixtures/reference.json',import.meta.url),'utf8'));
const ibm=JSON.parse(await readFile(new URL('../data/ibm-hr-attrition.json',import.meta.url),'utf8'));
const seeds=[17,101,2026];
const retained=Number(process.env.ORACLE_DRAWS||8000);
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const variance=a=>a.reduce((s,v)=>s+(v-mean(a))**2,0)/(a.length-1);
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y),k=(b.length-1)*p,i=Math.floor(k);return b[i]+(b[Math.min(i+1,b.length-1)]-b[i])*(k-i);};
const calc={mean,median:a=>q(a,.5),lower:a=>q(a,.025),upper:a=>q(a,.975)};

// Batch estimates are independent of the engine's ESS/MCSE and summary code.
function checkMarginal(series,oracle,label,refError=0){
  const all=series.flat();assert.ok(all.every(Number.isFinite),label+' finite draws');
  for(const [key,fn] of Object.entries(calc)){
    const estimates=[];
    for(const chain of series){const size=Math.floor(chain.length/32);for(let b=0;b<32;b++)estimates.push(fn(chain.slice(b*size,(b+1)*size)));}
    const mcse=Math.sqrt(variance(estimates)/estimates.length);
    const limit=(key==='lower'||key==='upper'?.08:.03)*oracle.sd;
    assert.ok(mcse<=limit,`${label} ${key}: MCSE ${mcse} exceeds precision limit ${limit}`);
    const value=fn(all),error=Math.abs(value-oracle[key]);
    assert.ok(error<=4*mcse+refError+1e-12,`${label} ${key}: sample ${value}, reference ${oracle[key]}, discrepancy ${error}, 4MCSE ${4*mcse}, integration error ${refError}`);
  }
}
const series=(fit,j)=>fit.chains.map(c=>c.map(d=>d[j]));
const settings=seed=>({seed,warmup:2000,draws:retained,chains:4});

for(const prior of ['default','wide'])for(const seed of seeds){
  test(`independent Beta oracle, all/zero/small groups; ${prior}, seed ${seed}`,async()=>{
    const full=await runChains(buildModel(ibm,{type:'proportion',prior}),settings(seed));
    checkMarginal(series(full,0),ref.beta[prior+':overall'],'overall');
    const rows=[];
    for(const [Gender,k,n] of [['zero',0,12],['all',12,12],['smallA',2,12],['smallB',9,18]])for(let i=0;i<n;i++)rows.push({Gender,Attrition:i<k?'Yes':'No',Department:'Sales'});
    const fit=await runChains(buildModel(rows,{type:'proportion',prior,groupBy:'Gender'}),settings(seed));
    fit.parameters.forEach((p,j)=>{
      checkMarginal(series(fit,j),ref.beta[prior+':'+p.label],p.label);
      assert.ok(series(fit,j).flat().every(v=>v>=0&&v<=1));
    });
  });
  for(const kind of ['compare','linear1','linear3'])test(`independent NIG joint posterior; ${kind}, ${prior}, seed ${seed}`,async()=>{
    const comparison=kind==='compare';
    const config=comparison?{type:'compare',groupBy:'Gender',groupA:'A',groupB:'B',prior}:{type:'linear',predictors:kind==='linear1'?['Age']:['Age','YearsAtCompany','TotalWorkingYears'],prior};
    const model=buildModel(comparison?ref.compareRows:ref.linearRows,config);
    const fit=await runChains(model,settings(seed));
    const oracle=ref.gaussian[prior][kind],p=oracle.betaLocation.length;
    for(let j=0;j<p;j++)checkMarginal(series(fit,j),oracle.raw[j],fit.parameters[j].id);
    const sigmaIndex=fit.parameters.findIndex(p=>p.id==='sigma');
    checkMarginal(series(fit,sigmaIndex),oracle.raw[p],'residual sigma');
    const pairA=p>2?1:0,pairB=p>2?2:1;
    const coefficientPairs=fit.chains.flatMap(c=>c.map(d=>[d[pairA],d[pairB]]));
    const covariance=pairs=>{const a=mean(pairs.map(x=>x[0])),b=mean(pairs.map(x=>x[1]));return pairs.reduce((s,x)=>s+(x[0]-a)*(x[1]-b),0)/(pairs.length-1);};
    const batchCov=[];
    for(const c of fit.chains){const size=Math.floor(c.length/32);for(let b=0;b<32;b++)batchCov.push(covariance(c.slice(b*size,(b+1)*size).map(d=>[d[pairA],d[pairB]])));}
    const mcse=Math.sqrt(variance(batchCov)/batchCov.length);
    assert.ok(Math.abs(covariance(coefficientPairs)-oracle.covariance[pairA][pairB])<=4*mcse+1e-10,'coefficient dependence matches joint reference');
    const ratioIndex=fit.parameters.findIndex(p=>p.id==='ratio'||p.id.startsWith('multiplier_'));
    const sourceIndex=comparison?1:1;
    fit.chains.forEach(c=>c.forEach(d=>assert.equal(d[ratioIndex],Math.exp(d[sourceIndex]))));
    // All natural-scale Gaussian parameters are monotone transforms of draws.
    if(comparison){
      const a=fit.parameters.findIndex(p=>p.id==='geomean_A'),b=fit.parameters.findIndex(p=>p.id==='geomean_B');
      fit.chains.forEach(c=>c.forEach(d=>{assert.equal(d[a],Math.exp(d[0]));assert.equal(d[b],Math.exp(d[0]+d[1]));}));
    }
  });
  test(`independent logistic quadrature, ${prior}, seed ${seed}`,async()=>{
    const fit=await runChains(buildModel(ref.logisticRows,{type:'logistic',predictors:['Age'],prior}),settings(seed));
    const oracle=ref.logistic[prior];
    for(let j=0;j<2;j++)checkMarginal(series(fit,j),oracle.raw[j],fit.parameters[j].id,oracle.refinementError);
    const odds=fit.parameters.findIndex(p=>p.id==='multiplier_Age');
    fit.chains.forEach(c=>c.forEach(d=>assert.equal(d[odds],Math.exp(d[1]))));
    assert.equal(fit.chains.length,4);assert.ok(fit.chains.every(c=>c.length===retained));
    assert.equal(new Set(fit.chainInfo.map(c=>c.seed)).size,4);
  });
}

test('seeded output reproducibility, distinct streams and real progress',async()=>{
  const model=buildModel(ref.logisticRows,{type:'logistic',predictors:['Age']});
  const events=[];
  const a=await runChains(model,{seed:101,warmup:100,draws:100},e=>events.push(e));
  const b=await runChains(model,{seed:101,warmup:100,draws:100});
  const c=await runChains(model,{seed:17,warmup:100,draws:100});
  assert.deepEqual(a.chains,b.chains);assert.notDeepEqual(a.chains,c.chains);
  assert.notDeepEqual(a.chains[0],a.chains[1]);
  assert.ok(events.some(e=>e.phase==='warmup'));assert.ok(events.some(e=>e.phase==='sampling'));
  assert.equal(events.at(-1).completed,events.at(-1).total);
});

function independentRng(seed){let s=seed;const u=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return ((s>>>0)+.5)/4294967296;};return()=>Math.sqrt(-2*Math.log(u()))*Math.cos(2*Math.PI*u());}
test('diagnostics reject shifted, autocorrelated and frozen chains',()=>{
  const iid=Array.from({length:4},(_,c)=>{const normal=independentRng(100+c);return Array.from({length:2000},normal);});
  const good=diagnostics(iid);assert.ok(good.rhat<1.01);assert.ok(good.ess>400);
  const shifted=diagnostics(iid.map((c,i)=>c.map(v=>v+2*i)));assert.ok(shifted.rhat>1.1);assert.ok(shifted.warning);
  const ar=iid.map(c=>{let x=0;return c.map(v=>(x=.95*x+Math.sqrt(1-.95**2)*v));});
  assert.ok(diagnostics(ar).ess<800,'AR(.95) ESS below N/10');
  assert.ok(diagnostics(Array.from({length:4},()=>Array(2000).fill(1))).warning);
});

test('invalid configurations fail explicitly; proper-prior one-outcome logistic is finite',async()=>{
  for(const config of [{type:'linear',predictors:[]},{type:'linear',predictors:['Age','YearsAtCompany','TotalWorkingYears','DistanceFromHome','OverTime','Age']},{type:'linear',predictors:['JobLevel']},{type:'compare',groupBy:'Gender',groupA:'A',groupB:'A'},{type:'proportion',department:'Missing'}])assert.throws(()=>buildModel(ref.linearRows,config));
  assert.throws(()=>buildModel([],{type:'proportion'}));
  assert.throws(()=>buildModel(ref.linearRows.map(r=>({...r,Age:1})),{type:'linear',predictors:['Age']}));
  assert.throws(()=>buildModel(ref.linearRows.map((r,i)=>({...r,MonthlyIncome:i?1000:0})),{type:'linear',predictors:['Age']}));
  for(const s of [{draws:49},{draws:NaN},{seed:-1},{seed:1.3},{warmup:-1},{warmup:Infinity},{chains:2}])assert.throws(()=>validateSettings(s));
  const separated=await runChains(buildModel(ref.logisticRows.map(r=>({...r,Attrition:'Yes'})),{type:'logistic',predictors:['Age']}),{warmup:500,draws:500,seed:17});
  assert.ok(separated.chains.flat(2).every(Number.isFinite));
});

test('group swap respects labels and reverses the posterior comparison',async()=>{
  const a=await runChains(buildModel(ref.compareRows,{type:'compare',groupBy:'Gender',groupA:'A',groupB:'B'}),{draws:2000,warmup:0,seed:17});
  const b=await runChains(buildModel(ref.compareRows,{type:'compare',groupBy:'Gender',groupA:'B',groupB:'A'}),{draws:2000,warmup:0,seed:17});
  assert.ok(q(series(a,1).flat(),.5)>0);assert.ok(q(series(b,1).flat(),.5)<0);
  const ratioA=a.parameters.findIndex(p=>p.id==='ratio'),ratioB=b.parameters.findIndex(p=>p.id==='ratio');
  assert.ok(Math.abs(q(series(a,ratioA).flat(),.5)*q(series(b,ratioB).flat(),.5)-1)<.02);
});
