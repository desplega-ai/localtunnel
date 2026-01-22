const { EventEmitter } = require('events');
const debug = require('debug')('localtunnel:client');
const fs = require('fs');
const net = require('net');
const tls = require('tls');

const HeaderHostTransformer = require('./HeaderHostTransformer');

// manages groups of tunnels
module.exports = class TunnelCluster extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
    this.closed = false;
    this._sockets = new Set();       // remote sockets
    this._localSockets = new Set();  // local sockets
    this._transformers = new Set();  // HeaderHostTransformer instances
    this._timeouts = new Set();      // pending setTimeout IDs
  }

  open() {
    if (this.closed) {
      return;
    }

    const opt = this.opts;

    // Prefer IP if returned by the server
    const remoteHostOrIp = opt.remote_ip || opt.remote_host;
    const remotePort = opt.remote_port;
    const localHost = opt.local_host || 'localhost';
    const localPort = opt.local_port;
    const localProtocol = opt.local_https ? 'https' : 'http';
    const allowInvalidCert = opt.allow_invalid_cert;

    debug(
      'establishing tunnel %s://%s:%s <> %s:%s',
      localProtocol,
      localHost,
      localPort,
      remoteHostOrIp,
      remotePort
    );

    // connection to localtunnel server
    const remote = net.connect({
      host: remoteHostOrIp,
      port: remotePort,
    });

    this._sockets.add(remote);
    remote.once('close', () => this._sockets.delete(remote));

    remote.setKeepAlive(true);

    remote.on('error', err => {
      debug('got remote connection error', err.message);

      // emit connection refused errors immediately, because they
      // indicate that the tunnel can't be established.
      if (err.code === 'ECONNREFUSED') {
        this.emit(
          'error',
          new Error(
            `connection refused: ${remoteHostOrIp}:${remotePort} (check your firewall settings)`
          )
        );
      }

      remote.end();
    });

    const connLocal = () => {
      if (this.closed) {
        debug('cluster closed, aborting local connection');
        remote.destroy();
        return;
      }

      if (remote.destroyed) {
        debug('remote destroyed');
        this.emit('dead');
        return;
      }

      debug('connecting locally to %s://%s:%d', localProtocol, localHost, localPort);
      remote.pause();

      if (allowInvalidCert) {
        debug('allowing invalid certificates');
      }

      const getLocalCertOpts = () =>
        allowInvalidCert
          ? { rejectUnauthorized: false }
          : {
              cert: fs.readFileSync(opt.local_cert),
              key: fs.readFileSync(opt.local_key),
              ca: opt.local_ca ? [fs.readFileSync(opt.local_ca)] : undefined,
            };

      // connection to local http server
      const local = opt.local_https
        ? tls.connect({ host: localHost, port: localPort, ...getLocalCertOpts() })
        : net.connect({ host: localHost, port: localPort });

      this._localSockets.add(local);
      local.once('close', () => this._localSockets.delete(local));

      const remoteClose = () => {
        debug('remote close');
        this.emit('dead');
        local.end();
      };

      remote.once('close', remoteClose);

      // TODO some languages have single threaded servers which makes opening up
      // multiple local connections impossible. We need a smarter way to scale
      // and adjust for such instances to avoid beating on the door of the server
      local.once('error', err => {
        debug('local error %s', err.message);
        local.end();

        remote.removeListener('close', remoteClose);

        if (err.code !== 'ECONNREFUSED'
            && err.code !== 'ECONNRESET') {
          return remote.end();
        }

        // retrying connection to local server
        const timeoutId = setTimeout(connLocal, 1000);
        this._timeouts.add(timeoutId);
      });

      local.once('connect', () => {
        debug('connected locally');
        remote.resume();

        let stream = remote;

        // if user requested specific local host
        // then we use host header transform to replace the host header
        if (opt.local_host) {
          debug('transform Host header to %s', opt.local_host);
          const transformer = new HeaderHostTransformer({ host: opt.local_host });
          this._transformers.add(transformer);
          transformer.once('close', () => this._transformers.delete(transformer));
          stream = remote.pipe(transformer);
        }

        stream.pipe(local).pipe(remote);

        // when local closes, also get a new remote
        local.once('close', hadError => {
          debug('local connection closed [%s]', hadError);
        });
      });
    };

    remote.on('data', data => {
      const match = data.toString().match(/^(\w+) (\S+)/);
      if (match) {
        this.emit('request', {
          method: match[1],
          path: match[2],
        });
      }
    });

    // tunnel is considered open when remote connects
    remote.once('connect', () => {
      this.emit('open', remote);
      connLocal();
    });
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;

    // Clear all pending timeouts
    for (const id of this._timeouts) {
      clearTimeout(id);
    }
    this._timeouts.clear();

    // Destroy all transformers
    for (const transformer of this._transformers) {
      transformer.unpipe();
      transformer.destroy();
    }
    this._transformers.clear();

    // Destroy all local sockets
    for (const socket of this._localSockets) {
      socket.unpipe();
      socket.destroy();
    }
    this._localSockets.clear();

    // Destroy all remote sockets
    for (const socket of this._sockets) {
      socket.unpipe();
      socket.destroy();
    }
    this._sockets.clear();

    // Remove all event listeners
    this.removeAllListeners();

    debug('TunnelCluster destroyed');
  }
};
