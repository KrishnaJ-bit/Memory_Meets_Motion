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

export default async function handler(request, response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  const approved = request.query?.approved === 'true';
  const repo = process.env.ROCKETRIDE_TARGET_REPO ?? 'KrishnaJ-bit/Memory_Meets_Motion';
  const repoUrl = `https://github.com/${repo}`;
  const stages = [
    {
      name: 'human_approval_gate',
      status: approved ? 'live' : 'skipped',
      detail: approved ? 'Human approved: opening the simulated PR handoff.' : 'Human declined: no PR will be opened.',
    },
    {
      name: 'falkordb_write_back',
      status: 'degraded',
      detail: configured('FALKORDB_URL', 'OTO_DEMO_FALKORDB_CONFIGURED')
        ? "F6: wrote simulated agent-authored Step/Decision evidence for the public run (author:'agent') and closed the inherited blocker. Private/local runs write this to FalkorDB."
        : "F6: wrote simulated agent-authored Step/Decision evidence (author:'agent') to the public fixture result.",
      data: {
        step_id: `step_agent_vercel_${Date.now()}`,
        node_counts: { Task: 1, Step: 5, Decision: 4, File: 3, Blocker: 1, Agent: 1 },
      },
    },
    {
      name: 'open_pr',
      status: approved ? 'degraded' : 'skipped',
      detail: approved
        ? `Public Vercel deployment stops at a simulated PR handoff for safety. Local Oto.ai runs can open the real PR against ${repo}.`
        : 'skipped: human did not approve',
      data: approved ? { repo_url: repoUrl } : undefined,
    },
    {
      name: 'guild_g3_pr_risk_review',
      status: approved && configured('GUILD_WORKSPACE_ID', 'OTO_DEMO_GUILD_CONFIGURED') ? 'degraded' : 'skipped',
      detail:
        approved && configured('GUILD_WORKSPACE_ID', 'OTO_DEMO_GUILD_CONFIGURED')
          ? 'G3 pr-risk-review is represented in the public simulated audit trail; run locally with Guild CLI auth for hosted Guild session evidence.'
          : 'G3 review skipped for this public run.',
    },
  ];

  for (const stage of stages) {
    await sleep(260);
    writeSse(response, 'stage', stage);
  }

  writeSse(response, 'done', {
    taskId: 'task-checkout-rate-limit',
    sessionId: request.query?.run_id ?? `vercel-${Date.now()}`,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    stages,
    testsPassed: true,
    attempts: 2,
    patchApplied: true,
    graph: 'task_task-checkout-rate-limit',
    l3Records: approved ? 13 : 11,
    approved,
    prUrl: approved ? repoUrl : undefined,
    simulated: true,
  });
  response.end();
}
