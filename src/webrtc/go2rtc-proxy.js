const http = require('http');
const go2rtcManager = require('./go2rtc-manager');
const { config } = require('../config');

/**
 * Proxy API requests to go2rtc internal service.
 * Reused pattern from rtsp2web-main/src/webrtc/go2rtc.js
 *
 * - Blocks requests until go2rtc is ready (503)
 * - Forwards /api/* to go2rtc API port
 * - Preserves request method, headers, and body
 */

function handleProxy(req, res) {
  if (!go2rtcManager.isReady()) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'WebRTC service initializing, please wait' }));
    return;
  }

  const options = {
    hostname: 'localhost',
    port: go2rtcManager.getApiPort(),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${go2rtcManager.getApiPort()}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Forward CORS headers
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'WebRTC service unavailable' }));
  });

  req.pipe(proxyReq);
}

module.exports = { handleProxy };
