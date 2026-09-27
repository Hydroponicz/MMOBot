// Thin client for Kick's official public API (https://docs.kick.com).
const crypto = require('node:crypto');

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

  broadcaster() {
    const t = this.getToken('broadcaster');
    return t ? { user_id: t.user_id, username: t.username } : null;
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
    const broadcaster = this.broadcaster();
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

  // Subscribe to chat messages for the broadcaster's channel. Kick delivers them to the
  // Webhook URL configured in your Kick developer app settings.
  async subscribeChat(broadcasterToken, broadcasterUserId) {
    return this.request('POST', '/public/v1/events/subscriptions', {
      token: broadcasterToken,
      body: {
        broadcaster_user_id: Number(broadcasterUserId),
        events: [{ name: 'chat.message.sent', version: 1 }],
        method: 'webhook',
      },
    });
  }

  async listSubscriptions(token) {
    return this.request('GET', '/public/v1/events/subscriptions', { token });
  }

  // ---- Webhook verification ---------------------------------------------

  async getPublicKey() {
    if (this.publicKey) return this.publicKey;
    const json = await this.request('GET', '/public/v1/public-key');
    this.publicKey = json?.data?.public_key;
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

module.exports = { KickApi };
