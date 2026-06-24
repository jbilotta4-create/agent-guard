const { spawn } = require('child_process');
const express = require('express');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'codex', timestamp: new Date().toISOString() });
});

// Ask Codex a question (print mode)
app.post('/ask', async (req, res) => {
  const { prompt, model, timeout: timeoutMs } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const args = ['-p', prompt, '--output-format', 'json'];
  if (model) args.push('--model', model);

  const timeout = timeoutMs || 300000;
  const proc = spawn('codex', args, { timeout });
  let output = '';
  let errorOutput = '';

  proc.stdout.on('data', d => output += d.toString());
  proc.stderr.on('data', d => errorOutput += d.toString());

  proc.on('close', (code) => {
    if (code !== 0 && !output) {
      return res.status(500).json({ error: errorOutput || 'Process failed', code });
    }
    try {
      res.json(JSON.parse(output));
    } catch {
      res.json({ result: output.trim() });
    }
  });

  proc.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
});

// List available models (proxy to codex)
app.get('/models', (req, res) => {
  const proc = spawn('codex', ['--list-models'], { timeout: 10000 });
  let output = '';
  proc.stdout.on('data', d => output += d.toString());
  proc.on('close', () => {
    try { res.json(JSON.parse(output)); }
    catch { res.json({ models: output.trim().split('\n').filter(Boolean) }); }
  });
  proc.on('error', (err) => res.status(500).json({ error: err.message }));
});

const PORT = process.env.CODEX_PORT || 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Codex HTTP bridge running on http://localhost:${PORT}`);
  console.log(`  POST /ask    - Send a prompt to Codex`);
  console.log(`  GET  /health - Health check`);
  console.log(`  GET  /models - List available models`);
});
