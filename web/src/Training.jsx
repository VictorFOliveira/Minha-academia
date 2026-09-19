import React, { useEffect, useState } from 'react';
import { Activity, CalendarDays, Dumbbell, Plus, RefreshCw, Users, X } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '/api';

async function api(path, { token, ...options } = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Falha na requisição');
  return body;
}

function Header({ title, subtitle, action }) {
  return <div className="page-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>;
}
function Empty({ title, subtitle }) {
  return <div className="empty"><h3>{title}</h3><p>{subtitle}</p></div>;
}
function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop"><div className="modal training-modal">
    <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={19}/></button></div>
    {children}
  </div></div>;
}
function Status({ value }) {
  const positive = ['ACTIVE','ATIVO'].includes(value);
  const warning = ['PAUSED','PENDING'].includes(value);
  return <span className={'status ' + (positive ? 'positive' : warning ? 'warning' : 'neutral')}>{value}</span>;
}
function Metric({ icon: Icon, label, value, helper }) {
  return <div className="metric-card"><div className="metric-head"><span>{label}</span><Icon size={19}/></div><strong>{value}</strong><small>{helper}</small></div>;
}
const dateBR = value => value ? String(value).slice(0,10).split('-').reverse().join('/') : 'Sem vencimento';
const unitParam = unitId => unitId ? '?unitId=' + encodeURIComponent(unitId) : '';

export function CoachDashboard({ token, user }) {
  const [data,setData]=useState(null),[error,setError]=useState('');
  async function load(){try{setData(await api('/training/coach/dashboard',{token}));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);
  if(error)return <Empty title="Não foi possível carregar o portal" subtitle={error}/>;
  if(!data)return <div className="loading"><RefreshCw className="spin" size={24}/> Carregando...</div>;
  return <>
    <Header title={'Olá, ' + user.name} subtitle="Seu painel de acompanhamento e prescrição de treinos." action={<button className="ghost compact" onClick={load}><RefreshCw size={16}/> Atualizar</button>}/>
    <div className="metrics">
      <Metric icon={Users} label="Meus alunos" value={data.assignedStudents} helper="Alunos com acompanhamento"/>
      <Metric icon={CalendarDays} label="Minhas turmas" value={data.activeClasses} helper="Turmas ativas"/>
      <Metric icon={Dumbbell} label="Treinos ativos" value={data.activeWorkouts} helper="Fichas sob acompanhamento"/>
      <Metric icon={Activity} label="Vencendo em 7 dias" value={data.workoutsExpiringSoon} helper="Treinos para reavaliar"/>
    </div>
    <div className="panel coach-hero"><div><p className="eyebrow">PORTAL DO PROFESSOR</p><h3>Prescrição com histórico, não sobrescrita.</h3><p>Cada alteração gera nova versão com professor, data, validade, duração e exercícios daquela fase.</p></div><Dumbbell size={68}/></div>
  </>;
}

export function Coaches({ token, user, units = [], activeUnitId = '' }) {
  const [rows,setRows]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [form,setForm]=useState({name:'',email:'',password:'',phone:'',registrationNumber:'',specialties:'',unitIds:[]});
  async function load(){try{setRows(await api('/training/coaches' + unitParam(activeUnitId),{token}));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[activeUnitId]);
  function toggleUnit(id){setForm({...form,unitIds:form.unitIds.includes(id)?form.unitIds.filter(x=>x!==id):[...form.unitIds,id]});}
  async function create(e){
    e.preventDefault();setError('');setNotice('');
    try{
      const unitIds=form.unitIds.length?form.unitIds:[user.unitId].filter(Boolean);
      await api('/training/coaches',{token,method:'POST',body:JSON.stringify({...form,unitId:unitIds[0],unitIds})});
      setOpen(false);setForm({name:'',email:'',password:'',phone:'',registrationNumber:'',specialties:'',unitIds:[]});
      setNotice('Professor criado e liberado para as unidades selecionadas.');await load();
    }catch(err){setError(err.message);}
  }
  return <>
    <Header title="Professores" subtitle="Contas, especialidades e unidades de atuação." action={['OWNER','ADMIN'].includes(user.role)?<button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Novo professor</button>:null}/>
    {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
    <div className="coach-grid">{rows.map(r=><div className="panel coach-card" key={r.id}>
      <div className="coach-avatar">{(r.name||'P').slice(0,2).toUpperCase()}</div>
      <div><div className="coach-card-title"><h3>{r.name}</h3><Status value={r.active&&r.profile_active!==false?'ACTIVE':'INACTIVE'}/></div>
      <p>{r.email}</p><div className="chips">{(r.specialties||[]).map(x=><span key={x}>{x}</span>)}</div>
      <div className="coach-stats"><span><b>{r.student_count}</b> alunos</span><span><b>{r.class_count}</b> turmas</span></div>
      <small className="unit-line">{(r.units||[]).map(x=>x.name).join(' · ') || r.unit_name || 'Sem unidade'}</small></div>
    </div>)}</div>
    {!rows.length&&<Empty title="Nenhum professor" subtitle="Cadastre uma conta de professor."/>}
    {open&&<Modal title="Novo professor" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}>
      <label>Nome<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>Telefone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label className="span-2">E-mail de acesso<input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>Senha inicial<input required minLength="8" type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>
      <label>Registro/CREF<input value={form.registrationNumber} onChange={e=>setForm({...form,registrationNumber:e.target.value})}/></label>
      <label className="span-2">Especialidades<input value={form.specialties} onChange={e=>setForm({...form,specialties:e.target.value})} placeholder="Musculação, Funcional"/></label>
      <div className="span-2 unit-checks"><b>Unidades de atuação</b>{units.map(u=><label key={u.id}><input type="checkbox" checked={form.unitIds.includes(u.id)} onChange={()=>toggleUnit(u.id)}/>{u.name}</label>)}</div>
      <button className="primary span-2">Criar acesso</button>
    </form></Modal>}
  </>;
}

export function Equipment({ token, user, activeUnitId = '' }) {
  const [rows,setRows]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState({name:'',category:'',manufacturer:'',model:'',location:'',instructions:'',global:false});
  const canCreate=['OWNER','ADMIN','MANAGER'].includes(user.role);
  async function load(){try{setRows(await api('/training/equipment' + unitParam(activeUnitId),{token}));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[activeUnitId]);
  async function create(e){
    e.preventDefault();
    try{await api('/training/equipment',{token,method:'POST',body:JSON.stringify({...form,unitId:activeUnitId||user.unitId})});setOpen(false);setForm({name:'',category:'',manufacturer:'',model:'',location:'',instructions:'',global:false});await load();}
    catch(err){setError(err.message);}
  }
  return <>
    <Header title="Aparelhos" subtitle="Máquinas por unidade e equipamentos disponíveis em toda a rede." action={canCreate?<button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Novo aparelho</button>:null}/>
    {error&&<div className="error">{error}</div>}
    <div className="equipment-grid">{rows.map(r=><div className="panel equipment-card" key={r.id}><div className="equipment-icon"><Dumbbell/></div><div>
      <p className="eyebrow">{r.category||'EQUIPAMENTO'}</p><h3>{r.name}</h3><p>{[r.manufacturer,r.model].filter(Boolean).join(' · ')||'Sem marca/modelo'}</p>
      <small>{r.unit_id?r.unit_name:'Todas as unidades'} · {r.exercise_count} exercício(s)</small>{r.instructions&&<div className="instruction-box">{r.instructions}</div>}
    </div></div>)}</div>
    {!rows.length&&<Empty title="Nenhum aparelho" subtitle="Cadastre os equipamentos da academia."/>}
    {open&&<Modal title="Novo aparelho" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}>
      <label className="span-2">Nome<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Leg Press 45°"/></label>
      <label>Categoria<input value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></label>
      <label>Localização<input value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/></label>
      <label>Fabricante<input value={form.manufacturer} onChange={e=>setForm({...form,manufacturer:e.target.value})}/></label>
      <label>Modelo<input value={form.model} onChange={e=>setForm({...form,model:e.target.value})}/></label>
      <label className="span-2 toggle-row"><input type="checkbox" checked={form.global} onChange={e=>setForm({...form,global:e.target.checked})}/><span><b>Equipamento/recurso disponível em toda a rede</b><small>Use para equipamentos equivalentes ou recursos comuns às unidades.</small></span></label>
      <label className="span-2">Orientações<textarea value={form.instructions} onChange={e=>setForm({...form,instructions:e.target.value})}/></label>
      <button className="primary span-2">Cadastrar aparelho</button>
    </form></Modal>}
  </>;
}

export function Exercises({ token, activeUnitId = '' }) {
  const [rows,setRows]=useState([]),[equipment,setEquipment]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState('');
  const [form,setForm]=useState({name:'',muscleGroup:'',equipmentId:'',instructions:'',videoUrl:''});
  async function load(){try{const q=unitParam(activeUnitId);const [e,m]=await Promise.all([api('/training/exercises'+q,{token}),api('/training/equipment'+q,{token})]);setRows(e);setEquipment(m.filter(x=>x.active));setError('');}catch(err){setError(err.message);}}
  useEffect(()=>{load();},[activeUnitId]);
  async function create(e){
    e.preventDefault();
    try{await api('/training/exercises',{token,method:'POST',body:JSON.stringify({...form,equipmentId:form.equipmentId||null})});setOpen(false);setForm({name:'',muscleGroup:'',equipmentId:'',instructions:'',videoUrl:''});await load();}
    catch(err){setError(err.message);}
  }
  return <>
    <Header title="Exercícios" subtitle="Biblioteca com execução e aparelho relacionado." action={<button className="primary compact" onClick={()=>setOpen(true)}><Plus size={16}/> Novo exercício</button>}/>
    {error&&<div className="error">{error}</div>}
    <div className="table-card"><table><thead><tr><th>Exercício</th><th>Grupo</th><th>Aparelho</th><th>Disponibilidade</th><th>Orientação</th><th>Criado por</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td><b>{r.name}</b></td><td>{r.muscle_group||'—'}</td><td>{r.equipment_name||'Livre'}</td><td>{r.equipment_id?(r.equipment_unit_name||'Rede'):'Rede'}</td><td className="instruction-cell">{r.instructions}</td><td>{r.created_by_name||'—'}</td></tr>)}
    </tbody></table>{!rows.length&&<Empty title="Biblioteca vazia" subtitle="Cadastre exercícios para montar treinos."/>}</div>
    {open&&<Modal title="Novo exercício" onClose={()=>setOpen(false)}><form className="form-grid" onSubmit={create}>
      <label>Nome<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>Grupo muscular<input value={form.muscleGroup} onChange={e=>setForm({...form,muscleGroup:e.target.value})}/></label>
      <label className="span-2">Aparelho<select value={form.equipmentId} onChange={e=>setForm({...form,equipmentId:e.target.value})}><option value="">Sem aparelho específico</option>{equipment.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
      <label className="span-2">Como executar<textarea required minLength="5" value={form.instructions} onChange={e=>setForm({...form,instructions:e.target.value})}/></label>
      <label className="span-2">Vídeo (opcional)<input value={form.videoUrl} onChange={e=>setForm({...form,videoUrl:e.target.value})}/></label>
      <button className="primary span-2">Cadastrar exercício</button>
    </form></Modal>}
  </>;
}

const emptyItem=()=>({exerciseId:'',workoutLabel:'A',sets:'3',reps:'10-12',load:'',restSeconds:'60',tempo:'',notes:''});

export function Workouts({ token, activeUnitId = '' }) {
  const [rows,setRows]=useState([]),[students,setStudents]=useState([]),[exercises,setExercises]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editing,setEditing]=useState(null),[history,setHistory]=useState(null);
  const [form,setForm]=useState({studentId:'',title:'',goal:'',startsOn:'',endsOn:'',estimatedMinutes:'50',notes:'',changeReason:'',items:[emptyItem()]});
  async function load(){
    try{
      const q=unitParam(activeUnitId);
      const [w,s,e]=await Promise.all([api('/training/workouts'+q,{token}),api('/students'+q,{token}),api('/training/exercises'+q,{token})]);
      setRows(w);setStudents(s.filter(x=>x.status==='ACTIVE'||x.status==='PAUSED'));setExercises(e.filter(x=>x.active));setError('');
    }catch(err){setError(err.message);}
  }
  useEffect(()=>{load();},[activeUnitId]);
  function updateItem(index,key,value){setForm({...form,items:form.items.map((item,i)=>i===index?{...item,[key]:value}:item)});}
  function newWorkout(){setEditing(null);setForm({studentId:'',title:'',goal:'',startsOn:'',endsOn:'',estimatedMinutes:'50',notes:'',changeReason:'',items:[emptyItem()]});setOpen(true);}
  async function newVersion(plan){
    try{
      const h=await api('/training/workouts/'+plan.id+'/history',{token});const current=h.versions[0];
      setEditing(plan);setForm({studentId:plan.student_id,title:plan.title,goal:current.goal||'',startsOn:'',endsOn:current.ends_on?String(current.ends_on).slice(0,10):'',estimatedMinutes:String(current.estimated_minutes||50),notes:current.notes||'',changeReason:'',items:current.items.map(i=>({exerciseId:i.exercise_id,workoutLabel:i.workout_label,sets:String(i.sets||''),reps:i.reps||'',load:i.load||'',restSeconds:String(i.rest_seconds??''),tempo:i.tempo||'',notes:i.notes||''}))});setOpen(true);
    }catch(err){setError(err.message);}
  }
  async function save(e){
    e.preventDefault();
    const payload={...form,estimatedMinutes:form.estimatedMinutes?Number(form.estimatedMinutes):null,items:form.items.map(i=>({...i,sets:i.sets?Number(i.sets):null,restSeconds:i.restSeconds===''?null:Number(i.restSeconds)}))};
    if(!payload.startsOn)delete payload.startsOn;
    try{
      if(editing){await api('/training/workouts/'+editing.id+'/versions',{token,method:'POST',body:JSON.stringify(payload)});setNotice('Nova versão criada; histórico anterior preservado.');}
      else{await api('/training/workouts',{token,method:'POST',body:JSON.stringify(payload)});setNotice('Treino prescrito.');}
      setOpen(false);setEditing(null);await load();
    }catch(err){setError(err.message);}
  }
  async function showHistory(plan){try{setHistory(await api('/training/workouts/'+plan.id+'/history',{token}));}catch(err){setError(err.message);}}
  return <>
    <Header title="Fichas de treino" subtitle="Prescrição, duração, validade e autoria versionada." action={<button className="primary compact" onClick={newWorkout}><Plus size={16}/> Novo treino</button>}/>
    {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
    <div className="workout-grid">{rows.map(r=><div className="panel workout-card" key={r.id}>
      <div className="workout-card-top"><div><p className="eyebrow">{r.student_name}</p><h3>{r.title}</h3></div><Status value={r.status}/></div>
      <div className="workout-meta"><span><b>Professor</b>{r.prescribed_by_name}</span><span><b>Duração</b>{r.estimated_minutes?r.estimated_minutes+' min':'—'}</span><span><b>Validade</b>{dateBR(r.starts_on)} → {dateBR(r.ends_on)}</span><span><b>Histórico</b>v{r.current_version} · {r.version_count} versão(ões)</span></div>
      <p>{r.goal||'Sem objetivo registrado.'}</p><div className="workout-actions"><button className="ghost compact" onClick={()=>showHistory(r)}>Histórico</button><button className="primary compact" onClick={()=>newVersion(r)}>Nova versão</button></div>
    </div>)}</div>
    {!rows.length&&<Empty title="Nenhuma ficha" subtitle="Prescreva o primeiro treino."/>}

    {open&&<Modal title={editing?'Nova versão — '+editing.title:'Prescrever treino'} onClose={()=>setOpen(false)}><form className="workout-form" onSubmit={save}>
      {!editing&&<div className="form-grid"><label>Aluno<select required value={form.studentId} onChange={e=>setForm({...form,studentId:e.target.value})}><option value="">Selecione</option>{students.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label>Ficha<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label></div>}
      <div className="form-grid"><label className="span-2">Objetivo<input value={form.goal} onChange={e=>setForm({...form,goal:e.target.value})}/></label><label>Início<input type="date" value={form.startsOn} onChange={e=>setForm({...form,startsOn:e.target.value})}/></label><label>Validade<input type="date" value={form.endsOn} onChange={e=>setForm({...form,endsOn:e.target.value})}/></label><label>Duração (min)<input type="number" min="1" max="600" value={form.estimatedMinutes} onChange={e=>setForm({...form,estimatedMinutes:e.target.value})}/></label>{editing&&<label>Motivo<input required value={form.changeReason} onChange={e=>setForm({...form,changeReason:e.target.value})}/></label>}<label className="span-2">Observações<input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label></div>
      <div className="workout-items-head"><h3>Exercícios</h3><button type="button" className="ghost compact" onClick={()=>setForm({...form,items:[...form.items,emptyItem()]})}><Plus size={15}/> Adicionar</button></div>
      <div className="workout-items">{form.items.map((item,index)=><div className="workout-item" key={index}>
        <b>{index+1}</b><select required value={item.exerciseId} onChange={e=>updateItem(index,'exerciseId',e.target.value)}><option value="">Exercício</option>{exercises.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select>
        <input value={item.workoutLabel} onChange={e=>updateItem(index,'workoutLabel',e.target.value)} placeholder="A"/><input type="number" min="1" value={item.sets} onChange={e=>updateItem(index,'sets',e.target.value)} placeholder="Séries"/>
        <input value={item.reps} onChange={e=>updateItem(index,'reps',e.target.value)} placeholder="Reps"/><input value={item.load} onChange={e=>updateItem(index,'load',e.target.value)} placeholder="Carga"/>
        <input type="number" min="0" value={item.restSeconds} onChange={e=>updateItem(index,'restSeconds',e.target.value)} placeholder="Descanso"/><input value={item.tempo} onChange={e=>updateItem(index,'tempo',e.target.value)} placeholder="Cadência"/>
        <input value={item.notes} onChange={e=>updateItem(index,'notes',e.target.value)} placeholder="Observação"/><button type="button" className="icon-btn revoke" onClick={()=>form.items.length>1&&setForm({...form,items:form.items.filter((_,i)=>i!==index)})}><X size={16}/></button>
      </div>)}</div><button className="primary">{editing?'Criar nova versão':'Prescrever treino'}</button>
    </form></Modal>}

    {history&&<Modal title={'Histórico — '+history.plan.student_name} onClose={()=>setHistory(null)}><div className="history-list">{history.versions.map(v=><section className="history-version" key={v.id}>
      <div className="history-version-head"><div><b>Versão {v.version_number}</b><small>{new Date(v.created_at).toLocaleString('pt-BR')}</small></div><span>{v.prescribed_by_name}</span></div>
      <p>{dateBR(v.starts_on)} → {dateBR(v.ends_on)} · {v.estimated_minutes?v.estimated_minutes+' min':'sem duração'} · {v.change_reason||'—'}</p>
      <div className="history-items">{v.items.map(i=><div key={i.id}><b>{i.workout_label} · {i.exercise_name}</b><span>{i.sets||'—'} séries · {i.reps||'—'} reps · {i.load||'carga livre'} · {i.rest_seconds??'—'}s</span><small>{i.equipment_name||'Sem aparelho'}{i.notes?' · '+i.notes:''}</small></div>)}</div>
    </section>)}</div></Modal>}
  </>;
}
