"""Independent ordinal QMC and hierarchical quadrature oracles (development only)."""
import json
import math
from pathlib import Path

import numpy as np
from scipy.integrate import trapezoid, cumulative_trapezoid
from scipy.optimize import minimize, brentq
from scipy.special import expit, ndtr, ndtri
from scipy.stats import qmc, chi2, multivariate_t

OUT = Path(__file__).parent / 'fixtures'
P = [.025, .5, .975]
FUNCS = ['mean', 'median', 'lower', 'upper']
COUNTS = np.array([[9, 7, 3, 1], [4, 8, 5, 3], [1, 4, 7, 8]])
X = np.array([-10., 0., 10.]) / math.sqrt(4000/59)


def ordinal_logp(theta, prior):
    """Independent aggregate likelihood; theta=(c1,loggap2,loggap3,beta)."""
    t = np.atleast_2d(theta)
    gaps = np.exp(np.clip(t[:, 1:3], -700, 700))
    cuts = np.column_stack([t[:, 0], t[:, 0]+gaps[:, 0], t[:, 0]+gaps.sum(axis=1)])
    m = np.array([-1.5, math.log(1.5), math.log(1.5), 0.])
    sd = np.array([2.5, .9, .9, 2.5] if prior == 'wide' else [1.5, .5, .5, 1.])
    ans = -.5*np.sum(((t-m)/sd)**2, axis=1)
    with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
        for x, counts in zip(X, COUNTS):
            z = cuts-t[:, 3, None]*x
            ll = np.column_stack([
                -np.logaddexp(0, -z[:, 0]),
                -np.logaddexp(0, -z[:, 1])-np.logaddexp(0, z[:, 0])+np.log(-np.expm1(-gaps[:, 0])),
                -np.logaddexp(0, -z[:, 2])-np.logaddexp(0, z[:, 1])+np.log(-np.expm1(-gaps[:, 1])),
                -np.logaddexp(0, z[:, 2])])
            ans += ll @ counts
    return np.where(np.isfinite(ans), ans, -np.inf)


def ordinal_values(t):
    c1=t[:, 0]; c2=c1+np.exp(t[:, 1]); c3=c2+np.exp(t[:, 2])
    return dict(c1=c1,log_gap2=t[:, 1],log_gap3=t[:, 2],beta_Age=t[:, 3],
                c2=c2,c3=c3,odds_Age=np.exp(t[:, 3]),
                p1=expit(c1),p2=expit(c2)-expit(c1),p3=expit(c3)-expit(c2),p4=expit(-c3))


def weighted_stats(v,w):
    order=np.argsort(v); quant=np.interp(P,np.cumsum(w[order]),v[order])
    avg=float(w@v)
    return dict(mean=avg,sd=float(np.sqrt(w@((v-avg)**2))),lower=float(quant[0]),median=float(quant[1]),upper=float(quant[2]))


def ordinal_reference(prior):
    initial=np.array([-1.5, math.log(1.5), math.log(1.5), 0.])
    mode=minimize(lambda z:-ordinal_logp(z,prior)[0],initial,method='BFGS',options={'gtol':1e-6}).x
    h=1e-4; eye=np.eye(4)*h
    H=np.array([[(-ordinal_logp(mode+eye[i]+eye[j],prior)[0]+ordinal_logp(mode+eye[i]-eye[j],prior)[0]
                  +ordinal_logp(mode-eye[i]+eye[j],prior)[0]-ordinal_logp(mode-eye[i]-eye[j],prior)[0])/(4*h*h)
                 for j in range(4)] for i in range(4)])
    covariance=np.linalg.inv(H)
    assert min(np.linalg.eigvalsh(covariance))>0
    reps=[];diagnostics=[]
    for power in [17,18]:
        for scale in [1.,1.5]:
            shape=covariance*scale**2; L=np.linalg.cholesky(shape)
            for seed in [11,29,41,61]:
                u=qmc.Sobol(5,scramble=True,seed=seed).random_base2(power)
                t=mode+ndtri(u[:,:4])@L.T*np.sqrt(7/chi2.ppf(u[:,4],7))[:,None]
                logw=ordinal_logp(t,prior)-multivariate_t.logpdf(t,loc=mode,shape=shape,df=7)
                w=np.exp(logw-np.max(logw));w/=sum(w)
                ess=float(1/sum(w*w)); maxw=float(max(w))
                assert ess>.2*len(w) and maxw<.001,(prior,power,scale,ess,maxw)
                mask=w>1e-250;w=w[mask];w/=sum(w);t=t[mask]
                stats={name:weighted_stats(v,w) for name,v in ordinal_values(t).items()}
                reps.append(dict(power=power,scale=scale,seed=seed,stats=stats))
                diagnostics.append(dict(power=power,scale=scale,seed=seed,n=2**power,weightESS=ess,maxWeight=maxw))
            print('ordinal',prior,power,scale,flush=True)
    result={}
    for name in reps[0]['stats']:
        largest=[r['stats'][name] for r in reps if r['power']==18]
        final={key:float(np.mean([r[key] for r in largest])) for key in ['mean','sd','median','lower','upper']}
        errors={}
        for key in FUNCS:
            groups={(power,scale):np.array([r['stats'][name][key] for r in reps if r['power']==power and r['scale']==scale])
                    for power in [17,18] for scale in [1.,1.5]}
            error=max([4*np.std(groups[(18,s)],ddof=1)/2 for s in [1.,1.5]]+
                      [abs(np.mean(groups[(18,1.)])-np.mean(groups[(18,1.5)]))]+
                      [abs(np.mean(groups[(17,s)])-np.mean(groups[(18,s)])) for s in [1.,1.5]])
            cap=(.025 if key in ['lower','upper'] else .01)*final['sd']
            assert error<=cap,(prior,name,key,error,cap)
            errors[key]=float(error)
        final['error']=errors;result[name]=final
    return dict(stats=result,diagnostics=diagnostics,mode=mode.tolist(),proposalCovariance=covariance.tolist(),
                method='Independent t7 importance integration; 4 scrambled Sobol replicates, powers17/18, scales1/1.5; per-functional uncertainty.')


def hierarchical_reference(rows,prior,size,expanded=False):
    labels=sorted(set(r['JobRole'] for r in rows));ys=[np.log([r['MonthlyIncome'] for r in rows if r['JobRole']==g]) for g in labels]
    n=np.array([len(y) for y in ys]);means=np.array([y.mean() for y in ys]);sse=sum(float(((y-y.mean())**2).sum()) for y in ys)
    m0=math.log(5000); prior_v=16. if prior=='wide' else 4.; bs=4. if prior=='wide' else 1.; bt=1. if prior=='wide' else .25
    e=np.linspace(-10,10,size) if expanded else np.linspace(-8,8,size)
    f=np.linspace(-12,14,size) if expanded else np.linspace(-10,12,size)
    v=np.exp(e)[:,None];t=np.exp(f)[None,:]
    d=np.array([t+v/ng for ng in n]); precision=(1/d).sum(axis=0)
    resid=means-m0;B=sum(resid[g]/d[g] for g in range(len(n)));C=sum(resid[g]**2/d[g] for g in range(len(n)))
    lp=-3*e[:,None]-bs/v-3*f[None,:]-bt/t
    lp+=-(sum(n)-len(n))/2*e[:,None]-sse/(2*v)
    lp+=-.5*np.log(d).sum(axis=0)-.5*np.log1p(prior_v*precision)-.5*(C-prior_v*B**2/(1+prior_v*precision))
    lp+=e[:,None]+f[None,:]  # Integration Jacobian, not an app posterior transformation.
    density=np.exp(lp-np.max(lp));norm=trapezoid(trapezoid(density,f,axis=1),e)
    de=e[1]-e[0];df=f[1]-f[0];we=np.ones(size)*de;wf=np.ones(size)*df;we[[0,-1]]*=.5;wf[[0,-1]]*=.5
    w=density*we[:,None]*wf[None,:]/norm
    boundary=float(w[[0,-1],:].sum()+w[:,[0,-1]].sum());assert boundary<1e-10,boundary
    mu_v=1/(1/prior_v+precision);mu_m=m0+mu_v*B
    keep=w>1e-16;dropped=float(w[~keep].sum());assert dropped<1e-9
    weights=w[keep];weights/=sum(weights)

    def mixture(m,var):
        mu=m[keep];sd=np.sqrt(var[keep]);avg=float(w.flatten()@m.flatten())
        second=float(np.sum(w*(var+m*m)));std=math.sqrt(max(0,second-avg*avg))
        lo=float(np.min(mu-12*sd));hi=float(np.max(mu+12*sd))
        qs=[brentq(lambda x:float(weights@ndtr((x-mu)/sd))-p,lo,hi,xtol=1e-10) for p in P]
        return dict(mean=avg,sd=std,lower=float(qs[0]),median=float(qs[1]),upper=float(qs[2]))

    stats={'mu':mixture(mu_m,mu_v)};locations=[];locvars=[];effects=[]
    for g,label in enumerate(labels):
        shrink=t/(t+v/n[g]);cond_v=1/(n[g]/v+1/t)
        loc_m=shrink*means[g]+(1-shrink)*mu_m
        loc_v=cond_v+(1-shrink)**2*mu_v
        effect_m=shrink*(means[g]-mu_m);effect_v=cond_v+shrink**2*mu_v
        stats['u_'+label]=mixture(effect_m,effect_v)
        stats['theta_'+label]=mixture(loc_m,loc_v)
        locations.append(loc_m);locvars.append(loc_v);effects.append(shrink)
    for name,axis,marginal,values in [
        ('sigma',e,trapezoid(density,f,axis=1)/norm,np.exp(e/2)),
        ('tau',f,trapezoid(density,e,axis=0)/norm,np.exp(f/2))]:
        cdf=cumulative_trapezoid(marginal,axis,initial=0);cdf/=cdf[-1]
        avg=float(trapezoid(marginal*values,axis));sd=math.sqrt(float(trapezoid(marginal*values**2,axis))-avg**2)
        quant=np.exp(np.interp(P,cdf,axis)/2)
        stats[name]=dict(mean=avg,sd=sd,lower=float(quant[0]),median=float(quant[1]),upper=float(quant[2]))
    cov=np.zeros((len(n),len(n)))
    for g in range(len(n)):
        for h in range(len(n)):
            cond=locvars[g] if g==h else (1-effects[g])*(1-effects[h])*mu_v
            cov[g,h]=np.sum(w*(cond+locations[g]*locations[h]))-stats['theta_'+labels[g]]['mean']*stats['theta_'+labels[h]]['mean']
    # ICC is bounded; weighted grid quantiles are refined separately.
    icc=np.broadcast_to(t/(t+v),w.shape);stats['icc']=weighted_stats(icc.flatten(),w.flatten())
    return dict(stats=stats,groupCovariance=cov.tolist(),labels=labels,n=n.tolist(),boundaryMass=boundary,droppedCDFMass=dropped,size=size,expanded=expanded)


def hierarchical_refined(rows,prior):
    coarse=hierarchical_reference(rows,prior,401)
    fine=hierarchical_reference(rows,prior,801)
    expanded=hierarchical_reference(rows,prior,801,True)
    for name,stats in fine['stats'].items():
        stats['error']={key:float(max(abs(stats[key]-coarse['stats'][name][key]),abs(stats[key]-expanded['stats'][name][key]))) for key in FUNCS}
        for key in FUNCS:
            assert stats['error'][key]<(.025 if key in ['lower','upper'] else .01)*stats['sd'],(name,key,stats['error'][key],stats['sd'])
    fine['refinement']={k:coarse[k] for k in ['size','boundaryMass','droppedCDFMass']}
    fine['expandedDomain']={k:expanded[k] for k in ['size','boundaryMass','droppedCDFMass']}
    return fine


def main():
    ordinal_rows=[]
    for age,counts in zip([22,32,42],COUNTS):
        for category,count in enumerate(counts,1):
            for _ in range(int(count)):
                ordinal_rows.append(dict(Age=age,JobSatisfaction=category,EnvironmentSatisfaction=category,WorkLifeBalance=category,Department='Sales'))
    hierarchy_rows=[]
    for g,n,mu in [('A',2,7.8),('B',9,8.45),('C',35,8.7)]:
        for i in range(n):hierarchy_rows.append(dict(JobRole=g,Department='Sales',MonthlyIncome=math.exp(mu+.55*math.sin(i*2.31+.7)+.2*math.cos(i*1.33))))
    singleton=[r for i,r in enumerate(hierarchy_rows) if not (r['JobRole']=='A' and i==1)]
    result=dict(ordinalRows=ordinal_rows,hierarchicalRows=hierarchy_rows,singletonRows=singleton,ordinal={},hierarchical={},singleton={})
    for prior in ['default','wide']:
        result['ordinal'][prior]=ordinal_reference(prior)
        result['hierarchical'][prior]=hierarchical_refined(hierarchy_rows,prior)
        print('hierarchical',prior,'verified',flush=True)
        result['singleton'][prior]=hierarchical_refined(singleton,prior)
        print('singleton',prior,'verified',flush=True)
    OUT.mkdir(exist_ok=True)
    (OUT/'advanced-reference.json').write_text(json.dumps(result,indent=2),encoding='utf8')
    print('Advanced references generated independently.',flush=True)


if __name__=='__main__':main()
