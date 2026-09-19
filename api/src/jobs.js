import { generateRecurringBilling } from './memberRouter.js';
import { processCommunicationQueue } from './communicationRouter.js';

let timer=null;
let running=false;

export async function runOperationalJobs({pool,query}){
  if(running) return {skipped:true};
  running=true;
  const summary={tenants:0,billingCreated:0,communicationsSent:0,failures:[]};
  try{
    const tenants=await query(`SELECT id,timezone FROM tenants
      WHERE active AND billing_status IN ('TRIAL','ACTIVE','OVERDUE') ORDER BY id`);
    for(const tenant of tenants.rows){
      try{
        const billing=await generateRecurringBilling({
          pool,tenantId:tenant.id,timeZone:tenant.timezone,actorUserId:null
        });
        const communication=await processCommunicationQueue({
          pool,query,tenantId:tenant.id,limit:100
        });
        summary.tenants+=1;
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
