import base64
import json
import logging

from flask import current_app
from pywebpush import webpush, WebPushException

from .. import mongo

logger = logging.getLogger(__name__)


def send_push_to_user_ids(user_ids, payload: dict) -> dict:
    """Sends `payload` as a Web Push notification to every subscription
    belonging to any of `user_ids`. A subscriber's stale/expired
    subscription (404/410 from the push service — e.g. they uninstalled the
    PWA or cleared site data) is dropped silently rather than failing the
    whole batch; one dead subscription shouldn't block everyone else's
    notification.
    """
    raw_private_key = current_app.config.get("VAPID_PRIVATE_KEY")
    if not raw_private_key:
        logger.warning("send_push_to_user_ids: VAPID_PRIVATE_KEY not configured, skipping send")
        return {"sent": 0, "failed": 0, "skipped": True}

    # deploy.sh base64's the PEM into a single line to survive docker
    # compose's --env-file format (one KEY=value per line, no embedded
    # newlines) — decode it back here. Checked explicitly rather than
    # try/except-ing the decode: base64.b64decode silently ignores
    # non-alphabet characters unless validate=True, so a raw PEM pasted
    # directly (e.g. local dev) could "succeed" at decoding into garbage
    # instead of raising.
    if raw_private_key.strip().startswith("-----BEGIN"):
        private_key = raw_private_key
    else:
        private_key = base64.b64decode(raw_private_key).decode()

    claim_email = current_app.config.get("VAPID_CLAIM_EMAIL")
    subs = list(mongo.db.push_subscriptions.find({"user_id": {"$in": user_ids}}))
    sent, failed = 0, 0
    body = json.dumps(payload)

    for sub in subs:
        try:
            webpush(
                subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
                data=body,
                vapid_private_key=private_key,
                vapid_claims={"sub": claim_email},
            )
            sent += 1
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            if status in (404, 410):
                mongo.db.push_subscriptions.delete_one({"_id": sub["_id"]})
            else:
                logger.warning("push send failed for subscription %s: %s", sub["_id"], e)
            failed += 1

    return {"sent": sent, "failed": failed, "skipped": False}
