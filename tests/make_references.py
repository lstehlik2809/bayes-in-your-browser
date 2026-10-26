"""Independent SciPy posterior oracles; development only, never used by the app.

Run with Python + numpy/scipy to regenerate fixtures/reference.json.
All likelihood/prior algebra here is independent of the JavaScript engine.
"""
import json
import math
from pathlib import Path

import numpy as np
from scipy.integrate import cumulative_trapezoid, trapezoid
from scipy.special import expit, gammaln
from scipy.stats import beta as beta_dist, invgamma, t as student_t

ROOT = Path(__file__).parent
OUT = ROOT / 'fixtures'
OUT.mkdir(exist_ok=True)
PROBS = [.025, .5, .975]


def summary(mean, sd, quantiles):
    return dict(mean=float(mean), sd=float(sd), lower=float(quantiles[0]),
                median=float(quantiles[1]), upper=float(quantiles[2]))


def gaussian(rows, predictors, prior, comparison=False):
    y = np.log([r['MonthlyIncome'] for r in rows])
    if comparison:
        X = np.array([[1., float(r['Gender'] == 'B')] for r in rows])
    else:
        cols = [[1.] * len(rows)]
        for key in predictors:
            v = np.array([r[key] for r in rows], dtype=float)
            cols.append(((v-v.mean())/v.std(ddof=1)).tolist())
        X = np.array(cols).T
    m0 = np.array([math.log(5000)] + [0.] * (X.shape[1]-1))
    V0 = np.diag([16.] + [4.] * (X.shape[1]-1)) if prior == 'wide' else np.diag([4.] + [1.] * (X.shape[1]-1))
    a0, b0 = 2., 4. if prior == 'wide' else 1.
    precision0 = np.linalg.inv(V0)
    Vn = np.linalg.inv(precision0 + X.T @ X)
    mn = Vn @ (precision0 @ m0 + X.T @ y)
    an = a0 + len(y)/2
    bn = b0 + .5 * (y @ y + m0 @ precision0 @ m0 - mn @ np.linalg.solve(Vn, mn))
    # Independent residual identity checks cancellation-sensitive posterior algebra.
    bn_alt = b0 + .5*((y-X@mn)@(y-X@mn)+(mn-m0)@precision0@(mn-m0))
    assert abs(bn-bn_alt) < 1e-8
    result = []
    for j in range(X.shape[1]):
        scale = math.sqrt(bn/an*Vn[j, j])
        q = student_t.ppf(PROBS, 2*an, loc=mn[j], scale=scale)
        result.append(summary(mn[j], math.sqrt(bn/(an-1)*Vn[j,j]), q))
    sigma_mean = math.sqrt(bn)*math.exp(gammaln(an-.5)-gammaln(an))
    sigma_sd = math.sqrt(bn/(an-1)-sigma_mean**2)
    result.append(summary(sigma_mean, sigma_sd, np.sqrt(invgamma.ppf(PROBS, an, scale=bn))))
    return dict(raw=result, covariance=(bn/(an-1)*Vn).tolist(),
                betaLocation=mn.tolist(), betaScale=(bn/an*Vn).tolist(), df=2*an)


def logistic(rows, prior, grid_n):
    # Explicitly aggregate the independent likelihood, avoiding app model code.
    age = np.array([r['Age'] for r in rows], dtype=float)
    center, scale = age.mean(), age.std(ddof=1)
    levels = sorted(set(age))
    counts = [(float((v-center)/scale), sum(r['Age']==v for r in rows),
               sum(r['Age']==v and r['Attrition']=='Yes' for r in rows)) for v in levels]
    axis = np.linspace(-9., 7., grid_n)
    a = axis[:, None]
    b = axis[None, :]
    sd_a, sd_b = (5.,2.5) if prior == 'wide' else (2.5,1.)
    lp = -.5*(a/sd_a)**2-.5*(b/sd_b)**2
    for x, n, k in counts:
        eta = a+b*x
        lp += k*eta-n*np.logaddexp(0.,eta)
    density = np.exp(lp-lp.max())
    norm = trapezoid(trapezoid(density, axis, axis=1), axis)
    density /= norm
    pa = trapezoid(density, axis, axis=1)
    pb = trapezoid(density, axis, axis=0)
    result = []
    for p in [pa,pb]:
        cdf = cumulative_trapezoid(p,axis,initial=0)
        cdf /= cdf[-1]
        mean = trapezoid(axis*p,axis)
        sd = math.sqrt(trapezoid((axis-mean)**2*p,axis))
        result.append(summary(mean,sd,np.interp(PROBS,cdf,axis)))
    # Boundary strips have negligible mass; separately test refined grid below.
    boundary = float(max(pa[:4].max(), pa[-4:].max(),pb[:4].max(),pb[-4:].max()))
    assert boundary < 1e-10, boundary
    return dict(raw=result, boundaryDensity=boundary, gridSize=grid_n)


def main():
    compare_rows = []
    for label,n,mu in [('A',37,8.25),('B',27,8.63)]:
        for i in range(n):
            compare_rows.append(dict(Gender=label,Department='Sales',
                MonthlyIncome=math.exp(mu+.27*math.sin(i*2.17)+.13*math.cos(i*1.3))))
    linear_rows = []
    for i in range(96):
        linear_rows.append(dict(Age=20+(i%29)*1.3,YearsAtCompany=(i*7)%19+.2*math.sin(i),
            TotalWorkingYears=0.,Department='Sales'))
    for i,r in enumerate(linear_rows):
        r['TotalWorkingYears']=.4*r['Age']+.5*r['YearsAtCompany']+(i*13)%11
    z = np.array([[r[k] for k in ['Age','YearsAtCompany','TotalWorkingYears']] for r in linear_rows])
    z=(z-z.mean(axis=0))/z.std(axis=0,ddof=1)
    for i,r in enumerate(linear_rows):
        r['MonthlyIncome']=math.exp(8.3+z[i]@np.array([.2,-.12,.3])+.25*math.sin(i*7.1))
    logistic_rows=[]
    for age,k in zip([18,25,32,39,46],[1,4,9,13,17]):
        for i in range(20):
            logistic_rows.append(dict(Age=age,Attrition='Yes' if i<k else 'No',Department='Sales'))
    ref = dict(description='Independent SciPy reference posteriors; no JavaScript engine imported.',
        compareRows=compare_rows,linearRows=linear_rows,logisticRows=logistic_rows,gaussian={},logistic={},beta={})
    for prior in ['default','wide']:
        ref['gaussian'][prior]={
            'compare':gaussian(compare_rows,[],prior,True),
            'linear1':gaussian(linear_rows,['Age'],prior),
            'linear3':gaussian(linear_rows,['Age','YearsAtCompany','TotalWorkingYears'],prior)}
        coarse=logistic(logistic_rows,prior,1001)
        fine=logistic(logistic_rows,prior,2001)
        err=max(abs(coarse['raw'][j][q]-fine['raw'][j][q]) for j in [0,1] for q in ['mean','median','lower','upper'])
        fine['refinementError']=float(err)
        assert err < .001
        ref['logistic'][prior]=fine
        alpha=.5 if prior=='wide' else 1.
        for name,k,n in [('overall',237,1470),('zero',0,12),('all',12,12),('smallA',2,12),('smallB',9,18)]:
            a,b=k+alpha,n-k+alpha
            ref['beta'][prior+':'+name]=summary(a/(a+b),math.sqrt(a*b/((a+b)**2*(a+b+1))),beta_dist.ppf(PROBS,a,b))
    (OUT/'reference.json').write_text(json.dumps(ref,indent=2),encoding='utf8')
    print('Independent fixtures generated. Logistic grid refinement errors:',
          {p:ref['logistic'][p]['refinementError'] for p in ['default','wide']})


if __name__=='__main__':
    main()
