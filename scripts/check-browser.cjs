/* Development QA. Requires Playwright in the caller's NODE_PATH, not at runtime. */
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');

(async()=>{
 const base=process.argv[2]||'http://127.0.0.1:4173/';
 const folder=process.argv[3]||'artifacts/browser-local';
 const hosted=base.startsWith('https://');
 await fs.mkdir(folder,{recursive:true});
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
 const page=await context.newPage();
 const errors=[],failedRequests=[],fits=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)failedRequests.push([r.status(),r.url()]);});
 const screenshot=async name=>page.screenshot({path:path.join(folder,name+'.png')});
 const checkOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page-level horizontal overflow');
 const fixed=/^-?\d[\d,]*\.\d{2}%?$/;
 const checkFixed=async selector=>{
  for(const text of await page.locator(selector).allTextContents()){
   if(['—','Undefined'].includes(text))continue;
   for(const value of text.split('–')){
    assert.match(value,fixed,`two fixed decimals: ${text}`);
    assert.doesNotMatch(value,/^-0\.00%?$/,'display has no negative zero');
   }
  }
 };
 const checkIntervals=async(selector,result)=>{
  const marks=await page.locator(selector+' .interval-marks').evaluateAll(groups=>groups.map(g=>{
   const wide=g.querySelector('.chart-range-95'),inner=g.querySelector('.chart-range-50'),dot=g.querySelector('.chart-dot');
   const endpoints=e=>[+e.getAttribute('x1'),+e.getAttribute('x2'),+e.getAttribute('y1'),+e.getAttribute('y2')];
   return{id:g.dataset.parameter,wide:endpoints(wide),inner:endpoints(inner),dot:[+dot.getAttribute('cx'),+dot.getAttribute('cy')],width95:parseFloat(getComputedStyle(wide).strokeWidth),width50:parseFloat(getComputedStyle(inner).strokeWidth),dotFill:getComputedStyle(dot).fill,lineStroke:getComputedStyle(inner).stroke};
  }));
  assert.ok(marks.length>0,'chart has interval marks');
  for(const m of marks){
   const s=result.summary.find(s=>s.id===m.id),span=m.wide[1]-m.wide[0];
   assert.ok(s,'each mark identifies a real summary');
   assert.ok(m.width95<m.width50,'50% line is thicker');
   assert.notEqual(m.dotFill,m.lineStroke,'median dot is distinct from interval');
   assert.equal(m.wide[2],m.wide[3]);assert.equal(m.inner[2],m.inner[3]);
   assert.equal(m.wide[2],m.inner[2]);assert.equal(m.dot[1],m.inner[2]);
   assert.ok(m.wide[0]<=m.inner[0]&&m.inner[0]<=m.dot[0]&&m.dot[0]<=m.inner[1]&&m.inner[1]<=m.wide[1],'intervals overlap and nest around median');
   if(span>0){
    for(const [x,value]of[[m.inner[0],s.low50],[m.inner[1],s.high50],[m.dot[0],s.median]])assert.ok(Math.abs((x-m.wide[0])/span-(value-s.low)/(s.high-s.low))<1e-9,'geometry uses real unrounded quantiles');
   }
  }
  assert.match(await page.locator(selector+' svg').getAttribute('aria-label'),/50%.*95%|95%.*50%/,'accessible description identifies both levels');
 };
 await page.goto(base,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.getElementById('dataset-badge').textContent.includes('1,470'));
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 assert.equal(await page.locator('#draws').inputValue(),'4000','UI default retained draws');
 await checkOverflow();await screenshot('landing-light');
 await page.locator('#lab').scrollIntoViewIfNeeded();
 await screenshot('lab-ready');

 // Tab keyboard semantics and visible focus.
 await page.locator('#tab-proportion').focus();await page.keyboard.press('End');
 assert.equal(await page.locator('#tab-hierarchical').getAttribute('aria-selected'),'true');
 await page.keyboard.press('ArrowLeft');
 assert.equal(await page.locator('#tab-ordinal').getAttribute('aria-selected'),'true');
 assert.notEqual(await page.locator('#tab-ordinal').evaluate(e=>getComputedStyle(e).outlineStyle),'none');

 const types=hosted?['logistic','ordinal','hierarchical']:['proportion','compare','linear','logistic','ordinal','hierarchical'];
 for(const type of types){
  await page.locator('#tab-'+type).click();
  if(type==='proportion')await page.locator('#group-by').selectOption('Department');
  if(type==='compare')await page.locator('#group-by').selectOption('Gender');
  if(type==='hierarchical')await page.locator('#group-by').selectOption('JobRole');
  if(['linear','logistic','ordinal'].includes(type)){
   for(const box of await page.locator('input[name=predictor]').all())await box.uncheck();
   for(const name of ['Age','YearsAtCompany','DistanceFromHome','TotalWorkingYears','OverTime'])await page.locator(`input[value="${name}"]`).check();
  }
  const started=Date.now();
  await page.locator('#run-button').click();
  await page.locator('#results').waitFor({state:'visible',timeout:120000});
  assert.equal(await page.locator('#fit-state').getAttribute('data-state'),'completed');
  assert.equal(await page.locator('#histogram svg, #interval-chart svg, #trace-chart svg').count(),3);
  assert.ok(await page.locator('#summary-body tr').count()>0);
  assert.equal(await page.locator('#summary-body th small').first().evaluate(e=>getComputedStyle(e).display),'block','summary units retain their own line; full stylesheet parsed');
  const downloadEvent=page.waitForEvent('download');await page.locator('#export-button').click();
  const download=await downloadEvent;const filename=path.join(folder,type+'-export.json');await download.saveAs(filename);
  const result=JSON.parse(await fs.readFile(filename,'utf8'));
  assert.equal(result.config.type,type);assert.equal(result.n,1470);assert.equal(result.source.fictional,true);
  assert.equal(result.settings.chains,4);assert.equal(result.settings.draws,4000);
  if(['linear','logistic','ordinal'].includes(type))assert.equal(result.config.predictors.length,5,'all five predictors fitted through UI');
  assert.equal(new Set(result.chainInfo.map(c=>c.seed)).size,4);
  assert.ok(result.summary.every(s=>Number.isFinite(s.median)&&Number.isFinite(s.low50)&&Number.isFinite(s.high50)&&Number.isFinite(s.low)&&Number.isFinite(s.high)));
  assert.deepEqual(result.intervals.map(i=>i.level),[.5,.95]);
  assert.match(result.interval,/95%/,'existing interval metadata preserved');
  await checkFixed('#summary-body td');
  await checkFixed('#interval-chart .chart-axis');
  await checkIntervals('#interval-chart',result);
  assert.match(await page.locator('#interval-note').textContent(),/50%.*95%/);
  assert.match(await page.locator('.exact-results > p').textContent(),/rounding can mask a boundary/);
  // Raw exports retain precision beyond the two-decimal presentation.
  assert.ok(result.summary.some(s=>s.median!==Math.round(s.median*100)/100));
  const diagnostics=await page.locator('#summary-body tr').evaluateAll(rows=>rows.map(row=>({rhat:row.querySelectorAll('td')[4].classList.contains('warn'),ess:row.querySelectorAll('td')[5].classList.contains('warn')})));
  diagnostics.forEach((d,i)=>{assert.equal(d.rhat,result.summary[i].rhat==null||result.summary[i].rhat>1.01);assert.equal(d.ess,result.summary[i].ess==null||result.summary[i].ess<400);});
  if(!['logistic','ordinal','hierarchical'].includes(type))assert.equal(result.settings.warmup,0);
  if(['linear','compare'].includes(type))assert.ok(result.summary.filter(s=>s.family==='income'||s.family==='ratio').every(s=>s.mean===null&&s.sd===null&&s.mcse===null));
  if(['linear','logistic'].includes(type)){
   assert.equal(result.summary.find(s=>s.id==='intercept').probabilityAboveNull,null,'intercept has no directional null');
   await page.locator('#parameter-select').selectOption('intercept');
   assert.doesNotMatch(await page.locator('#interpretation').textContent(),/no-change|retained draws are above/);
   assert.equal(await page.locator('#summary-body tr').first().locator('td').nth(3).textContent(),'—');
   await page.locator('#parameter-select').selectOption('multiplier_Age');
  }
  fits.push({type,milliseconds:Date.now()-started,n:result.n,parameters:result.summary.length,warnings:result.warnings,seed:result.settings.seed});
  await page.locator('#histogram').scrollIntoViewIfNeeded();await screenshot(type+'-charts-light');
  await checkOverflow();
  if(['ordinal','hierarchical'].includes(type)){
   assert.equal(await page.locator('#model-overview').isVisible(),true);
   assert.equal(await page.locator('#overview-chart svg').count(),1);
   await checkIntervals('#overview-chart',result);
   if(type==='ordinal'){
    assert.equal(result.config.outcome,'JobSatisfaction');
    assert.equal(result.observed.categories.reduce((s,c)=>s+c.n,0),1470);
    assert.match(await page.locator('#overview-note').textContent(),/not a predictive check/);
    assert.match(await page.locator('#overview-table').textContent(),/1 · Low/);
    await checkFixed('#overview-table td:not(:first-of-type)');
   }else{
    assert.equal(result.observed.groups.reduce((s,g)=>s+g.n,0),1470);
    assert.equal(result.observed.groups.length,9);
    assert.match(await page.locator('#histogram').textContent(),/Between-group share/);
    await checkFixed('#overview-table td:not(:first-of-type)');
   }
   await page.locator('#overview-chart').scrollIntoViewIfNeeded();await screenshot(type+'-overview-light');
   await page.locator('#theme-toggle').click();await page.locator('#overview-chart').scrollIntoViewIfNeeded();await screenshot(type+'-overview-dark');
   await checkIntervals('#overview-chart',result);
   await page.setViewportSize({width:360,height:900});await page.waitForTimeout(250);
   await checkOverflow();await page.locator('#overview-chart').scrollIntoViewIfNeeded();await screenshot(type+'-overview-mobile');
   await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(250);
   await page.locator('#theme-toggle').click();
   if(type==='ordinal'){
    await page.locator('#ordinal-outcome').selectOption('WorkLifeBalance');
    assert.equal(await page.locator('#results').isVisible(),false);
    assert.equal(await page.locator('#export-button').isDisabled(),true);
    await page.locator('#run-button').click();await page.locator('#results').waitFor({state:'visible',timeout:120000});
    assert.match(await page.locator('#result-context').textContent(),/WorkLifeBalance/);
   }else{
    await page.locator('#group-by').selectOption('Department');assert.equal(await page.locator('#results').isVisible(),false);
    await page.locator('#run-button').click();await page.locator('#results').waitFor({state:'visible',timeout:120000});
    assert.match(await page.locator('#model-notes').textContent(),/Only 3 groups/);
    await page.locator('#department').selectOption('Human Resources');await page.locator('#run-button').click();
    assert.equal(await page.locator('#fit-state').getAttribute('data-state'),'error');
    assert.match(await page.locator('#state-message').textContent(),/at least two/);
    await page.locator('#department').selectOption('All');await page.locator('#group-by').selectOption('JobRole');
    await page.locator('#run-button').click();await page.locator('#results').waitFor({state:'visible',timeout:120000});
   }
  }
 }

 await page.locator('#theme-toggle').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.locator('#histogram').scrollIntoViewIfNeeded();await screenshot('logistic-charts-dark');
 await page.setViewportSize({width:360,height:900});await page.waitForTimeout(250);
 await checkOverflow();await page.locator('#histogram').scrollIntoViewIfNeeded();await screenshot('mobile-charts-dark');
 await page.locator('#theme-toggle').click();await page.locator('#trace-chart').scrollIntoViewIfNeeded();await screenshot('mobile-trace-light');

 // Completed results invalidate on scope change.
 await page.locator('#department').selectOption('Human Resources');
 assert.equal(await page.locator('#results').isVisible(),false);
 assert.equal(await page.locator('#export-button').isDisabled(),true);
 assert.match(await page.locator('#scope-note').textContent(),/63/);
 await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(250);
 await page.locator('#model-form .settings').evaluate(e=>e.open=true);
 await page.locator('#warmup').fill('10000');await page.locator('#draws').fill('10000');
 await page.locator('#run-button').click();
 await page.waitForFunction(()=>document.getElementById('fit-progress').value>0,{timeout:30000});
 await screenshot('sampling-progress');
 // Theme is unrelated to the fit and must stay responsive.
 await page.locator('#theme-toggle').click();
 assert.equal(await page.locator('#fit-state').getAttribute('data-state'),'sampling');
 const cancelStart=Date.now();await page.locator('#cancel-button').click();
 assert.equal(await page.locator('#fit-state').getAttribute('data-state'),'cancelled');
 assert.ok(Date.now()-cancelStart<1000,'cancel acknowledges within one second');
 assert.equal(await page.locator('#results').isVisible(),false);
 // Changing settings during another run terminates it and rejects any old result.
 await page.locator('#run-button').click();
 await page.locator('#prior').selectOption('wide');
 assert.equal(await page.locator('#results').isVisible(),false);
 assert.equal(await page.locator('#cancel-button').isVisible(),false);
 assert.equal(await page.locator('#fit-state').getAttribute('data-state'),'stale');
 await page.waitForTimeout(1200);
 assert.equal(await page.locator('#results').isVisible(),false);
 // Invalid input: same two comparison groups after narrowing to one department.
 await page.locator('#tab-compare').click();await page.locator('#group-by').selectOption('Department');
 await page.locator('#run-button').click();
 assert.equal(await page.locator('#fit-state').getAttribute('data-state'),'error');
 assert.match(await page.locator('#state-message').textContent(),/different groups/);
 assert.equal(await page.locator('#results').isVisible(),false);
 await page.setViewportSize({width:360,height:900});await checkOverflow();
 await page.locator('#lab').scrollIntoViewIfNeeded();await screenshot('mobile-controls');
 assert.deepEqual(errors,[],'no browser JavaScript errors');
 assert.deepEqual(failedRequests,[],'no failing asset or data requests');
 const report={base,hosted,fits,errors,failedRequests,checks:['light default','4000 retained draws/chain',hosted?'hosted logistic/ordinal/hierarchical':'all six analysis tabs','five-predictor regression fits','two fixed decimal places','nested 50%/95% interval geometry and accessibility','raw export precision','unrounded diagnostic warnings','JSON exports','posterior charts and tables','keyboard tab navigation and visible focus','dark switch','360px reflow','scope invalidation','ordinal outcome invalidation','hierarchical grouping invalidation','single-group hierarchical error','live progress','theme while sampling','cancel <1s','running-setting invalidation','same-group error']};
 await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
