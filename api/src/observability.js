const startedAt=Date.now();
const counters={
  requests:0,
  errors5xx:0,
  durationMsTotal:0,
  byStatus:{}
};

export function metricsMiddleware(req,res,next){
  const start=process.hrtime.bigint();
  res.on('finish',()=>{
    const duration=Number(process.hrtime.bigint()-start)/1e6;
    counters.requests+=1;
    counters.durationMsTotal+=duration;
    const key=String(res.statusCode);
    counters.byStatus[key]=(counters.byStatus[key]||0)+1;
    if(res.statusCode>=500) counters.errors5xx+=1;
  });
  next();
}

export function metricsSnapshot({pool,jobStatus}={}){
  const mem=process.memoryUsage();
  return {
    startedAt:new Date(startedAt).toISOString(),
    uptimeSeconds:Math.floor(process.uptime()),
    requests:counters.requests,
    errors5xx:counters.errors5xx,
    averageDurationMs:counters.requests?Math.round((counters.durationMsTotal/counters.requests)*100)/100:0,
    byStatus:{...counters.byStatus},
    memory:{
      rss:mem.rss,heapUsed:mem.heapUsed,heapTotal:mem.heapTotal,external:mem.external
    },
    database:pool?{
      total:pool.totalCount,
      idle:pool.idleCount,
      waiting:pool.waitingCount
    }:null,
    jobs:jobStatus||null
  };
}

export function metricsPrometheus({pool,jobStatus}={}){
  const s=metricsSnapshot({pool,jobStatus});
  const lines=[
    '# HELP minha_academia_uptime_seconds Process uptime in seconds',
    '# TYPE minha_academia_uptime_seconds gauge',
    `minha_academia_uptime_seconds ${s.uptimeSeconds}`,
    '# HELP minha_academia_http_requests_total Total HTTP responses',
    '# TYPE minha_academia_http_requests_total counter',
    `minha_academia_http_requests_total ${s.requests}`,
    '# HELP minha_academia_http_5xx_total Total HTTP 5xx responses',
    '# TYPE minha_academia_http_5xx_total counter',
    `minha_academia_http_5xx_total ${s.errors5xx}`,
    '# HELP minha_academia_http_duration_ms_average Average HTTP response duration',
    '# TYPE minha_academia_http_duration_ms_average gauge',
    `minha_academia_http_duration_ms_average ${s.averageDurationMs}`,
    `minha_academia_process_memory_rss_bytes ${s.memory.rss}`,
    `minha_academia_process_heap_used_bytes ${s.memory.heapUsed}`
  ];
  for(const [status,count] of Object.entries(s.byStatus)){
    lines.push(`minha_academia_http_status_total{status="${status}"} ${count}`);
  }
  if(s.database){
    lines.push(`minha_academia_db_pool_total ${s.database.total}`);
    lines.push(`minha_academia_db_pool_idle ${s.database.idle}`);
    lines.push(`minha_academia_db_pool_waiting ${s.database.waiting}`);
  }
  if(s.jobs?.lastRunAt){
    lines.push(`minha_academia_jobs_last_success ${s.jobs.lastSuccess?1:0}`);
    lines.push(`minha_academia_jobs_last_run_timestamp_seconds ${Math.floor(new Date(s.jobs.lastRunAt).getTime()/1000)}`);
  }
  return lines.join('\n')+'\n';
}
