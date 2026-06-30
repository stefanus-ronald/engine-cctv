const { spawn } = require('child_process');
const JPEGFrameParser = require('./jpeg-parser');
const { config } = require('../config');
const cameraManager = require('../camera-manager');

/**
 * MJPEGManager — On-demand FFmpeg MJPEG streaming per camera.
 * Reused pattern from rtsp2web-main/src/mjpeg/mjpeg_multi.js
 *
 * - Starts FFmpeg on first client connection
 * - Stops FFmpeg when last client disconnects (1s grace)
 * - Auto-restarts on crash if clients still connected
 * - Dynamic camera support (cameras can be added/removed at runtime)
 */

const BOUNDARY = 'MJPEG_BOUNDARY';

const MAX_RESTART_ATTEMPTS = 5;

// Per-stream state, keyed by streamKey (cameraId for MAIN, `${cameraId}::sub` for
// SUB so a camera's main and sub channels can stream independently on different
// tiles): { cameraId, quality, ffmpeg, parser, clients: Set, stopTimer, restartCount, altIndex }
const streams = new Map();

// MAIN keeps the bare cameraId as its key (backward compatible); SUB gets a suffix.
function streamKeyFor(cameraId, quality) {
  return quality === 'sub' ? `${cameraId}::sub` : cameraId;
}

function getOrCreateStream(streamKey, cameraId, quality) {
  if (!streams.has(streamKey)) {
    streams.set(streamKey, {
      cameraId,
      quality: quality === 'sub' ? 'sub' : 'main',
      ffmpeg: null,
      parser: new JPEGFrameParser(),
      clients: new Set(),
      stopTimer: null,
      restartTimer: null,
      restartCount: 0,
      altIndex: -1, // -1 = primary path, 0+ = index into rtspAlternatives
    });
  }
  return streams.get(streamKey);
}

function startFFmpeg(streamKey) {
  const stream = streams.get(streamKey);
  if (!stream) return;
  const cameraId = stream.cameraId;
  const cam = cameraManager.getById(cameraId);
  if (!cam) {
    console.log(`[mjpeg] Camera ${cameraId} not found`);
    return;
  }

  // Use alternative path if set, otherwise the path for this stream's quality (main/sub)
  let rtspUrl;
  if (stream.altIndex >= 0 && cam.rtspAlternatives && cam.rtspAlternatives[stream.altIndex]) {
    rtspUrl = cameraManager.buildRtspUrlWithPath(cam, cam.rtspAlternatives[stream.altIndex]);
  } else {
    rtspUrl = cameraManager.buildRtspUrlForQuality(cam, stream.quality);
  }

  if (stream.ffmpeg) return; // Already running

  console.log(`[mjpeg] Starting FFmpeg for ${cameraId} (${cam.name})`);

  const ffmpegArgs = [
    '-rtsp_transport', 'tcp',
    '-analyzeduration', '100000',
    '-probesize', '100000',
    '-i', rtspUrl,
    '-c:v', 'mjpeg',
    '-q:v', String(config.mjpegQuality),
    '-r', String(config.mjpegFps),
    '-an',
    '-f', 'mjpeg',
    'pipe:1',
  ];

  const ffmpeg = spawn(config.ffmpegBin, ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  stream.ffmpeg = ffmpeg;
  stream.parser = new JPEGFrameParser();

  ffmpeg.stdout.on('data', (chunk) => {
    if (stream.clients.size === 0) return;
    // Reset restart count on first successful data
    stream.restartCount = 0;
    const frames = stream.parser.parseChunk(chunk);
    for (const frame of frames) {
      sendFrameToClients(streamKey, frame);
    }
  });

  ffmpeg.stderr.on('data', (data) => {
    // Suppress verbose FFmpeg logs; only log errors
    const msg = data.toString().trim();
    if (msg.includes('error') || msg.includes('Error')) {
      console.log(`[mjpeg][${cameraId}] ${msg}`);
    }
  });

  ffmpeg.on('exit', (code) => {
    console.log(`[mjpeg] FFmpeg for ${cameraId} exited (code ${code})`);
    stream.ffmpeg = null;

    // Auto-restart if clients are still connected, but respect max attempts.
    // The restart timer is tracked + re-checks clients so it can't resurrect an
    // FFmpeg process after everyone disconnected (orphaned process leak).
    if (stream.clients.size > 0) {
      stream.restartCount++;
      if (stream.restartCount <= MAX_RESTART_ATTEMPTS) {
        console.log(`[mjpeg] Restarting FFmpeg for ${cameraId} in 3s... (attempt ${stream.restartCount}/${MAX_RESTART_ATTEMPTS})`);
        stream.restartTimer = setTimeout(() => {
          stream.restartTimer = null;
          if (stream.clients.size > 0) startFFmpeg(streamKey);
        }, 3000);
      } else {
        // Try next alternative RTSP path if available
        const cam = cameraManager.getById(cameraId);
        const alts = cam && cam.rtspAlternatives ? cam.rtspAlternatives : [];
        const nextAlt = stream.altIndex + 1;
        if (nextAlt < alts.length) {
          stream.altIndex = nextAlt;
          stream.restartCount = 0;
          console.log(`[mjpeg] Trying alternative RTSP path ${nextAlt + 1}/${alts.length} for ${cameraId}: ${alts[nextAlt]}`);
          stream.restartTimer = setTimeout(() => {
            stream.restartTimer = null;
            if (stream.clients.size > 0) startFFmpeg(streamKey);
          }, 2000);
        } else {
          console.log(`[mjpeg] All RTSP paths exhausted for ${cameraId} — stopping`);
          cameraManager.setStatus(cameraId, 'error');
        }
      }
    }
  });

  ffmpeg.on('error', (err) => {
    console.error(`[mjpeg] FFmpeg error for ${cameraId}:`, err.message);
    stream.ffmpeg = null;
  });

  cameraManager.setStatus(cameraId, 'online');
}

function stopFFmpeg(streamKey) {
  const stream = streams.get(streamKey);
  if (!stream) return;
  // Cancel any pending auto-restart so a queued restart can't revive the stream.
  if (stream.restartTimer) { clearTimeout(stream.restartTimer); stream.restartTimer = null; }
  if (!stream.ffmpeg) return;

  console.log(`[mjpeg] Stopping FFmpeg for ${streamKey}`);
  stream.ffmpeg.kill('SIGTERM');
  stream.ffmpeg = null;
}

function sendFrameToClients(streamKey, frameBuffer) {
  const stream = streams.get(streamKey);
  if (!stream) return;

  const headers = Buffer.from(
    `--${BOUNDARY}\r\n` +
    'Content-Type: image/jpeg\r\n' +
    `Content-Length: ${frameBuffer.length}\r\n\r\n`
  );
  const footer = Buffer.from('\r\n');
  const fullFrame = Buffer.concat([headers, frameBuffer, footer]);

  for (const client of stream.clients) {
    if (!client.destroyed) {
      try {
        client.write(fullFrame);
      } catch (err) {
        stream.clients.delete(client);
      }
    }
  }
}

/**
 * Handle an MJPEG stream request.
 * @param {string} cameraId
 * @param {http.ServerResponse} res
 * @param {string} [quality] - 'main' (default) or 'sub' (lower bitrate channel)
 */
function handleStream(cameraId, res, quality) {
  const cam = cameraManager.getById(cameraId);
  if (!cam) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Camera not found' }));
    return;
  }

  const streamKey = streamKeyFor(cameraId, quality);
  const stream = getOrCreateStream(streamKey, cameraId, quality);

  // Cancel pending stop timer
  if (stream.stopTimer) {
    clearTimeout(stream.stopTimer);
    stream.stopTimer = null;
  }

  // Set multipart headers
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
  });

  stream.clients.add(res);
  console.log(`[mjpeg] Client connected to ${streamKey} (${stream.clients.size} total)`);

  // Start FFmpeg if first client
  if (stream.clients.size === 1 && !stream.ffmpeg) {
    startFFmpeg(streamKey);
  }

  // Handle disconnect
  res.on('close', () => {
    stream.clients.delete(res);
    console.log(`[mjpeg] Client disconnected from ${streamKey} (${stream.clients.size} remaining)`);

    if (stream.clients.size === 0) {
      stream.stopTimer = setTimeout(() => {
        stream.stopTimer = null;
        if (stream.clients.size === 0) {
          stopFFmpeg(streamKey);
          // Drop the per-stream state entirely so the Map (and its JPEG parser
          // buffer) doesn't grow without bound as camera ids churn over time.
          streams.delete(streamKey);
        }
      }, 1000);
    }
  });
}

/**
 * Get a single JPEG snapshot from a camera.
 */
function getSnapshot(cameraId, callback) {
  const cam = cameraManager.getById(cameraId);
  if (!cam) return callback(null);

  const rtspUrl = cameraManager.buildRtspUrl(cam);

  const ffmpeg = spawn(config.ffmpegBin, [
    '-rtsp_transport', 'tcp',
    '-i', rtspUrl,
    '-frames:v', '1',
    '-q:v', '2',
    '-f', 'image2',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Guard so the callback fires EXACTLY once: 'error' (spawn failed) and 'close'
  // can both fire, and the timeout below also resolves — a double callback made
  // the thumbnail route call res.writeHead twice → "headers already sent" crash.
  let done = false;
  const finish = (result) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    callback(result);
  };

  const chunks = [];
  ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
  ffmpeg.on('close', () => finish(chunks.length > 0 ? Buffer.concat(chunks) : null));
  ffmpeg.on('error', () => finish(null));

  // Timeout after 10 seconds — kill ffmpeg and resolve null if it ever hangs.
  const timer = setTimeout(() => {
    try { ffmpeg.kill('SIGTERM'); } catch (e) { /* already gone */ }
    finish(null);
  }, 10000);
}

function getStats() {
  const stats = {};
  for (const [cameraId, stream] of streams) {
    stats[cameraId] = {
      streaming: !!stream.ffmpeg,
      clients: stream.clients.size,
    };
  }
  return stats;
}

function stopAll() {
  for (const [cameraId] of streams) {
    stopFFmpeg(cameraId);
  }
}

module.exports = { handleStream, getSnapshot, getStats, stopAll };
