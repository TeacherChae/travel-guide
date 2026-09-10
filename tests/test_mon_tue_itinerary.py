"""Regression contracts for the flexible Rodin itinerary.

Visible route nodes must match the active Rodin scenario. Hidden alternate
scenario nodes may remain in the HTML, but they must not be part of the active
route, budget, or default maps.
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
        self._scenario_stack = [None]
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        inherited = self._scenario_stack[-1]
        current = attrs.get("data-rodin-only", inherited)
        attrs["_rodin_only"] = current
        self.nodes.append((tag, attrs))
        self._scenario_stack.append(current)

    def handle_endtag(self, tag):
        if len(self._scenario_stack) > 1:
            self._scenario_stack.pop()


class FlexibleItineraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "legacy.html").read_text()
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

    def panel_nodes(self, key, scenario="friday"):
        return [
            (tag, attrs)
            for tag, attrs in Nodes(self.panel(key)).nodes
            if attrs.get("_rodin_only") in (None, scenario)
        ]

    def itinerary_nodes(self, key, scenario="friday"):
        return [
            attrs
            for tag, attrs in self.panel_nodes(key, scenario)
            if ("stop" in attrs.get("class", "").split() and attrs.get("data-label"))
            or ("card" in attrs.get("class", "").split() and attrs.get("data-dining"))
        ]

    def route_legs(self, key, scenario="friday"):
        return [
            attrs
            for tag, attrs in self.panel_nodes(key, scenario)
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

    def assert_route_contract(self, key, expected_labels, expected_modes, scenario="friday"):
        panel = self.panel(key)
        nodes = self.itinerary_nodes(key, scenario)
        labels = [attrs.get("data-label") or attrs.get("data-dining") for attrs in nodes]
        self.assertEqual(labels, expected_labels, (key, scenario))

        legs = self.route_legs(key, scenario)
        self.assertEqual(len(legs), len(nodes) + 1, (key, scenario))
        self.assertEqual(self.query(legs[0]["data-src"])["saddr"][0], HOME, key)
        self.assertEqual(self.query(legs[-1]["data-src"])["daddr"][0], HOME, key)
        self.assertEqual([self.query(leg["data-src"])["dirflg"][0] for leg in legs], expected_modes)

        for index, node in enumerate(nodes):
            incoming = self.query(legs[index]["data-src"])
            outgoing = self.query(legs[index + 1]["data-src"])
            point = self.map_point(node)
            self.assertEqual(incoming["daddr"][0], point, labels[index])
            self.assertEqual(outgoing["saddr"][0], point, labels[index])

        frame = next(attrs for tag, attrs in Nodes(panel).nodes if tag == "iframe")
        self.assertIn("도보 개략도", panel) if key in {"p3", "p4"} else None
        overview = self.query(frame["src"])["daddr"][0].split(" to:")
        if scenario == "friday":
            self.assertEqual(overview, [self.query(leg["data-src"])["daddr"][0] for leg in legs])

    def test_sunday_default_keeps_festival_then_cruise_without_rodin(self):
        self.assert_route_contract(
            "p2",
            ["노트르담", "생트샤펠", "La Fête de Paris", "바토 파리지앵"],
            ["w", "w", "w", "r", "r"],
            scenario="friday",
        )
        panel = self.panel("p2")
        self.assertIn("La Fête de Paris", panel)
        self.assertIn("13:30–13:45 Panthéon 도착은", panel)
        self.assertIn("18시까지 반드시 머물 필요는 없습니다", panel)
        self.assertIn("생트샤펠은 현재 정기 미사", panel)
        self.assertRegex(panel, r'data-label="바토 파리지앵"[\s\S]*?<span class="time">21:00 목표</span>')
        self.assertIn("MyRealTrip", panel)
        self.assertIn("₩27,052", panel)
        self.assertNotIn("오랑주리 → 마르모탕", panel)

    def test_sunday_rodin_scenario_adds_only_conditional_rodin(self):
        self.assert_route_contract(
            "p2",
            ["노트르담", "생트샤펠", "La Fête de Paris", "로댕 미술관", "바토 파리지앵"],
            ["w", "w", "w", "w", "r", "r"],
            scenario="sunday",
        )
        panel = self.panel("p2")
        self.assertIn('data-rodin-only="sunday"', panel)
        self.assertRegex(panel, r'로댕 미술관[\s\S]*?16:40–18:15 조건부')
        self.assertIn("짧은 하이라이트 관람", panel)

    def test_monday_orangerie_then_existing_food_walk(self):
        self.assert_route_contract(
            "p3",
            [
                "오랑주리",
                "옥동식 파리",
                "Fer à Cheval",
                "퐁뇌프 · 센강 산책",
                "진화 대전시실",
                "파리 식물원",
                "Bouillon Racine",
                "Il Gelato del Marchese",
            ],
            ["r", "w", "w", "w", "r", "w", "r", "w", "w"],
        )
        panel = self.panel("p3")
        self.assertIn("루브르·들라크루아는 목요일로 옮겼습니다", panel)
        self.assertIn("10:00–12:00", panel)
        self.assertNotIn("들라크루아 미술관", panel)
        self.assertNotIn("La Samaritaine", panel)
        self.assertNotIn("Higuma", panel)

    def test_tuesday_has_only_marmottan_and_orsay_as_museums(self):
        self.assert_route_contract(
            "p4",
            ["Les Deux Magots", "마르모탕 모네", "오르세 미술관"],
            ["w", "r", "r", "r"],
        )
        panel = self.panel("p4")
        self.assertRegex(panel, r'data-label="마르모탕 모네"[\s\S]*?<span class="time">10:00–12:00</span>')
        self.assertRegex(panel, r'data-label="오르세 미술관"[\s\S]*?<span class="time">13:30–17:00</span>')
        self.assertNotIn('data-label="로댕 미술관"', panel)
        self.assertIn("미술관 3곳을 넣지 않도록 로댕을 제외", panel)

    def test_thursday_louvre_delacroix_pairing(self):
        self.assert_route_contract(
            "p6",
            ["루브르", "들라크루아 미술관"],
            ["r", "w", "w"],
        )
        panel = self.panel("p6")
        self.assertIn("09:00–13:00", panel)
        self.assertIn("15:45–17:00", panel)
        self.assertIn("무료 미술관은 아닙니다", panel)
        self.assertIn("달리그르·쿨레 베르트는 기본 동선과 예산에서 제외", panel)
        self.assertIn("진화 대전시실·식물원은 월요일", panel)

    def test_friday_scenarios_are_mutually_exclusive(self):
        friday_labels = [attrs.get("data-label") or attrs.get("data-dining") for attrs in self.itinerary_nodes("p7", "friday")]
        sunday_labels = [attrs.get("data-label") or attrs.get("data-dining") for attrs in self.itinerary_nodes("p7", "sunday")]
        self.assertEqual(friday_labels, ["로댕 미술관", "풀만 체크인", "트로카데로 광장", "Le Café du Commerce"])
        self.assertEqual(sunday_labels, ["몽소 공원", "Pleincœur", "풀만 체크인", "트로카데로 광장", "Le Café du Commerce"])
        self.assertNotIn("몽소 공원", friday_labels)
        self.assertNotIn("Pleincœur", friday_labels)
        self.assertNotIn("로댕 미술관", sunday_labels)

        for scenario, expected_destinations in {
            "friday": ["48.8556,2.2929", "48.8553072,2.3158354", "48.8556,2.2929", "48.8628,2.2876", "48.846418,2.2954771", "48.8556,2.2929"],
            "sunday": ["48.8556,2.2929", "48.8797,2.3090", "48.8864619,2.3186604", "48.8556,2.2929", "48.8628,2.2876", "48.846418,2.2954771", "48.8556,2.2929"],
        }.items():
            legs = self.route_legs("p7", scenario)
            self.assertEqual([self.query(leg["data-src"])["daddr"][0] for leg in legs], expected_destinations, scenario)
            self.assertEqual(self.query(legs[0]["data-src"])["saddr"][0], HOME, scenario)
            for previous, following in zip(legs, legs[1:]):
                self.assertEqual(self.query(previous["data-src"])["daddr"][0], self.query(following["data-src"])["saddr"][0], scenario)

        panel = self.panel("p7")
        self.assertIn('data-rodin-only="friday"', panel)
        self.assertIn('data-rodin-only="sunday"', panel)
        self.assertIn("14:00–15:10", panel)
        self.assertIn("15:40–16:10", panel)
        self.assertIn("기본 금요일 로댕안", (ROOT / "data" / "dining-plan.json").read_text())

    def test_budget_ledger_tracks_revised_places_and_exactly_one_rodin(self):
        days = self.budget["days"]
        self.assertEqual(self.budget["rodin_plan"], "friday")
        self.assertEqual(days["p3"]["items"][-1]["id"], "orangerie")
        self.assertEqual(days["p4"]["items"][-1]["id"], "marmottan")
        self.assertIn("delacroix", {item["id"] for item in days["p6"]["items"]})
        rodin_items = [item for day in days.values() for item in day["items"] if item["id"].startswith("rodin-")]
        self.assertCountEqual([item["rodin_day"] for item in rodin_items], ["sunday", "friday"])
        self.assertTrue(all(item["cents"] == 2800 for item in rodin_items))
        for scenario, expected in [("friday", 157560), ("sunday", 159560)]:
            total = 0
            for day in days.values():
                for item in day["items"]:
                    if item.get("rodin_day") and item["rodin_day"] != scenario:
                        continue
                    if item.get("optional") and not item.get("included"):
                        continue
                    total += item["cents"]
            self.assertEqual(total, expected, scenario)


if __name__ == "__main__":
    unittest.main()
