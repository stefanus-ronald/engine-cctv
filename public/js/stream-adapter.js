/**
 * StreamAdapter — WebRTC/MJPEG stream element factory.
 *
 * Manages real stream connections for camera tiles.
 * WebRTC: creates RTCPeerConnection and <video> element.
 * MJPEG: creates <img> element pointing to /mjpeg/<id>.
 *
 * Auto-fallback: if go2rtc is unavailable (503), automatically
 * falls back to MJPEG without retrying WebRTC.
 *
 * Connection reuse: when renderGrid() recreates tiles, existing
 * WebRTC connections are transferred to the new DOM elements
 * instead of being torn down and rebuilt.
 */
const StreamAdapter = (() => {
  // Track active connections per tile index
  // Each entry: { type, cameraId, cleanup, stream?, pc?, mediaEl?, tile? }
  const connections = new Map();

  // WebRTC availability — checked once at startup via /health
  let _webrtcAvailable = null; // null = unknown, true/false = checked

  // Notify the UI (e.g. the protocol badge) whenever effective availability changes.
  function _emitAvailability() {
    try { document.dispatchEvent(new CustomEvent('streamprotocolchange', { detail: { webrtcAvailable: _webrtcAvailable } })); }
    catch (e) { /* no-op */ }
  }

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  /**
   * Check server health to determine WebRTC availability.
   * Called once; result is cached.
   */
  async function _checkWebRTCAvailability() {
    if (_webrtcAvailable !== null) return _webrtcAvailable;
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const data = await res.json();
        _webrtcAvailable = data.go2rtc === 'ready';
      } else {
        _webrtcAvailable = false;
      }
    } catch (e) {
      _webrtcAvailable = false;
    }
    if (!_webrtcAvailable) {
      console.log('[stream] WebRTC unavailable — all streams will use MJPEG');
    }
    _emitAvailability();
    return _webrtcAvailable;
  }

  // Run health check on load
  _checkWebRTCAvailability();

  /**
   * Connect a stream to a tile element.
   * If the same camera is already connected at this tileIndex,
   * transfers the stream to the new element (avoids full reconnect).
   */
  function connect(tileElement, cameraId, protocol, tileIndex, quality, staggerMs) {
    quality = quality === 'sub' ? 'sub' : 'main';
    const desired = (protocol === 'webrtc' && _webrtcAvailable !== false) ? 'webrtc' : 'mjpeg';
    const existing = connections.get(tileIndex);

    // Reuse path: the same camera+quality+protocol is already live for this tile
    // index (its media element may have been parked during a grid re-render) —
    // adopt the existing element instead of reconnecting. This keeps WebRTC AND
    // MJPEG streams alive across layout changes.
    if (existing && existing.cameraId === cameraId && existing.quality === quality
        && existing.type === desired && existing.mediaEl && !existing.cancelled) {
      _adoptMedia(tileElement, existing);
      existing.tile = tileElement;
      return;
    }

    // Full disconnect + (re)connect
    disconnect(tileIndex);

    const fresh = () => {
      if (desired === 'webrtc') _connectWebRTC(tileElement, cameraId, tileIndex, quality);
      else _connectMJPEG(tileElement, cameraId, tileIndex, quality);
    };
    // Immediate connect runs during createTile (before the tile is appended), so
    // do NOT gate it on isConnected. Only the staggered/deferred connect checks
    // isConnected — by then the tile may have been removed during the delay.
    if (staggerMs > 0) setTimeout(() => { if (tileElement.isConnected) fresh(); }, staggerMs);
    else fresh();
  }

  // Move an existing (still-streaming) media element into a freshly-rendered tile,
  // replacing that tile's placeholder. Preserves the live stream — no reconnect.
  function _adoptMedia(tile, conn) {
    const mediaEl = conn.mediaEl;
    const placeholder = tile.querySelector('.tile-media');
    if (placeholder && placeholder !== mediaEl) placeholder.replaceWith(mediaEl);
    else if (!placeholder) tile.prepend(mediaEl);
    // Moving a <video> between DOM positions pauses it (autoplay won't re-fire) →
    // black tile. Re-kick playback. <img> multipart streams keep flowing.
    if (mediaEl.tagName === 'VIDEO') {
      if (mediaEl.srcObject) { try { mediaEl.play().catch(() => {}); } catch (e) {} }
    }
    const live = mediaEl.tagName === 'VIDEO' ? !!mediaEl.srcObject : true;
    _setTileStatus(tile, live ? 'connected' : 'connecting');
  }

  // Off-screen holder that keeps media elements in the document (so their
  // streams don't abort) while the grid is rebuilt.
  function _keepaliveEl() {
    let k = document.getElementById('stream-keepalive');
    if (!k) {
      k = document.createElement('div');
      k.id = 'stream-keepalive';
      k.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none';
      document.body.appendChild(k);
    }
    return k;
  }

  // Park all live media elements before a grid re-render so innerHTML='' doesn't
  // tear down their connections. They get re-adopted by connect() per tile.
  function parkMedia() {
    const k = _keepaliveEl();
    for (const conn of connections.values()) {
      if (conn.mediaEl && conn.mediaEl.parentNode !== k) k.appendChild(conn.mediaEl);
    }
  }

  // Re-key two tiles' connections so a drag swap/move keeps its live streams
  // (they get re-adopted at their new index instead of reconnecting).
  function swapTiles(a, b) {
    const ca = connections.get(a);
    const cb = connections.get(b);
    if (cb) connections.set(a, cb); else connections.delete(a);
    if (ca) connections.set(b, ca); else connections.delete(b);
  }

  // After a rebuild: disconnect tiles that no longer exist and drop any media that
  // wasn't re-adopted (its camera/tile is gone). Call once the synchronous render
  // pass has placed all reused elements.
  function sweep(totalTiles) {
    for (const [idx] of [...connections]) {
      if (idx >= totalTiles) disconnect(idx);
    }
    const k = document.getElementById('stream-keepalive');
    if (k) [...k.children].forEach(el => el.remove());
  }

  /**
   * Transfer an existing WebRTC connection to a new tile element.
   * Avoids tearing down the RTCPeerConnection and re-negotiating SDP.
   */
  function _transferWebRTC(conn, newTile) {
    let mediaEl = newTile.querySelector('.tile-media');

    // Ensure we have a video element
    if (!mediaEl || mediaEl.tagName !== 'VIDEO') {
      const video = document.createElement('video');
      video.className = 'tile-media tile-video';
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      if (mediaEl) {
        mediaEl.replaceWith(video);
      } else {
        newTile.prepend(video);
      }
      mediaEl = video;
    }

    // Transfer the MediaStream to the new video element
    if (conn.stream) {
      mediaEl.srcObject = conn.stream;
      _setTileStatus(newTile, 'connected');
    } else {
      _setTileStatus(newTile, 'connecting');
    }

    // Update references so future callbacks target the new elements
    conn.mediaEl = mediaEl;
    conn.tile = newTile;
  }

  /**
   * Disconnect the stream on a given tile.
   */
  function disconnect(tileIndex) {
    const conn = connections.get(tileIndex);
    if (conn) {
      conn.cancelled = true;
      if (conn.cleanup) conn.cleanup();
    }
    connections.delete(tileIndex);
  }

  /**
   * Disconnect all active streams.
   */
  function disconnectAll() {
    for (const [idx] of connections) {
      disconnect(idx);
    }
  }

  /**
   * Reconnect a specific tile's stream.
   */
  function reconnect(tileElement, cameraId, protocol, tileIndex, quality) {
    disconnect(tileIndex);
    connect(tileElement, cameraId, protocol, tileIndex, quality);
  }

  /**
   * Switch protocol on all active tiles.
   */
  function switchProtocol(newProtocol, getTileInfo) {
    const entries = Array.from(connections.entries());
    for (const [tileIndex] of entries) {
      const info = getTileInfo(tileIndex);
      if (info) {
        reconnect(info.element, info.cameraId, newProtocol, tileIndex);
      }
    }
  }

  /**
   * Re-check WebRTC availability (e.g. after go2rtc is started).
   */
  function recheckWebRTC() {
    _webrtcAvailable = null;
    return _checkWebRTCAvailability();
  }

  /**
   * Returns the effective protocol for a given requested protocol.
   */
  function getEffectiveProtocol(requested) {
    if (requested === 'webrtc' && _webrtcAvailable === false) return 'mjpeg';
    return requested;
  }

  // ─── WebRTC ─────────────────────────────────────────────────

  // go2rtc stream name for a given quality. MAIN keeps the bare cameraId
  // (backward compatible); SUB uses a suffix the server registers separately.
  function _srcName(cameraId, quality) {
    return quality === 'sub' ? `${cameraId}_sub` : cameraId;
  }

  function _connectWebRTC(tile, cameraId, tileIndex, quality) {
    quality = quality === 'sub' ? 'sub' : 'main';
    // Find or create the media element inside the tile
    let mediaEl = tile.querySelector('.tile-media');
    if (!mediaEl) {
      mediaEl = document.createElement('video');
      mediaEl.className = 'tile-media tile-video';
      mediaEl.autoplay = true;
      mediaEl.muted = true;
      mediaEl.playsInline = true;
      const img = tile.querySelector('.tile-img');
      if (img) {
        img.replaceWith(mediaEl);
      } else {
        tile.prepend(mediaEl);
      }
    } else if (mediaEl.tagName === 'IMG') {
      const video = document.createElement('video');
      video.className = 'tile-media tile-video';
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      mediaEl.replaceWith(video);
      mediaEl = video;
    }

    let retryCount = 0;
    const maxRetries = 3;
    let retryTimer = null;

    // Connection entry — shared state accessible by callbacks and transfer
    const conn = {
      type: 'webrtc',
      cameraId: cameraId,
      quality: quality,
      pc: null,
      stream: null,
      mediaEl: mediaEl,
      tile: tile,
      cancelled: false,
      cleanup: () => {
        if (retryTimer) clearTimeout(retryTimer);
        if (conn.pc) {
          try { conn.pc.close(); } catch (e) {}
          conn.pc = null;
        }
        if (conn.mediaEl) conn.mediaEl.srcObject = null;
      },
    };

    connections.set(tileIndex, conn);

    async function attemptConnection() {
      if (conn.cancelled) return;
      retryCount++;

      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 0,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      conn.pc = pc;

      pc.ontrack = (event) => {
        if (conn.cancelled) return;
        conn.stream = event.streams[0];
        // Always set srcObject on the CURRENT mediaEl (may have been transferred)
        conn.mediaEl.srcObject = conn.stream;
        retryCount = 0;
        _setTileProgress(conn.tile, _rand(93, 96), _rand(97, 99)); // track received
        // Keep the loading spinner until the first frame is actually painted —
        // otherwise the tile flips to "connected" while still showing a black box.
        _waitForFirstFrame(conn);
      };

      pc.onconnectionstatechange = () => {
        if (conn.cancelled) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          _setTileStatus(conn.tile, 'reconnecting');
          cleanupPC();
          if (retryCount < maxRetries) {
            retryTimer = setTimeout(attemptConnection, 3000);
          } else {
            console.log(`[stream] WebRTC failed for ${cameraId}, falling back to MJPEG`);
            _fallbackToMJPEG(conn.tile, cameraId, tileIndex, quality);
          }
        }
      };

      try {
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        _setTileProgress(conn.tile, _rand(20, 28), _rand(38, 46)); // offer created

        // Wait for ICE gathering (5s timeout for Safari)
        await new Promise(resolve => {
          if (pc.iceGatheringState === 'complete') { resolve(); return; }
          const timeout = setTimeout(resolve, 5000);
          const onIce = (e) => {
            if (!e.candidate) {
              pc.removeEventListener('icecandidate', onIce);
              clearTimeout(timeout);
              resolve();
            }
          };
          pc.addEventListener('icecandidate', onIce);
        });
        _setTileProgress(conn.tile, _rand(40, 50), _rand(60, 70)); // ICE done

        if (conn.cancelled) return;

        const response = await fetch(`/api/webrtc?src=${encodeURIComponent(_srcName(cameraId, quality))}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription.sdp,
        });
        _setTileProgress(conn.tile, _rand(63, 73), _rand(80, 88)); // answer received

        if (response.ok) {
          const answer = await response.text();
          await pc.setRemoteDescription({ type: 'answer', sdp: answer });
          _setTileProgress(conn.tile, _rand(84, 90), _rand(91, 94)); // negotiated
        } else if (response.status === 503) {
          _webrtcAvailable = false;
          _emitAvailability();
          console.log(`[stream] go2rtc unavailable (503), falling back to MJPEG for ${cameraId}`);
          cleanupPC();
          if (!conn.cancelled) _fallbackToMJPEG(conn.tile, cameraId, tileIndex, quality);
          return;
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (err) {
        console.warn(`[stream] WebRTC ${cameraId} attempt ${retryCount}/${maxRetries}:`, err.message);
        cleanupPC();
        if (conn.cancelled) return;

        if (retryCount < maxRetries) {
          _setTileStatus(conn.tile, 'reconnecting');
          retryTimer = setTimeout(attemptConnection, 3000);
        } else {
          console.log(`[stream] WebRTC failed for ${cameraId}, falling back to MJPEG`);
          _fallbackToMJPEG(conn.tile, cameraId, tileIndex, quality);
        }
      }
    }

    function cleanupPC() {
      if (conn.pc) {
        try { conn.pc.close(); } catch (e) {}
        conn.pc = null;
      }
    }

    _setTileStatus(tile, 'connecting');
    attemptConnection();
  }

  /**
   * Fallback: switch a single tile from failed WebRTC to MJPEG.
   */
  function _fallbackToMJPEG(tile, cameraId, tileIndex, quality) {
    const conn = connections.get(tileIndex);
    if (conn) {
      conn.cancelled = true;
      if (conn.cleanup) conn.cleanup();
    }
    connections.delete(tileIndex);
    _connectMJPEG(tile, cameraId, tileIndex, quality);
  }

  // ─── MJPEG ──────────────────────────────────────────────────

  function _connectMJPEG(tile, cameraId, tileIndex, quality) {
    quality = quality === 'sub' ? 'sub' : 'main';
    const streamUrl = `/mjpeg/${encodeURIComponent(cameraId)}?quality=${quality}`;
    let mediaEl = tile.querySelector('.tile-media');

    if (!mediaEl || mediaEl.tagName === 'VIDEO') {
      const img = document.createElement('img');
      img.className = 'tile-media tile-img';
      img.alt = '';
      if (mediaEl) {
        mediaEl.replaceWith(img);
      } else {
        tile.prepend(img);
      }
      mediaEl = img;
    }

    mediaEl.src = streamUrl;

    mediaEl.onload = () => {
      _setTileStatus(tile, 'connected');   // 100% — first JPEG painted
    };

    let retryTimer = null;
    mediaEl.onerror = () => {
      _setTileStatus(tile, 'error');
      retryTimer = setTimeout(() => {
        if (connections.has(tileIndex)) {
          mediaEl.src = `${streamUrl}&t=${Date.now()}`;
        }
      }, 5000);
    };

    connections.set(tileIndex, {
      type: 'mjpeg',
      cameraId: cameraId,
      quality: quality,
      mediaEl: mediaEl,
      tile: tile,
      cancelled: false,
      cleanup: () => {
        if (retryTimer) clearTimeout(retryTimer);
        mediaEl.src = '';
        mediaEl.onload = null;
        mediaEl.onerror = null;
      },
    });

    _setTileStatus(tile, 'connecting');
    _setTileProgress(tile, _rand(40, 55), _rand(82, 92)); // request issued — awaiting first JPEG
  }

  // ─── Helpers ────────────────────────────────────────────────

  /**
   * Hold the tile in "connecting" (spinner visible) until the <video> actually
   * has a decodable first frame, then flip to "connected". Falls back after a
   * timeout so the spinner can never hang forever.
   */
  function _waitForFirstFrame(conn) {
    const el = conn.mediaEl;
    if (!el) return;
    let done = false, timer = null;
    const finish = () => {
      if (done || conn.cancelled) return;
      done = true;
      if (timer) clearTimeout(timer);
      el.removeEventListener('loadeddata', finish);
      el.removeEventListener('playing', finish);
      if (!conn.cancelled) _setTileStatus(conn.tile, 'connected');
    };
    if (el.readyState >= 2) { finish(); return; } // already has a frame
    el.addEventListener('loadeddata', finish);
    el.addEventListener('playing', finish);
    timer = setTimeout(finish, 12000);
  }

  // Random float in [min,max) — used to jitter milestone values so the loading
  // bar shows different numbers each time (never the same scripted sequence).
  function _rand(min, max) { return min + Math.random() * (max - min); }

  function _renderTileProg(tile) {
    const overlay = tile && tile.querySelector && tile.querySelector('.reconnect-overlay');
    if (!overlay) return;
    const fill = overlay.querySelector('.tile-prog-fill');
    const pctEl = overlay.querySelector('.tile-prog-pct');
    const v = Math.round(tile._prog || 0);
    if (fill) fill.style.width = v + '%';
    if (pctEl) pctEl.textContent = v + '%';
  }
  function _stopTileTrickle(tile) {
    if (tile && tile._progTrickle) { clearTimeout(tile._progTrickle); tile._progTrickle = null; }
  }
  // Highly varied random step: mostly small, sometimes a burst, sometimes a
  // near-pause — so two loads never look alike.
  function _randStep() {
    const r = Math.random();
    if (r < 0.18) return Math.random() * 0.25;      // near-pause
    if (r < 0.82) return 0.3 + Math.random() * 1.9; // normal creep
    return 2.2 + Math.random() * 3.8;               // occasional burst
  }
  // Varied random interval: usually quick, occasionally a long hesitation.
  function _randInterval() {
    return Math.random() < 0.22 ? 650 + Math.random() * 1250 : 110 + Math.random() * 470;
  }

  // Between real milestones, creep upward by RANDOM steps at RANDOM intervals
  // toward the ceiling — alive & different every time, never overshooting.
  function _startTileTrickle(tile) {
    if (!tile || tile._progTrickle) return;
    const tick = () => {
      if (!tile.isConnected) { _stopTileTrickle(tile); return; }
      const ceil = tile._progCeil || 0;
      if ((tile._prog || 0) < ceil) {
        tile._prog = Math.min(ceil, (tile._prog || 0) + _randStep());
        _renderTileProg(tile);
      }
      tile._progTrickle = setTimeout(tick, _randInterval());
    };
    tile._progTrickle = setTimeout(tick, _randInterval());
  }
  /** Advance the tile loading bar to a REAL milestone `value`; the randomized
   *  trickle then creeps toward `ceil` until the next milestone. */
  function _setTileProgress(tile, value, ceil) {
    if (!tile) return;
    if (value >= 100) { _stopTileTrickle(tile); tile._prog = 100; tile._progCeil = 100; _renderTileProg(tile); return; }
    tile._prog = Math.max(tile._prog || 0, value);
    tile._progCeil = Math.max(tile._progCeil || 0, ceil != null ? ceil : value);
    _renderTileProg(tile);
    _startTileTrickle(tile);
  }

  function _setTileStatus(tile, status) {
    if (!tile || !tile.setAttribute) return;
    const prev = tile.getAttribute('data-stream-status');
    tile.setAttribute('data-stream-status', status);
    const overlay = tile.querySelector('.reconnect-overlay');
    if (overlay) {
      // The overlay's visibility is driven by the `.show` class (CSS opacity
      // fade) — toggling style.display alone never made it appear.
      const loading = (status === 'connecting' || status === 'reconnecting');
      overlay.classList.toggle('show', loading);
      const label = overlay.querySelector('.tile-loading-label');
      if (label) label.textContent = status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
      // REAL progress (not a timer): the bar is advanced from actual connection
      // milestones in attemptConnection / _connectMJPEG. Here we only seed it on
      // (re)connect start and complete it on 'connected'.
      if (loading && prev !== status) {
        tile._prog = 0; tile._progCeil = 0;
        _setTileProgress(tile, _rand(3, 8), _rand(16, 24));
      } else if (status === 'connected') {
        _setTileProgress(tile, 100);
      } else if (!loading) {
        _stopTileTrickle(tile);
      }
    }
    // Notify listeners (e.g. line-crossing overlay) when stream status changes.
    // Lets the UI defer rendering overlays until the video is actually showing.
    if (prev !== status && typeof CustomEvent === 'function') {
      try {
        tile.dispatchEvent(new CustomEvent('tilestreamstatus', { detail: { status } }));
      } catch (e) { /* no-op */ }
    }
  }

  function setMuted(tileElement, muted) {
    const video = tileElement.querySelector('video.tile-media');
    if (video) {
      video.muted = muted;
    }
  }

  function isConnected(tileIndex) {
    return connections.has(tileIndex);
  }

  return {
    connect,
    disconnect,
    disconnectAll,
    reconnect,
    switchProtocol,
    setMuted,
    isConnected,
    recheckWebRTC,
    getEffectiveProtocol,
    parkMedia,
    sweep,
    swapTiles,
  };
})();
