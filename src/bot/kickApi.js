// Thin client for Kick's official public API (https://docs.kick.com).
const crypto = require('node:crypto');

// Kick's webhook signing key, as published at https://docs.kick.com/events/webhook-security.
// Used if https://api.kick.com/public/v1/public-key can't be reached.
const KICK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

const CHAT_EVENT = 'chat.message.sent';

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
    const res = await fetch(`${this.cfg.apiBase}${path}`, {
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
  // "broadcaster": the streamer's account, connected once from the admin page. Used to subscribe to chat
  //                events and (by default) to post the bot's replies.
  // "bot":         optional separate Kick account the replies are posted from.

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

  // The token replies are posted with: the bot account if connected, otherwise the broadcaster.
  getBotToken() {
    return this.getToken('bot') || this.getToken('broadcaster');
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

  async sendChat(content) {
    const broadcaster = this.broadcaster() || (await this.resolveChannel().catch(() => null));
    if (!broadcaster) return false;
    const kind = this.getToken('bot') ? 'bot' : 'broadcaster';
    const token = await this.accessToken(kind);
    if (!token) return false;
    // With the broadcaster's own token, "bot" posts as the app's bot identity in that channel;
    // a separate bot account posts as itself into the broadcaster's chat.
    await this.request('POST', '/public/v1/chat', {
      token,
      body: {
        type: kind === 'bot' ? 'user' : 'bot',
        broadcaster_user_id: Number(broadcaster.user_id),
        content: content.slice(0, 500),
      },
    });
    return true;
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

  async subscribeChat(broadcasterUserId) {
    const token = await this.appAccessToken();
    return this.request('POST', '/public/v1/events/subscriptions', {
      token,
      body: {
        broadcaster_user_id: Number(broadcasterUserId),
        events: [{ name: CHAT_EVENT, version: 1 }],
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
    const existing = subs.find(
      (x) => x.event === CHAT_EVENT && String(x.broadcaster_user_id) === String(channel.user_id)
    );
    if (existing) return { ok: true, created: false, subscription: existing };
    const created = await this.subscribeChat(channel.user_id);
    this.log.log(`[kick] subscribed to chat for ${channel.username}`);
    return { ok: true, created: true, subscription: created?.data?.[0] || null };
  }

  // ---- Webhook verification ---------------------------------------------

  async getPublicKey() {
    if (this.publicKey) return this.publicKey;
    try {
      const json = await this.request('GET', '/public/v1/public-key');
      this.publicKey = json?.data?.public_key || KICK_PUBLIC_KEY;
    } catch (err) {
      this.log.warn('[kick] could not fetch public key, using the published one:', err.message);
      this.publicKey = KICK_PUBLIC_KEY;
    }
    return this.publicKey;
  }

  async verifyWebhook({ messageId, timestamp, signature, rawBody }) {
    if (!messageId || !timestamp || !signature) return false;
    const key = await this.getPublicKey();
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${messageId}.${timestamp}.${rawBody}`);
    verifier.end();
    try {
      return verifier.verify(key, signature, 'base64');
    } catch {
      return false;
    }
  }
}

module.exports = { KickApi, KICK_PUBLIC_KEY };
