import crypto from 'node:crypto';
import { secretHash, timingSafeSecretMatch } from './secureSecrets.js';

const digits=v=>String(v||'').replace(/\D/g,'');
const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const baseUrl=()=>String(process.env.PLATFORM_ASAAS_ENV||'SANDBOX').toUpperCase()==='PRODUCTION'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3';
function dbDate(value){if(value instanceof Date)return value.toISOString().slice(0,10);const text=String(value||'');return /^\d{4}-\d{2}-\d{2}/.test(text)?text.slice(0,10):text;}

async function asaas(path,{method='GET',body}={}){
  const key=String(process.env.PLATFORM_ASAAS_API_KEY||'');
  if(key.length<20) throw Object.assign(new Error('PLATFORM_ASAAS_API_KEY não configurada'),{statusCode:503});
  const response=await fetch(baseUrl()+path,{
    method,headers:{'content-type':'application/json','accept':'application/json','access_token':key,'user-agent':'MinhaAcademiaSaaS/1.0'},
    body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=data?.errors?.map?.(x=>x.description).filter(Boolean).join('; ')||data?.message||('Asaas HTTP '+response.status);
    throw Object.assign(new Error(message),{statusCode:502});
  }
  return data;
}

function monthKey(date=new Date()){return date.toISOString().slice(0,7);}

export async function generatePlatformInvoices({pool,query,cycleKey=monthKey()}){
  const client=await pool.connect();
  const result={created:0,skipped:0};
  try{
    await client.query('BEGIN');
    const tenants=await client.query(`SELECT t.id,t.saas_plan,t.billing_status,t.trial_ends_at,p.name product_name,p.price_cents
      FROM tenants t JOIN saas_products p ON p.code=t.saas_plan AND p.active
      WHERE t.active AND t.billing_status NOT IN ('SUSPENDED','CANCELED') AND p.price_cents IS NOT NULL AND p.price_cents>0
        AND (t.billing_status<>'TRIAL' OR t.trial_ends_at IS NULL OR t.trial_ends_at<=now())
      FOR UPDATE`);
    const dueDay=Math.max(1,Math.min(28,Number(process.env.SAAS_BILLING_DAY||10)));
    const [year,month]=cycleKey.split('-').map(Number);
    const dueDate=`${year}-${String(month).padStart(2,'0')}-${String(dueDay).padStart(2,'0')}`;
    for(const t of tenants.rows){
      const ins=await client.query(`INSERT INTO tenant_saas_invoices(
        tenant_id,product_code,cycle_key,description,due_date,amount_cents
      ) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(tenant_id,cycle_key) DO NOTHING RETURNING id`,[
        t.id,t.saas_plan,cycleKey,`Assinatura Minha Academia - ${t.product_name}`,dueDate,t.price_cents
      ]);
      if(ins.rowCount) result.created+=1; else result.skipped+=1;
    }
    await client.query(`UPDATE tenant_saas_invoices SET status='OVERDUE',updated_at=now()
      WHERE status='PENDING' AND due_date < current_date`);
    await client.query(`UPDATE tenants t SET billing_status='OVERDUE'
      WHERE t.billing_status='ACTIVE' AND EXISTS(
        SELECT 1 FROM tenant_saas_invoices i WHERE i.tenant_id=t.id AND i.status='OVERDUE'
      )`);
    await client.query('COMMIT');
    return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

async function ensureCustomer(client,tenant){
  if(tenant.saas_customer_external_id) return tenant.saas_customer_external_id;
  const cpfCnpj=digits(tenant.cnpj);
  if(![11,14].includes(cpfCnpj.length)) throw Object.assign(new Error('CPF/CNPJ do tenant é obrigatório para cobrança SaaS'),{statusCode:409});
  const owner=await client.query(`SELECT name,email FROM users WHERE tenant_id=$1 AND role='OWNER' AND active ORDER BY created_at LIMIT 1`,[tenant.id]);
  if(!owner.rowCount) throw Object.assign(new Error('Tenant sem proprietário ativo'),{statusCode:409});
  const customer=await asaas('/customers',{method:'POST',body:{
    name:tenant.legal_name||tenant.trade_name,cpfCnpj,email:owner.rows[0].email,externalReference:tenant.id,notificationDisabled:false
  }});
  if(!customer.id) throw Object.assign(new Error('Asaas não retornou cliente'),{statusCode:502});
  await client.query('UPDATE tenants SET saas_customer_external_id=$1 WHERE id=$2',[customer.id,tenant.id]);
  return customer.id;
}

export async function sendPlatformInvoiceToAsaas({pool,invoiceId}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query(`SELECT i.*,t.trade_name,t.legal_name,t.cnpj,t.saas_customer_external_id
      FROM tenant_saas_invoices i JOIN tenants t ON t.id=i.tenant_id WHERE i.id=$1 FOR UPDATE`,[invoiceId]);
    if(!r.rowCount){await client.query('ROLLBACK');throw Object.assign(new Error('Fatura SaaS não encontrada'),{statusCode:404});}
    const invoice=r.rows[0];
    if(invoice.status==='PAID'){await client.query('ROLLBACK');throw Object.assign(new Error('Fatura já paga'),{statusCode:409});}
    if(invoice.provider==='ASAAS'&&invoice.external_id){await client.query('ROLLBACK');return invoice;}
    const customer=await ensureCustomer(client,invoice);
    const payment=await asaas('/payments',{method:'POST',body:{
      customer,billingType:'UNDEFINED',value:Number(invoice.amount_cents)/100,dueDate:dbDate(invoice.due_date),
      description:invoice.description,externalReference:invoice.id
    }});
    const updated=await client.query(`UPDATE tenant_saas_invoices SET provider='ASAAS',external_id=$1,invoice_url=$2,updated_at=now()
      WHERE id=$3 RETURNING *`,[payment.id,payment.invoiceUrl||null,invoice.id]);
    await client.query('COMMIT');
    return updated.rows[0];
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function handlePlatformAsaasWebhook({pool,token,payload}){
  const expected=String(process.env.PLATFORM_ASAAS_WEBHOOK_TOKEN||'');
  if(expected.length<32||!timingSafeSecretMatch(token,secretHash(expected))) throw Object.assign(new Error('Webhook não autorizado'),{statusCode:401});
  const client=await pool.connect();
  try{
    const eventId=clean(payload?.id,255),eventType=clean(payload?.event,120),payment=payload?.payment||{};
    if(!eventId||!eventType) throw Object.assign(new Error('Evento inválido'),{statusCode:400});
    await client.query('BEGIN');
    const ev=await client.query(`INSERT INTO platform_webhook_events(provider,event_id,event_type,payload)
      VALUES('ASAAS',$1,$2,$3) ON CONFLICT(provider,event_id) DO NOTHING RETURNING id`,[eventId,eventType,payload]);
    if(!ev.rowCount){await client.query('ROLLBACK');return {ok:true,duplicate:true};}
    const invoice=payment.id?await client.query(`SELECT * FROM tenant_saas_invoices WHERE provider='ASAAS' AND external_id=$1 FOR UPDATE`,[payment.id]):{rowCount:0,rows:[]};
    if(invoice.rowCount){
      const i=invoice.rows[0];
      if(['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(eventType)){
        await client.query(`UPDATE tenant_saas_invoices SET status='PAID',paid_at=COALESCE(paid_at,now()),updated_at=now() WHERE id=$1`,[i.id]);
        await client.query(`UPDATE tenants SET billing_status='ACTIVE',subscription_started_at=COALESCE(subscription_started_at,now()) WHERE id=$1`,[i.tenant_id]);
      }else if(eventType==='PAYMENT_OVERDUE'){
        await client.query(`UPDATE tenant_saas_invoices SET status='OVERDUE',updated_at=now() WHERE id=$1`,[i.id]);
        await client.query(`UPDATE tenants SET billing_status='OVERDUE' WHERE id=$1 AND billing_status<>'CANCELED'`,[i.tenant_id]);
      }else if(eventType==='PAYMENT_DELETED'){
        await client.query(`UPDATE tenant_saas_invoices SET status='CANCELED',updated_at=now() WHERE id=$1`,[i.id]);
      }else if(['PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED'].includes(eventType)){
        await client.query(`UPDATE tenant_saas_invoices SET status='REFUNDED',updated_at=now() WHERE id=$1`,[i.id]);
        await client.query(`UPDATE tenants SET billing_status='OVERDUE' WHERE id=$1`,[i.tenant_id]);
      }
    }
    await client.query('UPDATE platform_webhook_events SET processed_at=now() WHERE id=$1',[ev.rows[0].id]);
    await client.query('COMMIT');
    return {ok:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
