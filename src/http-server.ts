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
import fs from 'fs';
import path from 'path';
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
const TIMEOUT_MS = parseInt(process.env.PERPLEXITY_TIMEOUT_MS || '300000', 10);

// Analytics persistence configuration
const ANALYTICS_DATA_DIR = process.env.ANALYTICS_DIR || '/app/data';
const ANALYTICS_FILE = path.join(ANALYTICS_DATA_DIR, 'analytics.json');
const SAVE_INTERVAL_MS = 60000; // Save every 60 seconds

// Default config from environment
const DEFAULT_API_KEY = process.env.PERPLEXITY_API_KEY || '';

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

const MAX_RECENT_CALLS = 100;

// Initialize analytics with default values
let analytics: Analytics = {
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

// Ensure data directory exists
function ensureDataDir(): void {
  try {
    if (!fs.existsSync(ANALYTICS_DATA_DIR)) {
      fs.mkdirSync(ANALYTICS_DATA_DIR, { recursive: true });
      console.log(`📁 Created analytics data directory: ${ANALYTICS_DATA_DIR}`);
    }
  } catch (error) {
    console.error(`⚠️ Failed to create analytics directory:`, error);
  }
}

// Load analytics from disk on startup
function loadAnalytics(): void {
  try {
    ensureDataDir();
    if (fs.existsSync(ANALYTICS_FILE)) {
      const data = fs.readFileSync(ANALYTICS_FILE, 'utf-8');
      const loaded = JSON.parse(data) as Analytics;
      
      analytics = {
        ...loaded,
        serverStartTime: loaded.serverStartTime || new Date().toISOString(),
      };
      
      console.log(`📊 Loaded analytics from ${ANALYTICS_FILE}`);
      console.log(`   Total requests: ${analytics.totalRequests}, Tool calls: ${analytics.totalToolCalls}`);
    } else {
      console.log(`📊 No existing analytics file, starting fresh`);
      saveAnalytics();
    }
  } catch (error) {
    console.error(`⚠️ Failed to load analytics:`, error);
  }
}

// Save analytics to disk
function saveAnalytics(): void {
  try {
    ensureDataDir();
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
  } catch (error) {
    console.error(`⚠️ Failed to save analytics:`, error);
  }
}

// Load analytics on module initialization
loadAnalytics();

// Periodic save interval
const saveInterval = setInterval(() => {
  saveAnalytics();
}, SAVE_INTERVAL_MS);

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

/**
 * Strips thinking tokens (content within <think>...</think> tags) from the response.
 */
function stripThinkingTokens(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Performs a chat completion by sending a request to the Perplexity API.
 */
async function performChatCompletion(
  messages: Array<{ role: string; content: string }>,
  model: string = 'sonar-pro',
  stripThinking: boolean = false
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No Perplexity API key available. Please provide your API key via URL query param (?apiKey=YOUR_KEY).');
  }

  const response = await axios.post(
    'https://api.perplexity.ai/chat/completions',
    { model, messages },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: TIMEOUT_MS,
    }
  );

  let messageContent = response.data.choices[0].message.content;

  if (stripThinking) {
    messageContent = stripThinkingTokens(messageContent);
  }

  // Append citations if available
  if (response.data.citations && Array.isArray(response.data.citations) && response.data.citations.length > 0) {
    messageContent += '\n\nCitations:\n';
    response.data.citations.forEach((citation: string, index: number) => {
      messageContent += `[${index + 1}] ${citation}\n`;
    });
  }

  return messageContent;
}

/**
 * Performs a web search using the Perplexity Search API.
 */
async function performSearch(
  query: string,
  maxResults: number = 10,
  country?: string
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No Perplexity API key available. Please provide your API key via URL query param (?apiKey=YOUR_KEY).');
  }

  const body: Record<string, unknown> = {
    query,
    max_results: maxResults,
  };

  if (country) {
    body.country = country;
  }

  const response = await axios.post(
    'https://api.perplexity.ai/search',
    body,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: TIMEOUT_MS,
    }
  );

  const data = response.data;
  if (!data.results || !Array.isArray(data.results)) {
    return 'No search results found.';
  }

  let formattedResults = `Found ${data.results.length} search results:\n\n`;
  data.results.forEach((result: { title: string; url: string; snippet?: string; date?: string }, index: number) => {
    formattedResults += `${index + 1}. **${result.title}**\n`;
    formattedResults += `   URL: ${result.url}\n`;
    if (result.snippet) {
      formattedResults += `   ${result.snippet}\n`;
    }
    if (result.date) {
      formattedResults += `   Date: ${result.date}\n`;
    }
    formattedResults += '\n';
  });

  return formattedResults;
}

// Create MCP server
const mcpServer = new McpServer({
  name: 'Perplexity MCP Server',
  version: '1.1.0',
});

// Tool 1: perplexity_ask - General conversational AI with web search
mcpServer.tool(
  'perplexity_ask',
  'General-purpose conversational AI with real-time web search using the sonar-pro model. Great for quick questions and everyday searches.',
  {
    messages: z.array(z.object({
      role: z.string().describe('Role of the message (e.g., system, user, assistant)'),
      content: z.string().describe('The content of the message'),
    })).describe('Array of conversation messages'),
  },
  async ({ messages }) => {
    try {
      const result = await performChatCompletion(messages, 'sonar-pro');
      return {
        content: [{ type: 'text' as const, text: result }],
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<PerplexityErrorResponse>;
        const errorData = axiosError.response?.data;
        const errorMessage = errorData?.error || errorData?.message || axiosError.message;
        return {
          content: [{ type: 'text' as const, text: `Perplexity API error: ${errorMessage}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: perplexity_research - Deep comprehensive research
mcpServer.tool(
  'perplexity_research',
  'Deep, comprehensive research using the sonar-deep-research model. Ideal for thorough analysis and detailed reports.',
  {
    messages: z.array(z.object({
      role: z.string().describe('Role of the message (e.g., system, user, assistant)'),
      content: z.string().describe('The content of the message'),
    })).describe('Array of conversation messages'),
    strip_thinking: z.boolean().optional().describe('If true, removes <think>...</think> tags from the response to save context tokens. Default is false.'),
  },
  async ({ messages, strip_thinking }) => {
    try {
      const stripThinking = typeof strip_thinking === 'boolean' ? strip_thinking : false;
      const result = await performChatCompletion(messages, 'sonar-deep-research', stripThinking);
      return {
        content: [{ type: 'text' as const, text: result }],
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<PerplexityErrorResponse>;
        const errorData = axiosError.response?.data;
        const errorMessage = errorData?.error || errorData?.message || axiosError.message;
        return {
          content: [{ type: 'text' as const, text: `Perplexity API error: ${errorMessage}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: perplexity_reason - Advanced reasoning and problem-solving
mcpServer.tool(
  'perplexity_reason',
  'Advanced reasoning and problem-solving using the sonar-reasoning-pro model. Perfect for complex analytical tasks.',
  {
    messages: z.array(z.object({
      role: z.string().describe('Role of the message (e.g., system, user, assistant)'),
      content: z.string().describe('The content of the message'),
    })).describe('Array of conversation messages'),
    strip_thinking: z.boolean().optional().describe('If true, removes <think>...</think> tags from the response to save context tokens. Default is false.'),
  },
  async ({ messages, strip_thinking }) => {
    try {
      const stripThinking = typeof strip_thinking === 'boolean' ? strip_thinking : false;
      const result = await performChatCompletion(messages, 'sonar-reasoning-pro', stripThinking);
      return {
        content: [{ type: 'text' as const, text: result }],
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<PerplexityErrorResponse>;
        const errorData = axiosError.response?.data;
        const errorMessage = errorData?.error || errorData?.message || axiosError.message;
        return {
          content: [{ type: 'text' as const, text: `Perplexity API error: ${errorMessage}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: perplexity_search - Direct web search using Search API
mcpServer.tool(
  'perplexity_search',
  'Direct web search using the Perplexity Search API. Returns ranked search results with titles, URLs, snippets, and metadata. Perfect for finding up-to-date facts, news, or specific information.',
  {
    query: z.string().describe('Search query string'),
    max_results: z.number().min(1).max(20).optional().describe('Maximum number of results to return (1-20, default: 10)'),
    country: z.string().optional().describe('ISO 3166-1 alpha-2 country code for regional results (e.g., US, GB, MY)'),
  },
  async ({ query, max_results, country }) => {
    try {
      const maxResults = typeof max_results === 'number' ? max_results : 10;
      const countryCode = typeof country === 'string' ? country : undefined;
      const result = await performSearch(query, maxResults, countryCode);
      return {
        content: [{ type: 'text' as const, text: result }],
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<PerplexityErrorResponse>;
        const errorData = axiosError.response?.data;
        const errorMessage = errorData?.error || errorData?.message || axiosError.message;
        return {
          content: [{ type: 'text' as const, text: `Perplexity Search API error: ${errorMessage}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true,
      };
    }
  }
);

// Tool 5: perplexity_hello - Test tool
mcpServer.tool(
  'perplexity_hello',
  'A simple test tool to verify that the MCP server is working correctly',
  {},
  async () => {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          message: 'Hello from Perplexity MCP Server!',
          timestamp: new Date().toISOString(),
          transport: 'streamable-http',
          hasApiKey: !!getApiKey(),
          availableTools: ['perplexity_ask', 'perplexity_research', 'perplexity_reason', 'perplexity_search'],
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
    server: 'Perplexity MCP Server',
    version: '1.1.0',
    transport: 'streamable-http',
    timestamp: new Date().toISOString(),
    hasDefaultApiKey: !!DEFAULT_API_KEY,
    tools: ['perplexity_ask', 'perplexity_research', 'perplexity_reason', 'perplexity_search'],
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

// Analytics import endpoint - for restoring backups
app.post('/analytics/import', (req: Request, res: Response) => {
  const importKey = req.query.key as string;
  const expectedKey = process.env.ANALYTICS_IMPORT_KEY;
  
  // Security: require import key if configured
  if (expectedKey && importKey !== expectedKey) {
    res.status(403).json({ error: 'Invalid import key' });
    return;
  }
  
  try {
    const importData = req.body;
    
    // Merge imported data with current analytics
    if (importData.summary) {
      analytics.totalRequests += importData.summary.totalRequests || 0;
      analytics.totalToolCalls += importData.summary.totalToolCalls || 0;
    }
    
    // Merge breakdown data
    if (importData.breakdown?.byMethod) {
      for (const [method, count] of Object.entries(importData.breakdown.byMethod)) {
        analytics.requestsByMethod[method] = 
          (analytics.requestsByMethod[method] || 0) + (count as number);
      }
    }
    
    if (importData.breakdown?.byEndpoint) {
      for (const [endpoint, count] of Object.entries(importData.breakdown.byEndpoint)) {
        analytics.requestsByEndpoint[endpoint] = 
          (analytics.requestsByEndpoint[endpoint] || 0) + (count as number);
      }
    }
    
    if (importData.breakdown?.byTool) {
      for (const [tool, count] of Object.entries(importData.breakdown.byTool)) {
        analytics.toolCalls[tool] = 
          (analytics.toolCalls[tool] || 0) + (count as number);
      }
    }
    
    // Merge client data
    if (importData.clients?.byIp) {
      for (const [ip, count] of Object.entries(importData.clients.byIp)) {
        analytics.clientsByIp[ip] = 
          (analytics.clientsByIp[ip] || 0) + (count as number);
      }
    }
    
    if (importData.clients?.byUserAgent) {
      for (const [ua, count] of Object.entries(importData.clients.byUserAgent)) {
        analytics.clientsByUserAgent[ua] = 
          (analytics.clientsByUserAgent[ua] || 0) + (count as number);
      }
    }
    
    // Merge hourly requests
    if (importData.hourlyRequests) {
      for (const [hour, count] of Object.entries(importData.hourlyRequests)) {
        analytics.hourlyRequests[hour] = 
          (analytics.hourlyRequests[hour] || 0) + (count as number);
      }
    }
    
    // Save immediately
    saveAnalytics();
    
    res.json({ 
      message: 'Analytics imported successfully',
      currentStats: {
        totalRequests: analytics.totalRequests,
        totalToolCalls: analytics.totalToolCalls,
      }
    });
  } catch (error) {
    res.status(400).json({ 
      error: 'Failed to import analytics', 
      details: String(error) 
    });
  }
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
      background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 8px;
    }
    header p { color: #a1a1aa; }
    .uptime-badge {
      display: inline-block;
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
      padding: 4px 12px;
      border-radius: 50px;
      font-size: 0.85rem;
      margin-top: 8px;
    }
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
    .stat-card .stat-label { color: #a1a1aa; font-size: 0.85rem; margin-bottom: 8px; }
    .stat-card .stat-value { font-size: 2rem; font-weight: bold; color: #3b82f6; }
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
    .chart-card h3 { margin-bottom: 16px; color: #e4e4e7; font-size: 1.1rem; }
    .chart-container { position: relative; height: 250px; }
    .recent-calls {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
      margin-bottom: 30px;
    }
    .recent-calls h3 { margin-bottom: 16px; font-size: 1.1rem; }
    .call-list { max-height: 400px; overflow-y: auto; }
    .call-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .call-item:last-child { border-bottom: none; }
    .call-tool { color: #3b82f6; font-weight: 500; }
    .call-time { color: #71717a; font-size: 0.8rem; }
    .call-ip { color: #a1a1aa; font-size: 0.75rem; }
    .loading { text-align: center; padding: 40px; color: #a1a1aa; }
    .refresh-btn {
      position: fixed;
      bottom: 30px;
      right: 30px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 50px;
      cursor: pointer;
      font-size: 1rem;
      box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .refresh-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
    }
    .no-data { color: #71717a; padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔍 Perplexity MCP Analytics</h1>
      <p>Real-time usage statistics</p>
      <span class="uptime-badge" id="uptime">Loading...</span>
    </header>
    
    <div id="content" class="loading">Loading analytics...</div>
  </div>
  
  <button class="refresh-btn" onclick="loadData()">🔄 Refresh</button>

  <script>
    const chartColors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f43f5e', '#84cc16'];
    let toolsChart, hourlyChart, endpointChart, clientsChart;
    
    async function loadData() {
      try {
        const basePath = window.location.pathname.replace(/\\/analytics\\/dashboard\\/?$/, '');
        const res = await fetch(basePath + '/analytics');
        const data = await res.json();
        
        document.getElementById('uptime').textContent = '⏱️ ' + data.uptime;
        
        document.getElementById('content').innerHTML = \`
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">Total Requests</div>
              <div class="stat-value">\${data.summary.totalRequests.toLocaleString()}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Tool Calls</div>
              <div class="stat-value">\${data.summary.totalToolCalls.toLocaleString()}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Unique Clients</div>
              <div class="stat-value">\${data.summary.uniqueClients.toLocaleString()}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Most Used Tool</div>
              <div class="stat-value" style="font-size:1rem;">\${Object.keys(data.breakdown.byTool)[0] || 'N/A'}</div>
            </div>
          </div>
          
          <div class="charts-grid">
            <div class="chart-card">
              <h3>📊 Tool Usage Distribution</h3>
              <div class="chart-container"><canvas id="toolsChart"></canvas></div>
            </div>
            <div class="chart-card">
              <h3>📈 Hourly Requests (Last 24h)</h3>
              <div class="chart-container"><canvas id="hourlyChart"></canvas></div>
            </div>
            <div class="chart-card">
              <h3>🔗 Requests by Endpoint</h3>
              <div class="chart-container"><canvas id="endpointChart"></canvas></div>
            </div>
            <div class="chart-card">
              <h3>👥 Top Clients by User Agent</h3>
              <div class="chart-container"><canvas id="clientsChart"></canvas></div>
            </div>
          </div>
          
          <div class="recent-calls">
            <h3>🕐 Recent Tool Calls</h3>
            <div class="call-list">
              \${data.recentToolCalls.length > 0 ? data.recentToolCalls.slice(0, 15).map(call => \`
                <div class="call-item">
                  <div>
                    <span class="call-tool">\${call.tool}</span>
                    <span class="call-ip"> • \${call.clientIp}</span>
                  </div>
                  <span class="call-time">\${new Date(call.timestamp).toLocaleString()}</span>
                </div>
              \`).join('') : '<div class="no-data">No tool calls yet</div>'}
            </div>
          </div>
        \`;
        
        // Tool usage doughnut chart
        const toolData = Object.entries(data.breakdown.byTool);
        if (toolData.length > 0) {
          if (toolsChart) toolsChart.destroy();
          toolsChart = new Chart(document.getElementById('toolsChart'), {
            type: 'doughnut',
            data: {
              labels: toolData.map(([k]) => k),
              datasets: [{
                data: toolData.map(([, v]) => v),
                backgroundColor: chartColors,
                borderWidth: 0
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'right', labels: { color: '#a1a1aa', font: { size: 11 } } } }
            }
          });
        }
        
        // Hourly requests line chart
        const hourlyData = Object.entries(data.hourlyRequests);
        if (hourlyData.length > 0) {
          if (hourlyChart) hourlyChart.destroy();
          hourlyChart = new Chart(document.getElementById('hourlyChart'), {
            type: 'line',
            data: {
              labels: hourlyData.map(([k]) => k.split('T')[1] || k),
              datasets: [{
                label: 'Requests',
                data: hourlyData.map(([, v]) => v),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
              }
            }
          });
        }
        
        // Endpoint bar chart
        const endpointData = Object.entries(data.breakdown.byEndpoint).sort(([,a], [,b]) => b - a).slice(0, 8);
        if (endpointData.length > 0) {
          if (endpointChart) endpointChart.destroy();
          endpointChart = new Chart(document.getElementById('endpointChart'), {
            type: 'bar',
            data: {
              labels: endpointData.map(([k]) => k),
              datasets: [{
                data: endpointData.map(([, v]) => v),
                backgroundColor: chartColors,
                borderRadius: 8
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: '#71717a' }, grid: { display: false } },
                y: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
              }
            }
          });
        }
        
        // Clients horizontal bar chart
        const clientData = Object.entries(data.clients.byUserAgent).sort(([,a], [,b]) => b - a).slice(0, 6);
        if (clientData.length > 0) {
          if (clientsChart) clientsChart.destroy();
          clientsChart = new Chart(document.getElementById('clientsChart'), {
            type: 'bar',
            data: {
              labels: clientData.map(([k]) => k.length > 25 ? k.substring(0, 25) + '...' : k),
              datasets: [{
                data: clientData.map(([, v]) => v),
                backgroundColor: chartColors,
                borderRadius: 8
              }]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: '#71717a' }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
                y: { ticks: { color: '#71717a' }, grid: { display: false } }
              }
            }
          });
        }
      } catch (err) {
        document.getElementById('content').innerHTML = '<p style="color:#f87171;text-align:center;padding:40px;">Failed to load analytics</p>';
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
    name: 'Perplexity MCP Server',
    version: '1.1.0',
    description: 'MCP server for Perplexity API - search, ask, research, and reasoning',
    transport: 'streamable-http',
    tools: {
      perplexity_ask: 'General conversational AI with web search (sonar-pro)',
      perplexity_research: 'Deep comprehensive research (sonar-deep-research)',
      perplexity_reason: 'Advanced reasoning and problem-solving (sonar-reasoning-pro)',
      perplexity_search: 'Direct web search with ranked results (Search API)',
    },
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

// Graceful shutdown handler
function gracefulShutdown(signal: string): void {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  clearInterval(saveInterval);
  saveAnalytics();
  console.log('💾 Analytics saved. Goodbye!');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Connect server to transport and start listening
mcpServer.server.connect(transport)
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log('='.repeat(60));
      console.log('🔍 Perplexity MCP Server (Streamable HTTP)');
      console.log('='.repeat(60));
      console.log(`📍 Server running on http://${HOST}:${PORT}`);
      console.log(`📡 MCP endpoint: http://${HOST}:${PORT}/mcp`);
      console.log(`❤️  Health check: http://${HOST}:${PORT}/health`);
      console.log(`📊 Analytics: http://${HOST}:${PORT}/analytics/dashboard`);
      console.log(`💾 Analytics file: ${ANALYTICS_FILE}`);
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
