/* eslint-disable no-console */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const url = require('url');
const assert = require('assert');

const localtunnel = require('./localtunnel');

let fakePort;

before(done => {
  const server = http.createServer();
  server.on('request', (req, res) => {
    res.write(req.headers.host);
    res.end();
  });
  server.listen(() => {
    const { port } = server.address();
    fakePort = port;
    done();
  });
});

it('query localtunnel server w/ ident', async () => {
  const tunnel = await localtunnel({ port: fakePort, host: 'https://lt.desplega.ai' });
  assert.ok(new RegExp('^https://.*').test(tunnel.url));

  const parsed = url.parse(tunnel.url);
  const opt = {
    host: parsed.host,
    port: 443,
    headers: { host: parsed.hostname },
    path: '/',
  };

  return new Promise((resolve, reject) => {
    const req = https.request(opt, res => {
      res.setEncoding('utf8');
      let body = '';

      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          assert(/.*[.]/.test(body), body);
          tunnel.close();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
});

it('request specific domain', async () => {
  const subdomain = Math.random()
    .toString(36)
    .substr(2);
  const tunnel = await localtunnel({ port: fakePort, subdomain, host: 'https://lt.desplega.ai' });
  assert.ok(new RegExp(`^https://${subdomain}`).test(tunnel.url));
  tunnel.close();
});

describe('--local-host localhost', () => {
  it('override Host header with local-host', async () => {
    const tunnel = await localtunnel({ port: fakePort, local_host: 'localhost', host: 'https://lt.desplega.ai' });
    assert.ok(new RegExp('^https://.*').test(tunnel.url));

    const parsed = url.parse(tunnel.url);
    const opt = {
      host: parsed.host,
      port: 443,
      headers: { host: parsed.hostname },
      path: '/',
    };

    return new Promise((resolve, reject) => {
      const req = https.request(opt, res => {
        res.setEncoding('utf8');
        let body = '';

        res.on('data', chunk => {
          body += chunk;
        });

        res.on('end', () => {
          try {
            assert.strictEqual(body, 'localhost');
            tunnel.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  });
});

describe('--local-host 127.0.0.1', () => {
  it('override Host header with local-host', async () => {
    const tunnel = await localtunnel({ port: fakePort, local_host: '127.0.0.1', host: 'https://lt.desplega.ai' });
    assert.ok(new RegExp('^https://.*').test(tunnel.url));

    const parsed = url.parse(tunnel.url);
    const opt = {
      host: parsed.host,
      port: 443,
      headers: {
        host: parsed.hostname,
      },
      path: '/',
    };

    return new Promise((resolve, reject) => {
      const req = https.request(opt, res => {
        res.setEncoding('utf8');
        let body = '';

        res.on('data', chunk => {
          body += chunk;
        });

        res.on('end', () => {
          try {
            assert.strictEqual(body, '127.0.0.1');
            tunnel.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  });

  it('send chunked request', async () => {
    const tunnel = await localtunnel({ port: fakePort, local_host: '127.0.0.1', host: 'https://lt.desplega.ai' });
    assert.ok(new RegExp('^https://.*').test(tunnel.url));

    const parsed = url.parse(tunnel.url);
    const opt = {
      host: parsed.host,
      port: 443,
      headers: {
        host: parsed.hostname,
        'Transfer-Encoding': 'chunked',
      },
      path: '/',
    };

    return new Promise((resolve, reject) => {
      const req = https.request(opt, res => {
        res.setEncoding('utf8');
        let body = '';

        res.on('data', chunk => {
          body += chunk;
        });

        res.on('end', () => {
          try {
            assert.strictEqual(body, '127.0.0.1');
            tunnel.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.end(crypto.randomBytes(1024 * 8).toString('base64'));
    });
  });
});
