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
        s = (ROOT / 'index.html').read_text()
        self.panel = re.search(r'<section class="panel" id="p6"[\s\S]*?</section>', s).group()
        self.nodes = Nodes(self.panel).nodes

    def test_order(self):
        stops = [a['data-label'] for t, a in self.nodes if t == 'button' and a.get('class') == 'stop']
        self.assertEqual(stops, ['생트샤펠', '마르셰 달리그르', '쿨레 베르트 르네뒤몽', '진화과학 박물관', '파리 식물원'])
        self.assertIn('11:30–12:30', self.panel)
        self.assertIn('15:00–17:00', self.panel)
        self.assertNotIn('data-dining=', self.panel)

    def test_route_continuity(self):
        legs = [parse_qs(urlparse(a['data-src']).query) for _, a in self.nodes if a.get('class') == 'leg']
        self.assertEqual(len(legs), 6)
        self.assertEqual(legs[0]['saddr'], legs[-1]['daddr'])
        for previous, following in zip(legs, legs[1:]):
            self.assertEqual(previous['daddr'], following['saddr'])
        frame = next(a for t, a in self.nodes if t == 'iframe')
        route = parse_qs(urlparse(frame['src']).query)['daddr'][0].split(' to:')
        self.assertEqual(route, [leg['daddr'][0] for leg in legs])

if __name__ == '__main__':
    unittest.main()
