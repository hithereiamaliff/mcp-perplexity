# Perplexity MCP Server

MCP (Model Context Protocol) server for Perplexity's API Platform - providing AI assistants with real-time web search, reasoning, and research capabilities through Sonar models and the Search API.

> **Fork:** This is a fork of [arjunkmrm/perplexity-search](https://github.com/arjunkmrm/perplexity-search), enhanced with additional tools and self-hosting capabilities based on the official [Perplexity MCP Server](https://github.com/perplexityai/modelcontextprotocol).

**MCP Endpoint:** `https://mcp.techmavie.digital/perplexity/mcp`

**Analytics Dashboard:** [`https://mcp.techmavie.digital/perplexity/analytics/dashboard`](https://mcp.techmavie.digital/perplexity/analytics/dashboard)

---

## What's New (Compared to Original Fork)

This fork significantly extends the original [arjunkmrm/perplexity-search](https://github.com/arjunkmrm/perplexity-search) with the following improvements:

### New Tools Added

The original fork only had a single `search` tool. This version now includes **4 tools** matching the official Perplexity MCP server:

| Tool | Model | Description |
|------|-------|-------------|
| `perplexity_ask` | `sonar-pro` | General conversational AI with real-time web search |
| `perplexity_research` | `sonar-deep-research` | Deep, comprehensive research for thorough analysis |
| `perplexity_reason` | `sonar-reasoning-pro` | Advanced reasoning and problem-solving |
| `perplexity_search` | Search API | Direct web search with ranked results and metadata |

### Self-Hosting Support

- **Streamable HTTP Transport** - Added `src/http-server.ts` for VPS deployment (original only supported Smithery/stdio)
- **Docker Support** - Complete `Dockerfile` and `docker-compose.yml` for containerized deployment
- **Nginx Configuration** - Ready-to-use reverse proxy config for production deployment
- **GitHub Actions** - Auto-deployment workflow on push to main branch

### Analytics Dashboard

- Built-in analytics tracking for all tool calls
- Visual dashboard at `/analytics/dashboard` with:
  - Total requests and tool call counts
  - Tool usage distribution chart
  - Hourly request trends (last 24 hours)
  - Recent tool calls feed
  - Unique client tracking

### Enhanced API Key Handling

- **Query Parameter**: `?apiKey=YOUR_KEY` (recommended for MCP clients)
- **Header**: `X-API-Key: YOUR_KEY`
- **Environment Variable**: `PERPLEXITY_API_KEY` (server default)

### Additional Features

- `strip_thinking` parameter for `perplexity_research` and `perplexity_reason` to remove `<think>...</think>` tags and save context tokens
- Configurable timeout via `PERPLEXITY_TIMEOUT_MS` environment variable (default: 5 minutes)
- Health check endpoint at `/health` for monitoring
- Proper error handling with detailed error messages

---

## Quick Start (Hosted Server)

The easiest way to use this MCP server is via the hosted endpoint. **No installation required!**

### Client Configuration

For Claude Desktop / Cursor / Windsurf, add to your MCP configuration:

```json
{
  "mcpServers": {
    "perplexity": {
      "transport": "streamable-http",
      "url": "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_PERPLEXITY_API_KEY"
    }
  }
}
```

> **Note:** Replace `YOUR_PERPLEXITY_API_KEY` with your [Perplexity API Key](https://www.perplexity.ai/settings/api).

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# Select "Streamable HTTP"
# Enter URL: https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_PERPLEXITY_API_KEY
```

### Test with curl

```bash
# List all available tools
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call the hello tool
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"perplexity_hello","arguments":{}}}'

# Perform a search
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"perplexity_search","arguments":{"query":"What is MCP?"}}}'

# Ask a question
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"perplexity_ask","arguments":{"messages":[{"role":"user","content":"What is MCP?"}]}}}'

# Perform research
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"perplexity_research","arguments":{"messages":[{"role":"user","content":"What is MCP?"}]}}}'

# Reason and solve a problem
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"perplexity_reason","arguments":{"messages":[{"role":"user","content":"What is MCP?"}]}}}'
```

## Features

- **4 powerful tools** matching the official Perplexity MCP server
- Real-time web search, research, and reasoning capabilities
- Built-in analytics dashboard
- Supports user-provided API keys via URL query parameter

## Available Tools

### perplexity_ask

General-purpose conversational AI with real-time web search using the `sonar-pro` model. Great for quick questions and everyday searches.

**Parameters:**
- `messages` (required): Array of conversation messages with `role` and `content`

### perplexity_research

Deep, comprehensive research using the `sonar-deep-research` model. Ideal for thorough analysis and detailed reports.

**Parameters:**
- `messages` (required): Array of conversation messages with `role` and `content`
- `strip_thinking` (optional): If true, removes `<think>...</think>` tags from the response to save context tokens

### perplexity_reason

Advanced reasoning and problem-solving using the `sonar-reasoning-pro` model. Perfect for complex analytical tasks.

**Parameters:**
- `messages` (required): Array of conversation messages with `role` and `content`
- `strip_thinking` (optional): If true, removes `<think>...</think>` tags from the response to save context tokens

### perplexity_search

Direct web search using the Perplexity Search API. Returns ranked search results with titles, URLs, snippets, and metadata.

**Parameters:**
- `query` (required): Search query string
- `max_results` (optional): Maximum number of results (1-20, default: 10)
- `country` (optional): ISO 3166-1 alpha-2 country code for regional results (e.g., US, GB, MY)

### perplexity_hello

A simple test tool to verify that the MCP server is working correctly.

## Authentication

The server supports three ways to provide a Perplexity API key:

1. **Query Parameter** (recommended): `?apiKey=YOUR_KEY`
2. **Header**: `X-API-Key: YOUR_KEY`
3. **Environment Variable**: `PERPLEXITY_API_KEY` (server default)

## Self-Hosting (VPS)

If you prefer to run your own instance, see [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md) for detailed VPS deployment instructions with Docker and Nginx.

```bash
# Using Docker
docker compose up -d --build

# Or run directly
npm run build:tsc
npm run start:http
```

## Local Development

```bash
# Install dependencies
npm install

# Run HTTP server in development mode
npm run dev:http

# Or build and run production version
npm run build:tsc
npm run start:http

# Test health endpoint
curl http://localhost:8080/health
```

## Project Structure

```
├── src/
│   ├── index.ts              # Main MCP server entry point (Smithery)
│   └── http-server.ts        # Streamable HTTP server for VPS
├── deploy/
│   ├── DEPLOYMENT.md         # VPS deployment guide
│   └── nginx-mcp.conf        # Nginx reverse proxy config
├── .github/
│   └── workflows/
│       └── deploy-vps.yml    # GitHub Actions auto-deploy
├── docker-compose.yml        # Docker deployment config
├── Dockerfile                # Container build config
├── package.json              # Project dependencies
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## Response Format

The response from the `perplexity_search` tool includes:

- `content`: The search results content
- `citations`: Array of citations for the information

## License

[MIT](LICENSE)