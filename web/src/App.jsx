import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, BadgeDollarSign, Building2, CalendarDays, CheckCircle2, CreditCard,
  Dumbbell, LogOut, Menu, Plus, RefreshCw, Search, ShieldCheck, Users, X
} from 'lucide-react';
import { CoachDashboard, Coaches, Equipment, Exercises, Workouts } from './Training.jsx';

const API = import.meta.env.VITE_API_URL || '/api';
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
const unitQuery = unitId => unitId ? '?unitId=' + encodeURIComponent(unitId) : '';

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

function Dashboard({ token, activeUnitId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  async function load() {
    try { setData(await api('/dashboard' + unitQuery(activeUnitId), { token })); setError(''); }
    catch (e) { setError(e.message); }
  }
  useEffect(()=>{ load(); },[activeUnitId]);
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

function Students({ token, activeUnitId }) {
  const [rows,setRows]=useState([]), [query,setQuery]=useState(''), [open,setOpen]=useState(false), [error,setError]=useState('');
  const [form,setForm]=useState({name:'',cpf:'',email:'',phone:'',status:'ACTIVE'});
  async function load(){ try{setRows(await api('/students'+unitQuery(activeUnitId),{token}));setError('');}catch(e){setError(e.message);} }
  useEffect(()=>{load();},[]);
  const filtered=useMemo(()=>rows.filter(r=>[r.name,r.cpf,r.email,r.phone].join(' ').toLowerCase().includes(query.toLowerCase())),[rows,query]);
  async function create(e){
    e.preventDefault(); setError('');
    try{await api('/students',{token,method:'POST',body:JSON.stringify({...form,unitId:activeUnitId||undefined})});setOpen(false);setForm({name:'',cpf:'',email:'',phone:'',status:'ACTIVE'});await load();}
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

function Plans({token,units=[]}){
  const [rows,setRows]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState({name:'',description:'',price:'',billingInterval:'MONTHLY',accessScope:'PRIMARY_UNIT',unitIds:[]});
  async function load(){try{setRows(await api('/plans',{token}));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);
  async function create(e){e.preventDefault();try{await api('/plans',{token,method:'POST',body:JSON.stringify({...form,priceCents:Math.round(Number(form.price.replace(',','.'))*100)})});setOpen(false);setForm({name:'',description:'',price:'',billingInterval:'MONTHLY',accessScope:'PRIMARY_UNIT',unitIds:[]});await load();}catch(err){setError(err.message);}}
  return <>
    <Header title="Planos" subtitle="Produtos comerciais oferecidos aos alunos." action={<button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Novo plano</button>}/>
    {error&&<div className="error">{error}</div>}
    <div className="plan-grid">{rows.map(p=><div className="panel plan-card" key={p.id}><div><Status value={p.active?'ATIVO':'INATIVO'}/><h3>{p.name}</h3><p>{p.description||'Sem descrição'}</p></div><strong>{money(p.price_cents)} <small>/ {p.billing_interval.toLowerCase()}</small></strong><small>{p.access_scope==='ALL_UNITS'?'Toda a rede':p.access_scope==='SELECTED_UNITS'?(p.access_units||[]).map(u=>u.name).join(', '):'Unidade principal'}</small></div>)}</div>
    {!rows.length&&<Empty title="Sem planos cadastrados" subtitle="Crie o primeiro plano comercial."/>}
    {open&&<Modal title="Novo plano" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}>
      <label className="span-2">Nome<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label className="span-2">Descrição<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <label>Preço (R$)<input required inputMode="decimal" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/></label>
      <label>Ciclo<select value={form.billingInterval} onChange={e=>setForm({...form,billingInterval:e.target.value})}><option value="MONTHLY">Mensal</option><option value="QUARTERLY">Trimestral</option><option value="SEMIANNUAL">Semestral</option><option value="ANNUAL">Anual</option></select></label>
      <label>Acesso<select value={form.accessScope} onChange={e=>setForm({...form,accessScope:e.target.value,unitIds:[]})}><option value="PRIMARY_UNIT">Somente unidade principal</option><option value="SELECTED_UNITS">Unidades selecionadas</option><option value="ALL_UNITS">Toda a rede</option></select></label>
      {form.accessScope==='SELECTED_UNITS'&&<div className="span-2 unit-checks"><b>Unidades liberadas</b>{units.map(u=><label key={u.id}><input type="checkbox" checked={form.unitIds.includes(u.id)} onChange={()=>setForm({...form,unitIds:form.unitIds.includes(u.id)?form.unitIds.filter(x=>x!==u.id):[...form.unitIds,u.id]})}/>{u.name}</label>)}</div>}
      <button className="primary span-2">Criar plano</button>
    </form></Modal>}
  </>;
}

function Classes({token,activeUnitId}){
  const [rows,setRows]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState({name:'',modality:'',capacity:'',weekday:'1',startsAt:'18:00',endsAt:'19:00'});
  async function load(){try{setRows(await api('/classes'+unitQuery(activeUnitId),{token}));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);
  async function create(e){e.preventDefault();try{await api('/classes',{token,method:'POST',body:JSON.stringify({...form,capacity:form.capacity?Number(form.capacity):null,weekday:Number(form.weekday),unitId:activeUnitId||undefined})});setOpen(false);await load();}catch(err){setError(err.message);}}
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

function Attendance({token,activeUnitId}){
  const [students,setStudents]=useState([]),[classes,setClasses]=useState([]),[rows,setRows]=useState([]),[studentId,setStudentId]=useState(''),[classId,setClassId]=useState(''),[message,setMessage]=useState('');
  async function load(){
    const q=unitQuery(activeUnitId);const [s,c,a]=await Promise.all([api('/students'+q,{token}),api('/classes'+q,{token}),api('/attendance'+q,{token})]);
    setStudents(s.filter(x=>x.status==='ACTIVE'));setClasses(c.filter(x=>x.active));setRows(a);
  }
  useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);
  async function checkin(){
    setMessage('');
    try{
      await api('/attendance/check-in',{token,method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({studentId,classId:classId||null,source:'RECEPTION',unitId:activeUnitId||undefined})});
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
    <div className="table-card"><table><thead><tr><th>Aluno</th><th>Unidade</th><th>Turma</th><th>Origem</th><th>Entrada</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td><b>{r.student_name}</b></td><td>{r.unit_name||'—'}</td><td>{r.class_name||'Livre'}</td><td>{r.source}</td><td>{new Date(r.checkin_at).toLocaleString('pt-BR')}</td></tr>)}
    </tbody></table>{!rows.length&&<Empty title="Nenhum check-in" subtitle="As entradas aparecerão aqui."/>}</div>
  </>;
}

function Finance({token,activeUnitId}){
  const [rows,setRows]=useState([]),[summary,setSummary]=useState(null),[error,setError]=useState('');
  async function load(){try{const q=unitQuery(activeUnitId);const [c,s]=await Promise.all([api('/charges'+q,{token}),api('/financial/summary'+q,{token})]);setRows(c);setSummary(s);setError('');}catch(e){setError(e.message);}}
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



function Units({token,user,units,onRefresh}){
  const [open,setOpen]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState({name:'',neighborhood:'',city:'Fortaleza',state:'CE'});
  async function create(e){
    e.preventDefault();setError('');
    try{
      await api('/units',{token,method:'POST',body:JSON.stringify({name:form.name,address:{neighborhood:form.neighborhood,city:form.city,state:form.state}})});
      setOpen(false);setForm({name:'',neighborhood:'',city:'Fortaleza',state:'CE'});await onRefresh();
    }catch(err){setError(err.message);}
  }
  return <>
    <Header title="Unidades" subtitle="Filiais da mesma academia dentro do mesmo tenant." action={['OWNER','ADMIN'].includes(user.role)?<button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Nova unidade</button>:null}/>
    {error&&<div className="error">{error}</div>}
    <div className="unit-grid">{units.map(u=><div className="panel unit-card" key={u.id}><div className="unit-icon"><Building2/></div><div><Status value={u.active?'ACTIVE':'INACTIVE'}/><h3>{u.name}</h3><p>{[u.address?.neighborhood,u.address?.city,u.address?.state].filter(Boolean).join(' · ')||'Endereço não informado'}</p><div className="unit-numbers"><span><b>{u.active_students}</b> alunos ativos</span><span><b>{u.active_coaches}</b> professores</span></div></div></div>)}</div>
    {open&&<Modal title="Nova unidade" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}><label className="span-2">Nome<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Jardim Iracema"/></label><label>Bairro<input value={form.neighborhood} onChange={e=>setForm({...form,neighborhood:e.target.value})}/></label><label>Cidade<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></label><label>UF<input value={form.state} maxLength="2" onChange={e=>setForm({...form,state:e.target.value.toUpperCase()})}/></label><button className="primary span-2">Criar unidade</button></form></Modal>}
  </>;
}

function AccessControl({token,user,activeUnitId}){
  const [agents,setAgents]=useState([]),[credentials,setCredentials]=useState([]),[students,setStudents]=useState([]),[events,setEvents]=useState([]);
  const [policy,setPolicy]=useState({denyWithoutActiveEnrollment:true,blockOverdue:false,offlineCacheHours:72});
  const [agentOpen,setAgentOpen]=useState(false),[secret,setSecret]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [agentForm,setAgentForm]=useState({name:'Catraca Recepção',adapter:'GENERIC_HTTP'});
  const [credentialForm,setCredentialForm]=useState({studentId:'',credentialType:'RFID',credential:'',label:''});

  async function load(){
    try{
      const [a,c,s,e,p]=await Promise.all([
        api('/access/agents',{token}),
        api('/access/credentials',{token}),
        api('/students',{token}),
        api('/access/events'+unitQuery(activeUnitId),{token}),
        (activeUnitId||user.unitId)?api('/access/policy/'+(activeUnitId||user.unitId),{token}).catch(()=>null):Promise.resolve(null)
      ]);
      setAgents(a);setCredentials(c);setStudents(s.filter(x=>x.status==='ACTIVE'));setEvents(e);
      if(p)setPolicy({
        denyWithoutActiveEnrollment:p.deny_without_active_enrollment,
        blockOverdue:p.block_overdue,
        offlineCacheHours:p.offline_cache_hours
      });
      setError('');
    }catch(e){setError(e.message);}
  }
  useEffect(()=>{load();},[]);

  async function createAgent(e){
    e.preventDefault();setError('');setNotice('');
    try{
      const data=await api('/access/agents',{token,method:'POST',body:JSON.stringify({...agentForm,unitId:activeUnitId||user.unitId})});
      setSecret({id:data.agent.id,key:data.agentKey,name:data.agent.name});
      setAgentOpen(false);await load();
    }catch(err){setError(err.message);}
  }

  async function createCredential(e){
    e.preventDefault();setError('');setNotice('');
    try{
      await api('/access/credentials',{token,method:'POST',body:JSON.stringify(credentialForm)});
      setCredentialForm({studentId:'',credentialType:'RFID',credential:'',label:''});
      setNotice('Credencial vinculada ao aluno.');await load();
    }catch(err){setError(err.message);}
  }

  async function revoke(id){
    if(!confirm('Revogar esta credencial? A catraca bloqueará após a próxima sincronização.'))return;
    try{await api(`/access/credentials/${id}`,{token,method:'DELETE'});setNotice('Credencial revogada.');await load();}
    catch(err){setError(err.message);}
  }

  async function savePolicy(){
    const policyUnitId=activeUnitId||user.unitId;if(!policyUnitId)return setError('Selecione uma unidade.');
    try{
      await api('/access/policy/'+policyUnitId,{token,method:'PUT',body:JSON.stringify(policy)});
      setNotice('Política de acesso atualizada.');setError('');
    }catch(err){setError(err.message);}
  }

  return <>
    <Header title="Acesso e catracas" subtitle="Agentes locais, credenciais e eventos de entrada." action={<button className="primary compact" onClick={()=>setAgentOpen(true)}><Plus size={16}/> Novo agente</button>}/>
    {error&&<div className="error">{error}</div>}
    {notice&&<div className="success">{notice}</div>}
    {secret&&<div className="access-secret">
      <div><p className="eyebrow">CHAVE EXIBIDA UMA ÚNICA VEZ</p><h3>{secret.name}</h3><p>Copie o ID e a chave para o <code>access-agent/.env</code>. Ao fechar este aviso, a chave não poderá ser consultada novamente.</p></div>
      <label>AGENT_ID<input readOnly value={secret.id}/></label>
      <label>AGENT_KEY<input readOnly value={secret.key}/></label>
      <button className="ghost compact" onClick={()=>setSecret(null)}>Já copiei</button>
    </div>}

    <div className="access-grid">
      <section className="panel access-panel">
        <div className="section-head"><div><p className="eyebrow">AGENTES</p><h3>Computadores locais</h3></div><ShieldCheck size={23}/></div>
        <div className="stack-list">{agents.map(a=><div className="stack-row" key={a.id}>
          <div><b>{a.name}</b><small>{a.unit_name} · {a.adapter}</small></div>
          <div className="stack-side"><Status value={a.status}/><small>{a.last_seen_at?'online em '+new Date(a.last_seen_at).toLocaleString('pt-BR'):'ainda não conectou'}</small></div>
        </div>)}</div>
        {!agents.length&&<Empty title="Nenhum agente" subtitle="Cadastre o computador que ficará conectado à catraca."/>}
      </section>

      <section className="panel access-panel">
        <div className="section-head"><div><p className="eyebrow">POLÍTICA DA UNIDADE</p><h3>Regra de liberação</h3></div><Activity size={23}/></div>
        <div className="policy-form">
          <label className="toggle-row"><input type="checkbox" checked={policy.denyWithoutActiveEnrollment} onChange={e=>setPolicy({...policy,denyWithoutActiveEnrollment:e.target.checked})}/><span><b>Exigir matrícula ativa</b><small>Bloqueia aluno sem matrícula vigente.</small></span></label>
          <label className="toggle-row"><input type="checkbox" checked={policy.blockOverdue} onChange={e=>setPolicy({...policy,blockOverdue:e.target.checked})}/><span><b>Bloquear inadimplente</b><small>Considera cobrança vencida com saldo aberto.</small></span></label>
          <label>Validade máxima do cache offline (horas)<input type="number" min="1" max="168" value={policy.offlineCacheHours} onChange={e=>setPolicy({...policy,offlineCacheHours:Number(e.target.value)})}/></label>
          <button className="primary compact" onClick={savePolicy}>Salvar política</button>
        </div>
      </section>
    </div>

    <section className="panel access-panel credential-create">
      <div><p className="eyebrow">CREDENCIAIS</p><h3>Vincular RFID, QR, biometria ou PIN</h3><p>O valor é convertido em hash pelo servidor e não volta para o painel.</p></div>
      <form className="credential-form" onSubmit={createCredential}>
        <select required value={credentialForm.studentId} onChange={e=>setCredentialForm({...credentialForm,studentId:e.target.value})}>
          <option value="">Selecione o aluno</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}
        </select>
        <select value={credentialForm.credentialType} onChange={e=>setCredentialForm({...credentialForm,credentialType:e.target.value})}>
          <option value="RFID">RFID</option><option value="QR">QR</option><option value="BIOMETRIC">Biometria</option><option value="PIN">PIN</option>
        </select>
        <input required minLength="3" placeholder="Código lido/cadastrado" value={credentialForm.credential} onChange={e=>setCredentialForm({...credentialForm,credential:e.target.value})}/>
        <input placeholder="Identificação, ex.: pulseira azul" value={credentialForm.label} onChange={e=>setCredentialForm({...credentialForm,label:e.target.value})}/>
        <button className="primary compact"><Plus size={16}/> Vincular</button>
      </form>
    </section>

    <div className="table-card access-table">
      <table><thead><tr><th>Aluno</th><th>Tipo</th><th>Identificação</th><th>Status</th><th></th></tr></thead><tbody>
        {credentials.map(r=><tr key={r.id}><td><b>{r.student_name}</b></td><td>{r.credential_type}</td><td>{r.label||'—'}</td><td><Status value={r.active?'ACTIVE':'REVOKED'}/></td><td>{r.active&&<button className="icon-btn revoke" title="Revogar" onClick={()=>revoke(r.id)}><X size={16}/></button>}</td></tr>)}
      </tbody></table>{!credentials.length&&<Empty title="Sem credenciais" subtitle="Vincule uma credencial física a um aluno ativo."/>}
    </div>

    <Header title="Eventos recentes" subtitle="Tentativas registradas pelos agentes locais." action={<button className="ghost compact" onClick={load}><RefreshCw size={16}/> Atualizar</button>}/>
    <div className="table-card"><table><thead><tr><th>Aluno</th><th>Decisão</th><th>Motivo</th><th>Direção</th><th>Dispositivo</th><th>Horário</th></tr></thead><tbody>
      {events.map(r=><tr key={r.id}><td><b>{r.student_name||'Credencial desconhecida'}</b></td><td><Status value={r.decision==='GRANTED'?'ACTIVE':'DENIED'}/></td><td>{r.reason}</td><td>{r.direction}</td><td>{r.device_id||r.agent_name}</td><td>{new Date(r.occurred_at).toLocaleString('pt-BR')}</td></tr>)}
    </tbody></table>{!events.length&&<Empty title="Sem eventos de acesso" subtitle="As tentativas da catraca aparecerão aqui."/>}</div>

    {agentOpen&&<Modal title="Novo agente de acesso" onClose={()=>setAgentOpen(false)}><form className="form-grid" onSubmit={createAgent}>
      <label className="span-2">Nome<input required value={agentForm.name} onChange={e=>setAgentForm({...agentForm,name:e.target.value})} placeholder="Ex.: PC Recepção / Catraca Entrada"/></label>
      <label className="span-2">Protocolo<select value={agentForm.adapter} onChange={e=>setAgentForm({...agentForm,adapter:e.target.value})}><option value="GENERIC_HTTP">HTTP genérico</option><option value="GENERIC_TCP">TCP genérico</option></select></label>
      <button className="primary span-2">Criar e gerar chave</button>
    </form></Modal>}
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
  ['coach','Meu painel',Activity],
  ['units','Unidades',Building2],
  ['students','Alunos',Users],
  ['coaches','Professores',Users],
  ['plans','Planos',CreditCard],
  ['classes','Turmas',CalendarDays],
  ['attendance','Presença',CheckCircle2],
  ['equipment','Aparelhos',Dumbbell],
  ['exercises','Exercícios',Dumbbell],
  ['workouts','Treinos',Dumbbell],
  ['access','Acesso',ShieldCheck],
  ['finance','Financeiro',BadgeDollarSign]
];

const navByRole={
  OWNER:['dashboard','units','students','coaches','plans','classes','attendance','equipment','exercises','workouts','access','finance'],
  ADMIN:['dashboard','units','students','coaches','plans','classes','attendance','equipment','exercises','workouts','access','finance'],
  MANAGER:['dashboard','students','coaches','plans','classes','attendance','equipment','exercises','workouts','finance'],
  RECEPTION:['dashboard','students','classes','attendance','equipment','workouts'],
  COACH:['coach','students','classes','attendance','equipment','exercises','workouts'],
  FINANCE:['dashboard','students','plans','finance'],
  STUDENT:[]
};

export default function App(){
  const [session,setSession]=useState(()=>{try{return JSON.parse(localStorage.getItem('academia.session'))}catch{return null}});
  const [page,setPage]=useState(()=>{try{return JSON.parse(localStorage.getItem('academia.session'))?.user?.role==='COACH'?'coach':'dashboard'}catch{return 'dashboard'}});
  const [mobile,setMobile]=useState(false);
  const [units,setUnits]=useState([]);
  const [activeUnitId,setActiveUnitId]=useState('');

  async function loadUnits(currentSession=session){
    if(!currentSession?.token)return;
    try{
      const rows=await api('/units',{token:currentSession.token});
      setUnits(rows);
      if(currentSession.user.role==='COACH'&&rows.length&&!activeUnitId)setActiveUnitId(rows[0].id);
    }catch{}
  }
  useEffect(()=>{if(session)loadUnits(session);},[session?.token]);

  function login(data){localStorage.setItem('academia.session',JSON.stringify(data));setSession(data);setPage(data.user.role==='COACH'?'coach':'dashboard');setActiveUnitId('');}
  function logout(){localStorage.removeItem('academia.session');setSession(null);setUnits([]);setActiveUnitId('');}
  if(!session) return <Login onLogin={login}/>;

  const props={token:session.token,user:session.user,activeUnitId,units};
  const allowed=navByRole[session.user.role]||[];
  const visibleNav=nav.filter(([id])=>allowed.includes(id));
  const content={
    dashboard:<Dashboard {...props}/>,
    coach:<CoachDashboard {...props}/>,
    units:<Units {...props} onRefresh={()=>loadUnits(session)}/>,
    students:<Students {...props}/>,
    coaches:<Coaches {...props}/>,
    plans:<Plans {...props}/>,
    classes:<Classes {...props}/>,
    attendance:<Attendance {...props}/>,
    equipment:<Equipment {...props}/>,
    exercises:<Exercises {...props}/>,
    workouts:<Workouts {...props}/>,
    access:<AccessControl {...props}/>,
    finance:<Finance {...props}/>
  }[page] || <Dashboard {...props}/>;

  return <div className="app-shell">
    <aside className={mobile?'sidebar open':'sidebar'}>
      <div className="brand-row"><div className="brand-mark small"><Dumbbell size={21}/></div><div><b>Minha Academia</b><small>{session.user.tenantName}</small></div></div>
      <div className="unit-switch"><small>UNIDADE</small><select value={activeUnitId} onChange={e=>setActiveUnitId(e.target.value)}>{['OWNER','ADMIN'].includes(session.user.role)&&<option value="">Todas as unidades</option>}{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <nav>{visibleNav.map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>{setPage(id);setMobile(false)}}><Icon size={18}/>{label}</button>)}</nav>
      <div className="sidebar-user"><div><b>{session.user.name}</b><small>{session.user.role}</small></div><button className="icon-btn" onClick={logout} title="Sair"><LogOut size={17}/></button></div>
    </aside>
    <main>
      <div className="mobile-top"><button className="icon-btn" onClick={()=>setMobile(!mobile)}><Menu/></button><b>Minha Academia</b></div>
      <div className="content">{content}</div>
    </main>
  </div>;
}
