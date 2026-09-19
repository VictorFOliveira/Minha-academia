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
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[mfaToken,setMfaToken]=useState(''),[code,setCode]=useState(''),[error,setError]=useState('');
  async function submit(e){
    e.preventDefault();setError('');
    try{
      if(mfaToken){
        const data=await api('/platform/auth/mfa',{method:'POST',body:JSON.stringify({mfaToken,code})});
        onLogin(data);
      }else{
        const data=await api('/platform/auth/login',{method:'POST',body:JSON.stringify({email,password})});
        if(data.mfaRequired)setMfaToken(data.mfaToken);else onLogin(data);
      }
    }catch(err){setError(err.message);}
  }
  return <div className="platform-login">
    <div className="platform-login-brand"><ShieldCheck size={42}/><p className="eyebrow">MINHA ACADEMIA · PLATFORM</p><h1>Superadmin</h1><p>Onboarding, cobrança SaaS, uso e situação das academias clientes.</p></div>
    <form className="login-card" onSubmit={submit}><h2>{mfaToken?'Verificação em duas etapas':'Entrar na plataforma'}</h2>{!mfaToken&&<><label>E-mail<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Senha<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label></>}{mfaToken&&<label>Código MFA<input autoFocus value={code} onChange={e=>setCode(e.target.value)} placeholder="123456 ou recuperação"/></label>}{error&&<div className="error">{error}</div>}<button className="primary">{mfaToken?'Validar código':'Entrar'}</button>{mfaToken&&<button type="button" className="link-button" onClick={()=>{setMfaToken('');setCode('')}}>Cancelar</button>}</form>
  </div>;
}

export default function PlatformApp(){
  const [session,setSession]=useState(()=>{try{return JSON.parse(localStorage.getItem('academia.platform.session'))}catch{return null}});
  const [tenants,setTenants]=useState([]),[products,setProducts]=useState([]),[productPrices,setProductPrices]=useState({}),[invoices,setInvoices]=useState([]),[mfaStatus,setMfaStatus]=useState(null),[mfaSetup,setMfaSetup]=useState(null),[mfaCode,setMfaCode]=useState(''),[recovery,setRecovery]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[open,setOpen]=useState(false),[selected,setSelected]=useState(null),[usage,setUsage]=useState(null);
  const [form,setForm]=useState({tradeName:'',legalName:'',slug:'',cnpj:'',ownerName:'',ownerEmail:'',ownerPassword:'',unitName:'Unidade Principal',saasPlan:'STARTER'});

  function login(data){localStorage.setItem('academia.platform.session',JSON.stringify(data));setSession(data);}
  function logout(){localStorage.removeItem('academia.platform.session');setSession(null);}
  async function load(){
    try{
      const [t,p,i,m]=await Promise.all([
        api('/platform/tenants',{token:session.token}),
        api('/platform/products',{token:session.token}),
        api('/platform/billing/invoices',{token:session.token}),
        api('/platform/security/mfa/status',{token:session.token})
      ]);
      setTenants(t);setProducts(p);setProductPrices(Object.fromEntries(p.map(x=>[x.code,x.price_cents==null?'':String(Number(x.price_cents)/100)])));setInvoices(i);setMfaStatus(m);setError('');
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
  async function generateInvoices(){
    try{const r=await api('/platform/billing/generate',{token:session.token,method:'POST',body:'{}'});setNotice(r.created+' fatura(s) SaaS criada(s).');await load();}catch(err){setError(err.message);}
  }
  async function sendInvoice(id){
    try{const r=await api('/platform/billing/invoices/'+id+'/asaas',{token:session.token,method:'POST',body:'{}'});setNotice('Fatura enviada ao Asaas.');await load();if(r.invoice_url&&confirm('Abrir cobrança?'))window.open(r.invoice_url,'_blank','noopener,noreferrer');}catch(err){setError(err.message);}
  }
  async function saveProductPrice(code){
    try{
      const value=productPrices[code];
      const priceCents=value===''?null:Math.round(Number(String(value).replace(',','.'))*100);
      await api('/platform/products/'+code,{token:session.token,method:'PUT',body:JSON.stringify({priceCents})});
      setNotice('Preço do plano '+code+' atualizado.');await load();
    }catch(err){setError(err.message);}
  }
  async function provisionPlatformWebhook(){
    try{
      const r=await api('/platform/billing/asaas/provision-webhook',{token:session.token,method:'POST',body:'{}'});
      setNotice((r.existing?'Webhook já existente: ':'Webhook criado: ')+r.url);
    }catch(err){setError(err.message);}
  }
  async function startMfa(){
    try{setMfaSetup(await api('/platform/security/mfa/setup',{token:session.token,method:'POST',body:'{}'}));setMfaCode('');}catch(err){setError(err.message);}
  }
  async function confirmMfa(e){
    e.preventDefault();
    try{const r=await api('/platform/security/mfa/confirm',{token:session.token,method:'POST',body:JSON.stringify({code:mfaCode})});setRecovery(r.recoveryCodes);setMfaSetup(null);setMfaStatus({enabled:true});setNotice('MFA do Superadmin ativado. A sessão atual foi invalidada; faça login novamente após guardar os códigos.');}catch(err){setError(err.message);}
  }

  if(!session)return <PlatformLogin onLogin={login}/>;
  const active=tenants.filter(x=>!['SUSPENDED','CANCELED'].includes(x.billing_status)).length;
  return <div className="platform-shell">
    <header className="platform-top"><div><p className="eyebrow">MINHA ACADEMIA PLATFORM</p><h2>Superadmin</h2></div><div className="platform-user"><span>{session.user.name}</span>{!mfaStatus?.enabled&&<button className="ghost compact" onClick={startMfa}><ShieldCheck size={15}/> Ativar MFA</button>}<button className="ghost compact" onClick={logout}><LogOut size={15}/> Sair</button></div></header>
    <main className="platform-content">
      <div className="page-header"><div><h2>Academias clientes</h2><p>Provisionamento e assinatura sem compartilhar privilégios com o tenant.</p></div><div className="header-actions"><button className="ghost compact" onClick={load}><RefreshCw size={16}/> Atualizar</button><button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Nova academia</button></div></div>
      {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
      <div className="metrics metrics-3"><div className="metric-card"><div className="metric-head"><span>Tenants</span><Building2 size={18}/></div><strong>{tenants.length}</strong><small>Total provisionado</small></div><div className="metric-card"><div className="metric-head"><span>Operacionais</span><ShieldCheck size={18}/></div><strong>{active}</strong><small>Trial/Active/Overdue</small></div><div className="metric-card"><div className="metric-head"><span>Alunos</span><Users size={18}/></div><strong>{tenants.reduce((s,x)=>s+Number(x.students||0),0)}</strong><small>Nos tenants cadastrados</small></div></div>

      <div className="platform-layout">
        <section className="table-card"><table><thead><tr><th>Academia</th><th>Plano</th><th>Status</th><th>Unidades</th><th>Alunos</th><th>Professores</th></tr></thead><tbody>{tenants.map(t=><tr key={t.id} onClick={()=>inspect(t)} className={selected?.id===t.id?'selected-row':''}><td><b>{t.trade_name}</b><small className="cell-sub">{t.slug}</small></td><td>{t.saas_plan}</td><td><Status value={t.billing_status}/></td><td>{t.units}</td><td>{t.students}</td><td>{t.coaches}</td></tr>)}</tbody></table></section>
        <aside className="panel platform-detail">{selected&&usage?<><p className="eyebrow">TENANT</p><h3>{selected.trade_name}</h3><p>{selected.legal_name}</p><div className="usage-list"><span><b>Unidades</b>{usage.usage.units} / {usage.limits.units??'∞'}</span><span><b>Alunos</b>{usage.usage.students} / {usage.limits.students??'∞'}</span><span><b>Professores</b>{usage.usage.coaches} / {usage.limits.coaches??'∞'}</span><span><b>Agentes</b>{usage.usage.accessAgents} / {usage.limits.accessAgents??'∞'}</span></div><label>Plano<select value={usage.plan} onChange={e=>updateSubscription(e.target.value,usage.billingStatus)}>{products.map(p=><option key={p.code} value={p.code}>{p.name}</option>)}</select></label><label>Status<select value={usage.billingStatus} onChange={e=>updateSubscription(usage.plan,e.target.value)}><option>TRIAL</option><option>ACTIVE</option><option>OVERDUE</option><option>SUSPENDED</option><option>CANCELED</option></select></label></>:<div className="empty"><CreditCard size={32}/><h3>Selecione uma academia</h3><p>Veja uso, limite e assinatura.</p></div>}</aside>
      </div>

      <div className="page-header platform-products-title"><div><h2>Faturamento do SaaS</h2><p>Mensalidades cobradas das academias clientes.</p></div><div className="header-actions"><button className="ghost compact" onClick={provisionPlatformWebhook}><ShieldCheck size={16}/> Provisionar webhook Asaas</button><button className="primary compact" onClick={generateInvoices}><RefreshCw size={16}/> Gerar ciclo mensal</button></div></div>
      <div className="table-card platform-invoices"><table><thead><tr><th>Academia</th><th>Plano</th><th>Ciclo</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Provider</th><th></th></tr></thead><tbody>{invoices.map(i=><tr key={i.id}><td><b>{i.trade_name}</b><small className="cell-sub">{i.slug}</small></td><td>{i.product_code}</td><td>{i.cycle_key}</td><td>{String(i.due_date).slice(0,10).split('-').reverse().join('/')}</td><td>{money(i.amount_cents)}</td><td><Status value={i.status}/></td><td>{i.provider}</td><td><div className="platform-invoice-actions">{i.invoice_url&&<button className="ghost compact" onClick={()=>window.open(i.invoice_url,'_blank','noopener,noreferrer')}>Abrir</button>}{i.status!=='PAID'&&i.provider!=='ASAAS'&&<button className="primary compact" onClick={()=>sendInvoice(i.id)}>Enviar Asaas</button>}</div></td></tr>)}</tbody></table>{!invoices.length&&<div className="empty"><h3>Sem faturas SaaS</h3><p>Defina preços nos planos e gere o primeiro ciclo.</p></div>}</div>

      <div className="page-header platform-products-title"><div><h2>Planos SaaS</h2><p>Limites efetivamente aplicados pela API.</p></div></div>
      <div className="plan-grid">{products.map(p=><div className="panel plan-card" key={p.code}><div><Status value={p.active?'ACTIVE':'INACTIVE'}/><h3>{p.name}</h3><p>{p.max_units??'∞'} unidade(s) · {p.max_students??'∞'} alunos · {p.max_coaches??'∞'} professores</p></div><strong>{money(p.price_cents)}</strong><div className="platform-plan-price"><input inputMode="decimal" value={productPrices[p.code]??''} onChange={e=>setProductPrices({...productPrices,[p.code]:e.target.value})} placeholder="Preço mensal R$"/><button className="ghost compact" onClick={()=>saveProductPrice(p.code)}>Salvar preço</button></div></div>)}</div>
    </main>

    {mfaSetup&&<Modal title="Configurar MFA do Superadmin" onClose={()=>setMfaSetup(null)}><div className="mfa-setup"><p>Adicione no autenticador e confirme um código.</p><code className="secret-code">{mfaSetup.secret}</code><textarea readOnly value={mfaSetup.otpauthUri}/><form className="form-grid" onSubmit={confirmMfa}><label className="span-2">Código<input required value={mfaCode} maxLength="6" onChange={e=>setMfaCode(e.target.value.replace(/\D/g,''))}/></label><button className="primary span-2">Ativar MFA</button></form></div></Modal>}
    {recovery&&<Modal title="Códigos de recuperação do Superadmin" onClose={()=>setRecovery(null)}><div className="recovery-box"><p>Guarde estes códigos fora do sistema.</p><div className="recovery-grid">{recovery.map(x=><code key={x}>{x}</code>)}</div><button className="primary" onClick={()=>navigator.clipboard?.writeText(recovery.join('\n'))}>Copiar</button></div></Modal>}
    {open&&<Modal title="Onboarding de academia" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={createTenant}><label>Nome fantasia<input required value={form.tradeName} onChange={e=>setForm({...form,tradeName:e.target.value})}/></label><label>Razão social<input value={form.legalName} onChange={e=>setForm({...form,legalName:e.target.value})}/></label><label>Slug<input required value={form.slug} onChange={e=>setForm({...form,slug:e.target.value.toLowerCase()})} placeholder="power-fit"/></label><label>CNPJ<input value={form.cnpj} onChange={e=>setForm({...form,cnpj:e.target.value})}/></label><label>Unidade inicial<input required value={form.unitName} onChange={e=>setForm({...form,unitName:e.target.value})}/></label><label>Plano<select value={form.saasPlan} onChange={e=>setForm({...form,saasPlan:e.target.value})}>{products.map(p=><option key={p.code} value={p.code}>{p.name}</option>)}</select></label><label>Proprietário<input required value={form.ownerName} onChange={e=>setForm({...form,ownerName:e.target.value})}/></label><label>E-mail proprietário<input required type="email" value={form.ownerEmail} onChange={e=>setForm({...form,ownerEmail:e.target.value})}/></label><label className="span-2">Senha inicial<input required minLength="8" type="password" value={form.ownerPassword} onChange={e=>setForm({...form,ownerPassword:e.target.value})}/></label><button className="primary span-2">Criar academia e iniciar trial</button></form></Modal>}
  </div>;
}
