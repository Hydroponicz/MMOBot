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
    } else if (/^\s*!|\[emote:/.test(msg.content || '')) {
      // Looked like a command (or an emote shortcut) but got no reply: log it, so "the bot isn't
      // answering" can be told apart from "the bot never saw it".
      this.stats.silent = (this.stats.silent || 0) + 1;
      (this.log.info || this.log.log || (() => {})).call(this.log, `[chat] ${msg.username}: ${msg.content.trim().slice(0, 120)} → (no reply)`);
    }
    return reply;
  }

  // Kick channel events (follow, sub, gifts, live): the engine rewards players and says thanks.
  handleChannelEvent(type, payload) {
    try {
      const text = this.engine.channelEvent(type, payload);
      this.log.info(`[event] ${type}${text ? ` → ${text}` : ''}`);
      if (text && this.engine.cfg.replyInChat) this.say(text);
      return text;
    } catch (err) {
      this.log.error(`[bot] error handling ${type}`, err);
      return null;
    }
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
        // In a busy chat, replies that are waiting go out together ("@A ... | @B ...") instead of
        // one every 1.2s, so nobody's reply arrives minutes late.
        const parts = [this.queue.shift()];
        while (this.queue.length && `${parts.join(' | ')} | ${this.queue[0]}`.length <= 500) parts.push(this.queue.shift());
        const text = parts.join(' | ');
        if (parts.length > 1) this.recentReplies.set(text.trim(), Date.now());
        try {
          const sent = await this.kick.sendChat(text);
          if (sent) {
            this.stats.sent++;
            const ls = this.kick.lastSend;
            (this.log.info || this.log.log || (() => {})).call(this.log, `[kick] posted reply as ${ls?.as || 'bot'}${ls?.messageId ? ` (message ${ls.messageId})` : ''}`);
          }
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
