import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ClipboardList, Dumbbell, HeartPulse, History, Plus, RefreshCw, UserRound, X } from 'lucide-react';

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

const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
const dateBR = value => value ? String(value).slice(0,10).split('-').reverse().join('/') : '—';

function Header({ title, subtitle, action }) {
  return <div className="page-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>;
}
function Empty({ title, subtitle }) {
  return <div className="empty"><h3>{title}</h3><p>{subtitle}</p></div>;
}
function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop"><div className="modal training-modal"><div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>{children}</div></div>;
}
function Status({ value }) {
  const positive=['ACTIVE','PAID','COMPLETED'].includes(value);
  const warning=['PAUSED','PENDING','PARTIAL','IN_PROGRESS'].includes(value);
  return <span className={'status '+(positive?'positive':warning?'warning':'neutral')}>{value}</span>;
}

export function Assessments({ token, activeUnitId='' }) {
  const [students,setStudents]=useState([]),[studentId,setStudentId]=useState(''),[assessments,setAssessments]=useState([]),[anamnesis,setAnamnesis]=useState([]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[assessmentOpen,setAssessmentOpen]=useState(false),[anamnesisOpen,setAnamnesisOpen]=useState(false);
  const [assessment,setAssessment]=useState({weightKg:'',heightCm:'',bodyFatPercent:'',muscleMassKg:'',restingHeartRate:'',bloodPressure:'',objective:'',notes:'',armCm:'',waistCm:'',hipCm:'',chestCm:''});
  const [anam,setAnam]=useState({hasMedicalClearance:false,medications:'',injuries:'',surgeries:'',chronicConditions:'',painOrLimitations:'',exerciseHistory:'',smoking:false,alcoholNotes:'',emergencyNotes:'',notes:''});

  async function loadStudents(){
    try {
      const q=activeUnitId?'?unitId='+encodeURIComponent(activeUnitId):'';
      const rows=await api('/students'+q,{token});
      setStudents(rows.filter(x=>x.status!=='LEAD'));
      if(!studentId && rows.length)setStudentId(rows[0].id);
      setError('');
    } catch(e){setError(e.message);}
  }
  async function loadStudent(id=studentId){
    if(!id){setAssessments([]);setAnamnesis([]);return;}
    try{
      const [a,n]=await Promise.all([
        api('/members/assessments/'+id,{token}),
        api('/members/anamnesis/'+id,{token})
      ]);
      setAssessments(a);setAnamnesis(n);setError('');
    }catch(e){setError(e.message);}
  }
  useEffect(()=>{loadStudents();},[activeUnitId]);
  useEffect(()=>{loadStudent(studentId);},[studentId]);

  const selected=students.find(x=>x.id===studentId);

  async function createAssessment(e){
    e.preventDefault();setError('');setNotice('');
    try{
      await api('/members/assessments/'+studentId,{token,method:'POST',body:JSON.stringify({
        ...assessment,
        measurements:{
          armCm:assessment.armCm?Number(assessment.armCm):null,
          waistCm:assessment.waistCm?Number(assessment.waistCm):null,
          hipCm:assessment.hipCm?Number(assessment.hipCm):null,
          chestCm:assessment.chestCm?Number(assessment.chestCm):null
        }
      })});
      setAssessmentOpen(false);setNotice('Avaliação física registrada no histórico.');await loadStudent();
    }catch(err){setError(err.message);}
  }

  async function createAnamnesis(e){
    e.preventDefault();setError('');setNotice('');
    try{
      await api('/members/anamnesis/'+studentId,{token,method:'POST',body:JSON.stringify(anam)});
      setAnamnesisOpen(false);setNotice('Anamnese registrada sem sobrescrever o histórico anterior.');await loadStudent();
    }catch(err){setError(err.message);}
  }

  const latest=assessments[0];
  return <>
    <Header title="Avaliação física e anamnese" subtitle="Histórico clínico-operacional e evolução física do aluno." action={<div className="header-actions"><button className="ghost compact" disabled={!studentId} onClick={()=>setAnamnesisOpen(true)}><HeartPulse size={16}/> Anamnese</button><button className="primary compact" disabled={!studentId} onClick={()=>setAssessmentOpen(true)}><Plus size={16}/> Nova avaliação</button></div>}/>
    {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
    <div className="panel assessment-selector"><label>Aluno<select value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">Selecione</option>{students.map(s=><option key={s.id} value={s.id}>{s.name} · {s.unit_name||'sem unidade'}</option>)}</select></label></div>
    {selected&&latest&&<div className="metrics">
      <div className="metric-card"><div className="metric-head"><span>Peso</span><Activity size={18}/></div><strong>{latest.weight_kg?Number(latest.weight_kg)+' kg':'—'}</strong><small>Última avaliação</small></div>
      <div className="metric-card"><div className="metric-head"><span>IMC</span><Activity size={18}/></div><strong>{latest.bmi||'—'}</strong><small>{latest.height_cm?Number(latest.height_cm)+' cm':'Altura não informada'}</small></div>
      <div className="metric-card"><div className="metric-head"><span>Gordura corporal</span><Activity size={18}/></div><strong>{latest.body_fat_percent?Number(latest.body_fat_percent)+'%':'—'}</strong><small>Composição corporal</small></div>
      <div className="metric-card"><div className="metric-head"><span>Massa muscular</span><Dumbbell size={18}/></div><strong>{latest.muscle_mass_kg?Number(latest.muscle_mass_kg)+' kg':'—'}</strong><small>{latest.created_by_name||'—'}</small></div>
    </div>}
    <div className="assessment-grid">
      <section className="panel assessment-panel"><div className="section-head"><div><p className="eyebrow">EVOLUÇÃO</p><h3>Avaliações</h3></div><ClipboardList/></div>
        <div className="timeline-list">{assessments.map(a=><div className="timeline-entry" key={a.id}><div><b>{new Date(a.assessed_at).toLocaleString('pt-BR')}</b><small>{a.created_by_name}</small></div><div className="timeline-values"><span>{a.weight_kg?Number(a.weight_kg)+' kg':'—'}</span><span>IMC {a.bmi||'—'}</span><span>{a.body_fat_percent?Number(a.body_fat_percent)+'% gordura':'—'}</span></div><p>{a.objective||a.notes||'Sem observações.'}</p></div>)}</div>
        {!assessments.length&&<Empty title="Sem avaliações" subtitle="Registre a avaliação inicial deste aluno."/>}
      </section>
      <section className="panel assessment-panel"><div className="section-head"><div><p className="eyebrow">ANAMNESE</p><h3>Registros</h3></div><HeartPulse/></div>
        <div className="timeline-list">{anamnesis.map(a=><div className="timeline-entry" key={a.id}><div><b>{new Date(a.created_at).toLocaleString('pt-BR')}</b><small>{a.created_by_name}</small></div><p><b>Lesões:</b> {a.injuries||'não informado'}<br/><b>Limitações:</b> {a.pain_or_limitations||'não informado'}<br/><b>Condições:</b> {a.chronic_conditions||'não informado'}</p></div>)}</div>
        {!anamnesis.length&&<Empty title="Sem anamnese" subtitle="Registre o histórico inicial do aluno."/>}
      </section>
    </div>

    {assessmentOpen&&<Modal title={'Nova avaliação — '+selected?.name} onClose={()=>setAssessmentOpen(false)}><form className="form-grid" onSubmit={createAssessment}>
      <label>Peso (kg)<input type="number" step="0.01" min="1" value={assessment.weightKg} onChange={e=>setAssessment({...assessment,weightKg:e.target.value})}/></label>
      <label>Altura (cm)<input type="number" step="0.1" min="1" value={assessment.heightCm} onChange={e=>setAssessment({...assessment,heightCm:e.target.value})}/></label>
      <label>Gordura corporal (%)<input type="number" step="0.1" min="0" max="100" value={assessment.bodyFatPercent} onChange={e=>setAssessment({...assessment,bodyFatPercent:e.target.value})}/></label>
      <label>Massa muscular (kg)<input type="number" step="0.1" min="0" value={assessment.muscleMassKg} onChange={e=>setAssessment({...assessment,muscleMassKg:e.target.value})}/></label>
      <label>FC repouso<input type="number" min="20" max="250" value={assessment.restingHeartRate} onChange={e=>setAssessment({...assessment,restingHeartRate:e.target.value})}/></label>
      <label>Pressão arterial<input value={assessment.bloodPressure} onChange={e=>setAssessment({...assessment,bloodPressure:e.target.value})} placeholder="120/80"/></label>
      <label>Braço (cm)<input type="number" step="0.1" value={assessment.armCm} onChange={e=>setAssessment({...assessment,armCm:e.target.value})}/></label>
      <label>Cintura (cm)<input type="number" step="0.1" value={assessment.waistCm} onChange={e=>setAssessment({...assessment,waistCm:e.target.value})}/></label>
      <label>Quadril (cm)<input type="number" step="0.1" value={assessment.hipCm} onChange={e=>setAssessment({...assessment,hipCm:e.target.value})}/></label>
      <label>Tórax (cm)<input type="number" step="0.1" value={assessment.chestCm} onChange={e=>setAssessment({...assessment,chestCm:e.target.value})}/></label>
      <label className="span-2">Objetivo<input value={assessment.objective} onChange={e=>setAssessment({...assessment,objective:e.target.value})}/></label>
      <label className="span-2">Observações<textarea value={assessment.notes} onChange={e=>setAssessment({...assessment,notes:e.target.value})}/></label>
      <button className="primary span-2">Salvar avaliação</button>
    </form></Modal>}

    {anamnesisOpen&&<Modal title={'Nova anamnese — '+selected?.name} onClose={()=>setAnamnesisOpen(false)}><form className="form-grid" onSubmit={createAnamnesis}>
      <label className="toggle-row span-2"><input type="checkbox" checked={anam.hasMedicalClearance} onChange={e=>setAnam({...anam,hasMedicalClearance:e.target.checked})}/><span><b>Possui liberação médica informada</b><small>Registro administrativo; não substitui avaliação médica.</small></span></label>
      <label>Medicamentos<textarea value={anam.medications} onChange={e=>setAnam({...anam,medications:e.target.value})}/></label>
      <label>Lesões<textarea value={anam.injuries} onChange={e=>setAnam({...anam,injuries:e.target.value})}/></label>
      <label>Cirurgias<textarea value={anam.surgeries} onChange={e=>setAnam({...anam,surgeries:e.target.value})}/></label>
      <label>Condições crônicas<textarea value={anam.chronicConditions} onChange={e=>setAnam({...anam,chronicConditions:e.target.value})}/></label>
      <label>Limitações/dor<textarea value={anam.painOrLimitations} onChange={e=>setAnam({...anam,painOrLimitations:e.target.value})}/></label>
      <label>Histórico de exercício<textarea value={anam.exerciseHistory} onChange={e=>setAnam({...anam,exerciseHistory:e.target.value})}/></label>
      <label className="toggle-row"><input type="checkbox" checked={anam.smoking} onChange={e=>setAnam({...anam,smoking:e.target.checked})}/><span><b>Tabagismo informado</b></span></label>
      <label>Álcool<textarea value={anam.alcoholNotes} onChange={e=>setAnam({...anam,alcoholNotes:e.target.value})}/></label>
      <label className="span-2">Observações de emergência<textarea value={anam.emergencyNotes} onChange={e=>setAnam({...anam,emergencyNotes:e.target.value})}/></label>
      <button className="primary span-2">Salvar anamnese</button>
    </form></Modal>}
  </>;
}

export function Memberships({ token }) {
  const [rows,setRows]=useState([]),[plans,setPlans]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[history,setHistory]=useState(null);
  const [actionModal,setActionModal]=useState(null),[actionForm,setActionForm]=useState({action:'PAUSE',reason:'',endsOn:'',planId:''});
  async function load(){
    try{const [e,p]=await Promise.all([api('/enrollments',{token}),api('/plans',{token})]);setRows(e);setPlans(p);setError('');}catch(err){setError(err.message);}
  }
  useEffect(()=>{load();},[]);

  async function runAction(e){
    e.preventDefault();setError('');setNotice('');
    try{
      await api('/members/enrollments/'+actionModal.id+'/action',{token,method:'POST',body:JSON.stringify(actionForm)});
      setActionModal(null);setNotice('Matrícula atualizada e evento registrado no histórico.');await load();
    }catch(err){setError(err.message);}
  }
  async function openHistory(row){
    try{setHistory({row,events:await api('/members/enrollments/'+row.id+'/history',{token})});}catch(err){setError(err.message);}
  }
  async function generateBilling(){
    try{const r=await api('/members/billing/generate-recurring',{token,method:'POST',body:'{}'});setNotice(r.created+' cobrança(s) recorrente(s) gerada(s).');await load();}catch(err){setError(err.message);}
  }
  function startAction(row,action){
    setActionModal(row);setActionForm({action,reason:'',endsOn:'',planId:row.plan_id});
  }

  return <>
    <Header title="Matrículas" subtitle="Pausa, retomada, troca de plano, renovação e histórico sem exclusão física." action={<button className="primary compact" onClick={generateBilling}><RefreshCw size={16}/> Gerar mensalidades vencidas</button>}/>
    {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
    <div className="table-card"><table><thead><tr><th>Aluno</th><th>Plano</th><th>Início</th><th>Fim</th><th>Status</th><th></th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td><b>{r.student_name}</b></td><td>{r.plan_name}</td><td>{dateBR(r.starts_on)}</td><td>{dateBR(r.ends_on)}</td><td><Status value={r.status}/></td><td><div className="row-actions"><button className="ghost compact" onClick={()=>openHistory(r)}><History size={14}/> Histórico</button>{r.status==='ACTIVE'&&<button className="ghost compact" onClick={()=>startAction(r,'PAUSE')}>Pausar</button>}{r.status==='PAUSED'&&<button className="ghost compact" onClick={()=>startAction(r,'RESUME')}>Retomar</button>}{!['CANCELED','EXPIRED'].includes(r.status)&&<button className="ghost compact" onClick={()=>startAction(r,'CHANGE_PLAN')}>Trocar plano</button>}<button className="ghost compact" onClick={()=>startAction(r,'RENEW')}>Renovar</button>{!['CANCELED','EXPIRED'].includes(r.status)&&<button className="icon-btn revoke" onClick={()=>startAction(r,'CANCEL')}>Cancelar</button>}</div></td></tr>)}
    </tbody></table>{!rows.length&&<Empty title="Sem matrículas" subtitle="As matrículas ativas e históricas aparecerão aqui."/>}</div>

    {actionModal&&<Modal title={actionForm.action+' — '+actionModal.student_name} onClose={()=>setActionModal(null)}><form className="form-grid" onSubmit={runAction}>
      {actionForm.action==='CHANGE_PLAN'&&<label className="span-2">Novo plano<select required value={actionForm.planId} onChange={e=>setActionForm({...actionForm,planId:e.target.value})}>{plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {actionForm.action==='RENEW'&&<label className="span-2">Nova validade<input type="date" value={actionForm.endsOn} onChange={e=>setActionForm({...actionForm,endsOn:e.target.value})}/></label>}
      <label className="span-2">Motivo/observação<textarea value={actionForm.reason} onChange={e=>setActionForm({...actionForm,reason:e.target.value})}/></label>
      <button className="primary span-2">Confirmar</button>
    </form></Modal>}

    {history&&<Modal title={'Histórico — '+history.row.student_name} onClose={()=>setHistory(null)}><div className="history-list">{history.events.map(ev=><div className="history-version" key={ev.id}><div className="history-version-head"><div><b>{ev.event_type}</b><small>{new Date(ev.created_at).toLocaleString('pt-BR')}</small></div><span>{ev.actor_name||'Sistema'}</span></div><p>{ev.from_status||'—'} → {ev.to_status||'—'}{ev.reason?' · '+ev.reason:''}</p></div>)}</div></Modal>}
  </>;
}

export function StudentPortal({ token, user }) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[sessionOpen,setSessionOpen]=useState(false);
  const [session,setSession]=useState({durationMinutes:'',perceivedEffort:'7',notes:'',items:[]});
  async function load(){try{setData(await api('/members/student/me/overview',{token}));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{load();},[]);

  function openSession(){
    const items=(data?.workout?.items||[]).map(item=>({
      exerciseId:item.exercise_id,workoutItemId:item.id,exerciseName:item.exercise_name,
      performedSets:item.sets||'',performedReps:item.reps||'',load:item.load||'',perceivedEffort:'',notes:'',completed:true
    }));
    setSession({durationMinutes:data?.workout?.estimated_minutes||'',perceivedEffort:'7',notes:'',items});
    setSessionOpen(true);
  }
  function updateItem(index,key,value){setSession({...session,items:session.items.map((it,i)=>i===index?{...it,[key]:value}:it)});}
  async function saveSession(e){
    e.preventDefault();setError('');setNotice('');
    try{
      await api('/members/workout-sessions',{token,method:'POST',body:JSON.stringify({
        workoutPlanId:data.workout?.id||null,workoutVersionId:data.workout?.version_id||null,
        durationMinutes:session.durationMinutes?Number(session.durationMinutes):null,
        perceivedEffort:session.perceivedEffort?Number(session.perceivedEffort):null,
        notes:session.notes,status:'COMPLETED',
        items:session.items.map(i=>({...i,performedSets:i.performedSets?Number(i.performedSets):null,perceivedEffort:i.perceivedEffort?Number(i.perceivedEffort):null}))
      })});
      setSessionOpen(false);setNotice('Treino concluído registrado no seu histórico.');await load();
    }catch(err){setError(err.message);}
  }

  if(error&&!data)return <Empty title="Não foi possível carregar seu espaço" subtitle={error}/>;
  if(!data)return <div className="loading"><RefreshCw className="spin" size={24}/> Carregando...</div>;
  const openCharges=data.charges.filter(x=>['PENDING','PARTIAL','OVERDUE'].includes(x.status));
  return <>
    <Header title={'Meu espaço — '+user.name} subtitle="Treino, evolução, presença e financeiro em um só lugar." action={<button className="ghost compact" onClick={load}><RefreshCw size={16}/> Atualizar</button>}/>
    {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
    <div className="metrics">
      <div className="metric-card"><div className="metric-head"><span>Plano</span><UserRound size={18}/></div><strong className="metric-text">{data.enrollment?.plan_name||'Sem plano'}</strong><small>{data.enrollment?.status||'—'}</small></div>
      <div className="metric-card"><div className="metric-head"><span>Treino atual</span><Dumbbell size={18}/></div><strong className="metric-text">{data.workout?.title||'Sem treino'}</strong><small>{data.workout?.professor_name||'—'}</small></div>
      <div className="metric-card"><div className="metric-head"><span>Último peso</span><Activity size={18}/></div><strong>{data.latestAssessment?.weight_kg?Number(data.latestAssessment.weight_kg)+' kg':'—'}</strong><small>IMC {data.latestAssessment?.bmi||'—'}</small></div>
      <div className="metric-card"><div className="metric-head"><span>A receber</span><ClipboardList size={18}/></div><strong>{money(openCharges.reduce((s,x)=>s+(x.amount_cents-x.paid_cents),0))}</strong><small>{openCharges.length} cobrança(s) aberta(s)</small></div>
    </div>

    <div className="student-portal-grid">
      <section className="panel portal-workout"><div className="section-head"><div><p className="eyebrow">TREINO ATUAL</p><h3>{data.workout?.title||'Nenhum treino ativo'}</h3></div>{data.workout&&<button className="primary compact" onClick={openSession}>Registrar treino feito</button>}</div>
        {data.workout?<><p>{data.workout.goal||'Sem objetivo registrado'} · {data.workout.estimated_minutes||'—'} min · válido até {dateBR(data.workout.ends_on)}</p><div className="portal-exercises">{data.workout.items.map(i=><div key={i.id}><b>{i.workout_label} · {i.exercise_name}</b><span>{i.sets||'—'} séries · {i.reps||'—'} reps · {i.load||'carga livre'} · {i.rest_seconds??'—'}s descanso</span><small>{i.equipment_name||'Sem aparelho específico'} · {i.instructions}</small></div>)}</div></>:<Empty title="Sem ficha ativa" subtitle="Seu professor ainda não publicou um treino ativo."/>}
      </section>
      <section className="panel portal-side"><p className="eyebrow">ÚLTIMOS TREINOS</p><h3>Histórico de execução</h3><div className="timeline-list">{data.recentSessions.map(s=><div className="timeline-entry" key={s.id}><b>{new Date(s.started_at).toLocaleString('pt-BR')}</b><span>{s.duration_minutes||'—'} min · esforço {s.perceived_effort||'—'}/10</span><Status value={s.status}/></div>)}</div>{!data.recentSessions.length&&<Empty title="Ainda sem registros" subtitle="Ao concluir um treino, ele aparece aqui."/>}</section>
    </div>

    <div className="student-portal-grid">
      <section className="panel portal-side"><p className="eyebrow">FINANCEIRO</p><h3>Mensalidades</h3><div className="timeline-list">{data.charges.map(ch=><div className="timeline-entry" key={ch.id}><div><b>{ch.description}</b><small>Vence {dateBR(ch.due_date)}</small></div><div className="timeline-values"><span>{money(ch.amount_cents)}</span><Status value={ch.status}/></div></div>)}</div></section>
      <section className="panel portal-side"><p className="eyebrow">PRESENÇA</p><h3>Entradas recentes</h3><div className="timeline-list">{data.attendance.map(a=><div className="timeline-entry" key={a.checkin_at}><b>{new Date(a.checkin_at).toLocaleString('pt-BR')}</b><span>{a.unit_name||'Unidade'} · {a.source}</span></div>)}</div></section>
    </div>

    {sessionOpen&&<Modal title="Registrar treino concluído" onClose={()=>setSessionOpen(false)}><form className="workout-form" onSubmit={saveSession}>
      <div className="form-grid"><label>Duração (min)<input type="number" min="1" max="600" value={session.durationMinutes} onChange={e=>setSession({...session,durationMinutes:e.target.value})}/></label><label>Esforço geral (1-10)<input type="number" min="1" max="10" value={session.perceivedEffort} onChange={e=>setSession({...session,perceivedEffort:e.target.value})}/></label><label className="span-2">Observações<input value={session.notes} onChange={e=>setSession({...session,notes:e.target.value})}/></label></div>
      <div className="portal-session-items">{session.items.map((item,index)=><div className="session-item" key={index}><b>{item.exerciseName}</b><input type="number" min="0" value={item.performedSets} onChange={e=>updateItem(index,'performedSets',e.target.value)} placeholder="Séries"/><input value={item.performedReps} onChange={e=>updateItem(index,'performedReps',e.target.value)} placeholder="Repetições"/><input value={item.load} onChange={e=>updateItem(index,'load',e.target.value)} placeholder="Carga real"/><input type="number" min="1" max="10" value={item.perceivedEffort} onChange={e=>updateItem(index,'perceivedEffort',e.target.value)} placeholder="Esforço"/></div>)}</div>
      <button className="primary">Salvar treino realizado</button>
    </form></Modal>}
  </>;
}
