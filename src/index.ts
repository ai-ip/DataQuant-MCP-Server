/**
 * DataQuant MCP Server（一期：无认证公开版）
 *
 * 部署形态：Cloudflare Worker，Streamable HTTP，无状态。
 * 一个端点同时供 Claude Connectors Directory 与 ChatGPT Plugins 目录使用。
 *
 * 认证口径（一期）：两个目录门户都没有终端用户 API Key 输入流程，
 * 只接受「无认证」或「OAuth」。一期走无认证：Worker 服务端持有
 * DataQuant API Key（secret，不下发给用户），对工具做行数上限与
 * 限流，定位为免费体验入口。二期补 OAuth 2.1 授权服务器后，
 * 用户可绑定自己的 DataQuant 账号与额度（见 README）。
 *
 * 红线：全部工具只读，只返回数据，不给投资建议，不执行任何交易。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

interface Env {
  /** DataQuant API Key，仅服务端持有，用 `wrangler secret put DQ_API_KEY` 设置 */
  DQ_API_KEY: string;
  /** 可选，默认 https://api.dataquant.trade */
  DQ_API_BASE?: string;
  /** ChatGPT 域名验证 token（门户生成后填入），未设置时该路径返回 404 */
  OPENAI_CHALLENGE_TOKEN?: string;
}

const MARKETS = ["ashare", "usstock", "hkstock", "crypto", "indices", "etfs"] as const;

function createServer(env: Env) {
  const base = env.DQ_API_BASE ?? "https://api.dataquant.trade";
  const server = new McpServer({ name: "dataquant", version: "1.0.0" });

  async function dq(path: string): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      headers: { "X-API-Key": env.DQ_API_KEY },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new Error(`DataQuant API error (HTTP ${res.status}): ${body}`);
    }
    return res.json();
  }

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  });

  server.registerTool(
    "search_symbols",
    {
      title: "Search symbols by keyword",
      description:
        "Search tradable symbols in one of DataQuant's six markets (ashare=A-shares, usstock=US stocks, hkstock=HK stocks, crypto, indices, etfs) by code or name keyword. Returns matching symbol codes. Market data only; no investment advice is provided.",
      inputSchema: {
        market: z.enum(MARKETS).describe("Market to search"),
        query: z.string().min(1).describe("Code or name keyword, e.g. 600519, AAPL, BTC"),
        limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ market, query, limit }) =>
      text(await dq(`/${market}/symbols?search=${encodeURIComponent(query)}&limit=${limit}`)),
  );

  server.registerTool(
    "get_klines",
    {
      title: "Get historical klines (OHLCV)",
      description:
        "Get historical daily kline rows (open, high, low, close, volume, amount, adj_factor) for one symbol in a DataQuant market, between start and end dates (YYYY-MM-DD). Returns published market data rows; data may be delayed and is not investment advice.",
      inputSchema: {
        market: z.enum(MARKETS).describe("Market the symbol belongs to"),
        symbol: z.string().min(1).describe("Symbol code, e.g. sh600519, usAAPL, hk00700, BTCUSDT"),
        start: z.string().describe("Start date YYYY-MM-DD"),
        end: z.string().describe("End date YYYY-MM-DD"),
        limit: z.number().int().min(1).max(500).default(100).describe("Max rows"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ market, symbol, start, end, limit }) =>
      text(
        await dq(
          `/${market}/klines/${encodeURIComponent(symbol)}?start=${start}&end=${end}&limit=${limit}`,
        ),
      ),
  );

  server.registerTool(
    "get_macro_overview",
    {
      title: "Get global macro indicators overview",
      description:
        "List global macroeconomic indicator data published by DataQuant, covering regions such as US, China, euro area, Japan and others. Returns indicator rows as published; no analysis or advice is added.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50).describe("Max rows"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ limit }) => text(await dq(`/macro/global?limit=${limit}`)),
  );

  return server;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ChatGPT 插件域名验证：纯文本返回 token 本身（不要 JSON、不要重定向）
    if (url.pathname === "/.well-known/openai-apps-challenge") {
      if (!env.OPENAI_CHALLENGE_TOKEN) return new Response("Not Found", { status: 404 });
      return new Response(env.OPENAI_CHALLENGE_TOKEN, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname !== "/mcp") return new Response("Not Found", { status: 404 });

    // 无状态模式：每请求新建 server + transport，不保存会话
    const server = createServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(req);
  },
};
