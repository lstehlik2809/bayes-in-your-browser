import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildModel,runChains,ordinalLogDensity,ordinalProbabilities} from '../engine.js';

const ref=JSON.parse(await readFile(new URL('./fixtures/advanced-reference.json',import.meta.url),'utf8'));
const ibm=JSON.parse(await readFile(new URL('../data/ibm-hr-attrition.json',import.meta.url),'utf8'));
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const variance=a=>{const m=mean(a);return a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1);};
const quantile=(a,p)=>{const s=[...a].sort((x,y)=>x-y),k=(s.length-1)*p,i=Math.floor(k);return s[i]+(s[Math.min(i+1,s.length-1)]-s[i])*(k-i);};
const functions={mean,median:a=>quantile(a,.5),lower:a=>quantile(a,.025),upper:a=>quantile(a,.975)};
const settings=seed=>({seed,warmup:2000,draws:Number(process.env.ORACLE_DRAWS||8000),chains:4});
const series=(fit,id)=>{const j=fit.parameters.findIndex(p=>p.id===id);assert.ok(j>=0,'parameter '+id);return fit.chains.map(c=>c.map(d=>d[j]));};
function check(series,oracle,label){
 assert.ok(series.flat().every(Number.isFinite),label+' finite');
 for(const [key,fn] of Object.entries(functions)){
  const batches=[];
  for(const c of series){const n=Math.floor(c.length/32);for(let b=0;b<32;b++)batches.push(fn(c.slice(b*n,(b+1)*n)));}
  const mcse=Math.sqrt(variance(batches)/batches.length),cap=(key==='lower'||key==='upper'?.08:.03)*oracle.sd;
  assert.ok(mcse<=cap,`${label} ${key} precision: ${mcse} > ${cap}`);
  const value=fn(series.flat()),error=Math.abs(value-oracle[key]),referenceError=oracle.error?.[key]||0;
  assert.ok(error<=4*mcse+referenceError+1e-11,`${label} ${key}: ${value} vs ${oracle[key]}, error ${error} > 4MCSE ${4*mcse} + reference ${referenceError}`);
 }
}

const ordinalMapping={c1:'c1',log_gap_2:'log_gap2',log_gap_3:'log_gap3',beta_Age:'beta_Age',c2:'c2',c3:'c3',multiplier_Age:'odds_Age',p_category_1:'p1',p_category_2:'p2',p_category_3:'p3',p_category_4:'p4'};
for(const prior of ['default','wide'])for(const seed of [17,101,2026]){
 test(`independent ordinal QMC posterior, ${prior}, seed ${seed}`,async()=>{
  const model=buildModel(ref.ordinalRows,{type:'ordinal',outcome:'JobSatisfaction',predictors:['Age'],prior});
  const fit=await runChains(model,settings(seed));
  assert.equal(model.X[0].length,1,'no redundant intercept');
  assert.equal(fit.settings.warmup,2000);
  for(const [id,name] of Object.entries(ordinalMapping))check(series(fit,id),ref.ordinal[prior].stats[name],id);
  for(const c of fit.chains)for(const draw of c){
   const value=id=>draw[fit.parameters.findIndex(p=>p.id===id)];
   assert.ok(value('c1')<value('c2')&&value('c2')<value('c3'));
   assert.equal(value('c2'),value('c1')+Math.exp(value('log_gap_2')));
   assert.equal(value('c3'),value('c2')+Math.exp(value('log_gap_3')));
   assert.equal(value('multiplier_Age'),Math.exp(value('beta_Age')));
   const probs=[1,2,3,4].map(k=>value('p_category_'+k));assert.ok(probs.every(p=>p>=0&&p<=1));
   assert.ok(Math.abs(probs.reduce((s,p)=>s+p,0)-1)<1e-12);
  }
 });
 test(`independent hierarchical joint posterior, ${prior}, seed ${seed}`,async()=>{
  await checkHierarchy(ref.hierarchicalRows,ref.hierarchical[prior],prior,seed,true);
 });
}

async function checkHierarchy(rows,oracle,prior,seed,covarianceCheck=false){
 const model=buildModel(rows,{type:'hierarchical',groupBy:'JobRole',prior});
 const fit=await runChains(model,settings(seed));
 check(series(fit,'mu'),oracle.stats.mu,'typical-group mu');
 check(series(fit,'sigma'),oracle.stats.sigma,'within-group sigma');
 check(series(fit,'tau'),oracle.stats.tau,'between-group tau');
 check(series(fit,'icc'),oracle.stats.icc,'ICC');
 for(let g=0;g<oracle.labels.length;g++){
  const label=oracle.labels[g];
  check(series(fit,'u_'+g),oracle.stats['u_'+label],'u_'+label);
  check(series(fit,'location_'+g),oracle.stats['theta_'+label],'location_'+label);
  assert.equal(model.groups[g].n,oracle.n[g]);
  const idx=id=>fit.parameters.findIndex(p=>p.id===id);
  for(const c of fit.chains)for(const d of c){
   assert.equal(d[idx('location_'+g)],d[idx('mu')]+d[idx('u_'+g)]);
   assert.equal(d[idx('geomean_'+g)],Math.exp(d[idx('location_'+g)]));
   assert.ok(d[idx('sigma')]>0&&d[idx('tau')]>0);
   assert.ok(Math.abs(d[idx('icc')]-d[idx('tau')]**2/(d[idx('tau')]**2+d[idx('sigma')]**2))<1e-14);
  }
 }
 if(covarianceCheck){
  const a=fit.parameters.findIndex(p=>p.id==='location_0'),b=fit.parameters.findIndex(p=>p.id==='location_1');
  const covariance=pairs=>{const ma=mean(pairs.map(x=>x[0])),mb=mean(pairs.map(x=>x[1]));return pairs.reduce((s,x)=>s+(x[0]-ma)*(x[1]-mb),0)/(pairs.length-1);};
  const batches=[];for(const c of fit.chains){const n=Math.floor(c.length/32);for(let k=0;k<32;k++)batches.push(covariance(c.slice(k*n,(k+1)*n).map(d=>[d[a],d[b]])));}
  const mcse=Math.sqrt(variance(batches)/batches.length),expected=oracle.groupCovariance[0][1];
  const observed=covariance(fit.chains.flatMap(c=>c.map(d=>[d[a],d[b]])));
  assert.ok(Math.abs(observed-expected)<=4*mcse+1e-9,`joint location covariance: ${observed} vs ${expected}, MCSE ${mcse}`);
  assert.ok(expected>4*mcse,`reference group covariance distinguishable from zero: ${expected}, 4MCSE ${4*mcse}`);
 }
 return fit;
}

for(const prior of ['default','wide'])test(`hierarchical singleton group posterior, ${prior}`,async()=>{
 await checkHierarchy(ref.singletonRows,ref.singleton[prior],prior,2026);
});

// Independent moderate-vector likelihood, using direct cumulative differences.
// Deliberately does not call the app's log density or its standardization.
function independentOrdinal(rows,{predictors,outcome,prior},free){
 const xs=predictors.map(field=>{
  if(field==='OverTime')return rows.map(r=>+(r[field]==='Yes'));
  const a=rows.map(r=>r[field]),m=mean(a),sd=Math.sqrt(variance(a));return a.map(v=>(v-m)/sd);
 });
 const m=[-1.5,Math.log(1.5),Math.log(1.5),...predictors.map(()=>0)];
 const sd=prior==='wide'?[2.5,.9,.9,...predictors.map(()=>2.5)]:[1.5,.5,.5,...predictors.map(()=>1)];
 let lp=-.5*free.reduce((s,v,j)=>s+((v-m[j])/sd[j])**2,0);
 const cuts=[free[0],free[0]+Math.exp(free[1]),free[0]+Math.exp(free[1])+Math.exp(free[2])];
 for(let i=0;i<rows.length;i++){
  const eta=predictors.reduce((s,_,j)=>s+xs[j][i]*free[j+3],0);
  const cdf=[0,...cuts.map(c=>1/(1+Math.exp(eta-c))),1],y=rows[i][outcome];lp+=Math.log(cdf[y]-cdf[y-1]);
 }
 return lp;
}
test('ordinal five-predictor gradients agree with an independent target, both priors',()=>{
 const rows=ibm.slice(0,120),vectors=[[-1,.2,.1,.3,-.15,.4,.2,-.3],[-2,.6,-.3,-.5,.5,-.2,-.4,.1],[-.5,-.7,.8,.8,-.4,.6,.3,.5]];
 for(const prior of ['default','wide'])for(const outcome of ['JobSatisfaction','EnvironmentSatisfaction','WorkLifeBalance']){
  const config={type:'ordinal',outcome,predictors:['Age','YearsAtCompany','DistanceFromHome','TotalWorkingYears','OverTime'],prior};
  const model=buildModel(rows,config);
  for(const free of vectors){
   const actual=ordinalLogDensity(model,free);assert.ok(Math.abs(actual.logp-independentOrdinal(rows,config,free))<1e-9);
   for(let j=0;j<free.length;j++){
    const h=1e-5*(1+Math.abs(free[j])),plus=[...free],minus=[...free];plus[j]+=h;minus[j]-=h;
    const expected=(independentOrdinal(rows,config,plus)-independentOrdinal(rows,config,minus))/(2*h);
    assert.ok(Math.abs(actual.grad[j]-expected)<1e-4*(1+Math.abs(expected)),`${outcome} ${prior} gradient ${j}`);
   }
  }
 }
});

test('ordinal absent categories retain positions; bad codes fail; positive slope favors higher responses',async()=>{
 for(const missing of [2,4]){
  const rows=ref.ordinalRows.filter(r=>r.JobSatisfaction!==missing);
  const model=buildModel(rows,{type:'ordinal',outcome:'JobSatisfaction',predictors:['Age']});
  assert.equal(model.observed.categories.find(c=>c.category===missing).n,0);
  const fit=await runChains(model,{warmup:500,draws:500,seed:17});
  assert.equal(fit.parameters.filter(p=>p.id.startsWith('p_category_')).length,4);
  assert.ok(fit.chains.flat(2).every(Number.isFinite));
 }
 for(const value of [0,5,1.5,NaN,'1'])assert.throws(()=>buildModel(ref.ordinalRows.map((r,i)=>({...r,JobSatisfaction:i?r.JobSatisfaction:value})),{type:'ordinal',outcome:'JobSatisfaction',predictors:['Age']}));
 const low=ordinalProbabilities([-1,.2,.1,.7],[-1]),high=ordinalProbabilities([-1,.2,.1,.7],[1]);
 for(let k=1;k<4;k++)assert.ok(high.slice(k).reduce((s,p)=>s+p,0)>low.slice(k).reduce((s,p)=>s+p,0));
});

test('advanced scope, validation, deterministic streams and profile metadata',async()=>{
 assert.throws(()=>buildModel(ref.hierarchicalRows.filter(r=>r.JobRole==='A'),{type:'hierarchical',groupBy:'JobRole'}));
 assert.throws(()=>buildModel(ref.hierarchicalRows,{type:'hierarchical',groupBy:'EmployeeNumber'}));
 assert.throws(()=>buildModel(ibm,{type:'hierarchical',groupBy:'Department',department:'Sales'}));
 assert.throws(()=>buildModel(ibm,{type:'ordinal',outcome:'Age',predictors:['Age']}));
 const config={type:'ordinal',outcome:'WorkLifeBalance',predictors:['Age','OverTime'],department:'Human Resources'};
 const model=buildModel(ibm,config);assert.equal(model.n,63);assert.equal(model.profile.values.OverTime,'No');
 const hr=ibm.filter(r=>r.Department==='Human Resources');assert.ok(Math.abs(model.profile.values.Age-mean(hr.map(r=>r.Age)))<1e-12);
 for(const type of ['ordinal','hierarchical']){
  const model=type==='ordinal'?buildModel(ref.ordinalRows,{type,predictors:['Age']}):buildModel(ref.hierarchicalRows,{type,groupBy:'JobRole'});
  const events=[],s={warmup:100,draws:100,seed:101};
  const a=await runChains(model,s,e=>events.push(e)),b=await runChains(model,s),c=await runChains(model,{...s,seed:17});
  assert.deepEqual(a.chains,b.chains);assert.notDeepEqual(a.chains,c.chains);assert.notDeepEqual(a.chains[0],a.chains[1]);
  assert.ok(events.some(e=>e.phase==='warmup'));assert.ok(events.some(e=>e.phase==='sampling'));
  assert.equal(events.at(-1).completed,events.at(-1).total);
 }
});
