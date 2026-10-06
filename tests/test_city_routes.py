"""Local link and city-boundary contracts for static hosting."""

import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]


class LocalLinks(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.links = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        for name in ('href', 'src'):
            if name in values:
                self.links.append(values[name])


class CityRoutesTests(unittest.TestCase):
    def test_city_entrypoints_and_local_links_resolve(self):
        for relative in ('index.html', 'Paris/index.html', 'Paris/legacy.html', 'Kumamoto/index.html'):
            page = ROOT / relative
            self.assertTrue(page.is_file(), relative)
            for link in LocalLinks(page.read_text(encoding='utf-8')).links:
                parsed = urlsplit(link)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                self.assertFalse(parsed.path.startswith('/'), (relative, link))
                target = (page.parent / unquote(parsed.path)).resolve()
                self.assertTrue(target.is_relative_to(ROOT), (relative, link))
                if target.is_dir():
                    target /= 'index.html'
                self.assertTrue(target.is_file(), (relative, link))

    def test_cities_do_not_share_seed_or_itinerary(self):
        landing = (ROOT / 'index.html').read_text(encoding='utf-8')
        paris = (ROOT / 'Paris/index.html').read_text(encoding='utf-8')
        kumamoto = (ROOT / 'Kumamoto/index.html').read_text(encoding='utf-8')
        self.assertIn('href="Paris/"', landing)
        self.assertIn('href="Kumamoto/"', landing)
        self.assertIn('src="data/places-seed.js"', paris)
        self.assertNotIn('places-seed.js', kumamoto)


if __name__ == '__main__':
    unittest.main()
