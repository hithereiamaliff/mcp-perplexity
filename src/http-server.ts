/**
 * Perplexity MCP Server - Streamable HTTP Transport
 * 
 * This file provides an HTTP server for self-hosting the MCP server on a VPS.
 * It uses the Streamable HTTP transport for MCP communication.
 * 
 * Usage:
 *   npm run build:tsc
 *   node dist/http-server.js
 * 
 * Or with environment variables:
 *   PORT=8080 PERPLEXITY_API_KEY=your_key node dist/http-server.js
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import axios, { AxiosError } from 'axios';

// Define interface for error response
interface PerplexityErrorResponse {
  error?: string;
  message?: string;
}

// Configuration
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Default config from environment
const DEFAULT_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const DEFAULT_MODEL = (process.env.PERPLEXITY_MODEL || 'sonar-pro') as 'sonar' | 'sonar-pro';
const DEFAULT_MAX_TOKENS = parseInt(process.env.PERPLEXITY_MAX_TOKENS || '8192', 10);
const DEFAULT_TEMPERATURE = parseFloat(process.env.PERPLEXITY_TEMPERATURE || '0.2');

// Per-request API key storage
let requestApiKey: string | null = null;

function getApiKey(): string {
  return requestApiKey || DEFAULT_API_KEY;
}

// Analytics tracking
interface ToolCall {
  tool: string;
  timestamp: string;
  clientIp: string;
  userAgent: string;
}

interface Analytics {
  serverStartTime: string;
  totalRequests: number;
  totalToolCalls: number;
  requestsByMethod: Record<string, number>;
  requestsByEndpoint: Record<string, number>;
  toolCalls: Record<string, number>;
  recentToolCalls: ToolCall[];
  clientsByIp: Record<string, number>;
  clientsByUserAgent: Record<string, number>;
  hourlyRequests: Record<string, number>;
}

const analytics: Analytics = {
  serverStartTime: new Date().toISOString(),
  totalRequests: 0,
  totalToolCalls: 0,
  requestsByMethod: {},
  requestsByEndpoint: {},
  toolCalls: {},
  recentToolCalls: [],
  clientsByIp: {},
  clientsByUserAgent: {},
  hourlyRequests: {},
};

const MAX_RECENT_CALLS = 100;

function trackRequest(req: Request, endpoint: string) {
  analytics.totalRequests++;
  
  const method = req.method;
  analytics.requestsByMethod[method] = (analytics.requestsByMethod[method] || 0) + 1;
  
  analytics.requestsByEndpoint[endpoint] = (analytics.requestsByEndpoint[endpoint] || 0) + 1;
  
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
  analytics.clientsByIp[clientIp] = (analytics.clientsByIp[clientIp] || 0) + 1;
  
  const userAgent = req.headers['user-agent'] || 'unknown';
  const shortAgent = userAgent.substring(0, 50);
  analytics.clientsByUserAgent[shortAgent] = (analytics.clientsByUserAgent[shortAgent] || 0) + 1;
  
  const hour = new Date().toISOString().substring(0, 13);
  analytics.hourlyRequests[hour] = (analytics.hourlyRequests[hour] || 0) + 1;
}

function trackToolCall(toolName: string, req: Request) {
  analytics.totalToolCalls++;
  analytics.toolCalls[toolName] = (analytics.toolCalls[toolName] || 0) + 1;
  
  const toolCall: ToolCall = {
    tool: toolName,
    timestamp: new Date().toISOString(),
    clientIp: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown',
    userAgent: (req.headers['user-agent'] || 'unknown').substring(0, 50),
  };
  
  analytics.recentToolCalls.unshift(toolCall);
  if (analytics.recentToolCalls.length > MAX_RECENT_CALLS) {
    analytics.recentToolCalls.pop();
  }
}

function getUptime(): string {
  const start = new Date(analytics.serverStartTime).getTime();
  const now = Date.now();
  const diff = now - start;
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Create MCP server
const mcpServer = new McpServer({
  name: 'Perplexity Search MCP Server',
  version: '1.0.0',
});

// Register the search tool
mcpServer.tool(
  'perplexity_search',
  'Perform a web search using Perplexity\'s API, which provides detailed and contextually relevant results with citations. By default, no time filtering is applied to search results.',
  {
    query: z.string().describe('The search query to perform'),
    search_recency_filter: z.enum(['month', 'week', 'day', 'hour']).optional().describe('Filter search results by recency (options: month, week, day, hour). If not specified, no time filtering is applied.'),
  },
  async ({ query, search_recency_filter }) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        content: [{
          type: 'text' as const,
          text: 'Error: No Perplexity API key available. Please provide your API key via URL query param (?apiKey=YOUR_KEY) or contact the server administrator.',
        }],
        isError: true,
      };
    }

    try {
      const payload: Record<string, unknown> = {
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'user',
            content: query,
          },
        ],
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
      };

      if (search_recency_filter) {
        payload.search_recency_filter = search_recency_filter;
      }

      console.log(`Perplexity search: model=${DEFAULT_MODEL}, query="${query.substring(0, 50)}..."`);

      const response = await axios.post('https://api.perplexity.ai/chat/completions', payload, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const formattedResponse = {
        content: response.data.choices[0].message.content,
        citations: response.data.citations || [],
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(formattedResponse, null, 2),
        }],
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<PerplexityErrorResponse>;
        const errorData = axiosError.response?.data;
        const errorMessage = errorData?.error || errorData?.message || axiosError.message;

        return {
          content: [{
            type: 'text' as const,
            text: `Perplexity API error: ${errorMessage}`,
          }],
          isError: true,
        };
      }
      throw error;
    }
  }
);

// Register hello tool for testing
mcpServer.tool(
  'perplexity_hello',
  'A simple test tool to verify that the MCP server is working correctly',
  {},
  async () => {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          message: 'Hello from Perplexity Search MCP Server!',
          timestamp: new Date().toISOString(),
          transport: 'streamable-http',
          hasApiKey: !!getApiKey(),
          model: DEFAULT_MODEL,
        }, null, 2),
      }],
    };
  }
);

// Create Express app
const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'Mcp-Session-Id', 'X-API-Key'],
  exposedHeaders: ['Mcp-Session-Id'],
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  trackRequest(req, '/health');
  res.json({
    status: 'healthy',
    server: 'Perplexity Search MCP',
    version: '1.0.0',
    transport: 'streamable-http',
    timestamp: new Date().toISOString(),
    hasDefaultApiKey: !!DEFAULT_API_KEY,
  });
});

// Analytics endpoint - summary
app.get('/analytics', (req: Request, res: Response) => {
  trackRequest(req, '/analytics');
  
  const sortedTools = Object.entries(analytics.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  
  const sortedClients = Object.entries(analytics.clientsByIp)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  
  const last24Hours = Object.entries(analytics.hourlyRequests)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 24)
    .reverse()
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  
  res.json({
    server: 'Perplexity Search MCP',
    uptime: getUptime(),
    serverStartTime: analytics.serverStartTime,
    summary: {
      totalRequests: analytics.totalRequests,
      totalToolCalls: analytics.totalToolCalls,
      uniqueClients: Object.keys(analytics.clientsByIp).length,
    },
    breakdown: {
      byMethod: analytics.requestsByMethod,
      byEndpoint: analytics.requestsByEndpoint,
      byTool: sortedTools,
    },
    clients: {
      byIp: sortedClients,
      byUserAgent: analytics.clientsByUserAgent,
    },
    hourlyRequests: last24Hours,
    recentToolCalls: analytics.recentToolCalls.slice(0, 20),
  });
});

// Analytics endpoint - detailed tool stats
app.get('/analytics/tools', (req: Request, res: Response) => {
  trackRequest(req, '/analytics/tools');
  
  const sortedTools = Object.entries(analytics.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .map(([tool, count]) => ({
      tool,
      count,
      percentage: analytics.totalToolCalls > 0
        ? ((count / analytics.totalToolCalls) * 100).toFixed(1) + '%'
        : '0%',
    }));
  
  res.json({
    totalToolCalls: analytics.totalToolCalls,
    tools: sortedTools,
    recentCalls: analytics.recentToolCalls,
  });
});

// Analytics dashboard - visual HTML page
app.get('/analytics/dashboard', (req: Request, res: Response) => {
  trackRequest(req, '/analytics/dashboard');
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Perplexity MCP - Analytics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #e4e4e7;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
    }
    header h1 {
      font-size: 2rem;
      background: linear-gradient(90deg, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    header p { color: #a1a1aa; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      border: 1px solid rgba(255,255,255,0.1);
      transition: transform 0.2s;
    }
    .stat-card:hover { transform: translateY(-2px); }
    .stat-card h3 { color: #a1a1aa; font-size: 0.875rem; margin-bottom: 8px; }
    .stat-card .value { font-size: 2rem; font-weight: bold; color: #60a5fa; }
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .chart-card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .chart-card h3 { margin-bottom: 16px; color: #e4e4e7; }
    .recent-calls {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .recent-calls h3 { margin-bottom: 16px; }
    .call-item {
      display: flex;
      justify-content: space-between;
      padding: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .call-item:last-child { border-bottom: none; }
    .call-tool { color: #60a5fa; font-weight: 500; }
    .call-time { color: #a1a1aa; font-size: 0.875rem; }
    .loading { text-align: center; padding: 40px; color: #a1a1aa; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔍 Perplexity MCP Analytics</h1>
      <p>Real-time usage statistics</p>
    </header>
    
    <div id="content" class="loading">Loading analytics...</div>
  </div>

  <script>
    async function loadData() {
      try {
        const basePath = window.location.pathname.replace(/\\/analytics\\/dashboard\\/?$/, '');
        const res = await fetch(basePath + '/analytics');
        const data = await res.json();
        
        document.getElementById('content').innerHTML = \`
          <div class="stats-grid">
            <div class="stat-card">
              <h3>Total Requests</h3>
              <div class="value">\${data.summary.totalRequests.toLocaleString()}</div>
            </div>
            <div class="stat-card">
              <h3>Tool Calls</h3>
              <div class="value">\${data.summary.totalToolCalls.toLocaleString()}</div>
            </div>
            <div class="stat-card">
              <h3>Unique Clients</h3>
              <div class="value">\${data.summary.uniqueClients.toLocaleString()}</div>
            </div>
            <div class="stat-card">
              <h3>Uptime</h3>
              <div class="value">\${data.uptime}</div>
            </div>
          </div>
          
          <div class="charts-grid">
            <div class="chart-card">
              <h3>Tool Usage</h3>
              <canvas id="toolChart"></canvas>
            </div>
            <div class="chart-card">
              <h3>Hourly Requests (Last 24h)</h3>
              <canvas id="hourlyChart"></canvas>
            </div>
          </div>
          
          <div class="recent-calls">
            <h3>Recent Tool Calls</h3>
            \${data.recentToolCalls.slice(0, 10).map(call => \`
              <div class="call-item">
                <span class="call-tool">\${call.tool}</span>
                <span class="call-time">\${new Date(call.timestamp).toLocaleString()}</span>
              </div>
            \`).join('') || '<p style="color:#a1a1aa;padding:12px;">No tool calls yet</p>'}
          </div>
        \`;
        
        // Tool usage chart
        const toolData = Object.entries(data.breakdown.byTool);
        if (toolData.length > 0) {
          new Chart(document.getElementById('toolChart'), {
            type: 'doughnut',
            data: {
              labels: toolData.map(([k]) => k),
              datasets: [{
                data: toolData.map(([, v]) => v),
                backgroundColor: ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f87171'],
              }]
            },
            options: {
              plugins: { legend: { labels: { color: '#e4e4e7' } } }
            }
          });
        }
        
        // Hourly chart
        const hourlyData = Object.entries(data.hourlyRequests);
        if (hourlyData.length > 0) {
          new Chart(document.getElementById('hourlyChart'), {
            type: 'line',
            data: {
              labels: hourlyData.map(([k]) => k.split('T')[1] || k),
              datasets: [{
                label: 'Requests',
                data: hourlyData.map(([, v]) => v),
                borderColor: '#60a5fa',
                backgroundColor: 'rgba(96,165,250,0.1)',
                fill: true,
                tension: 0.4,
              }]
            },
            options: {
              scales: {
                x: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                y: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.1)' } }
              },
              plugins: { legend: { labels: { color: '#e4e4e7' } } }
            }
          });
        }
      } catch (err) {
        document.getElementById('content').innerHTML = '<p style="color:#f87171;">Failed to load analytics</p>';
      }
    }
    
    loadData();
    setInterval(loadData, 30000);
  </script>
</body>
</html>
`;
  
  res.type('html').send(html);
});

// Create Streamable HTTP transport (stateless)
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

// MCP endpoint
app.all('/mcp', async (req: Request, res: Response) => {
  try {
    trackRequest(req, '/mcp');
    
    // Extract API key from query param or header (user's key takes priority)
    const userApiKey = req.query.apiKey as string || req.headers['x-api-key'] as string;
    if (userApiKey) {
      requestApiKey = userApiKey;
      console.log('Using user-provided API key');
    } else {
      requestApiKey = null;
    }
    
    // Track tool calls
    if (req.body && req.body.method === 'tools/call' && req.body.params?.name) {
      trackToolCall(req.body.params.name, req);
    }
    
    console.log('Received MCP request:', {
      method: req.method,
      path: req.path,
      mcpMethod: req.body?.method,
      hasUserApiKey: !!userApiKey,
    });
    
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Root endpoint with server info
app.get('/', (req: Request, res: Response) => {
  trackRequest(req, '/');
  res.json({
    name: 'Perplexity Search MCP Server',
    version: '1.0.0',
    description: 'MCP server for Perplexity web search API',
    transport: 'streamable-http',
    endpoints: {
      mcp: '/mcp',
      health: '/health',
      analytics: '/analytics',
      analyticsTools: '/analytics/tools',
      analyticsDashboard: '/analytics/dashboard',
    },
    apiKeySupport: {
      queryParam: '?apiKey=YOUR_PERPLEXITY_API_KEY',
      header: 'X-API-Key: YOUR_PERPLEXITY_API_KEY',
      example: '/mcp?apiKey=pplx-xxxx',
    },
    documentation: 'https://github.com/hithereiamaliff/mcp-perplexity',
  });
});

// Connect server to transport and start listening
mcpServer.server.connect(transport)
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log('='.repeat(60));
      console.log('🔍 Perplexity Search MCP Server (Streamable HTTP)');
      console.log('='.repeat(60));
      console.log(`📍 Server running on http://${HOST}:${PORT}`);
      console.log(`📡 MCP endpoint: http://${HOST}:${PORT}/mcp`);
      console.log(`❤️  Health check: http://${HOST}:${PORT}/health`);
      console.log(`📊 Analytics: http://${HOST}:${PORT}/analytics/dashboard`);
      console.log('='.repeat(60));
      console.log('');
      console.log('Test with MCP Inspector:');
      console.log(`  npx @modelcontextprotocol/inspector`);
      console.log(`  Select "Streamable HTTP" and enter: http://localhost:${PORT}/mcp`);
      console.log('');
    });
  })
  .catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });
