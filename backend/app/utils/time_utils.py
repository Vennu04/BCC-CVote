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


def to_iso_utc(dt: datetime):
    """Timezone-aware ISO 8601 string, safe for JS `new Date()` to parse
    correctly -- unlike format_ist()'s human-readable IST string ("11 Jul
    2026 11:47 PM IST"), which Date() silently mis-parses into NaN. Naive
    datetimes are assumed UTC, matching how they're stored everywhere in
    this codebase."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = pytz.utc.localize(dt)
    return dt.isoformat()


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


def get_match_weekend_dates():
    """Return next Friday/Saturday/Sunday as date objects."""
    today = now_ist().date()
    # weekday(): Monday=0, Saturday=5, Sunday=6
    days_until_saturday = (5 - today.weekday()) % 7
    if days_until_saturday == 0 and now_ist().hour >= 20:
        days_until_saturday = 7
    saturday = today + timedelta(days=days_until_saturday)
    friday = saturday - timedelta(days=1)
    sunday = saturday + timedelta(days=1)
    return {"friday": friday, "saturday": saturday, "sunday": sunday}


def get_upcoming_weekend_dates() -> dict:
    """Return next Saturday and Sunday dates from current date."""
    dates = get_match_weekend_dates()
    return {"saturday": dates["saturday"].isoformat(), "sunday": dates["sunday"].isoformat()}


# Fallback kickoff hour (IST) when a slot's match_time isn't a parseable clock
# time -- true for every ad-hoc slot, whose match_time is admin's free-text
# description (see admin.py's create_slot), not an actual time.
_TIME_OF_DAY_DEFAULT_HOUR = {"Morning": 7, "Evening": 15}


def effective_match_date_str(slot: dict):
    """
    The calendar date (YYYY-MM-DD string) this slot's match actually falls
    on this week, or None if it can't be determined.

    Ad-hoc slots always carry an explicit match_date. Recurring slots carry
    no persisted date by default -- it's whichever upcoming Sat/Sun the
    slot's `day` names -- but admin can set a one-off `date_override` for
    the current week via POST /admin/slots/<id>/date. The override carries
    a `week_of` snapshot of the natural date at the time it was set, so it
    self-expires the moment the natural weekend rolls over to the next one,
    with no cleanup job needed.
    """
    if slot.get("is_adhoc"):
        return slot.get("match_date")

    dates = get_match_weekend_dates()
    natural = dates.get(slot.get("day", "").lower())
    natural_str = natural.isoformat() if natural else None

    override = slot.get("date_override")
    if override and natural_str and override.get("week_of") == natural_str:
        return override.get("date")
    return natural_str


def match_datetime_for_slot(slot: dict):
    """
    Best-effort calendar date + kickoff time for a slot, as a naive UTC
    datetime -- used to key weather forecasts to the right day/time. Returns
    None if no date can be determined at all.

    Recurring Saturday/Sunday slots carry no explicit match_date (they're a
    standing weekly label, not tied to one calendar date) -- their date is
    whichever upcoming Sat/Sun the slot's `day` names, via
    get_match_weekend_dates(), or an admin's date_override for this week.
    Ad-hoc slots always carry an explicit match_date instead.
    """
    date_str = effective_match_date_str(slot)
    if date_str:
        try:
            match_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return None
    else:
        return None

    hour, minute = _TIME_OF_DAY_DEFAULT_HOUR.get(slot.get("time_of_day"), 9), 0
    raw_time = slot.get("match_time")
    if raw_time:
        for fmt in ("%I:%M %p", "%H:%M"):
            try:
                parsed = datetime.strptime(raw_time.strip(), fmt)
                hour, minute = parsed.hour, parsed.minute
                break
            except (ValueError, AttributeError):
                continue

    naive_ist = datetime.combine(match_date, datetime.min.time()).replace(hour=hour, minute=minute)
    return IST.localize(naive_ist).astimezone(pytz.utc).replace(tzinfo=None)


def get_next_match_slot(slots: list):
    """
    (slot_dict, match_datetime_utc) for whichever active slot is soonest to
    occur, by match_datetime_for_slot() -- or (None, None) if none of the
    given slots have a determinable date. Slots whose computed date+time has
    already passed are used only as a last resort (still preferring the
    earliest of them) so something is always returned as long as at least one
    slot has a date, even in the narrow window right after a match's
    calendar date rolls over before get_match_weekend_dates() itself advances.
    """
    dated = [(s, match_datetime_for_slot(s)) for s in slots]
    dated = [(s, dt) for s, dt in dated if dt is not None]
    if not dated:
        return None, None
    now = datetime.utcnow()
    upcoming = [(s, dt) for s, dt in dated if dt >= now]
    pool = upcoming or dated
    return min(pool, key=lambda pair: pair[1])


# (day, time_of_day) -> which weekend date the window falls on, and the IST open/close time
_WINDOW_RULES = {
    ("Saturday", "Morning"): {"date_key": "friday",   "open": (6, 0),  "close": (18, 30)},
    ("Saturday", "Evening"): {"date_key": "saturday",  "open": (10, 0), "close": (12, 30)},
    ("Sunday",   "Morning"): {"date_key": "saturday",  "open": (12, 30), "close": (18, 30)},
    ("Sunday",   "Evening"): {"date_key": "sunday",    "open": (10, 0), "close": (12, 30)},
}


def suggested_window_for_slot(slot: dict) -> dict:
    """
    Compute the rule-based default voting window for a match slot, based on
    its day/time_of_day. Returns opens_at/closes_at as naive UTC datetimes
    (ready to store), plus IST-formatted strings for display.
    """
    rule = _WINDOW_RULES.get((slot["day"], slot["time_of_day"]))
    if not rule:
        return None

    dates = get_match_weekend_dates()
    window_date = dates[rule["date_key"]]

    open_h, open_m = rule["open"]
    close_h, close_m = rule["close"]

    opens_naive = datetime.combine(window_date, datetime.min.time()).replace(hour=open_h, minute=open_m)
    closes_naive = datetime.combine(window_date, datetime.min.time()).replace(hour=close_h, minute=close_m)

    opens_at = IST.localize(opens_naive).astimezone(pytz.utc).replace(tzinfo=None)
    closes_at = IST.localize(closes_naive).astimezone(pytz.utc).replace(tzinfo=None)

    return {
        "opens_at": opens_at,
        "closes_at": closes_at,
        "opens_at_ist_iso": opens_naive.isoformat(timespec="minutes"),
        "closes_at_ist_iso": closes_naive.isoformat(timespec="minutes"),
        "opens_at_display": format_ist(opens_at),
        "closes_at_display": format_ist(closes_at),
    }


# Emergency revoke: a player who already voted may still withdraw ("remove their
# name") after the normal window closes, up to this IST clock time on the same
# calendar date the window closes — morning matches get an overnight grace
# period, evening matches need lead time before the same-day match.
_REVOKE_DEADLINE_TIME = {
    "Morning": (19, 30),
    "Evening": (12, 10),
}


def revoke_deadline_for_window(window: dict, slot: dict):
    """Naive UTC datetime after which a vote can no longer be revoked, or None."""
    if not window:
        return None
    deadline_time = _REVOKE_DEADLINE_TIME.get(slot["time_of_day"])
    if not deadline_time:
        return None
    closes_ist = utc_to_ist(window["closes_at"])
    hour, minute = deadline_time
    deadline_ist = closes_ist.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return deadline_ist.astimezone(pytz.utc).replace(tzinfo=None)


def can_revoke_vote(window: dict, slot: dict) -> bool:
    deadline = revoke_deadline_for_window(window, slot)
    if not deadline:
        return False
    return now_ist() <= pytz.utc.localize(deadline).astimezone(IST)
