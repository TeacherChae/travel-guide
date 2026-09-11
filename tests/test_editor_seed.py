"""Contract tests for the public, serverless place-editor seed.

The seed is deliberately kept as a small UMD JavaScript file so that the
static site can load it without a bundler.  These tests parse the JSON object
inside that wrapper and protect the boundary between the private Notion
snapshot and the public app.
"""

import json
import math
import re
import unittest
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "data" / "places-seed.js"
MODEL_PATH = ROOT / "assets" / "place-model.js"
INDEX_PATH = ROOT / "index.html"

ALLOWLIST = {
    "id",
    "Name",
    "Date&Time",
    "Reservation Status",
    "Reservation",
    "Total Fee",
    "Pay per Each",
    "EA",
    "Priority",
    "Category",
    "URL",
    "Maps",
    "memo",
}


def load_seed():
    source = SEED_PATH.read_text(encoding="utf-8")
    match = re.search(r"const seed = (\{.*\});\s*\n\s*if \(typeof module", source, re.S)
    if not match:
        raise AssertionError("places-seed.js must contain a JSON seed object")
    return json.loads(match.group(1))


class EditorSeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.seed_source = SEED_PATH.read_text(encoding="utf-8")
        cls.seed = load_seed()
        cls.places = cls.seed.get("places", [])
        cls.index = INDEX_PATH.read_text(encoding="utf-8")
        cls.model = MODEL_PATH.read_text(encoding="utf-8")

    def test_seed_has_expected_public_snapshot_shape(self):
        self.assertEqual(self.seed["version"], 1)
        self.assertEqual(self.seed["timeZone"], "Europe/Paris")
        self.assertEqual(len(self.places), 47)
        self.assertEqual(len({place["id"] for place in self.places}), 47)
        self.assertEqual(set(self.seed), {"version", "timeZone", "capturedAt", "source", "days", "places"})
        for place in self.places:
            self.assertEqual(set(place), ALLOWLIST, place.get("Name"))
            self.assertTrue(place["id"])
            self.assertTrue(place["Name"].strip())
            self.assertIsInstance(place["memo"], str)

    def test_source_snapshot_refreshes_only_scheduled_records_without_inventing_values(self):
        # Date&Time-filled Notion rows were refreshed first. Existing candidate
        # records without a date stay visible instead of receiving an invented day.
        self.assertEqual(sum(place["Date&Time"] is not None for place in self.places), 25)
        self.assertEqual(sum(place["Date&Time"] is None for place in self.places), 22)
        self.assertEqual(sum(not place["Maps"] for place in self.places), 1)
        for place in self.places:
            if place["Date&Time"] is None:
                continue
            value = place["Date&Time"]
            self.assertIsInstance(value, dict, place["Name"])
            self.assertIsInstance(value.get("start"), str, place["Name"])
            self.assertTrue(re.match(r"^\d{4}-\d{2}-\d{2}(?:T|$)", value["start"]))
            end = value.get("end")
            if end is not None:
                self.assertIsInstance(end, str, place["Name"])
                self.assertRegex(end, r"^\d{4}-\d{2}-\d{2}T")

    def test_seed_values_are_sanitized_and_amounts_are_real_numbers(self):
        forbidden = re.compile(
            r"formulaResult://|formulaCode://|AIza[0-9A-Za-z_-]{20,}|"
            r"signed|attachment|private|token|secret|authorization",
            re.I,
        )
        # Formula URLs and raw Notion attachment references must never become
        # amounts or public seed values.
        # Ignore the file's explanatory header (which intentionally says
        # "private attachments"); inspect only serialized seed values.
        self.assertNotRegex(json.dumps(self.seed, ensure_ascii=False), forbidden)
        for place in self.places:
            for field in ("Total Fee", "Pay per Each", "EA"):
                value = place[field]
                if value is not None:
                    self.assertIsInstance(value, (int, float), f"{place['Name']} {field}")
                    self.assertNotIsInstance(value, bool)
                    self.assertTrue(math.isfinite(value))
                    self.assertGreaterEqual(value, 0)
            for field in ("URL", "Maps"):
                value = place[field]
                self.assertIsInstance(value, str)
                self.assertNotRegex(value, forbidden)
                if not value:
                    continue
                for line in value.splitlines():
                    parsed = urlparse(line.strip())
                    self.assertIn(parsed.scheme, {"http", "https"}, (place["Name"], field, line))
                    self.assertFalse(parsed.username or parsed.password, (place["Name"], field))
                    if field == "URL":
                        self.assertNotIn(parsed.netloc.lower(), {"app.notion.com", "www.notion.so", "notion.so"})
                    if field == "Maps":
                        self.assertIn(parsed.netloc.lower(), {
                            "google.com",
                            "www.google.com",
                            "maps.google.com",
                            "google.fr",
                            "www.google.fr",
                        })

    def test_current_model_and_seed_are_loaded_by_index_without_legacy_records(self):
        for asset in (
            'assets/place-model.js',
            'data/places-seed.js',
            'assets/maps-picker.js',
            'assets/editor.js',
            'assets/editor.css',
        ):
            self.assertRegex(self.index, rf"(?:src|href)=\"{re.escape(asset)}\"", asset)
        for export in (
            "normalizePlace",
            "validatePlace",
            "getFee",
            "sortPlaces",
            "buildRoutes",
            "serializePlaces",
            "parsePlaces",
        ):
            self.assertIn(export, self.model)

        # The active page is a generic renderer.  Place names belong in the
        # seed/local storage, not in copied HTML markup.
        for place in self.places:
            self.assertNotIn(place["Name"], self.index, place["Name"])
        self.assertNotRegex(self.index, r"<section[^>]+id=\"p[1-8]\"")

    def test_seed_dates_are_well_formed_and_days_are_the_explicit_snapshot_days(self):
        self.assertEqual(self.seed["days"], [
            "2026-09-12",
            "2026-09-13",
            "2026-09-14",
            "2026-09-15",
            "2026-09-16",
            "2026-09-17",
            "2026-09-18",
            "2026-09-19",
        ])
        for place in self.places:
            date_time = place["Date&Time"]
            if date_time is None:
                continue
            start = date_time["start"]
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", start):
                date.fromisoformat(start)
            else:
                # Python's parser accepts the ISO Z suffix after replacing it
                # with an explicit UTC offset.
                self.assertRegex(start, r"^\d{4}-\d{2}-\d{2}T")
                fromiso = start.replace("Z", "+00:00")
                self.assertIsNotNone(__import__("datetime").datetime.fromisoformat(fromiso))


if __name__ == "__main__":
    unittest.main()
