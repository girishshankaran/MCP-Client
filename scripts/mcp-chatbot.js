#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { McpChatClient, formatResultContent } from './mcp-client.js';

const chatbotClient = new McpChatClient();

async function bootstrap() {
  try {
    await chatbotClient.connect();
    console.log(`Connected (${chatbotClient.getConnectionLabel()}) and ready to call ${chatbotClient.toolName}.`);
    announceProductFilter();
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
    const result = await chatbotClient.ask(question);
    printResult(result);
  } catch (error) {
    console.error('Tool call failed:', error.message ?? error);
  }
}

function printResult(result) {
  const formatted = formatResultContent(result);
  console.log(`\n${formatted}\n`);
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
        const handled = handleCommand(trimmed);
        if (handled) {
          continue;
        }
        console.log('Unknown command. Available: /product <name>, /product clear, /exit.');
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
  await chatbotClient.close();
}

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, closing the chatbot.');
  await cleanup();
  process.exit(0);
});

(async () => {
  await bootstrap();
  const cliArgs = process.argv.slice(2);
  const { question: singleQuestion, productFromCli } = parseCliArgs(cliArgs);
  if (productFromCli !== undefined) {
    chatbotClient.setProductFilter(productFromCli);
    announceProductFilter();
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
    remaining.push(arg);
  }
  return { question: remaining.join(' ').trim(), productFromCli: productValue };
}

function handleCommand(input) {
  const [command, ...rest] = input.slice(1).split(/\s+/);
  switch (command.toLowerCase()) {
    case 'product':
      if (rest.length === 0) {
        announceProductFilter();
        return true;
      }
      if (rest[0].toLowerCase() === 'clear') {
        chatbotClient.setProductFilter('');
        return true;
      }
      chatbotClient.setProductFilter(rest.join(' '));
      announceProductFilter();
      return true;
    case 'exit':
    case 'quit':
      process.exit(0);
      return true;
    default:
      return false;
  }
}

function announceProductFilter() {
  const filter = chatbotClient.getProductFilter();
  if (filter) {
    console.log(`Product filter: ${filter}`);
  } else {
    console.log(
      'No product filter set. Use /product <name>, --product "<name>", or MCP_PRODUCT env var for better results.'
    );
  }
}
