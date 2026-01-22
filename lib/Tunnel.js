/* eslint-disable consistent-return, no-underscore-dangle */

const { parse } = require('url');
const { EventEmitter } = require('events');
const axios = require('axios');
const debug = require('debug')('localtunnel:client');

const TunnelCluster = require('./TunnelCluster');

module.exports = class Tunnel extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
    this.closed = false;
    this._initTimeout = null;  // track _init retry timeout
    this._handlers = null;     // store handler refs for cleanup
    if (!this.opts.host) {
      this.opts.host = 'https://lt.desplega.ai';
    }
  }

  _getInfo(body) {
    /* eslint-disable camelcase */
    const { id, ip, port, url, cached_url, max_conn_count } = body;
    const { host, port: local_port, local_host } = this.opts;
    const { local_https, local_cert, local_key, local_ca, allow_invalid_cert } = this.opts;
    return {
      name: id,
      url,
      cached_url,
      max_conn: max_conn_count || 1,
      remote_host: parse(host).hostname,
      remote_ip: ip,
      remote_port: port,
      local_port,
      local_host,
      local_https,
      local_cert,
      local_key,
      local_ca,
      allow_invalid_cert,
    };
    /* eslint-enable camelcase */
  }

  // initialize connection
  // callback with connection info
  _init(cb) {
    const opt = this.opts;
    const getInfo = this._getInfo.bind(this);

    const params = {
      responseType: 'json',
    };

    const baseUri = `${opt.host}/`;
    // no subdomain at first, maybe use requested domain
    const assignedDomain = opt.subdomain;
    // where to quest
    let uri = baseUri + (assignedDomain || '?new');

    // add authentication parameters if provided
    if (opt.auth) {
      const separator = assignedDomain ? '?' : '&';
      uri += `${separator}username=hi`;
      // if opt.auth is a string (custom password), add it; if true, server generates password
      if (opt.auth !== true) {
        uri += `&password=${encodeURIComponent(opt.auth)}`;
      }
    }

    const self = this;
    (function getUrl() {
      axios
        .get(uri, params)
        .then(res => {
          const body = res.data;
          debug('got tunnel information', res.data);
          if (res.status !== 200) {
            const err = new Error(
              (body && body.message) || 'localtunnel server returned an error, please try again'
            );
            return cb(err);
          }
          cb(null, getInfo(body));
        })
        .catch(err => {
          // Handle 409 Conflict (subdomain in use) - fail immediately, don't retry
          if (err.response?.status === 409) {
            const message = err.response.data?.message || 'Subdomain is already in use';
            debug('subdomain in use: %s', message);
            return cb(new Error(message));
          }

          // Other errors (network issues, server down) - retry
          debug(`tunnel server offline: ${err.message}, retry 1s`);
          self._initTimeout = setTimeout(getUrl, 1000);
        });
    })();
  }

  _establish(info) {
    // increase max event listeners so that localtunnel consumers don't get
    // warning messages as soon as they setup even one listener. See #71
    this.setMaxListeners(info.max_conn + (EventEmitter.defaultMaxListeners || 10));

    this.tunnelCluster = new TunnelCluster(info);

    let tunnelCount = 0;

    // Store handlers for later cleanup
    this._handlers = {
      firstOpen: () => {
        this.emit('url', info.url);
      },
      error: err => {
        debug('got socket error', err.message);
        this.emit('error', err);
      },
      open: tunnel => {
        tunnelCount++;
        debug('tunnel open [total: %d]', tunnelCount);

        const closeHandler = () => {
          tunnel.destroy();
        };

        if (this.closed) {
          return closeHandler();
        }

        this.once('close', closeHandler);
        tunnel.once('close', () => {
          this.removeListener('close', closeHandler);
        });
      },
      dead: () => {
        tunnelCount--;
        debug('tunnel dead [total: %d]', tunnelCount);
        if (this.closed) {
          return;
        }
        this.tunnelCluster.open();
      },
      request: req => {
        this.emit('request', req);
      },
    };

    // Attach handlers
    this.tunnelCluster.once('open', this._handlers.firstOpen);
    this.tunnelCluster.on('error', this._handlers.error);
    this.tunnelCluster.on('open', this._handlers.open);
    this.tunnelCluster.on('dead', this._handlers.dead);
    this.tunnelCluster.on('request', this._handlers.request);

    // establish as many tunnels as allowed
    for (let count = 0; count < info.max_conn; ++count) {
      this.tunnelCluster.open();
    }
  }

  open(cb) {
    this._init((err, info) => {
      if (err) {
        return cb(err);
      }

      this.clientId = info.name;
      this.url = info.url;

      // `cached_url` is only returned by proxy servers that support resource caching.
      if (info.cached_url) {
        this.cachedUrl = info.cached_url;
      }

      this._establish(info);
      cb();
    });
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    debug('closing tunnel');

    // Cancel pending _init timeout
    if (this._initTimeout) {
      clearTimeout(this._initTimeout);
      this._initTimeout = null;
    }

    // Cleanup TunnelCluster
    if (this.tunnelCluster) {
      // Remove our listeners first
      if (this._handlers) {
        this.tunnelCluster.removeListener('open', this._handlers.firstOpen);
        this.tunnelCluster.removeListener('error', this._handlers.error);
        this.tunnelCluster.removeListener('open', this._handlers.open);
        this.tunnelCluster.removeListener('dead', this._handlers.dead);
        this.tunnelCluster.removeListener('request', this._handlers.request);
        this._handlers = null;
      }
      this.tunnelCluster.destroy();
      this.tunnelCluster = null;
    }

    // Emit close event for backwards compat (before removing our listeners)
    this.emit('close');

    // Allow close handlers to run
    await new Promise(resolve => setImmediate(resolve));

    this.removeAllListeners();
    debug('tunnel closed');
  }
};
