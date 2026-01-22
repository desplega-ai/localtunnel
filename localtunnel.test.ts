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

    await tunnel.close();
  });

  it("should create a tunnel with a specific subdomain", async () => {
    const subdomain = `test-${Math.random().toString(36).substr(2)}`;
    const tunnel = await localtunnel({
      port: fakePort,
      subdomain,
      host: "https://lt.desplega.ai",
    });

    expect(tunnel.url).toMatch(new RegExp(`^https://${subdomain}`));
    await tunnel.close();
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
    await tunnel.close();
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
    await tunnel.close();
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

    await tunnel.close();

    expect(closedEmitted).toBe(true);
  });

  it("should handle local_host option", async () => {
    const tunnel = await localtunnel({
      port: fakePort,
      local_host: "127.0.0.1",
      host: "https://lt.desplega.ai",
    });

    expect(tunnel.url).toBeDefined();
    await tunnel.close();
  });

  it("close() should return a Promise", async () => {
    const tunnel = await localtunnel({
      port: fakePort,
      host: "https://lt.desplega.ai",
    });

    const result = tunnel.close();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it("should handle multiple close() calls gracefully", async () => {
    const tunnel = await localtunnel({
      port: fakePort,
      host: "https://lt.desplega.ai",
    });

    await tunnel.close();
    await tunnel.close(); // Should not throw
    await tunnel.close(); // Should not throw
  });

  it("should cleanup tunnelCluster on close", async () => {
    const tunnel = await localtunnel({
      port: fakePort,
      host: "https://lt.desplega.ai",
    });

    expect(tunnel.tunnelCluster).toBeDefined();
    await tunnel.close();
    expect(tunnel.tunnelCluster).toBeNull();
  });

  it("should fail immediately with error message on 409 subdomain conflict", async () => {
    // Create a mock server that returns 409 Conflict
    const mockServer = http.createServer((req, res) => {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: "Subdomain 'test' is already in use. Try again in a few seconds or use a different subdomain."
      }));
    });

    const mockPort = await new Promise<number>((resolve) => {
      mockServer.listen(0, () => {
        const addr = mockServer.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        }
      });
    });

    try {
      await localtunnel({
        port: fakePort,
        subdomain: "test",
        host: `http://localhost:${mockPort}`,
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toContain("Subdomain 'test' is already in use");
    } finally {
      mockServer.close();
    }
  });
});
