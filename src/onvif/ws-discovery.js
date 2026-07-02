/**
 * ws-discovery.js — ONVIF WS-Discovery probe (V-014, Fase 1).
 *
 * Sends one WS-Discovery "Probe" to the multicast group 239.255.255.250:3702 and
 * collects ProbeMatch responses for a short window. This is the auto-detect that
 * ISAPI never had — list ONVIF cameras on the LAN without typing IPs.
 *
 * Zero dependencies — native `dgram` + crypto.randomUUID. Returns whatever
 * answers within the timeout (cameras on the same L2 segment; multicast usually
 * does NOT cross subnets/VLANs/firewalls — manual IP entry remains the fallback).
 */

const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');

const MCAST_ADDR = '239.255.255.250';
const MCAST_PORT = 3702;

/** All non-internal IPv4 interface addresses on this host (for multi-NIC probe). */
function ipv4Interfaces() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function buildProbe(messageId) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" ` +
      `xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" ` +
      `xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" ` +
      `xmlns:dn="http://www.onvif.org/ver10/network/wsdl">` +
      `<e:Header>` +
        `<w:MessageID>uuid:${messageId}</w:MessageID>` +
        `<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>` +
        `<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>` +
      `</e:Header>` +
      `<e:Body>` +
        `<d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe>` +
      `</e:Body>` +
    `</e:Envelope>`
  );
}

/** Extract the first http(s) XAddr from a ProbeMatch, plus name/hardware scopes. */
function parseProbeMatch(xml) {
  const xaddrsRaw = (xml.match(/<[^>]*XAddrs>([^<]*)</i) || [])[1] || '';
  const xaddr = xaddrsRaw.split(/\s+/).find(u => /^https?:\/\//i.test(u)) || '';
  const scopesRaw = (xml.match(/<[^>]*Scopes>([\s\S]*?)<\/[^>]*Scopes>/i) || [])[1] || '';
  const scopes = scopesRaw.split(/\s+/).filter(Boolean);
  const pick = (key) => {
    const s = scopes.find(x => x.includes(`/${key}/`));
    if (!s) return '';
    try { return decodeURIComponent(s.split(`/${key}/`)[1] || ''); } catch (e) { return s.split(`/${key}/`)[1] || ''; }
  };
  let ip = '';
  try { ip = xaddr ? new (require('url').URL)(xaddr).hostname : ''; } catch (e) { ip = ''; }
  return {
    xaddr,
    ip,
    name: pick('name') || pick('hardware') || ip,
    hardware: pick('hardware'),
    location: pick('location'),
  };
}

/**
 * Probe the LAN for ONVIF devices.
 * @param {object} [opts] - { timeoutMs=4000 }
 * @returns {Promise<Array<{xaddr,ip,name,hardware,location}>>} de-duplicated by xaddr
 */
function discover({ timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sockets = [];

    const onMessage = (msg) => {
      const xml = msg.toString('utf8');
      if (!/ProbeMatch/i.test(xml)) return;
      const m = parseProbeMatch(xml);
      if (m.xaddr && !found.has(m.xaddr)) found.set(m.xaddr, m);
    };

    const done = () => {
      for (const s of sockets) { try { s.close(); } catch (e) {} }
      resolve([...found.values()]);
    };

    // Fan the Probe out across EVERY IPv4 interface, not just the OS default.
    // WS-Discovery is multicast: on a multi-NIC host (Wi-Fi + Ethernet + VM/WSL
    // adapters) a single default-interface probe often egresses the wrong NIC and
    // the cameras never hear it → 0 results. Binding one socket per interface (and
    // one wildcard) makes discovery robust to which interface happens to be active.
    const addrs = ['0.0.0.0', ...ipv4Interfaces()];
    let bound = 0;

    const sendFrom = (sock, ifaceAddr) => {
      try {
        try { sock.setBroadcast(true); } catch (e) {}
        if (ifaceAddr !== '0.0.0.0') { try { sock.setMulticastInterface(ifaceAddr); } catch (e) {} }
        const probe = Buffer.from(buildProbe(crypto.randomUUID()), 'utf8');
        sock.send(probe, 0, probe.length, MCAST_PORT, MCAST_ADDR, () => {});
        // Re-send once after 400ms — a single UDP probe is easily dropped.
        setTimeout(() => { try { sock.send(Buffer.from(buildProbe(crypto.randomUUID()), 'utf8'), 0, probe.length, MCAST_PORT, MCAST_ADDR, () => {}); } catch (e) {} }, 400).unref();
      } catch (e) { /* ignore this interface */ }
    };

    for (const addr of addrs) {
      let sock;
      try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { continue; }
      sock.on('error', () => {
        // Bind/send failed on this interface (unplugged NIC, address conflict):
        // close it AND drop it from the pool so dead sockets don't accumulate.
        try { sock.close(); } catch (e) {}
        const i = sockets.indexOf(sock);
        if (i >= 0) sockets.splice(i, 1);
      });
      sock.on('message', onMessage);
      sockets.push(sock);
      const bindOpts = addr === '0.0.0.0' ? { port: 0 } : { address: addr, port: 0 };
      sock.bind(bindOpts, () => sendFrom(sock, addr));
    }

    if (!sockets.length) return resolve([]);
    setTimeout(done, timeoutMs).unref();
  });
}

module.exports = { discover, buildProbe, parseProbeMatch };
