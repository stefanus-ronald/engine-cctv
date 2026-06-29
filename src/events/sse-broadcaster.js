/**
 * SSEBroadcaster — Server-Sent Events for real-time notifications.
 *
 * Broadcasts camera status changes, stream events, and system events
 * to all connected browser clients.
 */

const clients = new Set();
let eventId = 0;

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

  req.on('close', () => {
    clients.delete(res);
  });
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
