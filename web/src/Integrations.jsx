import React, { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Mail, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '/api';

async function api(path,{token,...options}={}){
  const response=await fetch(API+path,{
    ...options,
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(options.headers||{})}
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Falha na requisição');
  return body;
}

function Header({title,subtitle,action}){return <div className="page-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>;}
function Status({value}){const ok=['ACTIVE','SENT'].includes(value);return <span className={'status '+(ok?'positive':'neutral')}>{value}</span>;}

export function Integrations({token}){
  const [asaas,setAsaas]=useState(null),[comms,setComms]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [asaasForm,setAsaasForm]=useState({environment:'SANDBOX',apiKey:''});
  const [smtp,setSmtp]=useState({host:'',port:'587',secure:false,requireTls:true,user:'',password:'',from:''});
  const [wa,setWa]=useState({phoneNumberId:'',apiVersion:'',accessToken:''});

  async function load(){
    try{
      const [a,c]=await Promise.all([
        api('/integrations/asaas',{token}),
        api('/integrations/communications/config',{token})
      ]);
      setAsaas(a);setComms(c);setError('');
    }catch(e){setError(e.message);}
  }
  useEffect(()=>{load();},[]);

  async function saveAsaas(e){
    e.preventDefault();setError('');setNotice('');
    try{
      const r=await api('/integrations/asaas',{token,method:'PUT',body:JSON.stringify(asaasForm)});
      setAsaasForm({...asaasForm,apiKey:''});
      setNotice(r.webhookToken?'Asaas configurado. Guarde o token de webhook exibido nesta operação no ambiente do Asaas.':'Asaas atualizado.');
      await load();
    }catch(err){setError(err.message);}
  }
  async function saveSmtp(e){
    e.preventDefault();setError('');setNotice('');
    try{
      await api('/integrations/communications/smtp',{token,method:'PUT',body:JSON.stringify({...smtp,port:Number(smtp.port)})});
      setSmtp({...smtp,password:''});setNotice('SMTP configurado com senha criptografada.');await load();
    }catch(err){setError(err.message);}
  }
  async function saveWhatsapp(e){
    e.preventDefault();setError('');setNotice('');
    try{
      await api('/integrations/communications/whatsapp',{token,method:'PUT',body:JSON.stringify(wa)});
      setWa({...wa,accessToken:''});setNotice('WhatsApp Cloud API configurado.');await load();
    }catch(err){setError(err.message);}
  }
  async function processNow(){
    try{
      const r=await api('/integrations/communications/process',{token,method:'POST',body:JSON.stringify({limit:100})});
      setNotice('Comunicações processadas: '+r.sent+' enviadas, '+r.failed+' falharam, '+r.skipped+' aguardando provider.');
    }catch(err){setError(err.message);}
  }

  const smtpState=comms.find(x=>x.provider==='SMTP');
  const waState=comms.find(x=>x.provider==='WHATSAPP_META');

  return <>
    <Header title="Integrações" subtitle="Pagamentos e comunicação por adapters isolados do núcleo do SaaS." action={<button className="ghost compact" onClick={load}><RefreshCw size={16}/> Atualizar</button>}/>
    {error&&<div className="error">{error}</div>}{notice&&<div className="success">{notice}</div>}
    <div className="integration-grid">
      <section className="panel integration-card">
        <div className="integration-title"><div className="integration-icon"><CreditCard/></div><div><h3>Asaas</h3><p>PIX, boleto e cartão com webhook idempotente.</p></div>{asaas?.configured&&<Status value={asaas.status}/>}</div>
        <form className="integration-form" onSubmit={saveAsaas}>
          <label>Ambiente<select value={asaasForm.environment} onChange={e=>setAsaasForm({...asaasForm,environment:e.target.value})}><option value="SANDBOX">Sandbox</option><option value="PRODUCTION">Produção</option></select></label>
          <label>API Key<input required type="password" value={asaasForm.apiKey} onChange={e=>setAsaasForm({...asaasForm,apiKey:e.target.value})} placeholder={asaas?.configured?'•••••••• configurada':'$aact_...'}/></label>
          <button className="primary"><ShieldCheck size={16}/> Salvar Asaas</button>
        </form>
        {asaas?.configured&&<small>Chave armazenada criptografada · {asaas.environment}</small>}
      </section>

      <section className="panel integration-card">
        <div className="integration-title"><div className="integration-icon"><Mail/></div><div><h3>E-mail SMTP</h3><p>Lembretes e avisos sem lock-in de provedor.</p></div>{smtpState&&<Status value={smtpState.status}/>}</div>
        <form className="integration-form" onSubmit={saveSmtp}>
          <div className="form-grid"><label>Host<input required value={smtp.host} onChange={e=>setSmtp({...smtp,host:e.target.value})}/></label><label>Porta<input required type="number" value={smtp.port} onChange={e=>setSmtp({...smtp,port:e.target.value})}/></label></div>
          <label>Usuário<input value={smtp.user} onChange={e=>setSmtp({...smtp,user:e.target.value})}/></label>
          <label>Senha<input required type="password" value={smtp.password} onChange={e=>setSmtp({...smtp,password:e.target.value})}/></label>
          <label>Remetente<input required value={smtp.from} onChange={e=>setSmtp({...smtp,from:e.target.value})} placeholder="Academia <financeiro@academia.com>"/></label>
          <label className="toggle-row"><input type="checkbox" checked={smtp.secure} onChange={e=>setSmtp({...smtp,secure:e.target.checked})}/><span><b>TLS direto</b><small>Normalmente usado na porta 465.</small></span></label>
          <button className="primary"><CheckCircle2 size={16}/> Salvar SMTP</button>
        </form>
      </section>

      <section className="panel integration-card">
        <div className="integration-title"><div className="integration-icon"><MessageCircle/></div><div><h3>WhatsApp Cloud API</h3><p>Adapter configurável por versão do Graph API.</p></div>{waState&&<Status value={waState.status}/>}</div>
        <form className="integration-form" onSubmit={saveWhatsapp}>
          <label>Phone Number ID<input required value={wa.phoneNumberId} onChange={e=>setWa({...wa,phoneNumberId:e.target.value})}/></label>
          <label>Versão Graph API<input required value={wa.apiVersion} onChange={e=>setWa({...wa,apiVersion:e.target.value})} placeholder="vXX.X"/></label>
          <label>Access Token<input required type="password" value={wa.accessToken} onChange={e=>setWa({...wa,accessToken:e.target.value})}/></label>
          <button className="primary"><CheckCircle2 size={16}/> Salvar WhatsApp</button>
        </form>
      </section>

      <section className="panel integration-card automation-card">
        <div className="integration-title"><div className="integration-icon"><RefreshCw/></div><div><h3>Automação</h3><p>Mensalidade, vencimento, atraso e treino perto da reavaliação.</p></div></div>
        <div className="automation-list"><span>✓ Cobrança recorrente idempotente</span><span>✓ Lembrete até 3 dias antes</span><span>✓ Aviso de atraso</span><span>✓ Treino vencendo em 7 dias</span><span>✓ Fila com até 5 tentativas</span></div>
        <button className="ghost" onClick={processNow}><RefreshCw size={16}/> Processar fila agora</button>
      </section>
    </div>
  </>;
}

export async function sendChargeToAsaas(token,chargeId,billingType='PIX'){
  return api('/integrations/asaas/charges/'+chargeId,{token,method:'POST',body:JSON.stringify({billingType})});
}
