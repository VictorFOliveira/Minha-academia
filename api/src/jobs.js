import { generateRecurringBilling } from './memberRouter.js';
import { processCommunicationQueue } from './communicationRouter.js';

let timer=null;
let running=false;

async function expireOperationalState({pool,tenantId,timeZone}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const expired=await client.query(`UPDATE enrollments SET status='EXPIRED'
      WHERE tenant_id=$1 AND status IN ('ACTIVE','PAUSED') AND ends_on IS NOT NULL
        AND ends_on < (now() AT TIME ZONE $2)::date
      RETURNING id,student_id,status`,[tenantId,timeZone]);
    for(const row of expired.rows){
      await client.query(`INSERT INTO enrollment_events(
        tenant_id,enrollment_id,actor_user_id,event_type,from_status,to_status,reason,metadata
      ) VALUES($1,$2,NULL,'EXPIRED','ACTIVE','EXPIRED','Vencimento automático',$3)`,[
        tenantId,row.id,{automatic:true}
      ]);
      const active=await client.query(`SELECT 1 FROM enrollments
        WHERE tenant_id=$1 AND student_id=$2 AND status='ACTIVE'
          AND starts_on <= (now() AT TIME ZONE $3)::date
          AND (ends_on IS NULL OR ends_on >= (now() AT TIME ZONE $3)::date)
        LIMIT 1`,[tenantId,row.student_id,timeZone]);
      if(!active.rowCount){
        await client.query("UPDATE students SET status='INACTIVE',updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,row.student_id]);
      }
    }
    const overdue=await client.query(`UPDATE charges SET status='OVERDUE'
      WHERE tenant_id=$1 AND status IN ('PENDING','PARTIAL')
        AND due_date < (now() AT TIME ZONE $2)::date
      RETURNING id`,[tenantId,timeZone]);
    await client.query('COMMIT');
    return {expiredEnrollments:expired.rowCount,overdueCharges:overdue.rowCount};
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{client.release();}
}

export async function runOperationalJobs({pool,query}){
  if(running) return {skipped:true};
  running=true;
  const summary={tenants:0,expiredEnrollments:0,overdueCharges:0,billingCreated:0,communicationsSent:0,failures:[]};
  try{
    const tenants=await query(`SELECT id,timezone FROM tenants
      WHERE active AND billing_status IN ('TRIAL','ACTIVE','OVERDUE') ORDER BY id`);
    for(const tenant of tenants.rows){
      try{
        const expiry=await expireOperationalState({pool,tenantId:tenant.id,timeZone:tenant.timezone});
        const billing=await generateRecurringBilling({
          pool,tenantId:tenant.id,timeZone:tenant.timezone,actorUserId:null
        });
        const communication=await processCommunicationQueue({
          pool,query,tenantId:tenant.id,limit:100
        });
        summary.tenants+=1;
        summary.expiredEnrollments+=expiry.expiredEnrollments;
        summary.overdueCharges+=expiry.overdueCharges;
        summary.billingCreated+=billing.created;
        summary.communicationsSent+=communication.sent;
      }catch(error){
        summary.failures.push({tenantId:tenant.id,error:String(error.message||error).slice(0,500)});
      }
    }
    return summary;
  }finally{
    running=false;
  }
}

export function startOperationalJobs({pool,query}){
  if(String(process.env.ENABLE_JOBS||'true').toLowerCase()==='false' || process.env.NODE_ENV==='test') return null;
  const interval=Math.max(60_000,Number(process.env.JOB_INTERVAL_MS||3_600_000));
  const execute=()=>runOperationalJobs({pool,query})
    .then(result=>{
      if(result.billingCreated||result.communicationsSent||result.failures.length){
        console.log('[jobs]',JSON.stringify(result));
      }
    })
    .catch(error=>console.error('[jobs] falha geral',error));
  const initial=setTimeout(execute,15_000);
  initial.unref();
  timer=setInterval(execute,interval);
  timer.unref();
  return timer;
}

export function stopOperationalJobs(){
  if(timer) clearInterval(timer);
  timer=null;
}
