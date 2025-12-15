# VPS Deployment Guide for Perplexity MCP

This guide explains how to deploy the Perplexity MCP server on your VPS at `mcp.techmavie.digital/perplexity`.

## Prerequisites

- VPS with Ubuntu/Debian
- Docker and Docker Compose installed
- Nginx installed
- Domain `mcp.techmavie.digital` pointing to your VPS IP
- SSL certificate (via Certbot/Let's Encrypt)
- Perplexity API key (optional - users can provide their own)

## Architecture

```
Client (Claude, Cursor, etc.)
    ↓ HTTPS
https://mcp.techmavie.digital/perplexity/mcp
    ↓
Nginx (SSL termination + reverse proxy)
    ↓ HTTP
Docker Container (port 8086 → 8080)
    ↓
Perplexity API
```

## Deployment Steps

### 1. SSH into your VPS

```bash
ssh root@your-vps-ip
```

### 2. Create directory for the MCP server

```bash
mkdir -p /opt/mcp-servers/perplexity
cd /opt/mcp-servers/perplexity
```

### 3. Clone the repository

```bash
git clone https://github.com/hithereiamaliff/mcp-perplexity.git .
```

### 4. Create environment file (optional)

If you want a default Perplexity API key for all requests:

```bash
nano .env
```

Add your Perplexity API key:
```env
PERPLEXITY_API_KEY=pplx-your_api_key_here
PERPLEXITY_MODEL=sonar-pro
PERPLEXITY_MAX_TOKENS=8192
PERPLEXITY_TEMPERATURE=0.2
```

> **Note:** Users can also provide their own API key via `?apiKey=` query parameter or `X-API-Key` header.

### 5. Build and start the Docker container

```bash
docker compose up -d --build
```

### 6. Verify the container is running

```bash
docker compose ps
docker compose logs -f
```

### 7. Test the health endpoint

```bash
curl http://localhost:8086/health
```

### 8. Configure Nginx

Add the location block from `deploy/nginx-mcp.conf` to your existing nginx config for `mcp.techmavie.digital`:

```bash
# Edit your existing nginx config
sudo nano /etc/nginx/sites-available/mcp.techmavie.digital

# Add the location block from deploy/nginx-mcp.conf inside the server block

# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 9. Test the MCP endpoint

```bash
# Test health endpoint through nginx
curl https://mcp.techmavie.digital/perplexity/health

# Test MCP endpoint (with API key)
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_PERPLEXITY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Client Configuration

### For Claude Desktop / Cursor / Windsurf

Add to your MCP configuration:

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

### For MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# Select "Streamable HTTP"
# Enter URL: https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_PERPLEXITY_API_KEY
```

## Authentication

The server supports three ways to provide a Perplexity API key:

1. **Query Parameter** (recommended for clients): `?apiKey=YOUR_KEY`
2. **Header**: `X-API-Key: YOUR_KEY`
3. **Environment Variable**: `PERPLEXITY_API_KEY` (server default)

If no API key is provided, the server returns an error message.

## Management Commands

### View logs

```bash
cd /opt/mcp-servers/perplexity
docker compose logs -f
```

### Restart the server

```bash
docker compose restart
```

### Update to latest version

```bash
git pull origin main
docker compose up -d --build
```

### Stop the server

```bash
docker compose down
```

## GitHub Actions Auto-Deploy

The repository includes a GitHub Actions workflow (`.github/workflows/deploy-vps.yml`) that automatically deploys to your VPS when you push to the `main` branch.

### Required GitHub Secrets

Set these in your repository settings (Settings → Secrets and variables → Actions):

| Secret | Description |
|--------|-------------|
| `VPS_HOST` | Your VPS IP address |
| `VPS_USERNAME` | SSH username (e.g., root) |
| `VPS_SSH_KEY` | Your private SSH key |
| `VPS_PORT` | SSH port (usually 22) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | HTTP server port (internal) |
| `HOST` | 0.0.0.0 | Bind address |
| `PERPLEXITY_API_KEY` | (optional) | Default Perplexity API key |
| `PERPLEXITY_MODEL` | sonar-pro | Model to use (sonar or sonar-pro) |
| `PERPLEXITY_MAX_TOKENS` | 8192 | Maximum tokens for response |
| `PERPLEXITY_TEMPERATURE` | 0.2 | Temperature for response generation |

## Port Allocation

Based on your existing MCP servers:
- **8080** - Malaysia Transit MCP
- **3001** - Keywords Everywhere MCP
- **8083** - Malaysia Open Data MCP
- **8084** - GitHub MCP
- **8085** - Nextcloud MCP
- **8086** - Perplexity MCP (this server)

## Analytics Dashboard

The MCP server includes a built-in analytics dashboard:

- **Dashboard:** `https://mcp.techmavie.digital/perplexity/analytics/dashboard`
- **API:** `https://mcp.techmavie.digital/perplexity/analytics`

Features:
- Total requests and tool calls
- Tool usage distribution (doughnut chart)
- Hourly request trends (last 24 hours)
- Recent tool calls feed

The dashboard auto-refreshes every 30 seconds.

## Troubleshooting

### Container not starting

```bash
docker compose logs mcp-perplexity
```

### Nginx 502 Bad Gateway

- Check if container is running: `docker compose ps`
- Check container logs: `docker compose logs`
- Verify port binding: `docker port mcp-perplexity`

### Test MCP connection

```bash
# List tools
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call hello tool
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"perplexity_hello","arguments":{}}}'

# Perform a search
curl -X POST "https://mcp.techmavie.digital/perplexity/mcp?apiKey=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"perplexity_search","arguments":{"query":"What is MCP?"}}}'
```
