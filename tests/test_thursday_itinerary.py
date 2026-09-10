import re
import unittest
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]

class Nodes(HTMLParser):
    def __init__(self, s):
        super().__init__()
        self.nodes = []
        self.feed(s)
    def handle_starttag(self, tag, attrs):
        self.nodes.append((tag, dict(attrs)))

class ThursdayTests(unittest.TestCase):
    def setUp(self):
        s = (ROOT / 'legacy.html').read_text()
        self.panel = re.search(r'<section class="panel" id="p6"[\s\S]*?</section>', s).group()
        self.nodes = Nodes(self.panel).nodes

    def test_order(self):
        stops = [a['data-label'] for t, a in self.nodes if t == 'button' and a.get('class') == 'stop']
        self.assertEqual(stops, ['루브르', '들라크루아 미술관'])
        self.assertIn('09:00–13:00', self.panel)
        self.assertIn('15:45–17:00', self.panel)
        self.assertIn('재배치 후보 보존', self.panel)

    def test_route_continuity(self):
        legs = [parse_qs(urlparse(a['data-src']).query) for _, a in self.nodes if a.get('class') == 'leg']
        self.assertEqual(len(legs), 3)
        self.assertEqual(legs[0]['saddr'], legs[-1]['daddr'])
        for previous, following in zip(legs, legs[1:]):
            self.assertEqual(previous['daddr'], following['saddr'])
        frame = next(a for t, a in self.nodes if t == 'iframe')
        route = parse_qs(urlparse(frame['src']).query)['daddr'][0].split(' to:')
        self.assertEqual(route, [leg['daddr'][0] for leg in legs])

if __name__ == '__main__':
    unittest.main()
