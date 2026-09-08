"""Arrival directions must start at CDG and end at the user's saved lodging."""
import csv
import re
import unittest
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
class Elements(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.nodes = []
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        self.nodes.append((tag, dict(attrs)))

class ArrivalTests(unittest.TestCase):
    def setUp(self):
        with (ROOT / 'paris-saved-spots-accommodation.csv').open(encoding='utf-8-sig') as f:
            lodging = next(csv.DictReader(f))
        self.home = lodging['latitude'] + ',' + lodging['longitude']
        self.source = (ROOT / 'index.html').read_text()
        panel = re.search(r'<section class="panel" id="p1"[\s\S]*?</section>', self.source).group()
        self.nodes = Elements(panel).nodes

    def test_airport_card_is_directions(self):
        card = next(a for _, a in self.nodes if a.get('data-label') == 'CDG → 5구 숙소')
        params = parse_qs(urlparse(card['data-src']).query)
        self.assertEqual(params.get('saddr'), ['49.0097,2.5479'])
        self.assertEqual(params.get('daddr'), [self.home])
        self.assertEqual(params.get('dirflg'), ['r'])
        self.assertNotIn('q', params)

    def test_arrival_route_tabs_are_accessible(self):
        panel = next(a for t, a in self.nodes if t == 'section')
        self.assertEqual(panel.get('data-arrival-mode'), 'rer')
        controls = [a for t, a in self.nodes if t == 'button' and a.get('data-arrival-mode') in {'rer', 'taxi'}]
        self.assertEqual([a['data-arrival-mode'] for a in controls], ['rer', 'taxi'])
        self.assertTrue(all(a.get('role') == 'tab' for a in controls))
        self.assertEqual([a.get('aria-selected') for a in controls], ['true', 'false'])
        ids = {a['id'] for _, a in self.nodes if 'id' in a}
        self.assertTrue({a['aria-controls'] for a in controls} <= ids)
        panels = [a for _, a in self.nodes if a.get('id') in {c['aria-controls'] for c in controls}]
        self.assertEqual(len(panels), 2)
        self.assertTrue(all(a.get('role') == 'tabpanel' for a in panels))

    def test_arrival_maps_are_single_leg_to_lodging(self):
        frame = next(a for t, a in self.nodes if t == 'iframe')
        params = parse_qs(urlparse(frame['src']).query)
        self.assertEqual(params['saddr'], ['49.0097,2.5479'])
        self.assertEqual(params['daddr'], [self.home])
        self.assertEqual(params['dirflg'], ['r'])

        route_buttons = {a['data-arrival-mode']: a for t, a in self.nodes if t == 'button' and a.get('data-arrival-mode') in {'rer', 'taxi'}}
        rer = parse_qs(urlparse(route_buttons['rer']['data-src']).query)
        taxi = parse_qs(urlparse(route_buttons['taxi']['data-src']).query)
        self.assertEqual(rer.get('saddr'), ['49.0097,2.5479'])
        self.assertEqual(rer.get('daddr'), [self.home])
        self.assertEqual(rer.get('dirflg'), ['r'])
        self.assertEqual(taxi.get('saddr'), ['49.0097,2.5479'])
        self.assertEqual(taxi.get('daddr'), [self.home])
        self.assertEqual(taxi.get('dirflg'), ['d'])

    def test_arrival_tab_js_contract_for_budget_integration(self):
        self.assertIn('arrivalmodechange', self.source)
        self.assertIn('dataset.arrivalMode', self.source)
        self.assertIn("detail:{mode: mode}", self.source)

    def test_arrival_copy_explains_google_transit_limit(self):
        self.assertIn('Google 지도는 RER B 노선을 강제 고정하지 못합니다', self.source)

    def test_arrival_construction_warning_does_not_claim_direct_service(self):
        panel = re.search(r'<section class="panel" id="p1"[\s\S]*?</section>', self.source)[0]
        self.assertIn('9/12–13', panel)
        self.assertIn('Gare du Nord ↔ Denfert-Rochereau 종일 운휴', panel)
        self.assertIn('직결은 불가', panel)
        self.assertIn('22:45 이후 운휴는 별도', panel)
        self.assertIn('rer-b-travaux', panel)
        self.assertIn('Saint-Michel–Notre-Dame', self.source)

    def test_overview_starts_at_airport(self):
        overview = next(a for _, a in self.nodes if 'data-day-overview' in a)
        params = parse_qs(urlparse(overview['data-src']).query)
        self.assertEqual(params['saddr'], ['49.0097,2.5479'])
        stops = params['daddr'][0].split(' to:')
        self.assertEqual(stops[0], self.home)
        self.assertEqual(stops[-1], self.home)
        self.assertGreater(len(stops), 1)
        self.assertEqual(params['dirflg'], ['r'])

    def test_no_old_lodging_pin_in_any_map(self):
        for _, a in Elements(self.source).nodes:
            for attr in ('src', 'data-src', 'href'):
                url = a.get(attr, '')
                if 'maps' in url:
                    params = parse_qs(urlparse(url).query)
                    for values in params.values():
                        self.assertTrue(all('48.8487,2.3565' not in v for v in values))

if __name__ == '__main__':
    unittest.main()
