import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

export function serveFixtures(root: string): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = (request.url ?? "/").split("?")[0];
      try {
        const body = readFileSync(join(root, path === "/" ? "/index.html" : path));
        response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
