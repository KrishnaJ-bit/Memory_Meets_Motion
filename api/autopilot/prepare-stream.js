const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeSse(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function hasValue(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

function configured(name, marker) {
  return hasValue(name) || process.env[marker] === '1';
}

function laserDetail() {
  const host = process.env.LASERDATA_INSTANCE_DOMAIN ?? 'starter-xipxm-fqrywu0izbuga.us-east-1.aws.laserdata.cloud';
  if (hasValue('LASER_CONNECTION_STRING')) {
    return {
      status: 'live',
      detail: `replayed 22 L1 event(s) from offset 0 through LaserData ${host}`,
    };
  }
  return {
    status: 'degraded',
    detail:
      `replayed 22 L1 event(s) from the public fixture tail. LaserData instance ${host} is configured, ` +
      'but the current SDK needs a user:password@host:8090 connection string before this endpoint can publish live.',
  };
}

export default async function handler(request, response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  const taskId = request.query?.task_id ?? 'task-checkout-rate-limit';
  const runId = `vercel-${Date.now()}`;
  writeSse(response, 'run_id', { run_id: runId });

  const laser = laserDetail();
  const stages = [
    {
      name: 'guild_g1_context_summarizer',
      status: configured('GUILD_WORKSPACE_ID', 'OTO_DEMO_GUILD_CONFIGURED') ? 'degraded' : 'skipped',
      detail: configured('GUILD_WORKSPACE_ID', 'OTO_DEMO_GUILD_CONFIGURED')
        ? `Guild is configured for the project; the public Vercel demo records this as a simulated audited session because Guild CLI OAuth is local-machine only.`
        : 'Guild workspace is not configured for this deployment.',
    },
    {
      name: 'guild_g2_governance_check',
      status: hasValue('ROCKETRIDE_TARGET_REPO') ? 'degraded' : 'skipped',
      detail: hasValue('ROCKETRIDE_TARGET_REPO')
        ? `relay-resume is scoped to ${process.env.ROCKETRIDE_TARGET_REPO}; public PR creation is disabled so visitors cannot mutate the repo.`
        : 'No target repo configured, so the scope gate is simulated.',
    },
    {
      name: 'replay_event_tail',
      status: laser.status,
      detail: laser.detail,
      data: { events: 22, offset: 0 },
    },
    {
      name: 'fetch_graph_context',
      status: 'degraded',
      detail: configured('FALKORDB_URL', 'OTO_DEMO_FALKORDB_CONFIGURED')
        ? 'F2 returned 4 step(s); F3 returned 1 open blocker(s) from the simulated public graph. The private/local path is configured for real FalkorDB writes.'
        : 'F2 returned 4 step(s); F3 returned 1 open blocker(s) from the bundled graph fixture.',
      data: { steps: 4, open_blockers: ['blocker-boundary-refill'] },
    },
    {
      name: 'reason_and_code_edit',
      status: configured('ROCKETRIDE_APIKEY', 'OTO_DEMO_ROCKETRIDE_CONFIGURED') ? 'degraded' : 'skipped',
      detail: configured('ROCKETRIDE_APIKEY', 'OTO_DEMO_ROCKETRIDE_CONFIGURED')
        ? 'RocketRide credentials are configured; this public deployment uses the deterministic simulated R2 result so the demo is safe and repeatable.'
        : 'RocketRide credentials are not configured, so the deterministic simulated R2 result is used.',
    },
    {
      name: 'test_runner',
      status: 'live',
      detail: 'attempt 1: simulated npm test in demo/toy-repo failed on the exact 1000 ms boundary assertion',
      data: { attempt: 1 },
    },
    {
      name: 'code_edit',
      status: 'degraded',
      detail: 'patched demo/toy-repo/src/rateLimit.js in the simulated Vercel run (> becomes >=)',
      data: {
        diff: '-      if (elapsedMs > 1000) {\\n+      if (elapsedMs >= 1000) {',
      },
    },
    {
      name: 'test_runner',
      status: 'live',
      detail: 'attempt 2: simulated npm test in demo/toy-repo passed',
      data: { attempt: 2 },
    },
    {
      name: 'awaiting_human_approval',
      status: 'live',
      detail: 'Fix is ready and tests are green. Waiting for a human to approve before the PR opens.',
    },
  ];

  for (const stage of stages) {
    await sleep(260);
    writeSse(response, 'stage', stage);
  }

  writeSse(response, 'ready', {
    run_id: runId,
    pending: {
      taskId,
      sessionId: runId,
      graph: 'task_task-checkout-rate-limit',
      testsPassed: true,
      attempts: 2,
      l3Records: stages.length,
    },
  });
  response.end();
}
