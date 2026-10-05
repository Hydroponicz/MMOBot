// Thin client for Kick's official public API (https://docs.kick.com).
const crypto = require('node:crypto');

const CHAT_EVENT = 'chat.message.sent';
// Channel events the game reacts to (follows, subs, gifted subs, going live, KICKs). Optional: if Kick
// refuses them, chat still works.
const CHANNEL_EVENTS = ['channel.followed', 'channel.subscription.new', 'channel.subscription.renewal', 'channel.subscription.gifts', 'livestream.status.updated', 'kicks.gifted'];

class KickApi {
  constructor({ config, repo, logger = console }) {
    this.cfg = config.kick;
    this.baseUrl = config.baseUrl;
    this.repo = repo;
    this.log = logger;
    this.publicKey = null;
  }

  get configured() {
    return Boolean(this.cfg.clientId && this.cfg.clientSecret);
  }

  // ---- OAuth (PKCE) ------------------------------------------------------

  static pkce() {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  authorizeUrl({ redirectPath, scopes, state, challenge }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg.clientId,
      redirect_uri: this.baseUrl + redirectPath,
      scope: scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    return `${this.cfg.oauthBase}/oauth/authorize?${params}`;
  }

  async exchangeCode({ code, verifier, redirectPath }) {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: this.baseUrl + redirectPath,
    });
  }

  async tokenRequest(params) {
    const res = await fetch(`${this.cfg.oauthBase}/oauth/token`, {
      signal: AbortSignal.timeout(this.timeoutMs ?? 15_000),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, ...params }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Kick token request failed (${res.status}): ${JSON.stringify(body)}`);
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      scope: body.scope,
      expires_at: Date.now() + (body.expires_in || 3600) * 1000,
    };
  }

  // ---- REST --------------------------------------------------------------

  async request(method, path, { token, body } = {}) {
    // Never wait forever on Kick: a request that hangs would stall everything queued behind it
    // (the chat reply queue sends one message at a time).
    const res = await fetch(`${this.cfg.apiBase}${path}`, {
      signal: AbortSignal.timeout(this.timeoutMs ?? 15_000),
      method,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(`Kick API ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async currentUser(token) {
    const json = await this.request('GET', '/public/v1/users', { token });
    const u = json?.data?.[0];
    if (!u) throw new Error('Kick did not return a user');
    return { userId: String(u.user_id), username: u.name, avatarUrl: u.profile_picture || null };
  }

  // ---- Stored tokens -----------------------------------------------------
  // "broadcaster": the streamer's account, connected once from the admin page.
  // "bot":         a separate Kick account (e.g. "mmobot") that posts the replies.

  getToken(kind) {
    return this.repo.getSetting(`token:${kind}`);
  }

  saveToken(kind, token) {
    this.repo.setSetting(`token:${kind}`, token);
  }

  removeToken(kind) {
    this.repo.deleteSetting(`token:${kind}`);
  }

  // The channel the game runs in: from the connected broadcaster account, or looked up by KICK_CHANNEL.
  broadcaster() {
    const t = this.getToken('broadcaster');
    if (t) return { user_id: String(t.user_id), username: t.username };
    const c = this.repo.getSetting('channel');
    return c && c.slug === this.cfg.channel ? { user_id: String(c.user_id), username: c.slug } : null;
  }

  // The connected bot account, if it's really a separate account. A token for the channel's own
  // account saved as "bot" (easy to do by accident: Kick's login page uses whoever is logged into
  // kick.com in that browser) is ignored, since replies would come from the streamer.
  botAccount() {
    const t = this.getToken('bot');
    if (!t) return null;
    const b = this.broadcaster();
    const isChannel =
      (b && String(t.user_id) === String(b.user_id)) || String(t.username).toLowerCase() === this.cfg.channel;
    return isChannel ? null : t;
  }

  // Who replies appear from, for the admin page.
  replySender() {
    const bot = this.botAccount();
    if (bot) return { mode: 'bot_account', username: bot.username };
    if (this.getToken('broadcaster')) return { mode: 'app_bot', username: null };
    return { mode: 'none', username: null };
  }

  async accessToken(kind) {
    const tok = this.getToken(kind);
    if (!tok) return null;
    if (tok.expires_at - Date.now() > 60_000) return tok.access_token;
    this._refreshing ??= {};
    if (!this._refreshing[kind]) {
      this._refreshing[kind] = this.tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token })
        .then((fresh) => {
          const merged = { ...tok, ...fresh, refresh_token: fresh.refresh_token || tok.refresh_token };
          this.saveToken(kind, merged);
          return merged.access_token;
        })
        .catch((err) => {
          this.log.error(`[kick] ${kind} token refresh failed — reconnect it from the admin page.`, err.message);
          return null;
        })
        .finally(() => {
          this._refreshing[kind] = null;
        });
    }
    return this._refreshing[kind];
  }

  // Replies go out through POST /public/v1/chat:
  //  - With a separate bot account connected: type "user" with that account's token, into the
  //    broadcaster's channel. Messages show up from the bot account (e.g. "mmobot").
  //  - Otherwise: type "bot" with the broadcaster's token. Kick posts as the bot account linked to the
  //    Kick app, in the token owner's channel.
  async sendChat(content) {
    const text = content.slice(0, 500);
    const bot = this.botAccount();
    // What Kick said about the last message (shown in the logs and on the admin page).
    const noted = (json, as) => {
      const d = json?.data || {};
      this.lastSend = { at: Date.now(), as, sent: d.is_sent ?? null, messageId: d.message_id ?? null };
      if (d.is_sent === false) this.log.warn(`[kick] Kick accepted the chat message but did not post it (is_sent=false, as ${as}).`);
      return d.is_sent !== false;
    };
    if (bot) {
      const broadcaster = this.broadcaster() || (await this.resolveChannel().catch(() => null));
      if (!broadcaster) {
        this.log.warn('[kick] reply not sent: the channel (KICK_CHANNEL) could not be looked up.');
        return false;
      }
      const token = await this.accessToken('bot');
      if (!token) {
        this.log.warn(`[kick] reply not sent: the bot account (${bot.username}) has no valid login. Reconnect it on the Admin page.`);
        return false;
      }
      const json = await this.request('POST', '/public/v1/chat', {
        token,
        body: { type: 'user', broadcaster_user_id: Number(broadcaster.user_id), content: text },
      });
      return noted(json, `@${bot.username}`);
    }

    const token = await this.accessToken('broadcaster');
    if (!token) {
      this.log.warn('[kick] reply not sent: no streamer login. Log in as the streamer on the Admin page (or connect a bot account).');
      return false;
    }
    try {
      return noted(await this.request('POST', '/public/v1/chat', { token, body: { type: 'bot', content: text } }), "the Kick app's bot");
    } catch (err) {
      if (err.status === 404) {
        err.message =
          "Kick couldn't post as your app's bot (404). Connect your bot account (e.g. mmobot) on the Admin page. " +
          err.message;
      }
      throw err;
    }
  }

  // ---- App access token (client credentials) -----------------------------
  // Server-to-server token; per Kick's docs it can subscribe to events for any channel by user ID.

  async appAccessToken() {
    if (this._app && this._app.expires_at - Date.now() > 60_000) return this._app.access_token;
    this._app = await this.tokenRequest({ grant_type: 'client_credentials' });
    return this._app.access_token;
  }

  // Look up KICK_CHANNEL's broadcaster user ID (cached in the database).
  async resolveChannel() {
    const known = this.broadcaster();
    if (known) return known;
    if (!this.cfg.channel) return null;
    const token = await this.appAccessToken();
    const json = await this.request('GET', `/public/v1/channels?slug=${encodeURIComponent(this.cfg.channel)}`, { token });
    const ch = json?.data?.[0];
    if (!ch?.broadcaster_user_id) throw new Error(`Kick channel "${this.cfg.channel}" not found`);
    this.repo.setSetting('channel', { user_id: String(ch.broadcaster_user_id), slug: this.cfg.channel });
    return this.broadcaster();
  }

  // ---- Chat event subscription ----------------------------------------------
  // Kick POSTs chat messages to the Webhook URL set in your Kick app settings.

  async listSubscriptions() {
    const token = await this.appAccessToken();
    return (await this.request('GET', '/public/v1/events/subscriptions', { token }))?.data || [];
  }

  async subscribeChat(broadcasterUserId, events = [CHAT_EVENT]) {
    const token = await this.appAccessToken();
    return this.request('POST', '/public/v1/events/subscriptions', {
      token,
      body: {
        broadcaster_user_id: Number(broadcasterUserId),
        events: events.map((name) => ({ name, version: 1 })),
        method: 'webhook',
      },
    });
  }

  // Makes sure we're subscribed to the channel's chat. Safe to call repeatedly: Kick drops
  // subscriptions whose webhook keeps failing for a day, so the server re-checks periodically.
  async ensureChatSubscription() {
    if (!this.configured) return { ok: false, reason: 'KICK_CLIENT_ID / KICK_CLIENT_SECRET not set' };
    const channel = await this.resolveChannel();
    if (!channel) return { ok: false, reason: 'KICK_CHANNEL not set' };
    const subs = await this.listSubscriptions();
    const mine = subs.filter((x) => String(x.broadcaster_user_id) === String(channel.user_id));
    // Follows, subs and live status: subscribe to any that are missing. A failure here never
    // stops chat from working.
    const missing = CHANNEL_EVENTS.filter((e) => !mine.some((x) => x.event === e));
    if (missing.length) {
      try {
        await this.subscribeChat(channel.user_id, missing);
        this.log.log(`[kick] subscribed to ${missing.join(', ')} for ${channel.username}`);
      } catch (err) {
        this.log.warn(`[kick] couldn't subscribe to channel events (${missing.join(', ')}): ${err.message}`);
      }
    }
    const existing = mine.find((x) => x.event === CHAT_EVENT);
    if (existing) return { ok: true, created: false, subscription: existing };
    const created = await this.subscribeChat(channel.user_id);
    this.log.log(`[kick] subscribed to chat for ${channel.username}`);
    return { ok: true, created: true, subscription: created?.data?.[0] || null };
  }

  // ---- Webhook verification ---------------------------------------------

  // Kick's public key for webhook signatures, always fetched from Kick (never a stored copy, as
  // Kick asks: they can rotate it). Kept for an hour; refetched sooner if a signature stops matching.
  async getPublicKey({ refresh = false } = {}) {
    const fresh = this.publicKey && (this.publicKeyAt === undefined || Date.now() - this.publicKeyAt < 60 * 60_000);
    if (fresh && !refresh) return this.publicKey;
    this._keyFetch ??= this.request('GET', '/public/v1/public-key')
      .then((json) => {
        const key = json?.data?.public_key;
        if (!key) throw new Error('no public_key in the response');
        if (this.publicKey && key !== this.publicKey) this.log.log('[kick] Kick\'s webhook signing key changed; using the new one.');
        this.publicKey = key;
        this.publicKeyAt = Date.now();
        return key;
      })
      .catch((err) => {
        // Keep the last key we had (if any) and try again on the next webhook.
        this.log.warn('[kick] could not fetch Kick\'s public key:', err.message);
        return this.publicKey;
      })
      .finally(() => {
        this._keyFetch = null;
      });
    return this._keyFetch;
  }

  async verifyWebhook({ messageId, timestamp, signature, rawBody }) {
    if (!messageId || !timestamp || !signature) return false;
    const check = (key) => {
      if (!key) return false;
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${messageId}.${timestamp}.${rawBody}`);
      verifier.end();
      try {
        return verifier.verify(key, signature, 'base64');
      } catch {
        return false;
      }
    };
    if (check(await this.getPublicKey())) return true;
    // Maybe Kick rotated its key: fetch it again (at most once a minute) and retry.
    // (A key set by hand, as in tests, has no fetch time and is never refetched.)
    if (this.publicKeyAt === undefined || Date.now() - this.publicKeyAt < 60_000) return false;
    return check(await this.getPublicKey({ refresh: true }));
  }
}

module.exports = { KickApi };
