# Cisco Docs MCP Chatbot

This repository now includes a small Node.js client that connects to Cisco's documentation MCP server (`https://docs-ai.cloudapps.cisco.com/mcp/sse`) and lets you ask questions from the terminal.

## Prerequisites
- Node.js 18+ (Node 23.10.0 is bundled with the Codex CLI).
- An API key from `https://docs-ai.cloudapps.cisco.com/register`.
- Local network access (the CLI sandbox blocks outbound network calls, so run it directly on your machine).

## Configuration
Set the following environment variables before running the chatbot:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `MCP_API_KEY` | ✅ | – | Your Cisco Docs key. You can also use `CISCO_DOCS_API_KEY` or `X_API_KEY`. |
| `MCP_PRODUCT` | ✅/❌ | – | Optional product filter (e.g., `Cisco Secure Client`). Greatly improves answer quality. Also accepts `DOCS_PRODUCT`. |
| `MCP_SSE_URL` (or legacy `MCP_SERVER_URL`) | ❌ | `https://docs-ai.cloudapps.cisco.com/mcp/sse` | SSE endpoint. Leave default unless Cisco confirms a different path. |
| `MCP_STREAMABLE_URL` | ❌ | `https://docs-ai.cloudapps.cisco.com/mcp` | HTTP endpoint tried before SSE. If you override `MCP_SSE_URL`, the streamable default derives from it without the `/sse` suffix. |
| `MCP_TRANSPORT` | ❌ | `auto` | Set to `streamable` or `sse` to force a specific transport if one of them misbehaves. |
| `MCP_TOOL_NAME` | ❌ | `ask_cisco_documentation` | A different tool name exposed by the server. |
| `MCP_EXTRA_ARGS` | ❌ | `{}` | JSON payload merged into every tool call (useful for optional filters). |
| `CHATBOT_PORT` (or `PORT`) | ❌ | `4173` | Port for the web UI server; CLI `--port` takes precedence. |

Example shell profile entry:

```bash
export MCP_API_KEY="<redacted>"
```

## Install & Run
```bash
npm install       # already done in this repo, rerun if package-lock changes
npm run chatbot   # interactive mode
# or
npm run chatbot -- "How do I troubleshoot ACI fabric?"  # one-off question
# with an explicit product filter
npm run chatbot -- --product "Cisco ACI" "How do I troubleshoot ACI fabric?"
# force streamable transport if SSE errors
MCP_TRANSPORT=streamable npm run chatbot -- --product "Cisco ACI" "How do I troubleshoot ACI fabric?"
```

During the first connection the client lists available tools and looks for `ask_cisco_documentation`. If the server updates its schema, the client automatically inspects the tool input schema and uses the first string argument (preferring `query` / `question`).

Transport selection defaults to Streamable HTTP (new MCP spec) with an automatic fallback to SSE. If you need to force one, export `MCP_TRANSPORT=streamable` or `MCP_TRANSPORT=sse`. A 404 when using SSE usually means the server expects the Streamable HTTP endpoint instead.

## Web UI
A lightweight HTTP wrapper is available if you prefer a browser-based chat window. It shares the same environment variables as the CLI client.

```bash
# defaults to http://localhost:4173
MCP_API_KEY="<redacted>" npm run chatbot:ui

# choose a different port
CHATBOT_PORT=5000 npm run chatbot:ui
# or equivalently
MCP_API_KEY="<redacted>" npm run chatbot:ui -- --port 5000
# shorthand helper
MCP_API_KEY="<redacted>" npm run chatbot:5000
```

Open the printed URL to access the UI. The page lets you submit a question, optionally add a product keyword, and view the responses inline. Server logs appear in the terminal window that launched the UI.

To lock in a default product filter for the UI server, pass `--product "<name>"` (or set `MCP_PRODUCT`) when launching it. The browser form still lets you override the product per question.

### Product filter quick controls
- Environment variable: `export MCP_PRODUCT="Cisco ACI"`
- CLI flag: `npm run chatbot -- --product "Cisco ACI" "question..."`
- Interactive command: While running, type `/product Cisco ACI` to set or `/product clear` to remove.

## Output
Results stream back as Model Context Protocol tool content. Text sections are printed directly; JSON/object payloads are pretty-printed; other media types are acknowledged but not rendered. Errors from the MCP server are surfaced verbatim so you can adjust inputs or credentials.

## Notes
- The CLI sandbox cannot reach the Cisco endpoint, so the chatbot was only smoke-tested up to the network boundary. Run it on a machine with outbound access to complete the flow.
- `Ctrl+C` or typing `/exit` cleanly shuts down the session.
