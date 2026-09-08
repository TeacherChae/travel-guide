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
        self.assertEqual(by_id['marmottan']['cents'], 2900)
        self.assertEqual(by_id['monet']['cents'], 2700)
        self.assertNotIn('피카소', [item['name'] for item in items])
        self.assertTrue(by_id['impressionisms']['included'])
        self.assertEqual(by_id['orsay']['cents'], 0)
        self.assertEqual(by_id['orsay']['standalone_cents'], 3200)
        self.assertNotEqual(by_id['orsay']['status'], 'free')
        self.assertEqual(by_id['orangerie']['cents'], 0)
        self.assertEqual(by_id['orangerie']['standalone_cents'], 2500)
        self.assertNotEqual(by_id['orangerie']['status'], 'free')
        self.assertEqual(by_id['chapelle']['cents'], 4400)

    def test_carte_blanche_is_the_selected_plan_and_paid_once_on_first_visit(self):
        self.assertEqual(self.data['admission_plan'], 'carte-blanche-jeunes-duo')
        membership = [
            item
            for day in self.data['days'].values()
            for item in day['items']
            if item['id'] == 'carte-blanche-jeunes-duo'
        ]
        self.assertEqual(len(membership), 1)
        self.assertEqual(self.data['days']['p2']['items'].count(membership[0]), 1)
        self.assertEqual(membership[0]['cents'], 4000)
        self.assertEqual(membership[0].get('purchase_status'), 'planned')
        self.assertFalse(membership[0].get('optional', False))
        self.assertNotIn('carte-blanche-jeunes-duo', [
            item['id']
            for key, day in self.data['days'].items()
            if key != 'p2'
            for item in day['items']
        ])

        for key, standalone in [('orangerie', 2500), ('orsay', 3200)]:
            item = next(
                item
                for day in self.data['days'].values()
                for item in day['items']
                if item['id'] == key
            )
            self.assertEqual(item['cents'], 0)
            self.assertEqual(item['standalone_cents'], standalone)
            self.assertNotEqual(item['status'], 'free')
            self.assertRegex(item['basis'], r'Carte Blanche|조건')

        for label in ['오랑주리', '오르세 미술관']:
            stop = re.search(r'data-label="' + label + r'"[\s\S]*?</button>', self.html)[0]
            self.assertRegex(stop, r'Carte Blanche|청년 Duo')
            self.assertRegex(stop, r'예약 (면제|불필요)')

        pass_panel = re.search(r'<section class="panel" id="pc"[\s\S]*?</section>', self.html)[0]
        rows = re.findall(r'<tr>[\s\S]*?</tr>', pass_panel)
        selected_rows = [row for row in rows if 'data-pass-comparison="selected"' in row]
        self.assertEqual(len(selected_rows), 1)
        self.assertIn('Carte Blanche Jeunes Duo', selected_rows[0])
        self.assertNotIn('PMP', selected_rows[0])

    def test_prep_and_handoff_docs_do_not_claim_notion_sync_completed(self):
        prep = ROOT / 'docs' / 'predeparture-checklist.md'
        handoff = ROOT / 'docs' / 'notion-sync-handoff.md'
        self.assertTrue(prep.is_file())
        self.assertTrue(handoff.is_file())
        prep_text = prep.read_text()
        handoff_text = handoff.read_text()
        self.assertRegex(prep_text, r'Carte Blanche|카르트 블랑슈')
        self.assertRegex(prep_text, r'여권|나이|Wallet|지갑')
        self.assertRegex(handoff_text, r'(?i)OAuth|blocked|차단|미완료|수동')
        for false_claim in [
            '노션 동기화 완료',
            'Notion sync complete',
            'Notion synchronized successfully',
            'Notion sync succeeded',
        ]:
            self.assertNotIn(false_claim.casefold(), handoff_text.casefold())

    def test_transit_baseline_and_taxi_are_alternatives(self):
        airport = self.data['days']['p1']['items'][0]
        self.assertEqual(airport['id'], 'arrival')
        self.assertEqual(airport['cents'], 2800)
        self.assertEqual(airport['taxi_cents'], 6500)
        self.assertEqual(airport['taxi_cents'] - airport['cents'], 3700)
        self.assertTrue(airport['taxi_sources'])

    def test_default_totals_match_documented_two_person_budgets(self):
        expected = [11000, 26230, 23310, 19510, 28320, 21310, 20130, 15420]
        totals = [sum(i['cents'] for i in day['items']
                      if not i.get('optional') or i['included'])
                  for day in self.data['days'].values()]
        self.assertEqual(totals, expected)
        self.assertEqual(sum(totals), 165230)
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
        self.assertEqual(included, {'evolution', 'pleincoeur', 'gelato', 'impressionisms'})

    def test_pass_comparison_uses_only_covered_visits_and_does_not_double_bill_delacroix(self):
        items = {i['id']: i for day in self.data['days'].values() for i in day['items']}
        covered = ['louvre', 'orsay', 'orangerie', 'chapelle', 'rodin', 'delacroix']
        individual = sum(items[key].get('standalone_cents', items[key]['cents']) for key in covered)
        self.assertEqual(individual, 19300)
        comparison = {attrs['data-pass-comparison']: int(attrs['data-cents'])
                      for _, attrs in Nodes(self.html).nodes if 'data-pass-comparison' in attrs}
        self.assertEqual(comparison, {'individual': individual, 'selected': 17600, 'pmp': 2 * 10500})
        self.assertEqual(comparison['pmp'] - comparison['individual'], 1700)

    def test_carte_blanche_access_is_distinguished_from_other_museum_conditions(self):
        orsay = re.search(r'data-label="오르세 미술관"[\s\S]*?</button>', self.html)[0]
        self.assertNotIn('Paris Museum Pass도 무료 시간 슬롯 예약 필수', orsay)
        self.assertIn('Carte Blanche 일반 관람은 시간 예약 면제', orsay)
        rodin = re.search(r'data-label="로댕 미술관"[\s\S]*?</button>', self.html)[0]
        self.assertIn('Carte Blanche 입장 미포함', rodin)
        delacroix = re.search(r'data-label="들라크루아 미술관"[\s\S]*?</button>', self.html)[0]
        self.assertIn('루브르', delacroix)
        self.assertIn('무료 미술관은 아닙니다', delacroix)

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
