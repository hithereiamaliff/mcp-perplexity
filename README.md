# Perplexity Search MCP

MCP (Model Context Protocol) server for Perplexity's web search API with sonar or sonar-pro models.

> **Note:** This is a fork of [arjunkmrm/perplexity-search](https://github.com/arjunkmrm/perplexity-search).

**MCP Endpoint:** `https://mcp.techmavie.digital/perplexity/mcp`

**Analytics Dashboard:** [`https://mcp.techmavie.digital/perplexity/analytics/dashboard`](https://mcp.techmavie.digital/perplexity/analytics/dashboard)

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
```

## Features

- Provides a `perplexity_search` tool for AI assistants to perform web searches
- Uses Perplexity's chat completions API with the sonar/sonar-pro models
- Built-in analytics dashboard
- Supports user-provided API keys via URL query parameter

## Available Tools

### perplexity_search

Perform a web search using Perplexity's API with detailed and contextually relevant results with citations.

**Parameters:**
- `query` (required): The search query to perform
- `search_recency_filter` (optional): Filter search results by recency (options: month, week, day, hour)

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

MIT