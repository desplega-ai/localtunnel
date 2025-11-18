import { describe, it, beforeAll, expect } from "bun:test";
import http from "http";
import localtunnel from "./localtunnel";

let fakePort: number;

beforeAll(async () => {
  return new Promise<void>((resolve) => {
    const server = http.createServer((req, res) => {
      res.write(req.headers.host || "");
      res.end();
    });
    server.listen(() => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        fakePort = addr.port;
      }
      resolve();
    });
  });
});

describe("localtunnel client", () => {
  it("should create a tunnel with auto-generated subdomain", async () => {
    const tunnel = await localtunnel({
      port: fakePort,
      host: "https://lt.desplega.ai",
    });

    expect(tunnel.url).toBeDefined();
    expect(tunnel.url).toMatch(/^https:\/\/.+\.lt\.desplega\.ai/);

    tunnel.close();
  });

  it("should create a tunnel with a specific subdomain", async () => {
    const subdomain = `test-${Math.random().toString(36).substr(2)}`;
    const tunnel = await localtunnel({
      port: fakePort,
      subdomain,
      host: "https://lt.desplega.ai",
    });

    expect(tunnel.url).toMatch(new RegExp(`^https://${subdomain}`));
    tunnel.close();
  });

  it("should accept auth flag for server-generated password", async () => {
    const tunnel = await localtunnel({
      port: fakePort,
      auth: true,
      host: "https://lt.desplega.ai",
    });

    // Should successfully create tunnel with auth
    expect(tunnel.url).toBeDefined();
    expect(tunnel.url).toMatch(/^https:\/\/.+\.lt\.desplega\.ai/);
    tunnel.close();
  });

  it("should accept custom password", async () => {
    const customPassword = "mypassword123";
    const tunnel = await localtunnel({
      port: fakePort,
      auth: customPassword,
      host: "https://lt.desplega.ai",
    });

    // Should successfully create tunnel with custom password
    expect(tunnel.url).toBeDefined();
    expect(tunnel.url).toMatch(/^https:\/\/.+\.lt\.desplega\.ai/);
    tunnel.close();
  });

  it("should emit close event", async () => {
    const tunnel = await localtunnel({
      port: fakePort,
      host: "https://lt.desplega.ai",
    });

    let closedEmitted = false;
    tunnel.on("close", () => {
      closedEmitted = true;
    });

    tunnel.close();

    // Give it a moment to emit the event
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closedEmitted).toBe(true);
  });

  it("should handle local_host option", async () => {
    const tunnel = await localtunnel({
      port: fakePort,
      local_host: "127.0.0.1",
      host: "https://lt.desplega.ai",
    });

    expect(tunnel.url).toBeDefined();
    tunnel.close();
  });
});
