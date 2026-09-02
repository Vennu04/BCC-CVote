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
    private_key = current_app.config.get("VAPID_PRIVATE_KEY")
    if not private_key:
        logger.warning("send_push_to_user_ids: VAPID_PRIVATE_KEY not configured, skipping send")
        return {"sent": 0, "failed": 0, "skipped": True}

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
