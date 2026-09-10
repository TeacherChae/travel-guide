"""The single embedded ledger must cover the trip without double billing."""
import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]

class Nodes(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.nodes = []
        self._scenario_stack = [None]
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        inherited = self._scenario_stack[-1]
        current = attrs.get('data-rodin-only', inherited)
        attrs['_rodin_only'] = current
        self.nodes.append((tag, attrs))
        self._scenario_stack.append(current)
    def handle_endtag(self, tag):
        if len(self._scenario_stack) > 1:
            self._scenario_stack.pop()

class BudgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / 'index.html').read_text()
        match = re.search(r'<script type="application/json" id="daily-budget-data">([\s\S]*?)</script>', cls.html)
        if not match:
            raise AssertionError('Missing single-source daily budget ledger')
        cls.data = json.loads(match[1])

    def scenario_total(self, scenario):
        totals = []
        for day in self.data['days'].values():
            total = 0
            for item in day['items']:
                if item.get('rodin_day') and item['rodin_day'] != scenario:
                    continue
                if item.get('optional') and not item.get('included'):
                    continue
                total += item['cents']
            totals.append(total)
        return totals

    def test_eight_days_and_two_adults(self):
        self.assertEqual(self.data['people'], 2)
        self.assertEqual(self.data['currency'], 'EUR')
        self.assertEqual(self.data['rodin_plan'], 'friday')
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
                self.assertIn(item['status'], ['verified', 'estimate', 'free', 'excluded', 'paid'])
                if item['status'] == 'verified':
                    self.assertTrue(item.get('sources'))
                for source in item.get('sources', []):
                    evidence = self.data['sources'][source]
                    self.assertTrue(evidence['url'].startswith('https://'))
                    self.assertRegex(evidence['checked_on'], r'^\d{4}-\d{2}-\d{2}$')
        self.assertEqual(len(ids), len(set(ids)))

    def test_default_scenario_mapped_places_and_dining_have_one_budget_entry(self):
        for key, day in self.data['days'].items():
            panel = re.search(r'<section class="panel" id="'+key+r'"[\s\S]*?</section>', self.html)[0]
            places = []
            for _, attrs in Nodes(panel).nodes:
                if attrs.get('_rodin_only') not in (None, 'friday'):
                    continue
                if attrs.get('data-label') and 'stop' in attrs.get('class', '').split():
                    places.append(attrs['data-label'])
                if attrs.get('data-dining'):
                    places.append(attrs['data-dining'])
            assigned = [
                item['place'] for item in day['items']
                if item.get('place') and item.get('rodin_day') in (None, 'friday')
            ]
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

    def test_carte_blanche_is_selected_and_paid_once_on_first_use(self):
        self.assertEqual(self.data['admission_plan'], 'carte-blanche-jeunes-duo')
        membership = [
            item
            for day in self.data['days'].values()
            for item in day['items']
            if item['id'] == 'carte-blanche-jeunes-duo'
        ]
        self.assertEqual(len(membership), 1)
        self.assertEqual(self.data['days']['p3']['items'].count(membership[0]), 1)
        self.assertEqual(membership[0]['cents'], 4000)
        self.assertEqual(membership[0].get('purchase_status'), 'planned')
        self.assertFalse(membership[0].get('optional', False))
        self.assertNotIn('carte-blanche-jeunes-duo', [
            item['id']
            for key, day in self.data['days'].items()
            if key != 'p3'
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

    def test_cruise_purchase_is_paid_in_krw_without_eur_fx_or_double_count(self):
        cruise = next(
            item
            for day in self.data['days'].values()
            for item in day['items']
            if item['id'] == 'cruise'
        )
        self.assertEqual(cruise['status'], 'paid')
        self.assertEqual(cruise['purchase_status'], 'paid')
        self.assertEqual(cruise['paid_currency'], 'KRW')
        self.assertEqual(cruise['paid_amount'], 27052)
        self.assertEqual(cruise['purchase_source'], 'MyRealTrip')
        self.assertEqual(cruise['cents'], 0)
        self.assertEqual(cruise['range'], [0, 0])
        self.assertRegex(cruise['basis'], r'사용자 보고|2인|e-ticket|탑승')
        self.assertNotRegex(cruise['basis'], r'환율|FX|€27,052')
        self.assertEqual(
            sum(1 for day in self.data['days'].values() for item in day['items'] if item['id'] == 'cruise'),
            1,
        )

        sunday = re.search(r'<section class="panel" id="p2"[\s\S]*?</section>', self.html)[0]
        self.assertIn('MyRealTrip', sunday)
        self.assertIn('₩27,052', sunday)
        self.assertNotRegex(sunday, r'크루즈[\s\S]{0,80}€0')
        self.assertIn('docs/flexible-rodin-plan.md', sunday)
        self.assertNotIn('docs/fete-schedule-proposal.md', sunday)
        info = re.search(r'<section class="panel" id="pi"[\s\S]*?</section>', self.html)[0]
        self.assertRegex(info, r'aria-checked="false"[^\n]+일요일 일반 유람선 바우처·탑승 조건 확인')

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



    def test_current_info_tab_uses_latest_schedule_dates(self):
        info = re.search(r'<section class="panel" id="pi"[\s\S]*?</section>', self.html)[0]
        self.assertIn('루브르 9/17 09:00 시간 지정권', info)
        self.assertIn('마르모탕 9/15 10:00 온라인 단독권', info)
        self.assertIn('생트샤펠 9/13 12:00 시간 지정권', info)
        self.assertIn('오랑주리·오르세', info)
        self.assertIn('월9/14 10:00', info)
        self.assertIn('화9/15 13:30', info)
        self.assertIn('로댕은 일요일 16:40 조건부 또는 금요일 14:00 기본안', info)
        self.assertIn('Le Florentin 보류', info)
        self.assertIn('진화 대전시실은 월요일 16:00', info)
        self.assertNotIn('진화과학박물관은 날짜 미정 후보', info)
        for stale in [
            '루브르 9/14 09:00',
            '마르모탕 9/13 15:30',
            '생트샤펠 9/17 10:00',
            '일13:00',
            'Le Florentin 일12:00',
            '진화과학박물관 목15:00',
        ]:
            self.assertNotIn(stale, info)

    def test_transport_budget_notes_follow_current_itinerary(self):
        items = {item['id']: item for day in self.data['days'].values()
                 for item in day['items']}
        for item_id, cents in [('monday-metro', 1530), ('tuesday-metro', 1530),
                               ('thursday-metro', 510)]:
            self.assertEqual(items[item_id]['cents'], cents)
            self.assertEqual(items[item_id]['range'], [cents, cents])
        self.assertIn('숙소→오랑주리', items['monday-metro']['basis'])
        self.assertNotIn('생트샤펠', items['monday-metro']['basis'])
        self.assertIn('오르세→숙소', items['tuesday-metro']['basis'])
        self.assertNotIn('로댕', items['tuesday-metro']['basis'])
        self.assertIn('숙소→루브르', items['thursday-metro']['basis'])
        for stale in ['생트샤펠', '달리그르']:
            self.assertNotIn(stale, items['thursday-metro']['basis'])

    def test_current_guidance_links_not_old_handoff_or_fete_proposal(self):
        sunday = re.search(r'<section class="panel" id="p2"[\s\S]*?</section>', self.html)[0]
        self.assertIn('docs/flexible-rodin-plan.md', sunday)
        self.assertNotIn('docs/fete-schedule-proposal.md', sunday)
        info = re.search(r'<section class="panel" id="pi"[\s\S]*?</section>', self.html)[0]
        primary_card = re.search(r'<section class="panel" id="pi"[\s\S]*?<h3 class="sec">', self.html)[0]
        self.assertIn('docs/predeparture-checklist.md', primary_card)
        self.assertIn('docs/flexible-rodin-plan.md', primary_card)
        self.assertNotIn('docs/notion-sync-handoff.md', primary_card)
        self.assertNotRegex(info, r'Notion[^<]{0,40}(동기화|sync)')

    def test_pmp_inventory_is_reference_folded_without_losing_urls(self):
        panel = re.search(r'<section class="panel" id="ppass"[\s\S]*?</section>', self.html)[0]
        details = re.search(r'<details[^>]*data-pass-catalog[\s\S]*?</details>', panel)
        self.assertIsNotNone(details)
        self.assertNotIn(' open', details.group(0).split('>', 1)[0])
        rendered = re.findall(r'data-pass-site="([^"]+)"', panel)
        self.assertEqual(len(rendered), 55)
        self.assertEqual(len(set(rendered)), 55)
        before_details = panel[:details.start()]
        self.assertNotIn('data-pass-site=', before_details)

    def test_transit_baseline_and_taxi_are_alternatives(self):
        airport = self.data['days']['p1']['items'][0]
        self.assertEqual(airport['id'], 'arrival')
        self.assertEqual(airport['cents'], 2800)
        self.assertEqual(airport['taxi_cents'], 6500)
        self.assertEqual(airport['taxi_cents'] - airport['cents'], 3700)
        self.assertTrue(airport['taxi_sources'])

    def test_default_and_sunday_rodin_totals_match_scenario_budgets(self):
        default = [11000, 16820, 23330, 20630, 28320, 21110, 20930, 15420]
        sunday = [11000, 19620, 23330, 20630, 28320, 21110, 20130, 15420]
        self.assertEqual(self.scenario_total('friday'), default)
        self.assertEqual(self.scenario_total('sunday'), sunday)
        self.assertEqual(sum(default), 157560)
        self.assertEqual(sum(sunday), 159560)
        self.assertNotIn('scenarios', self.data)

    def test_monday_transport_budget_covers_every_rail_leg(self):
        panel = re.search(r'<section class="panel" id="p3"[\s\S]*?</section>', self.html)[0]
        rail_legs = [a for _, a in Nodes(panel).nodes
                     if a.get('class') == 'leg'
                     and parse_qs(urlparse(a['data-src']).query).get('dirflg') == ['r']]
        self.assertEqual(len(rail_legs), 3)
        metro = next(i for i in self.data['days']['p3']['items'] if i['id'] == 'monday-metro')
        self.assertEqual(metro['cents'], 255 * len(rail_legs) * self.data['people'])
        for leg in ['숙소→오랑주리', '퐁뇌프→진화 대전시실', '식물원→Bouillon Racine']:
            self.assertIn(leg, metro['basis'])

    def test_monday_museums_are_active_not_pending(self):
        items = self.data['days']['p3']['items']
        gallery = next(i for i in items if i['id'] == 'evolution-gallery')
        self.assertEqual(gallery['cents'], 1300 * self.data['people'])
        self.assertEqual(gallery['range'], [2600, 2600])
        self.assertIn('마지막 입장 17:00', gallery['basis'])
        for item_id in ['evolution-gallery', 'jardin-des-plantes']:
            self.assertEqual(sum(i['id'] == item_id for i in items), 1)
        self.assertEqual({i['id'] for i in self.data['pending']}, {'aligre', 'coulee', 'florentin'})

    def test_current_documents_match_monday_and_budget_totals(self):
        default = self.scenario_total('friday')
        sunday = self.scenario_total('sunday')
        for name in ['README.md', 'docs/flexible-rodin-plan.md']:
            text = (ROOT / name).read_text()
            monday = next(line for line in text.splitlines() if '9/14' in line and '오랑주리' in line)
            self.assertIn('진화 대전시실 16:00–17:30', monday, name)
            self.assertIn('식물원 17:30–17:50', monday, name)
            for cents in [default[2], sum(default), sum(default) + 3700,
                          sum(sunday), sum(sunday) + 3700]:
                self.assertIn(f'€{cents / 100:,.2f}', text, name)
        prep = (ROOT / 'docs/predeparture-checklist.md').read_text()
        self.assertIn('진화 대전시실 9/14 16:00', prep)
        self.assertNotRegex(prep, r'\[보류[^\n]*(?:GGE|식물원|진화)')

    def test_published_menu_arithmetic_and_optional_defaults(self):
        items = {i['id']: i for day in self.data['days'].values() for i in day['items']}
        self.assertEqual(items['okdongsik']['cents'], 5000)
        self.assertEqual(items['okdongsik']['status'], 'estimate')
        self.assertEqual(items['monday-dinner']['cents'], 7000)
        self.assertEqual(items['monday-dinner']['status'], 'estimate')
        self.assertEqual(items['deux-magots']['cents'], 2 * 1400)
        self.assertEqual(items['giverny-shuttle']['cents'], 2 * 1000)
        included = {i['id'] for i in items.values() if i.get('optional') and i['included']}
        self.assertEqual(included, {'pleincoeur', 'gelato', 'impressionisms'})

    def test_pass_comparison_uses_only_covered_visits_and_does_not_double_bill_delacroix(self):
        items = {i['id']: i for day in self.data['days'].values() for i in day['items']}
        covered = ['louvre', 'orsay', 'orangerie', 'chapelle', 'rodin-friday', 'delacroix']
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
