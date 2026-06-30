/**
 * SSEBroadcaster — Server-Sent Events for real-time notifications.
 *
 * Broadcasts camera status changes, stream events, and system events
 * to all connected browser clients.
 */

const clients = new Set();
let eventId = 0;

// Periodic heartbeat: a half-open TCP connection (client gone without a FIN)
// never fires req 'close', so its entry would linger and every broadcast would
// keep trying to write to a dead socket. A comment ping every 25s keeps proxies
// from idling the connection AND prunes clients whose write now fails.
const HEARTBEAT_MS = 25000;
const _heartbeat = setInterval(() => {
  for (const client of clients) {
    if (client.destroyed) { clients.delete(client); continue; }
    try { client.write(': ping\n\n'); }
    catch (err) { clients.delete(client); }
  }
}, HEARTBEAT_MS);
if (_heartbeat.unref) _heartbeat.unref();   // don't keep the process alive for this

function handleConnection(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

  clients.add(res);

  req.on('close', () => clients.delete(res));
  res.on('error', () => clients.delete(res));   // socket error also removes the client
}

function broadcast(event) {
  eventId++;
  const data = JSON.stringify({ ...event, id: eventId, timestamp: Date.now() });
  const message = `id: ${eventId}\ndata: ${data}\n\n`;

  for (const client of clients) {
    if (!client.destroyed) {
      try {
        client.write(message);
      } catch (err) {
        clients.delete(client);
      }
    }
  }
}

function getClientCount() {
  return clients.size;
}

module.exports = { handleConnection, broadcast, getClientCount };
