"""Static checks for the official Museum Pass inventory snapshot."""
import json
import re
import unittest
from pathlib import Path
from html.parser import HTMLParser
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
class Elements(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.elements = []
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

class MuseumPassTests(unittest.TestCase):
    def test_inventory(self):
        data = json.loads((ROOT / 'data/museum-pass-sites.json').read_text())
        sites = data['sites']
        self.assertEqual(len(sites), 55)
        self.assertEqual(sum(s['area'] == 'Paris' for s in sites), 34)
        self.assertEqual(sum(s['area'] == 'Region' for s in sites), 21)
        self.assertEqual(sum(s['closed_until_2030'] for s in sites), 3)
        urls = [s['url'] for s in sites]
        self.assertEqual(len(set(urls)), 55)
        elements = Elements((ROOT / 'index.html').read_text()).elements
        rendered = [a['data-pass-site'] for _, a in elements if 'data-pass-site' in a]
        self.assertCountEqual(urls, rendered)
        links = [a.get('href') for t, a in elements if t == 'a']
        self.assertTrue(set(urls) <= set(links))

    def test_tabs(self):
        elements = Elements((ROOT / 'index.html').read_text()).elements
        ids = [a['id'] for _, a in elements if 'id' in a]
        self.assertEqual(len(ids), len(set(ids)))
        tabs = [a for _, a in elements if a.get('role') == 'tab' and 'tab' in a.get('class', '').split()]
        panels = [a for _, a in elements if a.get('role') == 'tabpanel' and 'panel' in a.get('class', '').split()]
        self.assertEqual(len(tabs), 12)
        self.assertEqual(len(panels), 12)
        self.assertCountEqual([t['aria-controls'] for t in tabs], [p['id'] for p in panels])
        for _, a in elements:
            for attr in ('aria-controls', 'aria-labelledby', 'aria-describedby'):
                self.assertTrue(set(a.get(attr, '').split()) <= set(ids))

    def test_validity(self):
        start = datetime(2026, 9, 13, 13, tzinfo=ZoneInfo('Europe/Paris'))
        visit = datetime(2026, 9, 17, 10, tzinfo=ZoneInfo('Europe/Paris'))
        self.assertEqual((start + timedelta(hours=96)).isoformat(), '2026-09-17T13:00:00+02:00')
        self.assertLess(visit, start + timedelta(hours=96))
        self.assertGreater(visit, start + timedelta(hours=48))

if __name__ == '__main__':
    unittest.main()
