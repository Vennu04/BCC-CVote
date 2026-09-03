"""
Email / SMS / WhatsApp, alongside the existing Web Push (services/push.py).
Same "missing config = safe no-op per channel, never a startup failure or a
500" convention VAPID_PRIVATE_KEY already established — every function here
degrades to {"skipped": True} rather than raising when its own env vars
aren't set, so this is safe to call unconditionally from every trigger site
regardless of which (if any) channels an environment has configured.

No new dependency: SMTP uses stdlib smtplib, and Twilio is called as a plain
REST POST via `requests` (already in requirements.txt) rather than pulling
in the `twilio` SDK package for something this small.
"""
import logging
import os
import smtplib
from email.mime.text import MIMEText

import requests

from .. import mongo
from .push import send_push_to_user_ids

logger = logging.getLogger(__name__)

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT") or 587)
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "") or SMTP_USER

TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_SMS_FROM = os.environ.get("TWILIO_SMS_FROM", "")
TWILIO_WHATSAPP_FROM = os.environ.get("TWILIO_WHATSAPP_FROM", "")


def send_email(to_addrs, subject, body):
    if not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD and to_addrs):
        return {"sent": 0, "skipped": True}
    sent, failed = 0, 0
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            for addr in to_addrs:
                try:
                    msg = MIMEText(body)
                    msg["Subject"] = subject
                    msg["From"] = SMTP_FROM
                    msg["To"] = addr
                    server.sendmail(SMTP_FROM, [addr], msg.as_string())
                    sent += 1
                except Exception:
                    failed += 1
                    logger.warning("send_email: failed for %s", addr, exc_info=True)
    except Exception:
        logger.exception("send_email: SMTP connection/login failed")
        return {"sent": sent, "failed": failed, "skipped": False, "error": True}
    return {"sent": sent, "failed": failed, "skipped": False}


def _twilio_send(to_numbers, body, from_number):
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and from_number and to_numbers):
        return {"sent": 0, "skipped": True}
    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    sent, failed = 0, 0
    for number in to_numbers:
        try:
            resp = requests.post(
                url,
                data={"To": number, "From": from_number, "Body": body},
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                timeout=10,
            )
            if resp.status_code < 300:
                sent += 1
            else:
                failed += 1
                logger.warning("twilio send failed for %s: %s %s", number, resp.status_code, resp.text)
        except Exception:
            failed += 1
            logger.exception("twilio send raised for %s", number)
    return {"sent": sent, "failed": failed, "skipped": False}


def send_sms(to_numbers, body):
    return _twilio_send(to_numbers, body, TWILIO_SMS_FROM)


def send_whatsapp(to_numbers, body):
    formatted = [n if n.startswith("whatsapp:") else f"whatsapp:{n}" for n in to_numbers]
    from_number = TWILIO_WHATSAPP_FROM
    if from_number and not from_number.startswith("whatsapp:"):
        from_number = f"whatsapp:{from_number}"
    return _twilio_send(formatted, body, from_number)


# One (title, body) builder per event this app fires notifications for.
# Adding a new triggered event later is a one-line addition here, not a new
# function — see notify_event's callers in notification_scheduler.py and
# routes/auction.py for the context dict each event expects.
EVENT_MESSAGES = {
    "voting_window_open": lambda ctx: (
        "🏏 Voting is open!", f"Cast your availability for {ctx.get('label', 'the match')} now."
    ),
    "auction_started": lambda ctx: (
        "🏏 Auction started!", f"The live auction for {ctx.get('label', 'the match')} has begun — join now."
    ),
    "player_sold": lambda ctx: (
        "🏏 Player sold!",
        f"{ctx.get('player_name', 'A player')} was sold to {ctx.get('team_name', 'a team')}"
        + (f" for {ctx['price']}" if ctx.get("price") is not None else "") + ".",
    ),
}


def notify_event(event, user_ids, context=None, url="/"):
    """Fans one event out to every configured channel. Web Push always runs
    (reuses send_push_to_user_ids as-is, unchanged). Email/SMS/WhatsApp only
    run for recipients who have an `email`/`phone` field on their user doc —
    both are optional, admin-settable fields (see admin.py's update_player/
    update_captain), not backfilled for existing accounts.
    """
    context = context or {}
    builder = EVENT_MESSAGES.get(event)
    if not builder:
        logger.warning("notify_event: unknown event %r", event)
        return {}
    title, body = builder(context)

    results = {"push": send_push_to_user_ids(user_ids, {"title": title, "body": body, "url": url})}

    if user_ids:
        recipients = list(mongo.db.users.find({"_id": {"$in": user_ids}}, {"email": 1, "phone": 1}))
        emails = [r["email"] for r in recipients if r.get("email")]
        phones = [r["phone"] for r in recipients if r.get("phone")]
        if emails:
            results["email"] = send_email(emails, title, body)
        if phones:
            results["whatsapp"] = send_whatsapp(phones, body)
            results["sms"] = send_sms(phones, body)

    return results
