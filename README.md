# DataQuant MCP Server

Remote [MCP](https://modelcontextprotocol.io) server for [DataQuant](https://app.dataquant.trade) — financial market data for **A-shares, US stocks, Hong Kong stocks, crypto, indices and ETFs**, plus macro indicators, in one schema.

Read-only. No trading, no investment advice — data only.

## Tools

| Tool | Description |
| --- | --- |
| `search_symbols` | Search symbols across all six markets (name or code) |
| `get_klines` | Historical OHLCV klines for a symbol (daily/weekly/monthly, capped rows) |
| `get_macro_overview` | Global macro overview: rates, major indices and headline indicators |

## Connect (hosted endpoint)

```json
{
  "mcpServers": {
    "dataquant": {
      "url": "https://mcp.dataquant.trade/mcp"
    }
  }
}
```

Streamable HTTP, stateless, no authentication in this phase — the server-side key covers a free-tier quota, intended as a trial entry point.

## Self-host

The server is a Cloudflare Worker (TypeScript). You need a free DataQuant API key from [app.dataquant.trade](https://app.dataquant.trade) (self-serve signup, free tier, no card).

```bash
npm install
npx wrangler secret put DQ_API_KEY   # paste your own DataQuant API key
npx wrangler dev                     # local run
npx wrangler deploy                  # deploy to your Cloudflare account
```

For a local run, point the endpoint at `http://localhost:8787/mcp` (or the port wrangler reports). To use your own domain, adjust `routes` in `wrangler.toml`.

## Notes

- All tools are read-only and return market data only.
- Kline responses are row-capped server-side to protect the upstream quota.
- Data is aggregated from public sources; see DataQuant for coverage and field definitions.
