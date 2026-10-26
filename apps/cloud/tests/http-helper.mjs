import { request } from "node:http";

// Use raw HTTP: Node fetch can replace Host with the URL's authority.
// These tests connect to loopback while exercising browser-facing tenant hosts.
export function fetchWithHost(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method ?? "GET", headers: options.headers }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, headers: { get: name => { const value = response.headers[name.toLowerCase()]; return Array.isArray(value) ? value.join(", ") : value ?? null; } }, text: async () => body, json: async () => JSON.parse(body) });
      });
      response.on("error", reject);
    });
    req.on("error", reject);
    req.end(options.body);
  });
}
