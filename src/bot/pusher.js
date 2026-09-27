// Optional chat reader using Kick's public websocket (the same one kick.com uses in the browser).
// Handy for local development where Kick can't reach your webhook URL. Unofficial: may change without notice.

const PUSHER_URL =
  'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';

function startPusherReader({ chatroomId, bot, logger = console }) {
  let ws;
  let stopped = false;
  let retry = 1000;

  const connect = () => {
    ws = new WebSocket(PUSHER_URL);

    ws.addEventListener('open', () => {
      retry = 1000;
      ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}.v2` } }));
      logger.log(`[pusher] connected, listening to chatroom ${chatroomId}`);
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.event === 'pusher:ping') return ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      if (msg.event !== 'App\\Events\\ChatMessageEvent') return;
      let data;
      try {
        data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
      } catch {
        return;
      }
      if (!data?.sender?.id) return;
      bot.handleMessage({ kickUserId: String(data.sender.id), username: data.sender.username, content: data.content || '' });
    });

    ws.addEventListener('close', () => {
      if (stopped) return;
      logger.warn(`[pusher] disconnected, reconnecting in ${retry / 1000}s`);
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30_000);
    });

    ws.addEventListener('error', (err) => logger.error('[pusher] error', err.message || err));
  };

  connect();
  return () => {
    stopped = true;
    ws?.close();
  };
}

module.exports = { startPusherReader };
