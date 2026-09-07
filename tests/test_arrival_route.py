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

    def test_overview_starts_at_airport(self):
        frame = next(a for t, a in self.nodes if t == 'iframe')
        params = parse_qs(urlparse(frame['src']).query)
        self.assertEqual(params['saddr'], ['49.0097,2.5479'])
        stops = params['daddr'][0].split(' to:')
        self.assertEqual(stops[0], self.home)
        self.assertEqual(stops[-1], self.home)

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
