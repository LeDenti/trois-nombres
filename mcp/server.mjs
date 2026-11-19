// Three Numbers MCP server: one public, read-only tool that reads an XRPL key's
// commitment record (signed, kept, expired) from a public ledger node.
//
// It uses the same counting code as the page (../script.js), so the page, its assistant
// and any other agent site get the same numbers. Streamable HTTP transport, plain JSON
// replies, stateless, CORS open: a browser on any agent site can call it directly.
//
// Run: node mcp/server.mjs            (PORT, default 8787)
// Endpoint: POST /mcp   Info: GET /   Health: GET /healthz
import http from "node:http";
import { NETWORKS, METHOD, NOT_SUPPORTED, TIMELINE_FOR_AGENT, NodeClient, Page } from "../script.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "three-numbers", title: "Three Numbers", version: "1.0.0" };
const MAX_BODY = 64 * 1024;
const CACHE_MS = 60 * 1000;
const RATE_PER_MINUTE = 30;
const MAX_CONCURRENT_READS = 8;

const TOOLS = [
  {
    name: "read_key",
    title: "Read an XRPL key's commitment record",
    description: `Read one XRPL key's public commitment record from a public ledger node: escrows it signed (EscrowCreate), kept (EscrowFinish on its own escrows) and let expire (EscrowCancel on its own escrows), plus escrows still open, SignerList defenders, acts for others and the ${TIMELINE_FOR_AGENT} newest acts with explorer links. Read-only. Returns ok false with a reason for a bad address or a node error; found false when the key does not exist on that network; partial true when only the first 5,000 transactions were read. readOn is today's date: use it for ages.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["address"],
      properties: {
        address: { type: "string", minLength: 20, maxLength: 40, description: "XRPL classic address, starting with r." },
        network: { type: "string", enum: ["testnet", "mainnet"], default: "testnet", description: "XRPL network to read." },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  {
    name: "explain_method",
    title: "How Three Numbers counts",
    description: "Return how each number is counted and what the record cannot show (owner, memos, amounts, verdicts). No arguments.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

/**
 * Reads keys through the page's own code, with a short cache and a concurrency cap.
 */
export class Reader {
  static page = new Page(null, (url) => new NodeClient(url));
  static cache = new Map();
  static running = 0;

  static async readKey(args) {
    const address = typeof args.address === "string" ? args.address.trim() : "";
    const network = args.network || "testnet";
    const key = `${network}:${address}`;
    const hit = Reader.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      return hit.result;
    }
    if (Reader.running >= MAX_CONCURRENT_READS) {
      return { ok: false, reason: "The service is busy. Try again in a few seconds." };
    }
    Reader.running++;
    try {
      const result = await Reader.page.lookUp(address, network);
      if (result.ok && result.record) {
        result.record.timelineTotal = result.record.timeline.length;
        result.record.timeline = result.record.timeline.slice(0, TIMELINE_FOR_AGENT);
      }
      if (result.ok) {
        Reader.cache.set(key, { at: Date.now(), result });
      }
      if (Reader.cache.size > 500) {
        Reader.cache.delete(Reader.cache.keys().next().value);
      }
      return result;
    } finally {
      Reader.running--;
    }
  }
}

/**
 * Per-IP request counter over a one-minute window.
 */
class RateLimit {
  static windows = new Map();

  static allow(ip) {
    const now = Date.now();
    const w = RateLimit.windows.get(ip);
    if (!w || now - w.start > 60000) {
      RateLimit.windows.set(ip, { start: now, count: 1 });
      if (RateLimit.windows.size > 10000) {
        RateLimit.windows.clear();
      }
      return true;
    }
    w.count++;
    return w.count <= RATE_PER_MINUTE;
  }
}

/**
 * Validate arguments against a tool's small schema (types, enum, lengths, no extra keys).
 *
 * :return: An error message, or null.
 */
export function checkArgs(tool, args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return "arguments must be an object";
  }
  const props = tool.inputSchema.properties;
  for (const name of Object.keys(args)) {
    if (!Object.hasOwn(props, name)) {
      return `unexpected argument ${name}`;
    }
  }
  for (const name of tool.inputSchema.required || []) {
    if (!(name in args)) {
      return `missing argument ${name}`;
    }
  }
  for (const [name, value] of Object.entries(args)) {
    const p = props[name];
    if (p.type === "string" && typeof value !== "string") {
      return `${name} must be a string`;
    }
    if (p.enum && !p.enum.includes(value)) {
      return `${name} must be one of ${p.enum.join(", ")}`;
    }
    if (p.maxLength && value.length > p.maxLength) {
      return `${name} is too long`;
    }
  }
  return null;
}

/**
 * Answer one JSON-RPC message.
 *
 * :return: The response object, or null for a notification.
 */
export async function handle(message) {
  const { id, method, params } = message || {};
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, text) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message: text } });
  if (!message || message.jsonrpc !== "2.0" || typeof method !== "string") {
    return fail(-32600, "Invalid request");
  }
  if (id === undefined) {
    return null;
  }
  if (method === "initialize") {
    const asked = params?.protocolVersion;
    return reply({
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: "Read-only XRPL commitment records. Counts acts on the ledger; never says who owns a key and gives no verdict.",
    });
  }
  if (method === "ping") {
    return reply({});
  }
  if (method === "tools/list") {
    return reply({ tools: TOOLS });
  }
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) {
      return fail(-32602, `Unknown tool ${params?.name}`);
    }
    const args = params.arguments || {};
    const problem = checkArgs(tool, args);
    if (problem) {
      return reply({ isError: true, content: [{ type: "text", text: `Invalid arguments: ${problem}.` }] });
    }
    let data;
    if (tool.name === "explain_method") {
      data = { method: METHOD, notSupported: NOT_SUPPORTED, networks: Object.keys(NETWORKS), source: "https://ledenti.github.io/trois-nombres/" };
    } else {
      data = await Reader.readKey(args);
    }
    return reply({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data });
  }
  return fail(-32601, `Method not found: ${method}`);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { ...CORS, "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method === "GET" && path === "/healthz") {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && path === "/") {
      send(res, 200, { ...SERVER_INFO, mcp: "/mcp", transport: "streamable-http (JSON replies, stateless)", tools: TOOLS.map((t) => t.name), site: "https://ledenti.github.io/trois-nombres/" });
      return;
    }
    if (path !== "/mcp") {
      send(res, 404, { error: "Not found" });
      return;
    }
    if (req.method !== "POST") {
      // No server-initiated stream: this server only answers requests.
      send(res, 405, { error: "Use POST" });
      return;
    }
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    if (!RateLimit.allow(ip)) {
      send(res, 429, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests; slow down." } });
      return;
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        send(res, 413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } });
        return;
      }
      chunks.push(chunk);
    }
    let message;
    try {
      message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    if (Array.isArray(message)) {
      send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported" } });
      return;
    }
    try {
      const answer = await handle(message);
      if (answer === null) {
        res.writeHead(202, CORS);
        res.end();
        return;
      }
      send(res, 200, answer);
    } catch (error) {
      send(res, 500, { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: "Internal error" } });
      console.error(error);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  createServer().listen(port, () => console.log(`Three Numbers MCP on :${port}/mcp`));
}
