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
    timeout: 15000,   // don't let a non-responsive go2rtc hold the socket forever
  };

  const fail = (msg) => {
    // Only answer if we haven't started streaming the upstream response yet.
    if (!res.headersSent) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg || 'WebRTC service unavailable' }));
    } else {
      try { res.destroy(); } catch (e) { /* already closed */ }
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => fail('WebRTC service unavailable'));
  proxyReq.on('timeout', () => { proxyReq.destroy(); fail('WebRTC service timeout'); });
  // Client aborted/upload errored — without a listener this throws uncaught.
  req.on('error', () => { try { proxyReq.destroy(); } catch (e) {} });
  // Tear down the upstream request if the client disconnects mid-flight.
  res.on('close', () => { try { proxyReq.destroy(); } catch (e) {} });

  req.pipe(proxyReq);
}

module.exports = { handleProxy };
