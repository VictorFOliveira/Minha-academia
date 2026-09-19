import React,{useEffect,useState} from 'react';
import { Download, FileText, KeyRound, Palette, Printer, RefreshCw, ShieldCheck, X } from 'lucide-react';

const API=import.meta.env.VITE_API_URL||'/api';
async function api(path,{token,...options}={}){
  const response=await fetch(API+path,{...options,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body.error||'Falha na requisição');
  return body;
}
const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100);
const dateBR=value=>value?new Date(value).toLocaleString('pt-BR'):'—';
function Header({title,subtitle,action}){return <div className="page-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>;}
function Modal({title,onClose,children}){return <div className="modal-backdrop"><div className="modal training-modal"><div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>{children}</div></div>;}

export function SecurityCenter({token,user}){
  const [status,setStatus]=useState(null),[setup,setSetup]=useState(null),[code,setCode]=useState(''),[recovery,setRecovery]=useState(null),[password,setPassword]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function load(){try{setStatus(await api('/security/mfa/status',{token}));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);
  async function start(){try{setSetup(await api('/security/mfa/setup',{token,method:'POST',body:'{}'}));setCode('');setRecovery(null);setError('');}catch(e){setError(e.message);}}
  async function confirm(e){e.preventDefault();try{const r=await api('/security/mfa/confirm',{token,method:'POST',body:JSON.stringify({code})});setRecovery(r.recoveryCodes);setSetup(null);setNotice('MFA ativado. Sua sessão atual será invalidada e o próximo login exigirá o segundo fator.');await load();}catch(err){setError(err.message);}}
  async function disable(e){e.preventDefault();try{await api('/security/mfa/disable',{token,method:'POST',body:JSON.stringify({password})});setPassword('');setNotice('MFA desativado. Faça login novamente quando a sessão for renovada.');await load();}catch(err){setError(err.message);}}
  return <>
    <Header title="Segurança" subtitle="MFA TOTP, códigos de recuperação e proteção da conta administrativa." action={<button className="ghost compact" onClick={load}><RefreshCw size={16}/> Atualizar</button>}/>
    {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
    <div className="security-grid">
      <section className="panel security-card">
        <div className="section-head"><div><p className="eyebrow">MFA</p><h3>Autenticador</h3></div><ShieldCheck/></div>
        <p>Conta: <b>{user.email}</b></p>
        <p>Status: <b>{status?.enabled?'Ativado':'Desativado'}</b></p>
        <p className="muted">Use Google Authenticator, Microsoft Authenticator, 1Password ou outro app compatível com TOTP.</p>
        {!status?.enabled&&<button className="primary" onClick={start}><KeyRound size={16}/> Configurar MFA</button>}
        {status?.enabled&&<form className="integration-form" onSubmit={disable}><label>Senha atual<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="ghost">Desativar MFA</button></form>}
      </section>
      <section className="panel security-card">
        <p className="eyebrow">POLÍTICA</p><h3>Conta administrativa</h3>
        <div className="automation-list"><span>✓ Sessão versionada: reset/MFA invalida tokens antigos</span><span>✓ Challenge MFA expira em 5 minutos</span><span>✓ Reset de senha de uso único</span><span>✓ Códigos de recuperação são armazenados somente como hash</span></div>
      </section>
    </div>
    {setup&&<Modal title="Configurar autenticador" onClose={()=>setSetup(null)}><div className="mfa-setup"><p>Adicione a conta no autenticador usando o segredo abaixo ou importe a URI TOTP.</p><code className="secret-code">{setup.secret}</code><textarea readOnly value={setup.otpauthUri}/><form className="form-grid" onSubmit={confirm}><label className="span-2">Código de 6 dígitos<input required inputMode="numeric" maxLength="6" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></label><button className="primary span-2">Confirmar e ativar</button></form></div></Modal>}
    {recovery&&<Modal title="Códigos de recuperação" onClose={()=>setRecovery(null)}><div className="recovery-box"><p>Guarde estes códigos em local seguro. Cada código funciona uma única vez.</p><div className="recovery-grid">{recovery.map(x=><code key={x}>{x}</code>)}</div><button className="primary" onClick={()=>navigator.clipboard?.writeText(recovery.join('\n'))}>Copiar códigos</button></div></Modal>}
  </>;
}

export function Reports({token,activeUnitId=''}) {
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[summary,setSummary]=useState(null),[payments,setPayments]=useState([]),[receipt,setReceipt]=useState(null),[error,setError]=useState('');
  const query=()=>{const p=new URLSearchParams();if(activeUnitId)p.set('unitId',activeUnitId);if(from)p.set('from',from);if(to)p.set('to',to);const s=p.toString();return s?'?'+s:'';};
  async function load(){try{const q=query();const [s,p]=await Promise.all([api('/reports/summary'+q,{token}),api('/reports/payments'+q,{token})]);setSummary(s);setPayments(p);setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[activeUnitId]);
  async function download(path,filename){
    try{
      const response=await fetch(API+path+query(),{headers:{authorization:'Bearer '+token}});
      if(!response.ok)throw new Error('Falha ao gerar relatório');
      const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    }catch(e){setError(e.message);}
  }
  async function showReceipt(id){try{setReceipt(await api('/reports/payments/'+id+'/receipt',{token}));}catch(e){setError(e.message);}}
  return <>
    <Header title="Relatórios e recibos" subtitle="Financeiro, presença, alunos e comprovantes de pagamento." action={<button className="ghost compact" onClick={load}><RefreshCw size={16}/> Atualizar</button>}/>
    {error&&<div className="error">{error}</div>}
    <div className="panel report-filters"><label>De<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Até<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button className="primary compact" onClick={load}>Aplicar período</button></div>
    {summary&&<div className="metrics"><div className="metric-card"><span>Receita</span><strong>{money(summary.revenueCents)}</strong><small>{summary.paymentsCount} pagamentos</small></div><div className="metric-card"><span>A receber</span><strong>{money(summary.receivableCents)}</strong><small>{summary.overdueCount} vencida(s)</small></div><div className="metric-card"><span>Check-ins</span><strong>{summary.checkins}</strong><small>{summary.uniqueStudents} alunos únicos</small></div><div className="metric-card"><span>Pagantes</span><strong>{summary.payingStudents}</strong><small>No período selecionado</small></div></div>}
    <div className="report-downloads"><button className="ghost" onClick={()=>download('/reports/financial.csv','financeiro.csv')}><Download size={16}/> Financeiro CSV</button><button className="ghost" onClick={()=>download('/reports/attendance.csv','presencas.csv')}><Download size={16}/> Presença CSV</button><button className="ghost" onClick={()=>download('/reports/students.csv','alunos.csv')}><Download size={16}/> Alunos CSV</button></div>
    <div className="table-card"><table><thead><tr><th>Pagamento</th><th>Aluno</th><th>Unidade</th><th>Data</th><th>Valor</th><th>Método</th><th></th></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td><b>{p.description}</b><small className="cell-sub">{p.provider}</small></td><td>{p.student_name}</td><td>{p.unit_name||'—'}</td><td>{dateBR(p.paid_at)}</td><td>{money(p.amount_cents)}</td><td>{p.method}</td><td><button className="ghost compact" onClick={()=>showReceipt(p.id)}><FileText size={14}/> Recibo</button></td></tr>)}</tbody></table></div>
    {receipt&&<Modal title={'Recibo '+receipt.receiptNumber} onClose={()=>setReceipt(null)}><div className="receipt-print"><div className="receipt-brand">{receipt.academy.branding?.logoUrl&&<img src={receipt.academy.branding.logoUrl} alt="Logo"/>}<div><h2>{receipt.academy.tradeName}</h2><p>{receipt.academy.legalName}{receipt.academy.cnpj?' · CNPJ '+receipt.academy.cnpj:''}</p></div></div><hr/><p>Recebemos de <b>{receipt.student.name}</b>{receipt.student.cpf?' · CPF '+receipt.student.cpf:''} a quantia de:</p><div className="receipt-value">{money(receipt.payment.amountCents)}</div><p><b>Referente a:</b> {receipt.payment.description}</p><p><b>Pagamento:</b> {dateBR(receipt.payment.paidAt)} · {receipt.payment.method} · {receipt.payment.provider}</p><p><b>Identificador:</b> {receipt.payment.id}</p><small>Recibo gerado eletronicamente pelo Minha Academia.</small></div><button className="primary" onClick={()=>window.print()}><Printer size={16}/> Imprimir / Salvar PDF</button></Modal>}
  </>;
}

export function TenantSettings({token}) {
  const [data,setData]=useState(null),[domains,setDomains]=useState([]),[form,setForm]=useState({tradeName:'',primaryColor:'#111827',accentColor:'#22c55e',logoUrl:''}),[domain,setDomain]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dns,setDns]=useState(null);
  async function load(){try{const [b,d]=await Promise.all([api('/settings/branding',{token}),api('/settings/domains',{token})]);setData(b);setDomains(d);setForm({tradeName:b.tradeName||'',primaryColor:b.branding.primaryColor,accentColor:b.branding.accentColor,logoUrl:b.branding.logoUrl||''});setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);
  async function save(e){e.preventDefault();try{await api('/settings/branding',{token,method:'PUT',body:JSON.stringify(form)});setNotice('Branding atualizado.');await load();}catch(err){setError(err.message);}}
  async function addDomain(e){e.preventDefault();try{const r=await api('/settings/domains',{token,method:'POST',body:JSON.stringify({domain})});setDns(r.dnsInstruction);setDomain('');setNotice('Domínio registrado. Publique o TXT indicado e depois valide.');await load();}catch(err){setError(err.message);}}
  async function verify(id){try{await api('/settings/domains/'+id+'/verify',{token,method:'POST',body:'{}'});setNotice('Domínio verificado e ativado.');await load();}catch(err){setError(err.message);}}
  return <>
    <Header title="Configurações da academia" subtitle="Marca, identidade visual e domínio personalizado." action={<button className="ghost compact" onClick={load}><RefreshCw size={16}/> Atualizar</button>}/>
    {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
    <div className="settings-grid">
      <section className="panel settings-card"><div className="section-head"><div><p className="eyebrow">BRANDING</p><h3>Identidade visual</h3></div><Palette/></div><form className="form-grid" onSubmit={save}><label className="span-2">Nome exibido<input required value={form.tradeName} onChange={e=>setForm({...form,tradeName:e.target.value})}/></label><label>Cor principal<input type="color" value={form.primaryColor} onChange={e=>setForm({...form,primaryColor:e.target.value})}/></label><label>Cor de destaque<input type="color" value={form.accentColor} onChange={e=>setForm({...form,accentColor:e.target.value})}/></label><label className="span-2">Logo HTTPS<input value={form.logoUrl} onChange={e=>setForm({...form,logoUrl:e.target.value})} placeholder="https://..."/></label><button className="primary span-2">Salvar branding</button></form></section>
      <section className="panel settings-card"><p className="eyebrow">DOMÍNIO</p><h3>Endereço personalizado</h3><p>Atual: <b>{data?.customDomain||'não configurado'}</b></p><form className="integration-form" onSubmit={addDomain}><label>Domínio<input required value={domain} onChange={e=>setDomain(e.target.value)} placeholder="app.academia.com.br"/></label><button className="primary">Adicionar domínio</button></form>{dns&&<div className="dns-box"><b>Publique este TXT no DNS:</b><code>{dns.name}</code><code>{dns.value}</code></div>}<div className="domain-list">{domains.map(d=><div key={d.id}><div><b>{d.domain}</b><small>{d.verified_at?'Verificado':'Aguardando TXT'}</small></div>{!d.verified_at&&<button className="ghost compact" onClick={()=>verify(d.id)}>Verificar DNS</button>}{d.active&&<span className="status positive">ATIVO</span>}</div>)}</div></section>
    </div>
  </>;
}
