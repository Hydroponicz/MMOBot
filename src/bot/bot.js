// Glue between incoming chat (webhook / websocket / dev console) and the game engine,
// plus a rate-limited outgoing chat queue.

class ChatBot {
  constructor({ engine, kick, config, logger = console }) {
    this.engine = engine;
    this.kick = kick;
    this.replyInChat = config.game.replyInChat;
    this.log = logger;
    this.queue = [];
    this.sending = false;
    this.minGapMs = 1200; // stay well under Kick's chat rate limits
    this.stats = { received: 0, commands: 0, sent: 0, sendErrors: 0, lastMessageAt: null, lastError: null };
  }

  // msg: { kickUserId, username, avatarUrl?, content }
  handleMessage(msg) {
    this.stats.received++;
    this.stats.lastMessageAt = Date.now();
    // Ignore the bot account's own messages (never the streamer's).
    const botAccount = this.kick.botAccount();
    if (botAccount && String(msg.kickUserId) === String(botAccount.user_id)) return null;
    let reply = null;
    try {
      reply = this.engine.handleChat(msg).reply;
    } catch (err) {
      this.log.error('[bot] error handling message', err);
      return null;
    }
    if (reply) {
      this.stats.commands++;
      if (this.replyInChat) this.say(reply);
    }
    return reply;
  }

  say(text) {
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
