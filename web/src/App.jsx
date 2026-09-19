import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, BadgeDollarSign, CalendarDays, CheckCircle2, CreditCard,
  Dumbbell, LogOut, Menu, Plus, RefreshCw, Search, ShieldCheck, Users, X
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '/api';
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);

async function api(path, { token, ...options } = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Falha na requisição');
  return body;
}

function Login({ onLogin }) {
  const [tenant, setTenant] = useState('demo');
  const [email, setEmail] = useState('admin@minhaacademia.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ tenant, email, password }) });
      onLogin(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return <div className="login-shell">
    <section className="login-brand">
      <div className="brand-mark"><Dumbbell size={32} /></div>
      <p className="eyebrow">GESTÃO DE ACADEMIAS</p>
      <h1>Sua academia.<br/>Uma operação só.</h1>
      <p>Alunos, matrículas, presença, turmas e financeiro em uma plataforma SaaS preparada para crescer com a sua rede.</p>
      <div className="login-points">
        <span><ShieldCheck size={18}/> Dados isolados por academia</span>
        <span><Activity size={18}/> Operação em tempo real</span>
        <span><CreditCard size={18}/> Financeiro integrado</span>
      </div>
    </section>
    <form className="login-card" onSubmit={submit}>
      <div>
        <p className="eyebrow">BEM-VINDO</p>
        <h2>Entrar no painel</h2>
        <p className="muted">Use sua conta administrativa da academia.</p>
      </div>
      <label>Academia<input value={tenant} onChange={e=>setTenant(e.target.value)} placeholder="slug da academia" /></label>
      <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></label>
      <label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" /></label>
      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
      <p className="demo-hint">Ambiente local: senha <b>Academia@123</b></p>
    </form>
  </div>;
}

function Card({ icon: Icon, label, value, helper }) {
  return <div className="metric-card">
    <div className="metric-head"><span>{label}</span><Icon size={19}/></div>
    <strong>{value}</strong>
    <small>{helper}</small>
  </div>;
}

function Dashboard({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  async function load() {
    try { setData(await api('/dashboard', { token })); setError(''); }
    catch (e) { setError(e.message); }
  }
  useEffect(()=>{ load(); },[]);
  if (error) return <Empty title="Não foi possível carregar" subtitle={error} action={load}/>;
  if (!data) return <Loading/>;

  return <>
    <Header title="Visão geral" subtitle="Acompanhe sua operação de hoje." action={<button className="ghost" onClick={load}><RefreshCw size={16}/> Atualizar</button>} />
    <div className="metrics">
      <Card icon={Users} label="Alunos ativos" value={data.activeStudents} helper={`${data.leads} leads em acompanhamento`} />
      <Card icon={CheckCircle2} label="Check-ins hoje" value={data.checkinsToday} helper="Presenças registradas" />
      <Card icon={BadgeDollarSign} label="Receita no mês" value={money(data.revenueMonthCents)} helper="Pagamentos confirmados" />
      <Card icon={CreditCard} label="A receber" value={money(data.receivableCents)} helper={`${data.openCharges} cobranças abertas`} />
    </div>
    <div className="panel hero-panel">
      <div>
        <p className="eyebrow">OPERAÇÃO</p>
        <h3>Pronto para a rotina da recepção</h3>
        <p>Cadastre alunos, vincule planos, registre entrada e acompanhe as cobranças sem sair do painel.</p>
      </div>
      <Dumbbell size={72}/>
    </div>
  </>;
}

function Header({ title, subtitle, action }) {
  return <div className="page-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>;
}
function Loading(){ return <div className="loading"><RefreshCw className="spin" size={24}/> Carregando...</div>; }
function Empty({title,subtitle,action}){ return <div className="empty"><h3>{title}</h3><p>{subtitle}</p>{action&&<button className="ghost" onClick={action}>Tentar novamente</button>}</div>; }

function Students({ token }) {
  const [rows,setRows]=useState([]), [query,setQuery]=useState(''), [open,setOpen]=useState(false), [error,setError]=useState('');
  const [form,setForm]=useState({name:'',cpf:'',email:'',phone:'',status:'ACTIVE'});
  async function load(){ try{setRows(await api('/students',{token}));setError('');}catch(e){setError(e.message);} }
  useEffect(()=>{load();},[]);
  const filtered=useMemo(()=>rows.filter(r=>[r.name,r.cpf,r.email,r.phone].join(' ').toLowerCase().includes(query.toLowerCase())),[rows,query]);
  async function create(e){
    e.preventDefault(); setError('');
    try{await api('/students',{token,method:'POST',body:JSON.stringify(form)});setOpen(false);setForm({name:'',cpf:'',email:'',phone:'',status:'ACTIVE'});await load();}
    catch(err){setError(err.message);}
  }
  return <>
    <Header title="Alunos" subtitle="Cadastro e situação dos alunos da academia." action={<button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Novo aluno</button>}/>
    <div className="toolbar"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por nome, CPF, e-mail ou telefone"/></div>
    {error&&<div className="error">{error}</div>}
    <div className="table-card">
      <table><thead><tr><th>Aluno</th><th>Contato</th><th>CPF</th><th>Status</th><th>Unidade</th></tr></thead>
      <tbody>{filtered.map(r=><tr key={r.id}><td><b>{r.name}</b></td><td>{r.email||r.phone||'—'}</td><td>{r.cpf||'—'}</td><td><Status value={r.status}/></td><td>{r.unit_name||'—'}</td></tr>)}</tbody></table>
      {!filtered.length&&<Empty title="Nenhum aluno encontrado" subtitle="Cadastre o primeiro aluno ou ajuste sua busca."/>}
    </div>
    {open&&<Modal title="Novo aluno" onClose={()=>setOpen(false)}>
      <form className="form-grid" onSubmit={create}>
        <label className="span-2">Nome<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label>CPF<input value={form.cpf} onChange={e=>setForm({...form,cpf:e.target.value})}/></label>
        <label>Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option>ACTIVE</option><option>LEAD</option><option>PAUSED</option><option>INACTIVE</option></select></label>
        <label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
        <label>Telefone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
        <button className="primary span-2">Cadastrar aluno</button>
      </form>
    </Modal>}
  </>;
}

function Plans({token}){
  const [rows,setRows]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState({name:'',description:'',price:'',billingInterval:'MONTHLY'});
  async function load(){try{setRows(await api('/plans',{token}));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);
  async function create(e){e.preventDefault();try{await api('/plans',{token,method:'POST',body:JSON.stringify({...form,priceCents:Math.round(Number(form.price.replace(',','.'))*100)})});setOpen(false);setForm({name:'',description:'',price:'',billingInterval:'MONTHLY'});await load();}catch(err){setError(err.message);}}
  return <>
    <Header title="Planos" subtitle="Produtos comerciais oferecidos aos alunos." action={<button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Novo plano</button>}/>
    {error&&<div className="error">{error}</div>}
    <div className="plan-grid">{rows.map(p=><div className="panel plan-card" key={p.id}><div><Status value={p.active?'ATIVO':'INATIVO'}/><h3>{p.name}</h3><p>{p.description||'Sem descrição'}</p></div><strong>{money(p.price_cents)} <small>/ {p.billing_interval.toLowerCase()}</small></strong></div>)}</div>
    {!rows.length&&<Empty title="Sem planos cadastrados" subtitle="Crie o primeiro plano comercial."/>}
    {open&&<Modal title="Novo plano" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}>
      <label className="span-2">Nome<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label className="span-2">Descrição<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <label>Preço (R$)<input required inputMode="decimal" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/></label>
      <label>Ciclo<select value={form.billingInterval} onChange={e=>setForm({...form,billingInterval:e.target.value})}><option value="MONTHLY">Mensal</option><option value="QUARTERLY">Trimestral</option><option value="SEMIANNUAL">Semestral</option><option value="ANNUAL">Anual</option></select></label>
      <button className="primary span-2">Criar plano</button>
    </form></Modal>}
  </>;
}

function Classes({token}){
  const [rows,setRows]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState({name:'',modality:'',capacity:'',weekday:'1',startsAt:'18:00',endsAt:'19:00'});
  async function load(){try{setRows(await api('/classes',{token}));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);
  async function create(e){e.preventDefault();try{await api('/classes',{token,method:'POST',body:JSON.stringify({...form,capacity:form.capacity?Number(form.capacity):null,weekday:Number(form.weekday)})});setOpen(false);await load();}catch(err){setError(err.message);}}
  const day=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  return <>
    <Header title="Turmas e aulas" subtitle="Grade recorrente de atividades da academia." action={<button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Nova turma</button>}/>
    {error&&<div className="error">{error}</div>}
    <div className="table-card"><table><thead><tr><th>Turma</th><th>Modalidade</th><th>Dia</th><th>Horário</th><th>Capacidade</th><th>Professor</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td><b>{r.name}</b></td><td>{r.modality}</td><td>{r.weekday==null?'—':day[r.weekday]}</td><td>{r.starts_at?String(r.starts_at).slice(0,5):'—'} {r.ends_at?'– '+String(r.ends_at).slice(0,5):''}</td><td>{r.capacity||'—'}</td><td>{r.coach_name||'—'}</td></tr>)}
    </tbody></table>{!rows.length&&<Empty title="Sem turmas" subtitle="Cadastre a grade de aulas da academia."/>}</div>
    {open&&<Modal title="Nova turma" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}>
      <label>Nome<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>Modalidade<input required value={form.modality} onChange={e=>setForm({...form,modality:e.target.value})}/></label>
      <label>Dia<select value={form.weekday} onChange={e=>setForm({...form,weekday:e.target.value})}>{day.map((d,i)=><option value={i} key={d}>{d}</option>)}</select></label>
      <label>Capacidade<input type="number" min="1" value={form.capacity} onChange={e=>setForm({...form,capacity:e.target.value})}/></label>
      <label>Início<input type="time" value={form.startsAt} onChange={e=>setForm({...form,startsAt:e.target.value})}/></label>
      <label>Fim<input type="time" value={form.endsAt} onChange={e=>setForm({...form,endsAt:e.target.value})}/></label>
      <button className="primary span-2">Criar turma</button>
    </form></Modal>}
  </>;
}

function Attendance({token}){
  const [students,setStudents]=useState([]),[classes,setClasses]=useState([]),[rows,setRows]=useState([]),[studentId,setStudentId]=useState(''),[classId,setClassId]=useState(''),[message,setMessage]=useState('');
  async function load(){
    const [s,c,a]=await Promise.all([api('/students',{token}),api('/classes',{token}),api('/attendance',{token})]);
    setStudents(s.filter(x=>x.status==='ACTIVE'));setClasses(c.filter(x=>x.active));setRows(a);
  }
  useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);
  async function checkin(){
    setMessage('');
    try{
      await api('/attendance/check-in',{token,method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({studentId,classId:classId||null,source:'RECEPTION'})});
      setMessage('Check-in registrado com sucesso.'); await load();
    }catch(e){setMessage(e.message);}
  }
  return <>
    <Header title="Presença" subtitle="Check-in rápido da recepção e histórico recente."/>
    <div className="panel checkin-box"><div><p className="eyebrow">CHECK-IN</p><h3>Registrar entrada</h3></div>
      <select value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">Selecione o aluno</option>{students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Sem turma específica</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <button className="primary" disabled={!studentId} onClick={checkin}><CheckCircle2 size={17}/> Confirmar entrada</button>
    </div>
    {message&&<div className={message.includes('sucesso')?'success':'error'}>{message}</div>}
    <div className="table-card"><table><thead><tr><th>Aluno</th><th>Turma</th><th>Origem</th><th>Entrada</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td><b>{r.student_name}</b></td><td>{r.class_name||'Livre'}</td><td>{r.source}</td><td>{new Date(r.checkin_at).toLocaleString('pt-BR')}</td></tr>)}
    </tbody></table>{!rows.length&&<Empty title="Nenhum check-in" subtitle="As entradas aparecerão aqui."/>}</div>
  </>;
}

function Finance({token}){
  const [rows,setRows]=useState([]),[summary,setSummary]=useState(null),[error,setError]=useState('');
  async function load(){try{const [c,s]=await Promise.all([api('/charges',{token}),api('/financial/summary',{token})]);setRows(c);setSummary(s);setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);
  return <>
    <Header title="Financeiro" subtitle="Cobranças e recebimentos dos alunos." action={<button className="ghost" onClick={load}><RefreshCw size={16}/> Atualizar</button>}/>
    {error&&<div className="error">{error}</div>}
    {summary&&<div className="metrics metrics-3"><Card icon={BadgeDollarSign} label="Cobrado" value={money(summary.totalChargedCents)} helper="Total gerado"/><Card icon={CheckCircle2} label="Recebido" value={money(summary.totalPaidCents)} helper="Pagamentos registrados"/><Card icon={CreditCard} label="A receber" value={money(summary.receivableCents)} helper="Saldo em aberto"/></div>}
    <div className="table-card"><table><thead><tr><th>Aluno</th><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Status</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td><b>{r.student_name}</b></td><td>{r.description}</td><td>{String(r.due_date).slice(0,10).split('-').reverse().join('/')}</td><td>{money(r.amount_cents)}</td><td>{money(r.paid_cents)}</td><td><Status value={r.status}/></td></tr>)}
    </tbody></table>{!rows.length&&<Empty title="Nenhuma cobrança" subtitle="As mensalidades e cobranças geradas aparecerão aqui."/>}</div>
  </>;
}

function Status({value}){
  const positive=['ACTIVE','PAID','ATIVO'].includes(value);
  const warning=['LEAD','PENDING','PARTIAL','PAUSED'].includes(value);
  return <span className={`status ${positive?'positive':warning?'warning':'neutral'}`}>{value}</span>;
}
function Modal({title,onClose,children}){return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={19}/></button></div>{children}</div></div>;}

const nav=[
  ['dashboard','Visão geral',Activity],
  ['students','Alunos',Users],
  ['plans','Planos',CreditCard],
  ['classes','Turmas',CalendarDays],
  ['attendance','Presença',CheckCircle2],
  ['finance','Financeiro',BadgeDollarSign]
];

export default function App(){
  const [session,setSession]=useState(()=>{try{return JSON.parse(localStorage.getItem('academia.session'))}catch{return null}});
  const [page,setPage]=useState('dashboard');
  const [mobile,setMobile]=useState(false);

  function login(data){localStorage.setItem('academia.session',JSON.stringify(data));setSession(data);}
  function logout(){localStorage.removeItem('academia.session');setSession(null);}
  if(!session) return <Login onLogin={login}/>;

  const props={token:session.token};
  const content={
    dashboard:<Dashboard {...props}/>,students:<Students {...props}/>,plans:<Plans {...props}/>,
    classes:<Classes {...props}/>,attendance:<Attendance {...props}/>,finance:<Finance {...props}/>
  }[page];

  return <div className="app-shell">
    <aside className={mobile?'sidebar open':'sidebar'}>
      <div className="brand-row"><div className="brand-mark small"><Dumbbell size={21}/></div><div><b>Minha Academia</b><small>{session.user.tenantName}</small></div></div>
      <nav>{nav.map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>{setPage(id);setMobile(false)}}><Icon size={18}/>{label}</button>)}</nav>
      <div className="sidebar-user"><div><b>{session.user.name}</b><small>{session.user.role}</small></div><button className="icon-btn" onClick={logout} title="Sair"><LogOut size={17}/></button></div>
    </aside>
    <main>
      <div className="mobile-top"><button className="icon-btn" onClick={()=>setMobile(!mobile)}><Menu/></button><b>Minha Academia</b></div>
      <div className="content">{content}</div>
    </main>
  </div>;
}
