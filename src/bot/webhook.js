// Receives Kick event webhooks (chat.message.sent) at POST /webhooks/kick.
const express = require('express');

function webhookRouter({ bot, kick, repo, config, logger = console }) {
  const router = express.Router();

  router.post('/kick', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
    const rawBody = req.body?.toString('utf8') || '';
    const messageId = req.get('Kick-Event-Message-Id');
    const timestamp = req.get('Kick-Event-Message-Timestamp');
    const signature = req.get('Kick-Event-Signature');
    const type = req.get('Kick-Event-Type');

    if (config.kick.verifyWebhooks) {
      let ok = false;
      try {
        ok = await kick.verifyWebhook({ messageId, timestamp, signature, rawBody });
      } catch (err) {
        logger.error('[webhook] signature check failed:', err.message);
      }
      if (!ok) {
        logger.warn(`[webhook] rejected a request with an invalid signature (type ${type || 'unknown'})`);
        return res.status(401).send('invalid signature');
      }
    }

    // Acknowledge fast; Kick retries on slow/failed deliveries.
    res.status(200).send('ok');

    if (messageId && !repo.markProcessed(messageId)) return; // duplicate delivery
    if (type !== 'chat.message.sent') return;

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return;
    }
    const broadcaster = kick.broadcaster();
    if (broadcaster && String(payload.broadcaster?.user_id) !== String(broadcaster.user_id)) return;
    const sender = payload.sender || {};
    if (!sender.user_id || sender.is_anonymous) return;

    bot.handleMessage({
      kickUserId: String(sender.user_id),
      username: sender.username,
      avatarUrl: sender.profile_picture || null,
      content: payload.content || '',
    });
  });

  return router;
}

module.exports = { webhookRouter };
