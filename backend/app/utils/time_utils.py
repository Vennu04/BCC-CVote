from datetime import datetime, timedelta
import pytz

IST = pytz.timezone("Asia/Kolkata")


def now_ist() -> datetime:
    return datetime.now(IST)


def utc_to_ist(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = pytz.utc.localize(dt)
    return dt.astimezone(IST)


def ist_to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = IST.localize(dt)
    return dt.astimezone(pytz.utc)


def format_ist(dt: datetime) -> str:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = pytz.utc.localize(dt)
    return dt.astimezone(IST).strftime("%d %b %Y %I:%M %p IST")


def is_voting_window_open(opens_at: datetime, closes_at: datetime) -> bool:
    now = now_ist()
    if opens_at.tzinfo is None:
        opens_at = pytz.utc.localize(opens_at)
    if closes_at.tzinfo is None:
        closes_at = pytz.utc.localize(closes_at)
    opens_ist = opens_at.astimezone(IST)
    closes_ist = closes_at.astimezone(IST)
    return opens_ist <= now <= closes_ist


def seconds_until_close(closes_at: datetime) -> int:
    now = now_ist()
    if closes_at.tzinfo is None:
        closes_at = pytz.utc.localize(closes_at)
    closes_ist = closes_at.astimezone(IST)
    delta = closes_ist - now
    return max(0, int(delta.total_seconds()))


def get_upcoming_weekend_dates() -> dict:
    """Return next Saturday and Sunday dates from current date."""
    today = now_ist().date()
    # weekday(): Monday=0, Saturday=5, Sunday=6
    days_until_saturday = (5 - today.weekday()) % 7
    if days_until_saturday == 0 and now_ist().hour >= 20:
        days_until_saturday = 7
    saturday = today + timedelta(days=days_until_saturday)
    sunday = saturday + timedelta(days=1)
    return {"saturday": saturday.isoformat(), "sunday": sunday.isoformat()}
