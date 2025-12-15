#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ChatTargetManager, formatResultContent, loadTargetsFromEnv } from './mcp-client.js';

const targets = loadTargetsFromEnv();
const targetManager = new ChatTargetManager(targets);
let activeTarget = targetManager.getDefaultTarget();

async function bootstrap() {
  try {
    const client = await targetManager.getClient(activeTarget);
    await client.connect();
    console.log(
      `Connected to "${activeTarget}" (${client.getConnectionLabel()}) and ready to call ${client.toolName}.`
    );
    announceProductFilter(client);
    console.log('Type your question (or /exit to quit).');
  } catch (error) {
    console.error('Unable to start chatbot:', error.message ?? error);
    await cleanup();
    process.exit(1);
  }
}

async function ask(question) {
  if (!question?.trim()) {
    return;
  }
  try {
    const client = await targetManager.getClient(activeTarget);
    const result = await client.ask(question);
    printResult(result, activeTarget);
  } catch (error) {
    console.error(`[${activeTarget}] Tool call failed:`, error.message ?? error);
  }
}

function printResult(result, targetName) {
  const formatted = formatResultContent(result);
  console.log(`\n[${targetName}] ${formatted}\n`);
}

async function interactiveLoop() {
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const question = await rl.question('you> ');
      const trimmed = question.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed.startsWith('/')) {
        const handled = await handleCommand(trimmed);
        if (handled) {
          continue;
        }
        console.log('Unknown command. Available: /product <name>, /product clear, /server <name>, /exit.');
        continue;
      }
      if (trimmed === '/exit' || trimmed === '/quit') {
        break;
      }
      await ask(trimmed);
    }
  } finally {
    rl.close();
  }
}

async function cleanup() {
  await targetManager.closeAll();
}

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, closing the chatbot.');
  await cleanup();
  process.exit(0);
});

(async () => {
  const cliArgs = process.argv.slice(2);
  const { question: singleQuestion, productFromCli, targetFromCli } = parseCliArgs(cliArgs);
  if (targetFromCli) {
    if (!targetManager.hasTarget(targetFromCli)) {
      console.error(`Unknown target "${targetFromCli}". Available: ${targetManager.getTargetNames().join(', ')}.`);
      process.exit(1);
    }
    activeTarget = targetFromCli;
  }
  await bootstrap();
  if (productFromCli !== undefined) {
    const client = await targetManager.getClient(activeTarget);
    client.setProductFilter(productFromCli);
    announceProductFilter(client);
  }
  if (singleQuestion) {
    await ask(singleQuestion);
    await cleanup();
    process.exit(0);
  }
  await interactiveLoop();
  await cleanup();
})();

function parseCliArgs(rawArgs) {
  const remaining = [];
  let productValue;
  let targetValue;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--product' || arg === '-p') {
      productValue = rawArgs[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--product=')) {
      productValue = arg.slice('--product='.length);
      continue;
    }
    if (arg === '--server' || arg === '--target' || arg === '-s') {
      targetValue = rawArgs[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--server=') || arg.startsWith('--target=')) {
      targetValue = arg.split('=').slice(1).join('=');
      continue;
    }
    remaining.push(arg);
  }
  return { question: remaining.join(' ').trim(), productFromCli: productValue, targetFromCli: targetValue?.trim() };
}

async function handleCommand(input) {
  const [command, ...rest] = input.slice(1).split(/\s+/);
  switch (command.toLowerCase()) {
    case 'product': {
      const client = await targetManager.getClient(activeTarget);
      if (rest.length === 0) {
        announceProductFilter(client);
        return true;
      }
      if (rest[0].toLowerCase() === 'clear') {
        client.setProductFilter('');
        announceProductFilter(client);
        return true;
      }
      client.setProductFilter(rest.join(' '));
      announceProductFilter(client);
      return true;
    }
    case 'server':
    case 'target': {
      if (!rest.length) {
        console.log(`Active target: ${activeTarget}`);
        console.log(`Available targets: ${targetManager.getTargetNames().join(', ')}`);
        return true;
      }
      const nextTarget = rest.join(' ');
      if (!targetManager.hasTarget(nextTarget)) {
        console.log(`Unknown target "${nextTarget}". Available: ${targetManager.getTargetNames().join(', ')}`);
        return true;
      }
      activeTarget = nextTarget;
      const client = await targetManager.getClient(activeTarget);
      console.log(`Switched to target "${activeTarget}".`);
      announceProductFilter(client);
      return true;
    }
    case 'exit':
    case 'quit':
      process.exit(0);
      return true;
    default:
      return false;
  }
}

function announceProductFilter(client) {
  const filter = client.getProductFilter();
  if (filter) {
    console.log(`[${activeTarget}] Product filter: ${filter}`);
  } else {
    console.log(
      `[${activeTarget}] No product filter set. Use /product <name>, --product "<name>", or MCP_PRODUCT env var for better results.`
    );
  }
}
