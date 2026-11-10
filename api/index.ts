import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRequest } from "../src/server.ts";

async function vercelHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const method = req.method ?? "GET";
  const host = req.headers.host ?? "localhost";
  const webRequest = new Request(`https://${host}${req.url ?? "/"}`, {
    method,
    headers: req.headers as Record<string, string>,
    body: method !== "GET" && method !== "HEAD" ? Buffer.concat(chunks) : undefined,
  });
  const webResponse = await handleRequest(webRequest, process.cwd());

  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await webResponse.arrayBuffer()));
}

export default vercelHandler;
