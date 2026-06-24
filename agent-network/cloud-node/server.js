/**
 * Agent Network Node - Cloud Server Side
 * 
 * Runs alongside OpenClaw on the cloud server.
 * Provides a thin HTTP layer that other agents can call through Cloudflare Tunnel.
 * 
 * Implements Agent Network Protocol v1.0:
 * - Atomic writes (tmp→rename) for state files
 * - Three standard response formats (ok/cannot/need_info)
 * - Event log for cross-agent communication
 * - Pipeline state management
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const SHARED_DIR = process.env.SHARED_DIR || path.join(__dirname, '..', 'shared');
const STATE_DIR = path.join(SHARED_DIR, 'state');
const EVENTS_DIR = path.join(SHARED_DIR, 'events');
const PORT = process.env.PORT || 3003;

// Ensure directories
for (const dir of [SHARED_DIR, STATE_DIR, EVENTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// --- Atomic write (tmp→rename) ---
function atomicWrite(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, data, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function atomicReadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// --- Event log ---
const EVENT_LOG = path.join(EVENTS_DIR, 'event-log.jsonl');

function appendEvent(event) {
  const entry = JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(EVENT_LOG, entry, 'utf8');
}

// --- Three standard response formats ---
function respondOk(res, result) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', result, ts: new Date().toISOString() }));
}

function respondCannot(res, reason) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'cannot', reason, ts: new Date().toISOString() }));
}

function respondNeedInfo(res, question) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'need_info', question, ts: new Date().toISOString() }));
}

// --- Pipeline state ---
const PIPELINE_FILE = path.join(STATE_DIR, 'pipeline.json');

function updatePipelineStep(step, status, output) {
  const pipeline = atomicReadJSON(PIPELINE_FILE) || { steps: {}, updated_at: '' };
  pipeline.steps[step] = {
    status,
    agent: 'shi-cloud',
    ...(output && { output }),
    ...(status === 'done' && { finished_at: new Date().toISOString() }),
    ...(status === 'running' && { started_at: new Date().toISOString() }),
  };
  pipeline.updated_at = new Date().toISOString();
  atomicWrite(PIPELINE_FILE, JSON.stringify(pipeline, null, 2));
}

// --- Agent registry ---
const AGENTS_FILE = path.join(STATE_DIR, 'agents.json');

function registerAgent(agentId, endpoint, capabilities) {
  const agents = atomicReadJSON(AGENTS_FILE) || {};
  agents[agentId] = {
    endpoint,
    capabilities: capabilities || [],
    registered_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };
  atomicWrite(AGENTS_FILE, JSON.stringify(agents, null, 2));
}

function getAgents() {
  return atomicReadJSON(AGENTS_FILE) || {};
}

// --- HTTP Router ---
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // GET /health
  if (pathname === '/health' && method === 'GET') {
    return respondOk(res, {
      agent: 'shi-cloud',
      uptime: process.uptime(),
      agents_registered: Object.keys(getAgents()).length,
      pipeline: !!atomicReadJSON(PIPELINE_FILE),
    });
  }

  // GET /agents - List registered agents
  if (pathname === '/agents' && method === 'GET') {
    return respondOk(res, getAgents());
  }

  // POST /register - Register an agent
  if (pathname === '/register' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { agentId, endpoint, capabilities } = JSON.parse(body);
        if (!agentId || !endpoint) return respondNeedInfo(res, 'agentId and endpoint are required');
        registerAgent(agentId, endpoint, capabilities);
        appendEvent({ event: 'agent.registered', agentId, endpoint });
        respondOk(res, { registered: true });
      } catch {
        respondCannot(res, 'Invalid JSON body');
      }
    });
    return;
  }

  // POST /message - Receive message from other agents
  if (pathname === '/message' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { from, text, type } = JSON.parse(body);
        if (!from || !text) return respondNeedInfo(res, 'from and text are required');
        appendEvent({ event: 'message.received', from, text: text.slice(0, 500), type });
        respondOk(res, { acknowledged: true });
      } catch {
        respondCannot(res, 'Invalid JSON body');
      }
    });
    return;
  }

  // GET /events - Read recent events
  if (pathname === '/events' && method === 'GET') {
    const limit = parseInt(parsedUrl.query.limit) || 50;
    if (!fs.existsSync(EVENT_LOG)) return respondOk(res, []);
    const lines = fs.readFileSync(EVENT_LOG, 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .slice(-limit);
    try {
      respondOk(res, lines.map(l => JSON.parse(l)));
    } catch {
      respondCannot(res, 'Event log corrupted');
    }
    return;
  }

  // GET /pipeline - Read pipeline state
  if (pathname === '/pipeline' && method === 'GET') {
    const pipeline = atomicReadJSON(PIPELINE_FILE);
    if (!pipeline) return respondCannot(res, 'No pipeline state found');
    return respondOk(res, pipeline);
  }

  // POST /pipeline/:step - Update pipeline step
  if (pathname.startsWith('/pipeline/') && method === 'POST') {
    const step = pathname.replace('/pipeline/', '');
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { status, output } = JSON.parse(body);
        if (!status) return respondNeedInfo(res, 'status is required');
        updatePipelineStep(step, status, output);
        appendEvent({ event: 'pipeline.updated', step, status });
        respondOk(res, { updated: true });
      } catch {
        respondCannot(res, 'Invalid JSON body');
      }
    });
    return;
  }

  // POST /relay - Forward task to another agent (message loop prevention)
  if (pathname === '/relay' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { target, prompt, type } = JSON.parse(body);
        if (!target || !prompt) return respondNeedInfo(res, 'target and prompt are required');
        
        const agents = getAgents();
        const agent = agents[target];
        if (!agent) return respondCannot(res, `Agent "${target}" not registered`);
        
        // Message loop prevention: check if this relay creates a cycle
        // Simple rule: don't relay back to the sender
        const senderAgent = Object.entries(agents).find(([id, a]) => 
          a.endpoint === req.headers['x-agent-endpoint']
        );
        if (senderAgent && senderAgent[0] === target) {
          return respondCannot(res, 'Cannot relay back to sender (loop prevention)');
        }

        // Forward to target agent
        const httpReq = http.request(
          agent.endpoint + (type === 'ask' ? '/ask' : '/message'),
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (targetRes) => {
            let targetBody = '';
            targetRes.on('data', chunk => targetBody += chunk);
            targetRes.on('end', () => {
              appendEvent({ event: 'relay.completed', target, type });
              res.writeHead(targetRes.statusCode, targetRes.headers);
              res.end(targetBody);
            });
          }
        );
        httpReq.on('error', (err) => {
          respondCannot(res, `Failed to reach agent "${target}": ${err.message}`);
        });
        httpReq.write(JSON.stringify({ prompt, from: 'shi-cloud' }));
        httpReq.end();
      } catch {
        respondCannot(res, 'Invalid JSON body');
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'cannot', reason: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent Network Node (shi-cloud) running on http://127.0.0.1:${PORT}`);
  console.log('Agent Network Protocol v1.0');
  console.log('Endpoints:');
  console.log('  GET  /health       - Health check');
  console.log('  GET  /agents       - List registered agents');
  console.log('  POST /register     - Register an agent');
  console.log('  POST /message      - Receive message from other agents');
  console.log('  GET  /events       - Recent events');
  console.log('  GET  /pipeline     - Pipeline state');
  console.log('  POST /pipeline/:step - Update pipeline step');
  console.log('  POST /relay        - Forward task to another agent');
  console.log(`Shared directory: ${SHARED_DIR}`);
});
