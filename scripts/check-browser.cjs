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
 await page.goto(base,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.getElementById('dataset-badge').textContent.includes('1,470'));
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await checkOverflow();await screenshot('landing-light');
 await page.locator('#lab').scrollIntoViewIfNeeded();
 await screenshot('lab-ready');

 // Tab keyboard semantics and visible focus.
 await page.locator('#tab-proportion').focus();await page.keyboard.press('End');
 assert.equal(await page.locator('#tab-logistic').getAttribute('aria-selected'),'true');
 await page.keyboard.press('ArrowLeft');
 assert.equal(await page.locator('#tab-linear').getAttribute('aria-selected'),'true');
 assert.notEqual(await page.locator('#tab-linear').evaluate(e=>getComputedStyle(e).outlineStyle),'none');

 const types=hosted?['logistic']:['proportion','compare','linear','logistic'];
 for(const type of types){
  await page.locator('#tab-'+type).click();
  if(type==='proportion')await page.locator('#group-by').selectOption('Department');
  if(type==='compare')await page.locator('#group-by').selectOption('Gender');
  if(['linear','logistic'].includes(type)){
   for(const box of await page.locator('input[name=predictor]').all())await box.uncheck();
   for(const name of type==='linear'?['Age','YearsAtCompany','TotalWorkingYears']:['Age','YearsAtCompany','OverTime'])await page.locator(`input[value="${name}"]`).check();
  }
  const started=Date.now();
  await page.locator('#run-button').click();
  await page.locator('#results').waitFor({state:'visible',timeout:120000});
  assert.equal(await page.locator('#fit-state').getAttribute('data-state'),'completed');
  assert.equal(await page.locator('#results svg').count(),3);
  assert.ok(await page.locator('#summary-body tr').count()>0);
  const downloadEvent=page.waitForEvent('download');await page.locator('#export-button').click();
  const download=await downloadEvent;const filename=path.join(folder,type+'-export.json');await download.saveAs(filename);
  const result=JSON.parse(await fs.readFile(filename,'utf8'));
  assert.equal(result.config.type,type);assert.equal(result.n,1470);assert.equal(result.source.fictional,true);
  assert.equal(result.settings.chains,4);assert.equal(result.settings.draws,1500);
  assert.equal(new Set(result.chainInfo.map(c=>c.seed)).size,4);
  assert.ok(result.summary.every(s=>Number.isFinite(s.median)&&Number.isFinite(s.low)&&Number.isFinite(s.high)));
  if(type!=='logistic')assert.equal(result.settings.warmup,0);
  if(['linear','compare'].includes(type))assert.ok(result.summary.filter(s=>s.family==='income'||s.family==='ratio').every(s=>s.mean===null&&s.sd===null&&s.mcse===null));
  fits.push({type,milliseconds:Date.now()-started,n:result.n,parameters:result.summary.length,warnings:result.warnings,seed:result.settings.seed});
  await page.locator('#histogram').scrollIntoViewIfNeeded();await screenshot(type+'-charts-light');
  await checkOverflow();
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
 const report={base,hosted,fits,errors,failedRequests,checks:['light default','four tabs / hosted logistic','JSON exports','posterior charts and tables','keyboard tab navigation and visible focus','dark switch','360px reflow','scope invalidation','live progress','theme while sampling','cancel <1s','running-setting invalidation','same-group error']};
 await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
