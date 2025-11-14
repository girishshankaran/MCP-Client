import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DEFAULT_SSE_URL = 'https://docs-ai.cloudapps.cisco.com/mcp/sse';
const DEFAULT_TOOL_NAME = 'ask_cisco_documentation';

export class McpChatClient {
  constructor(options = {}) {
    this.sseUrl = options.sseUrl ?? process.env.MCP_SSE_URL ?? process.env.MCP_SERVER_URL ?? DEFAULT_SSE_URL;
    this.streamableUrl =
      options.streamableUrl ??
      process.env.MCP_STREAMABLE_URL ??
      stripSseSuffix(this.sseUrl) ??
      'https://docs-ai.cloudapps.cisco.com/mcp';
    this.apiKey = options.apiKey ?? process.env.MCP_API_KEY ?? process.env.CISCO_DOCS_API_KEY ?? process.env.X_API_KEY;
    this.toolName = options.toolName ?? process.env.MCP_TOOL_NAME ?? DEFAULT_TOOL_NAME;
    this.transportPreference = (options.transportPreference ?? process.env.MCP_TRANSPORT ?? 'auto').toLowerCase();
    this.staticArgs = { ...(options.staticArgs ?? safeParseJson(process.env.MCP_EXTRA_ARGS) ?? {}) };
    const initialProduct = options.product ?? process.env.MCP_PRODUCT ?? process.env.DOCS_PRODUCT ?? '';
    this.productFilter = initialProduct.trim() || null;
    this.client = undefined;
    this.transport = undefined;
    this.connectionLabel = '';
    this.primaryArgKey = 'query';
    this.selectedTool = undefined;
    this.connectPromise = null;
  }

  isConnected() {
    return Boolean(this.client);
  }

  getProductFilter() {
    return this.productFilter;
  }

  setProductFilter(value) {
    this.productFilter = value?.trim() ? value.trim() : null;
    return this.productFilter;
  }

  getConnectionLabel() {
    return this.connectionLabel;
  }

  async connect() {
    if (this.client) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.#connectInternal();
    }
    await this.connectPromise;
  }

  async #connectInternal() {
    if (!this.apiKey) {
      throw new Error('Missing API key. Set MCP_API_KEY (or CISCO_DOCS_API_KEY) before using the chatbot.');
    }
    try {
      const headers = { 'X-API-Key': this.apiKey };
      const requestInit = { headers: { ...headers, 'Content-Type': 'application/json' } };

      const { client, transport, connectionLabel } = await connectWithFallback({
        headers,
        requestInit,
        transportPreference: this.transportPreference,
        sseUrl: this.sseUrl,
        streamableUrl: this.streamableUrl
      });

      this.client = client;
      this.transport = transport;
      this.connectionLabel = connectionLabel;

      const { tools } = await this.client.listTools();
      this.selectedTool = tools.find((tool) => tool.name === this.toolName);
      if (!this.selectedTool) {
        throw new Error(`Tool "${this.toolName}" is not exposed by the MCP server.`);
      }

      this.primaryArgKey = pickPrimaryArgument(this.selectedTool.inputSchema) ?? this.primaryArgKey;
    } finally {
      this.connectPromise = null;
    }
  }

  async ask(question, argOverrides = {}) {
    const trimmed = question?.trim();
    if (!trimmed) {
      throw new Error('Question cannot be empty.');
    }
    if (!this.client) {
      await this.connect();
    }
    if (!this.client || !this.selectedTool) {
      throw new Error('Client is not connected.');
    }
    const args = { ...this.staticArgs, ...argOverrides };
    args[this.primaryArgKey] = trimmed;
    if (this.productFilter && !args.product) {
      args.product = this.productFilter;
    }

    return this.client.callTool({
      name: this.toolName,
      arguments: args
    });
  }

  async close() {
    if (this.client?.close) {
      try {
        await this.client.close();
      } catch (_) {
        // ignore shutdown errors
      }
    }
    if (this.transport?.close) {
      try {
        await this.transport.close();
      } catch (_) {
        // ignore shutdown errors
      }
    }
    this.client = undefined;
    this.transport = undefined;
    this.selectedTool = undefined;
    this.connectionLabel = '';
  }
}

async function connectWithFallback(initOptions) {
  const attempts = buildTransportAttempts(initOptions);
  if (!attempts.length) {
    throw new Error('No transport attempts configured. Set MCP_TRANSPORT to "sse" or "streamable".');
  }

  let lastError;
  for (const attempt of attempts) {
    const candidateClient = new Client({
      name: 'sea-guide-chatbot',
      version: '0.1.0'
    });

    const candidateTransport = attempt.create();
    try {
      await candidateClient.connect(candidateTransport);
      return { client: candidateClient, transport: candidateTransport, connectionLabel: attempt.label };
    } catch (error) {
      lastError = error;
      console.warn(`Transport "${attempt.label}" failed: ${error.message ?? error}`);
      await candidateClient.close?.().catch(() => {});
      await candidateTransport.close?.().catch(() => {});
    }
  }

  throw lastError ?? new Error('All transports failed to connect.');
}

function buildTransportAttempts({ headers, requestInit, transportPreference, sseUrl, streamableUrl }) {
  const attempts = [];
  const normalizedPreference = ['sse', 'streamable'].includes(transportPreference) ? transportPreference : 'auto';

  if (normalizedPreference === 'streamable' || normalizedPreference === 'auto') {
    attempts.push({
      label: `streamable-http @ ${streamableUrl}`,
      create: () =>
        new StreamableHTTPClientTransport(new URL(streamableUrl), {
          requestInit
        })
    });
  }

  if (normalizedPreference === 'sse' || normalizedPreference === 'auto') {
    attempts.push({
      label: `sse @ ${sseUrl}`,
      create: () =>
        new SSEClientTransport(new URL(sseUrl), {
          eventSourceInit: { headers },
          requestInit
        })
    });
  }

  return attempts;
}

function pickPrimaryArgument(schema) {
  if (!schema || schema.type !== 'object') {
    return null;
  }

  const props = schema.properties ?? {};
  if (props.query) {
    return 'query';
  }
  if (props.question) {
    return 'question';
  }
  const entries = Object.keys(props);
  if (entries.length === 1) {
    return entries[0];
  }
  const stringOnly = entries.filter((key) => props[key]?.type === 'string');
  if (stringOnly.length === 1) {
    return stringOnly[0];
  }
  return null;
}

function safeParseJson(payload) {
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload);
  } catch {
    console.warn('MCP_EXTRA_ARGS is not valid JSON. Ignoring value.');
    return null;
  }
}

function stripSseSuffix(urlString) {
  if (!urlString) {
    return urlString;
  }
  return urlString.replace(/\/sse\/?$/i, '');
}

export function formatResultContent(result) {
  const content = result?.content ?? [];
  const sections = [];
  for (const chunk of content) {
    switch (chunk.type) {
      case 'text':
        if (chunk.text?.trim()) {
          sections.push(chunk.text.trim());
        }
        break;
      case 'object':
        sections.push(JSON.stringify(chunk.data ?? {}, null, 2));
        break;
      default:
        sections.push(`[${chunk.type} content not rendered]`);
    }
  }
  if (!sections.length) {
    sections.push('Tool returned no text content. Inspect full payload below:');
    sections.push(JSON.stringify(result ?? {}, null, 2));
  }
  return sections.join('\n\n');
}
