import os
from datetime import datetime, timedelta

import pytz
import requests

from .. import mongo
from ..utils.time_utils import match_datetime_for_slot

# Fixed match venue for every slot (https://maps.app.goo.gl/8DBCyjCNtk5zQkDKA
# resolves to Narregudem Grounds) -- same location on every forecast call,
# overridable via env only if the ground ever changes.
VENUE_NAME = os.environ.get("VENUE_NAME", "Narregudem Grounds")
VENUE_LAT = float(os.environ.get("VENUE_LAT", "17.537681"))
VENUE_LON = float(os.environ.get("VENUE_LON", "78.305236"))

OPENWEATHER_API_KEY = os.environ.get("OPENWEATHER_API_KEY", "")
OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/forecast"

# The free OpenWeatherMap "5 day / 3 hour" forecast endpoint only ever
# returns ~5 days of data (40 x 3h steps) -- capped here to match what the
# API actually delivers rather than the "7-10 days" ballpark quoted for
# weather APIs in general, so a slot never falls back to stale/invented data.
FORECAST_HORIZON_DAYS = 5

CACHE_TTL = timedelta(hours=2)
FAILURE_CACHE_TTL = timedelta(minutes=10)  # shorter, so a transient outage clears itself quickly


def _cache_get(slot_id, target_date):
    doc = mongo.db.weather_cache.find_one({"slot_id": slot_id, "target_date": target_date})
    if not doc:
        return None
    ttl = CACHE_TTL if doc["status"] == "ok" else FAILURE_CACHE_TTL
    if datetime.utcnow() - doc["fetched_at"] > ttl:
        return None
    return doc


def _cache_put(slot_id, target_date, status, forecast):
    mongo.db.weather_cache.update_one(
        {"slot_id": slot_id, "target_date": target_date},
        {"$set": {"status": status, "forecast": forecast, "fetched_at": datetime.utcnow()}},
        upsert=True,
    )


def _fetch_forecast(target_dt_utc):
    """Calls OpenWeatherMap, returns the single 3-hour bucket closest to
    target_dt_utc, or None on any failure (missing key, network error, bad
    response) -- callers treat None as "unavailable", this never raises."""
    if not OPENWEATHER_API_KEY:
        return None
    try:
        resp = requests.get(OPENWEATHER_URL, params={
            "lat": VENUE_LAT, "lon": VENUE_LON, "appid": OPENWEATHER_API_KEY, "units": "metric",
        }, timeout=5)
        resp.raise_for_status()
        entries = resp.json().get("list") or []
    except (requests.RequestException, ValueError):
        return None
    if not entries:
        return None

    target_ts = target_dt_utc.replace(tzinfo=pytz.utc).timestamp()
    closest = min(entries, key=lambda e: abs(e["dt"] - target_ts))
    main = closest.get("main", {})
    return {
        "temp_c": main.get("temp"),
        "feels_like_c": main.get("feels_like"),
        "humidity_pct": main.get("humidity"),
        "rain_chance_pct": round((closest.get("pop") or 0) * 100),
        "wind_kph": round(closest.get("wind", {}).get("speed", 0) * 3.6, 1),
        "forecast_for": closest.get("dt_txt"),
    }


def get_forecast_for_slot(slot: dict) -> dict:
    """
    Always returns a dict with at least {"status": ..., "venue": ...} --
    callers/frontend only read the numeric fields when status == "ok". A
    weather lookup failure must never break the slot's own display.

    status is one of:
      "ok"          - forecast fields are populated
      "too_far"     - slot's date is beyond what a 5-day forecast can cover
      "unavailable" - API key missing, call failed, or slot has no resolvable date
    """
    slot_id = str(slot.get("_id") or slot.get("id"))
    match_dt_utc = match_datetime_for_slot(slot)
    if match_dt_utc is None:
        return {"status": "unavailable", "venue": VENUE_NAME}

    if match_dt_utc - datetime.utcnow() > timedelta(days=FORECAST_HORIZON_DAYS):
        return {"status": "too_far", "venue": VENUE_NAME}

    target_date = match_dt_utc.date().isoformat()
    cached = _cache_get(slot_id, target_date)
    if cached:
        return {"status": cached["status"], "venue": VENUE_NAME, **(cached.get("forecast") or {})}

    forecast = _fetch_forecast(match_dt_utc)
    status = "ok" if forecast else "unavailable"
    _cache_put(slot_id, target_date, status, forecast)
    return {"status": status, "venue": VENUE_NAME, **(forecast or {})}
