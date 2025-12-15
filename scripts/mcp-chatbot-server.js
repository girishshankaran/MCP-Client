#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { ChatTargetManager, formatResultContent, loadTargetsFromEnv } from './mcp-client.js';

const DEFAULT_PORT = 4173;
const cliOptions = parseServerCliArgs(process.argv.slice(2));
const resolvedPort = Number(cliOptions.port ?? process.env.CHATBOT_PORT ?? process.env.PORT ?? DEFAULT_PORT);
const port = Number.isFinite(resolvedPort) && resolvedPort > 0 ? resolvedPort : DEFAULT_PORT;
const baseDir = fileURLToPath(new URL('..', import.meta.url));
const publicDir = resolve(baseDir, 'public');
const targets = loadTargetsFromEnv();
if (cliOptions.product) {
  const defaultEntry = targets[0];
  if (defaultEntry) {
    defaultEntry.options.product = defaultEntry.options.product ?? cliOptions.product;
  }
}
const targetManager = new ChatTargetManager(targets);
if (cliOptions.target) {
  targetManager.setDefaultTarget(cliOptions.target);
}
const defaultTarget = targetManager.getDefaultTarget();

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (req.method === 'POST' && requestUrl.pathname === '/api/ask') {
      await handleAsk(req, res);
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/status') {
      const summary = targetManager.getTargetSummary(defaultTarget);
      respondJson(res, 200, {
        connected: summary?.connected ?? false,
        productFilter: summary?.productFilter ?? null,
        connectionLabel: summary?.connectionLabel ?? '',
        target: defaultTarget,
        targets: targetManager.getTargetNames()
      });
      return;
    }

    if (req.method === 'GET') {
      await serveStaticFile(requestUrl.pathname, res);
      return;
    }

    respondJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Server error:', error);
    respondJson(res, 500, { error: error.message ?? 'Internal server error' });
  }
});

server.listen(port, () => {
  console.log(`Chatbot UI available at http://localhost:${port}`);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down chatbot UI server...');
  server.close(() => {
    console.log('HTTP server closed.');
  });
  await targetManager.closeAll();
  process.exit(0);
});

async function handleAsk(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    respondJson(res, 400, { error: error.message ?? 'Invalid request body.' });
    return;
  }
  const question = body.question ?? '';
  const product = body.product?.trim();
  const requestedTarget = body.target?.trim();
  if (requestedTarget && !targetManager.hasTarget(requestedTarget)) {
    respondJson(res, 400, { error: `Unknown target "${requestedTarget}".` });
    return;
  }
  const targetName = requestedTarget || defaultTarget;

  if (!question.trim()) {
    respondJson(res, 400, { error: 'Question cannot be empty.' });
    return;
  }

  try {
    const client = await targetManager.getClient(targetName);
    if (product) {
      client.setProductFilter(product);
    } else if (cliOptions.product && targetName === defaultTarget) {
      client.setProductFilter(cliOptions.product);
    }
    await client.connect();
    const result = await client.ask(question, product ? { product } : {});
    const answer = formatResultContent(result);
    respondJson(res, 200, {
      answer,
      connectionLabel: client.getConnectionLabel(),
      productFilter: client.getProductFilter(),
      target: targetName
    });
  } catch (error) {
    respondJson(res, 500, { error: error.message ?? 'Unable to call MCP tool.' });
  }
}

async function serveStaticFile(pathname, res) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(publicDir, '.' + safePath);
  if (!filePath.startsWith(publicDir)) {
    respondJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const data = await readFile(filePath);
    const contentType = mimeType(extname(filePath));
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      respondJson(res, 404, { error: 'Not found' });
      return;
    }
    throw error;
  }
}

function mimeType(ext) {
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function respondJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        rejectPromise(new Error('Request body too large.'));
        req.pause();
      }
    });
    req.on('end', () => {
      try {
        resolvePromise(data ? JSON.parse(data) : {});
      } catch (error) {
        rejectPromise(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', rejectPromise);
  });
}

function parseServerCliArgs(rawArgs) {
  const options = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--port' || arg === '-P') {
      options.port = rawArgs[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      options.port = arg.slice('--port='.length);
      continue;
    }
    if (arg === '--product' || arg === '-p') {
      options.product = rawArgs[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--product=')) {
      options.product = arg.slice('--product='.length);
      continue;
    }
    if (arg === '--server' || arg === '--target' || arg === '-s') {
      options.target = rawArgs[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--server=') || arg.startsWith('--target=')) {
      options.target = arg.split('=').slice(1).join('=');
      continue;
    }
  }
  if (typeof options.product === 'string') {
    const trimmed = options.product.trim();
    options.product = trimmed ? trimmed : undefined;
  }
  if (typeof options.target === 'string') {
    const trimmed = options.target.trim();
    options.target = trimmed ? trimmed : undefined;
  }
  return options;
}
