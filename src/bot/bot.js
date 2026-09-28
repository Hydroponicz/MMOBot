// Glue between incoming chat (webhook / websocket / dev console) and the game engine,
// plus a rate-limited outgoing chat queue.

class ChatBot {
  constructor({ engine, kick, logger = console }) {
    this.engine = engine;
    this.kick = kick;
    this.log = logger;
    this.queue = [];
    this.sending = false;
    this.minGapMs = 1200; // stay well under Kick's chat rate limits
    this.stats = { received: 0, commands: 0, sent: 0, sendErrors: 0, lastMessageAt: null, lastError: null };
    this.recentReplies = new Map(); // reply text -> when we queued it
  }

  // msg: { kickUserId, username, avatarUrl?, content }
  handleMessage(msg) {
    this.stats.received++;
    this.stats.lastMessageAt = Date.now();
    // Ignore the bot account's own messages (never the streamer's).
    const botAccount = this.kick.botAccount();
    if (botAccount && String(msg.kickUserId) === String(botAccount.user_id)) return null;
    // Our own replies coming back through the webhook (when they're posted by Kick's app bot, whose
    // account we don't know) aren't chat: they can quote what a viewer typed, emote names included.
    if (this.isOwnReply(msg.content)) return null;
    let reply = null;
    try {
      reply = this.engine.handleChat(msg).reply;
    } catch (err) {
      this.log.error('[bot] error handling message', err);
      return null;
    }
    if (reply) {
      this.stats.commands++;
      this.log.info(`[chat] ${msg.username}: ${msg.content.trim().slice(0, 200)} → ${reply}`);
      if (this.engine.cfg.replyInChat) this.say(reply);
    }
    return reply;
  }

  isOwnReply(content) {
    const at = this.recentReplies.get(String(content || '').trim());
    return at !== undefined && Date.now() - at < 5 * 60_000;
  }

  say(text) {
    const now = Date.now();
    this.recentReplies.set(text.slice(0, 500).trim(), now);
    for (const [t, at] of this.recentReplies) if (now - at > 5 * 60_000 || this.recentReplies.size > 200) this.recentReplies.delete(t);
    this.queue.push(text);
    if (this.queue.length > 50) this.queue.splice(0, this.queue.length - 50); // drop backlog under heavy load
    this.drain();
  }

  async drain() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length) {
        const text = this.queue.shift();
        try {
          const sent = await this.kick.sendChat(text);
          if (sent) this.stats.sent++;
        } catch (err) {
          this.stats.sendErrors++;
          this.stats.lastError = err.message;
          this.log.error('[bot] failed to send chat message:', err.message);
        }
        await new Promise((r) => setTimeout(r, this.minGapMs));
      }
    } finally {
      this.sending = false;
    }
  }
}

module.exports = { ChatBot };
