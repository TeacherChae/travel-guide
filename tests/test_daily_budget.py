"""The single embedded ledger must cover the trip without double billing."""
import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class Nodes(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.nodes = []
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        self.nodes.append((tag, dict(attrs)))

class BudgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / 'index.html').read_text()
        match = re.search(r'<script type="application/json" id="daily-budget-data">([\s\S]*?)</script>', cls.html)
        if not match:
            raise AssertionError('Missing single-source daily budget ledger')
        cls.data = json.loads(match[1])

    def test_eight_days_and_two_adults(self):
        self.assertEqual(self.data['people'], 2)
        self.assertEqual(self.data['currency'], 'EUR')
        self.assertEqual(list(self.data['days']), [f'p{i}' for i in range(1, 9)])
        for key in self.data['days']:
            panel = re.search(r'<section class="panel" id="'+key+r'"[\s\S]*?</section>', self.html)[0]
            self.assertIn('class="daily-budget"', panel)
            self.assertIn('2인 일일 예산', panel)

    def test_cents_ranges_and_source_integrity(self):
        ids = []
        for day in self.data['days'].values():
            for item in day['items']:
                ids.append(item['id'])
                for value in [item['cents'], *item['range']]:
                    self.assertIs(type(value), int)
                    self.assertGreaterEqual(value, 0)
                self.assertLessEqual(item['range'][0], item['cents'])
                self.assertLessEqual(item['cents'], item['range'][1])
                self.assertTrue(item['basis'])
                self.assertIn(item['status'], ['verified', 'estimate', 'free', 'excluded'])
                if item['status'] == 'verified':
                    self.assertTrue(item.get('sources'))
                for source in item.get('sources', []):
                    evidence = self.data['sources'][source]
                    self.assertTrue(evidence['url'].startswith('https://'))
                    self.assertRegex(evidence['checked_on'], r'^\d{4}-\d{2}-\d{2}$')
        self.assertEqual(len(ids), len(set(ids)))

    def test_all_mapped_places_and_dining_have_one_budget_entry(self):
        for key, day in self.data['days'].items():
            panel = re.search(r'<section class="panel" id="'+key+r'"[\s\S]*?</section>', self.html)[0]
            places = []
            for _, attrs in Nodes(panel).nodes:
                if attrs.get('data-label') and 'stop' in attrs.get('class', '').split():
                    places.append(attrs['data-label'])
                if attrs.get('data-dining'):
                    places.append(attrs['data-dining'])
            assigned = [item['place'] for item in day['items'] if item.get('place')]
            self.assertCountEqual(places, assigned, key)

    def test_no_combined_ticket_or_removed_museum_double_count(self):
        items = [item for day in self.data['days'].values() for item in day['items']]
        by_id = {item['id']: item for item in items}
        self.assertEqual(by_id['marmottan']['cents'], 2800)
        self.assertEqual(by_id['monet']['cents'], 2600)
        self.assertNotIn('피카소', [item['name'] for item in items])
        self.assertFalse(by_id['impressionisms']['included'])
        self.assertEqual(by_id['orsay']['cents'], 3200)
        self.assertEqual(by_id['chapelle']['cents'], 4400)

    def test_transit_baseline_and_taxi_are_alternatives(self):
        airport = self.data['days']['p1']['items'][0]
        self.assertEqual(airport['id'], 'arrival')
        self.assertEqual(airport['cents'], 2800)
        self.assertEqual(airport['taxi_cents'], 6500)
        self.assertEqual(airport['taxi_cents'] - airport['cents'], 3700)
        self.assertTrue(airport['taxi_sources'])

    def test_default_totals_match_documented_two_person_budgets(self):
        expected = [11000, 24630, 23310, 23220, 25820, 21310, 20130, 15420]
        totals = [sum(i['cents'] for i in day['items']
                      if not i.get('optional') or i['included'])
                  for day in self.data['days'].values()]
        self.assertEqual(totals, expected)
        self.assertEqual(sum(totals), 164840)
        readme = (ROOT / 'README.md').read_text()
        for value in expected + [sum(expected), sum(expected) + 3700]:
            self.assertIn(f'€{value / 100:,.2f}', readme)

    def test_published_menu_arithmetic_and_optional_defaults(self):
        items = {i['id']: i for day in self.data['days'].values() for i in day['items']}
        self.assertEqual(items['okdongsik']['cents'], 5000)
        self.assertEqual(items['okdongsik']['status'], 'estimate')
        self.assertEqual(items['monday-dinner']['cents'], 7000)
        self.assertEqual(items['monday-dinner']['status'], 'estimate')
        self.assertEqual(items['deux-magots']['cents'], 2 * 1400)
        self.assertEqual(items['giverny-shuttle']['cents'], 2 * 1000)
        included = {i['id'] for i in items.values() if i.get('optional') and i['included']}
        self.assertEqual(included, {'evolution', 'pleincoeur', 'gelato'})

    def test_pass_comparison_uses_only_covered_visits_and_does_not_double_bill_delacroix(self):
        items = {i['id']: i for day in self.data['days'].values() for i in day['items']}
        covered = ['louvre', 'orsay', 'orangerie', 'chapelle', 'rodin', 'delacroix']
        individual = sum(items[key]['cents'] for key in covered)
        self.assertEqual(individual, 19300)
        comparison = {attrs['data-pass-comparison']: int(attrs['data-cents'])
                      for _, attrs in Nodes(self.html).nodes if 'data-pass-comparison' in attrs}
        self.assertEqual(comparison, {'individual': individual, 'pmp': 2 * 10500})
        self.assertEqual(comparison['pmp'] - comparison['individual'], 1700)

    def test_orsay_pass_slot_is_distinguished_from_non_reserved_museums(self):
        orsay = re.search(r'data-label="오르세 미술관"[\s\S]*?</button>', self.html)[0]
        self.assertIn('Paris Museum Pass도 무료 시간 슬롯 예약 필수', orsay)
        self.assertIn('Carte Blanche 일반 관람은 시간 예약 면제', orsay)
        for museum in ['들라크루아 미술관', '로댕 미술관']:
            stop = re.search(r'data-label="'+museum+r'"[\s\S]*?</button>', self.html)[0]
            self.assertIn('PMP 시간 예약 불필요', stop)

    def test_meals_are_not_omitted_or_prepurchased_twice(self):
        for key, day in self.data['days'].items():
            meals = [item['meal'] for item in day['items'] if item.get('meal')]
            expected = ['dinner'] if key == 'p1' else ['breakfast', 'lunch', 'dinner']
            self.assertCountEqual(meals, expected, key)
        for key in ['p2', 'p5']:
            breakfast = next(i for i in self.data['days'][key]['items'] if i.get('meal') == 'breakfast')
            self.assertEqual(breakfast['cents'], 0)
            self.assertIn('장보기', breakfast['basis'])

if __name__ == '__main__':
    unittest.main()
