"""Regression contracts for the revised Monday/Tuesday itinerary.

These tests intentionally describe the public itinerary contract rather than
coupling to the implementation of the map binder.  Every visible stop,
including dining cards, must be represented in the map route and overview.
"""
import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
HOME = "48.8484866,2.3540618"


class Nodes(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.nodes = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.nodes.append((tag, dict(attrs)))


class MondayTuesdayItineraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "index.html").read_text()
        budget = re.search(
            r'<script type="application/json" id="daily-budget-data">([\s\S]*?)</script>',
            cls.html,
        )
        if not budget:
            raise AssertionError("Missing daily budget ledger")
        cls.budget = json.loads(budget[1])

    def panel(self, key):
        match = re.search(r'<section class="panel" id="' + key + r'"[\s\S]*?</section>', self.html)
        if not match:
            raise AssertionError(f"Missing panel {key}")
        return match[0]

    @staticmethod
    def panel_nodes(panel):
        return Nodes(panel).nodes

    def itinerary_nodes(self, key):
        """Return visible route nodes, including dining cards."""
        return [
            attrs
            for tag, attrs in self.panel_nodes(self.panel(key))
            if ("stop" in attrs.get("class", "").split() and attrs.get("data-label"))
            or ("card" in attrs.get("class", "").split() and attrs.get("data-dining"))
        ]

    @staticmethod
    def route_legs(panel):
        return [
            attrs
            for tag, attrs in Nodes(panel).nodes
            if "leg" in attrs.get("class", "").split() and attrs.get("data-src")
        ]

    @staticmethod
    def query(src):
        return parse_qs(urlparse(src).query)

    @classmethod
    def map_point(cls, attrs):
        query = cls.query(attrs["data-src"])
        point = query.get("q", [None])[0]
        if not point:
            raise AssertionError(f"Route node has no map point: {attrs}")
        return point

    def assert_route_contract(self, key, expected_labels, exact=True):
        panel = self.panel(key)
        nodes = self.itinerary_nodes(key)
        labels = [attrs.get("data-label") or attrs.get("data-dining") for attrs in nodes]
        if exact:
            self.assertEqual(labels, expected_labels, key)
        else:
            self.assertEqual(labels[: len(expected_labels)], expected_labels, key)

        # There is one leg from home to each node and one final leg home.
        legs = self.route_legs(panel)
        self.assertEqual(len(legs), len(nodes) + 1, key)
        self.assertEqual(self.query(legs[0]["data-src"])["saddr"][0], HOME, key)
        self.assertEqual(self.query(legs[-1]["data-src"])["daddr"][0], HOME, key)

        for index, node in enumerate(nodes):
            incoming = self.query(legs[index]["data-src"])
            outgoing = self.query(legs[index + 1]["data-src"])
            point = self.map_point(node)
            self.assertEqual(incoming["daddr"][0], point, labels[index])
            self.assertEqual(outgoing["saddr"][0], point, labels[index])

        # The embedded overview must show exactly the same destination chain.
        frame = next(attrs for tag, attrs in Nodes(panel).nodes if tag == "iframe")
        # Multi-stop transit embeds render pins without a route. The full map is
        # explicitly a walking schematic, not the actual mode of every leg.
        self.assertEqual(self.query(frame["src"])["dirflg"], ["w"])
        self.assertIn("도보 개략도", panel)
        overview = self.query(frame["src"])["daddr"][0].split(" to:")
        self.assertEqual(overview, [self.query(leg["data-src"])["daddr"][0] for leg in legs])
        actual_modes = [self.query(leg["data-src"])["dirflg"][0] for leg in legs]
        expected_modes = ["r"] + ["w"] * 7 if key == "p3" else ["w"] * 3 + ["r"] * 2
        self.assertEqual(actual_modes, expected_modes)

    def test_monday_route_replaces_shopping_with_musee_delacroix_and_evening_dessert(self):
        self.assert_route_contract(
            "p3",
            [
                "루브르",
                "옥동식 파리",
                "Fer à Cheval",
                "퐁뇌프 · 센강 산책",
                "들라크루아 미술관",
                "Bouillon Racine",
                "Il Gelato del Marchese",
            ],
        )
        panel = self.panel("p3")
        self.assertNotIn("La Samaritaine", panel)
        self.assertNotIn("48.8592564,2.3424255", panel)
        self.assertNotIn("Higuma", panel)
        self.assertIn("09:00–13:00", panel)
        for dining, timing in [
            ("옥동식 파리", "13:20–14:10"),
            ("Fer à Cheval", "14:40–15:00"),
            ("Bouillon Racine", "18:30–19:45"),
            ("Il Gelato del Marchese", "20:00–20:20"),
        ]:
            self.assertRegex(panel, rf'data-dining="{re.escape(dining)}"[\s\S]*?{re.escape(timing)}')
        for stop, timing in [
            ("퐁뇌프 · 센강 산책", "15:15–15:30"),
            ("들라크루아 미술관", "15:45–16:45"),
        ]:
            self.assertRegex(
                panel,
                rf'data-label="{re.escape(stop)}"[\s\S]*?<span class="time">{re.escape(timing)}</span>',
            )

        self.assertNotIn("바토 파리지앵", panel)

    def test_sunday_retains_cruise_and_monday_does_not(self):
        sunday = self.panel("p2")
        self.assertIn("바토 파리지앵", sunday)
        self.assertNotIn("샹드마르스 · 에펠탑", sunday)
        self.assertRegex(sunday, r'data-label="바토 파리지앵"[\s\S]*?<span class="time">21:00</span>')
        sunday_stops = [
            attrs.get("data-label")
            for tag, attrs in Nodes(sunday).nodes
            if "stop" in attrs.get("class", "").split() and attrs.get("data-label")
        ]
        self.assertEqual(
            sunday_stops,
            ["노트르담", "오랑주리", "마르모탕 모네", "바토 파리지앵"],
        )
        legs = self.route_legs(sunday)
        self.assertEqual(
            [self.query(leg["data-src"])["daddr"][0] for leg in legs],
            [
                "48.8530,2.3499",
                "48.8638,2.3227",
                "48.8593,2.2672",
                "48.8604,2.2936",
                HOME,
            ],
        )
        unlabelled_stops = [
            attrs
            for tag, attrs in Nodes(sunday).nodes
            if "stop" in attrs.get("class", "").split() and not attrs.get("data-label")
        ]
        self.assertTrue(unlabelled_stops)
        self.assertTrue(all("data-src" not in attrs for attrs in unlabelled_stops))
        sunday_items = {item["id"]: item for item in self.budget["days"]["p2"]["items"]}
        self.assertIn("cruise", sunday_items)
        self.assertEqual(sunday_items["cruise"]["cents"], 4000)

        monday_items = {item["id"]: item for item in self.budget["days"]["p3"]["items"]}
        self.assertNotIn("cruise", monday_items)

    def test_tuesday_route_puts_rodin_before_late_orsay(self):
        self.assert_route_contract(
            "p4",
            ["Les Deux Magots", "로댕 미술관", "오르세 미술관", "샹드마르스 · 에펠탑"],
        )
        panel = self.panel("p4")
        self.assertNotIn("10:00–13:30", panel)
        self.assertRegex(panel, r'data-dining="Les Deux Magots"[\s\S]*?08:30–09:00')
        for stop, timing in [
            ("로댕 미술관", "10:00–11:30"),
            ("오르세 미술관", "13:30–17:00"),
            ("샹드마르스 · 에펠탑", "17:45"),
        ]:
            self.assertRegex(
                panel,
                rf'data-label="{re.escape(stop)}"[\s\S]*?<span class="time">{re.escape(timing)}</span>',
            )
        champ = next(
            attrs
            for tag, attrs in Nodes(panel).nodes
            if attrs.get("data-label") == "샹드마르스 · 에펠탑"
        )
        self.assertEqual(champ.get("data-tier"), "2")

    def test_budget_ledger_tracks_the_revised_places_and_membership_boundary(self):
        p3 = self.budget["days"]["p3"]["items"]
        p4 = self.budget["days"]["p4"]["items"]
        by_id = {item["id"]: item for item in p3 + p4}

        self.assertIn("okdongsik", by_id)
        self.assertNotIn("higuma", by_id)
        self.assertNotIn("samaritaine", by_id)
        self.assertEqual(by_id["okdongsik"]["place"], "옥동식 파리")
        self.assertEqual(by_id["delacroix"]["cents"], 0)
        self.assertIn("louvre", by_id["delacroix"].get("sources", []))
        self.assertNotEqual(by_id["delacroix"].get("status"), "free")
        self.assertEqual(by_id["rodin"]["cents"], 2800)
        self.assertNotIn("carte", " ".join(by_id).lower())

        dinners = [item for item in p3 if item.get("meal") == "dinner"]
        self.assertEqual(len(dinners), 1)
        self.assertEqual(dinners[0]["place"], "Bouillon Racine")
        self.assertEqual(dinners[0]["cents"], 7000)
        self.assertEqual(by_id["okdongsik"]["cents"], 5000)

        gelato = by_id["gelato"]
        self.assertTrue(gelato.get("optional"))
        self.assertTrue(gelato.get("included"))

        soap = by_id["soap"]
        self.assertTrue(soap.get("optional"))
        self.assertFalse(soap.get("included"))
        # The purchase remains optional, but Fer à Cheval stays in the fixed route.
        self.assertIn('data-dining="Fer à Cheval"', self.panel("p3"))


if __name__ == "__main__":
    unittest.main()
