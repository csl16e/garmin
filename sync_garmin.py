#!/usr/bin/env python3
"""
Garmin Connect data sync script.
Built on python-garminconnect by cyberjunky.
https://github.com/cyberjunky/python-garminconnect
"""

import argparse
import base64
import json
import os
import pickle
import sys
from datetime import date, timedelta
from pathlib import Path

try:
    import garminconnect
except ImportError:
    sys.exit("Run: pip install -r requirements.txt")


TOKEN_FILE = Path.home() / ".garmin_tokens"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def _client_from_token():
    if not TOKEN_FILE.exists():
        return None
    data = TOKEN_FILE.read_bytes()
    client = garminconnect.Garmin()
    client.garth.loads(data.decode())
    return client


def _client_from_env():
    email = os.environ.get("GARMIN_EMAIL", "").strip()
    password = os.environ.get("GARMIN_PASSWORD", "").strip()
    if not email or not password:
        sys.exit(
            "Set GARMIN_EMAIL and GARMIN_PASSWORD environment variables, then run --login."
        )
    return email, password


def do_login():
    email, password = _client_from_env()
    client = garminconnect.Garmin(email=email, password=password)
    client.login()
    token_bytes = client.garth.dumps().encode()
    TOKEN_FILE.write_bytes(token_bytes)
    b64 = base64.b64encode(token_bytes).decode()
    print("Login successful. Token saved to", TOKEN_FILE)
    print("\n--- GARMIN_TOKEN_B64 (copy this for GitHub Actions) ---")
    print(b64)
    print("--- end ---\n")
    return client


def get_client():
    # Try base64 env var (GitHub Actions path)
    b64 = os.environ.get("GARMIN_TOKEN_B64", "").strip()
    if b64:
        token_bytes = base64.b64decode(b64)
        token_str = token_bytes.decode()
        # Newer garminconnect uses garth
        try:
            client = garminconnect.Garmin()
            client.garth.loads(token_str)
            return client
        except AttributeError:
            pass
        # Older garminconnect: decode the inner base64 and unpickle session
        try:
            inner = base64.b64decode(token_str)
            session = pickle.loads(inner)
            email = session.get("username", "")
            client = garminconnect.Garmin(email=email, password="")
            client.session_data = session
            client.login(session)
            return client
        except Exception:
            pass
        # Last resort: re-login with email/password from env
        return _login_with_env()

    # Try token file
    if TOKEN_FILE.exists():
        token_str = TOKEN_FILE.read_bytes().decode()
        try:
            client = garminconnect.Garmin()
            client.garth.loads(token_str)
            return client
        except AttributeError:
            pass

    sys.exit("No saved token found. Run: python sync_garmin.py --login")


def _login_with_env():
    email, password = _client_from_env()
    client = garminconnect.Garmin(email=email, password=password)
    client.login()
    return client


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def fetch_wellness(client, day: date) -> dict:
    d = day.isoformat()
    out = {"date": d}

    try:
        stats = client.get_stats_and_body(d)
        out["resting_hr"] = stats.get("restingHeartRate")
        out["steps"] = stats.get("totalSteps")
        out["stress_avg"] = stats.get("averageStressLevel")
        charged = stats.get("bodyBatteryChargedValue")
        drained = stats.get("bodyBatteryDrainedValue")
        out["body_battery_high"] = charged
        out["body_battery_low"] = drained
        out["active_calories"] = stats.get("activeKilocalories")
        out["moderate_intensity_minutes"] = stats.get("moderateIntensityMinutes")
        out["vigorous_intensity_minutes"] = stats.get("vigorousIntensityMinutes")
        out["floors_ascended"] = stats.get("floorsAscended")
        out["distance_meters"] = stats.get("totalDistanceMeters")
    except Exception:
        try:
            stats = client.get_stats(d)
            out["resting_hr"] = stats.get("restingHeartRate")
            out["steps"] = stats.get("totalSteps")
            out["stress_avg"] = stats.get("averageStressLevel")
            charged = stats.get("bodyBatteryChargedValue")
            drained = stats.get("bodyBatteryDrainedValue")
            out["body_battery_high"] = charged
            out["body_battery_low"] = drained
        except Exception as e:
            out["stats_error"] = str(e)

    try:
        sleep = client.get_sleep_data(d)
        sd = sleep.get("dailySleepDTO", {})
        out["sleep_seconds"] = sd.get("sleepTimeSeconds")
        out["sleep_score"] = sd.get("sleepScores", {}).get("overall", {}).get("value") if isinstance(sd.get("sleepScores"), dict) else None
        out["hrv_nightly_avg"] = sd.get("avgOvernightHrv")
    except Exception as e:
        out["sleep_error"] = str(e)

    try:
        readiness = client.get_training_readiness(d)
        if readiness:
            item = readiness[0] if isinstance(readiness, list) else readiness
            out["training_readiness"] = item.get("score") or item.get("trainingReadinessScore")
    except Exception:
        pass

    return out


def fetch_activities(client, day: date) -> list:
    d = day.isoformat()
    try:
        acts = client.get_activities_by_date(d, d)
        return acts if acts else []
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def _fmt_sleep(seconds):
    if seconds is None:
        return "—"
    h = seconds / 3600
    return f"{h:.1f} h"


def wellness_to_md(w: dict) -> str:
    lines = [f"# Garmin wellness {w['date']}"]

    if rhr := w.get("resting_hr"):
        lines.append(f"- Resting HR: {rhr} bpm")

    if hrv := w.get("hrv_nightly_avg"):
        lines.append(f"- HRV (overnight): {hrv} ms")

    sleep_s = w.get("sleep_seconds")
    score = w.get("sleep_score")
    sleep_str = _fmt_sleep(sleep_s)
    if sleep_s or score:
        score_str = f" (score {score})" if score else ""
        lines.append(f"- Sleep: {sleep_str}{score_str}")

    bb_low = w.get("body_battery_low")
    bb_high = w.get("body_battery_high")
    if bb_low is not None or bb_high is not None:
        if bb_high is not None:
            lines.append(f"- Body battery: {bb_low} -> {bb_high}")
        else:
            lines.append(f"- Body battery: {bb_low}")

    if stress := w.get("stress_avg"):
        lines.append(f"- Stress (avg): {stress}")

    if steps := w.get("steps"):
        lines.append(f"- Steps: {steps:,}")

    if tr := w.get("training_readiness"):
        lines.append(f"- Training readiness: {tr}")

    return "\n".join(lines) + "\n"


def activity_to_md(a: dict) -> str:
    name = a.get("activityName", "Activity")
    start = (a.get("startTimeLocal") or a.get("startTimeGMT") or "")[:10]
    atype = a.get("activityType", {}).get("typeKey", "unknown")
    duration_s = a.get("duration", 0)
    duration_min = int(duration_s // 60)
    distance_m = a.get("distance", 0) or 0
    distance_km = distance_m / 1000

    lines = [f"# {name} — {start}"]
    lines.append(f"- Type: {atype}")
    lines.append(f"- Duration: {duration_min} min")
    if distance_km > 0.05:
        lines.append(f"- Distance: {distance_km:.2f} km ({distance_m / 1609.34:.2f} mi)")
    if avg_hr := a.get("averageHR"):
        lines.append(f"- Avg HR: {avg_hr} bpm")
    if max_hr := a.get("maxHR"):
        lines.append(f"- Max HR: {max_hr} bpm")
    if calories := a.get("calories"):
        lines.append(f"- Calories: {calories}")
    if avg_pace := a.get("averageSpeed"):
        # averageSpeed in m/s -> min/km
        if avg_pace > 0:
            min_per_km = 1000 / avg_pace / 60
            pace_min = int(min_per_km)
            pace_sec = int((min_per_km - pace_min) * 60)
            lines.append(f"- Avg pace: {pace_min}:{pace_sec:02d} /km")
    if elev := a.get("elevationGain"):
        lines.append(f"- Elevation gain: {elev} m")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Sinks
# ---------------------------------------------------------------------------

def sink_files(all_wellness: list, all_activities: list, out_dir: Path, dry_run: bool):
    daily_dir = out_dir / "daily"
    acts_dir = out_dir / "activities"

    if not dry_run:
        daily_dir.mkdir(parents=True, exist_ok=True)
        acts_dir.mkdir(parents=True, exist_ok=True)

    # Wellness notes
    for w in all_wellness:
        md = wellness_to_md(w)
        path = daily_dir / f"{w['date']}.md"
        if dry_run:
            print(f"\n=== {path} ===")
            print(md)
        else:
            path.write_text(md)
            print(f"  wrote {path}")

    # Activity notes
    for a in all_activities:
        start = (a.get("startTimeLocal") or a.get("startTimeGMT") or "unknown")[:16].replace(":", "-").replace(" ", "-")
        safe_name = (a.get("activityName") or "activity").replace(" ", "_").replace("/", "-")[:40]
        fname = f"{start}-{safe_name}.md"
        path = acts_dir / fname
        md = activity_to_md(a)
        if dry_run:
            print(f"\n=== {path} ===")
            print(md)
        else:
            path.write_text(md)
            print(f"  wrote {path}")

    # Full JSON store
    store = {"wellness": all_wellness, "activities": all_activities}
    json_path = out_dir / "data.json"
    if not dry_run:
        existing = {}
        if json_path.exists():
            try:
                existing = json.loads(json_path.read_text())
            except Exception:
                pass
        # Merge by date for wellness, by activityId for activities
        w_map = {w["date"]: w for w in existing.get("wellness", [])}
        for w in all_wellness:
            w_map[w["date"]] = w
        a_map = {str(a.get("activityId", id(a))): a for a in existing.get("activities", [])}
        for a in all_activities:
            a_map[str(a.get("activityId", id(a)))] = a
        store = {"wellness": list(w_map.values()), "activities": list(a_map.values())}
        json_path.write_text(json.dumps(store, indent=2, default=str))
        print(f"  updated {json_path}")


def sink_supabase(all_wellness: list, all_activities: list):
    import urllib.request

    url = os.environ.get("GARMIN_INGEST_URL", "").strip()
    secret = os.environ.get("GARMIN_INGEST_SECRET", "").strip()
    if not url:
        sys.exit("Set GARMIN_INGEST_URL to use --sink supabase")

    payload = json.dumps({"wellness": all_wellness, "activities": all_activities}).encode()
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    if secret:
        req.add_header("Authorization", f"Bearer {secret}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"  POST {url} -> {resp.status}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Sync Garmin Connect data")
    parser.add_argument("--login", action="store_true", help="Authenticate and save token")
    parser.add_argument("--days", type=int, default=1, help="How many days back to sync (default 1)")
    parser.add_argument("--since", help="Backfill from date YYYY-MM-DD (overrides --days)")
    parser.add_argument("--sink", choices=["files", "supabase"], default="files")
    parser.add_argument("--out", default="./garmin", help="Output folder (--sink files)")
    parser.add_argument("--dry-run", action="store_true", help="Print instead of writing")
    args = parser.parse_args()

    if args.login:
        do_login()
        return

    client = get_client()

    today = date.today()
    if args.since:
        start = date.fromisoformat(args.since)
        days = [start + timedelta(days=i) for i in range((today - start).days + 1)]
    else:
        days = [today - timedelta(days=i) for i in range(args.days)]

    all_wellness = []
    all_activities = []

    for day in days:
        print(f"Fetching {day.isoformat()} ...")
        w = fetch_wellness(client, day)
        all_wellness.append(w)
        acts = fetch_activities(client, day)
        all_activities.extend(acts)
        print(f"  wellness ok | {len(acts)} activities")

    if args.sink == "files":
        sink_files(all_wellness, all_activities, Path(args.out), args.dry_run)
    elif args.sink == "supabase":
        sink_supabase(all_wellness, all_activities)

    print("Done.")


if __name__ == "__main__":
    main()
