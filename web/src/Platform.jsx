import React,{useEffect,useState} from 'react';
import { Building2, CreditCard, LogOut, Plus, RefreshCw, ShieldCheck, Users, X } from 'lucide-react';

const API=import.meta.env.VITE_API_URL||'/api';
async function api(path,{token,...options}={}){
  const response=await fetch(API+path,{...options,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Falha na requisição');
  return body;
}
const money=cents=>cents==null?'Preço a definir':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents)/100);
function Status({value}){const positive=['ACTIVE','TRIAL'].includes(value);const warning=['OVERDUE'].includes(value);return <span className={'status '+(positive?'positive':warning?'warning':'neutral')}>{value}</span>;}
function Modal({title,onClose,children}){return <div className="modal-backdrop"><div className="modal training-modal"><div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>{children}</div></div>;}

function PlatformLogin({onLogin}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
  async function submit(e){e.preventDefault();try{const data=await api('/platform/auth/login',{method:'POST',body:JSON.stringify({email,password})});onLogin(data);}catch(err){setError(err.message);}}
  return <div className="platform-login">
    <div className="platform-login-brand"><ShieldCheck size={42}/><p className="eyebrow">MINHA ACADEMIA · PLATFORM</p><h1>Superadmin</h1><p>Onboarding, planos SaaS, uso e situação das academias clientes.</p></div>
    <form className="login-card" onSubmit={submit}><h2>Entrar na plataforma</h2><label>E-mail<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Senha<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="error">{error}</div>}<button className="primary">Entrar</button></form>
  </div>;
}

export default function PlatformApp(){
  const [session,setSession]=useState(()=>{try{return JSON.parse(localStorage.getItem('academia.platform.session'))}catch{return null}});
  const [tenants,setTenants]=useState([]),[products,setProducts]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[open,setOpen]=useState(false),[selected,setSelected]=useState(null),[usage,setUsage]=useState(null);
  const [form,setForm]=useState({tradeName:'',legalName:'',slug:'',cnpj:'',ownerName:'',ownerEmail:'',ownerPassword:'',unitName:'Unidade Principal',saasPlan:'STARTER'});

  function login(data){localStorage.setItem('academia.platform.session',JSON.stringify(data));setSession(data);}
  function logout(){localStorage.removeItem('academia.platform.session');setSession(null);}
  async function load(){
    try{
      const [t,p]=await Promise.all([api('/platform/tenants',{token:session.token}),api('/platform/products',{token:session.token})]);
      setTenants(t);setProducts(p);setError('');
    }catch(err){setError(err.message);}
  }
  useEffect(()=>{if(session)load();},[session?.token]);

  async function createTenant(e){
    e.preventDefault();setError('');setNotice('');
    try{await api('/platform/tenants',{token:session.token,method:'POST',body:JSON.stringify(form)});setOpen(false);setForm({tradeName:'',legalName:'',slug:'',cnpj:'',ownerName:'',ownerEmail:'',ownerPassword:'',unitName:'Unidade Principal',saasPlan:'STARTER'});setNotice('Academia criada com trial de 14 dias.');await load();}catch(err){setError(err.message);}
  }
  async function inspect(tenant){
    try{setSelected(tenant);setUsage(await api('/platform/tenants/'+tenant.id+'/usage',{token:session.token}));}catch(err){setError(err.message);}
  }
  async function updateSubscription(plan,status){
    try{
      await api('/platform/tenants/'+selected.id+'/subscription',{token:session.token,method:'POST',body:JSON.stringify({plan,status})});
      setNotice('Assinatura atualizada.');await load();const next=tenants.find(x=>x.id===selected.id)||selected;await inspect(next);
    }catch(err){setError(err.message);}
  }

  if(!session)return <PlatformLogin onLogin={login}/>;
  const active=tenants.filter(x=>!['SUSPENDED','CANCELED'].includes(x.billing_status)).length;
  return <div className="platform-shell">
    <header className="platform-top"><div><p className="eyebrow">MINHA ACADEMIA PLATFORM</p><h2>Superadmin</h2></div><div className="platform-user"><span>{session.user.name}</span><button className="ghost compact" onClick={logout}><LogOut size={15}/> Sair</button></div></header>
    <main className="platform-content">
      <div className="page-header"><div><h2>Academias clientes</h2><p>Provisionamento e assinatura sem compartilhar privilégios com o tenant.</p></div><div className="header-actions"><button className="ghost compact" onClick={load}><RefreshCw size={16}/> Atualizar</button><button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Nova academia</button></div></div>
      {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
      <div className="metrics metrics-3"><div className="metric-card"><div className="metric-head"><span>Tenants</span><Building2 size={18}/></div><strong>{tenants.length}</strong><small>Total provisionado</small></div><div className="metric-card"><div className="metric-head"><span>Operacionais</span><ShieldCheck size={18}/></div><strong>{active}</strong><small>Trial/Active/Overdue</small></div><div className="metric-card"><div className="metric-head"><span>Alunos</span><Users size={18}/></div><strong>{tenants.reduce((s,x)=>s+Number(x.students||0),0)}</strong><small>Nos tenants cadastrados</small></div></div>

      <div className="platform-layout">
        <section className="table-card"><table><thead><tr><th>Academia</th><th>Plano</th><th>Status</th><th>Unidades</th><th>Alunos</th><th>Professores</th></tr></thead><tbody>{tenants.map(t=><tr key={t.id} onClick={()=>inspect(t)} className={selected?.id===t.id?'selected-row':''}><td><b>{t.trade_name}</b><small className="cell-sub">{t.slug}</small></td><td>{t.saas_plan}</td><td><Status value={t.billing_status}/></td><td>{t.units}</td><td>{t.students}</td><td>{t.coaches}</td></tr>)}</tbody></table></section>
        <aside className="panel platform-detail">{selected&&usage?<><p className="eyebrow">TENANT</p><h3>{selected.trade_name}</h3><p>{selected.legal_name}</p><div className="usage-list"><span><b>Unidades</b>{usage.usage.units} / {usage.limits.units??'∞'}</span><span><b>Alunos</b>{usage.usage.students} / {usage.limits.students??'∞'}</span><span><b>Professores</b>{usage.usage.coaches} / {usage.limits.coaches??'∞'}</span><span><b>Agentes</b>{usage.usage.accessAgents} / {usage.limits.accessAgents??'∞'}</span></div><label>Plano<select value={usage.plan} onChange={e=>updateSubscription(e.target.value,usage.billingStatus)}>{products.map(p=><option key={p.code} value={p.code}>{p.name}</option>)}</select></label><label>Status<select value={usage.billingStatus} onChange={e=>updateSubscription(usage.plan,e.target.value)}><option>TRIAL</option><option>ACTIVE</option><option>OVERDUE</option><option>SUSPENDED</option><option>CANCELED</option></select></label></>:<div className="empty"><CreditCard size={32}/><h3>Selecione uma academia</h3><p>Veja uso, limite e assinatura.</p></div>}</aside>
      </div>

      <div className="page-header platform-products-title"><div><h2>Planos SaaS</h2><p>Limites efetivamente aplicados pela API.</p></div></div>
      <div className="plan-grid">{products.map(p=><div className="panel plan-card" key={p.code}><div><Status value={p.active?'ACTIVE':'INACTIVE'}/><h3>{p.name}</h3><p>{p.max_units??'∞'} unidade(s) · {p.max_students??'∞'} alunos · {p.max_coaches??'∞'} professores</p></div><strong>{money(p.price_cents)}</strong></div>)}</div>
    </main>

    {open&&<Modal title="Onboarding de academia" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={createTenant}><label>Nome fantasia<input required value={form.tradeName} onChange={e=>setForm({...form,tradeName:e.target.value})}/></label><label>Razão social<input value={form.legalName} onChange={e=>setForm({...form,legalName:e.target.value})}/></label><label>Slug<input required value={form.slug} onChange={e=>setForm({...form,slug:e.target.value.toLowerCase()})} placeholder="power-fit"/></label><label>CNPJ<input value={form.cnpj} onChange={e=>setForm({...form,cnpj:e.target.value})}/></label><label>Unidade inicial<input required value={form.unitName} onChange={e=>setForm({...form,unitName:e.target.value})}/></label><label>Plano<select value={form.saasPlan} onChange={e=>setForm({...form,saasPlan:e.target.value})}>{products.map(p=><option key={p.code} value={p.code}>{p.name}</option>)}</select></label><label>Proprietário<input required value={form.ownerName} onChange={e=>setForm({...form,ownerName:e.target.value})}/></label><label>E-mail proprietário<input required type="email" value={form.ownerEmail} onChange={e=>setForm({...form,ownerEmail:e.target.value})}/></label><label className="span-2">Senha inicial<input required minLength="8" type="password" value={form.ownerPassword} onChange={e=>setForm({...form,ownerPassword:e.target.value})}/></label><button className="primary span-2">Criar academia e iniciar trial</button></form></Modal>}
  </div>;
}
