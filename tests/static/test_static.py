"""LS-100 source/offer regression checks. Pure stdlib; no client data or external calls."""
import re
import unittest
from pathlib import Path
from html.parser import HTMLParser
ROOT = Path(__file__).resolve().parents[2]
class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags=[]
        self.ids=[]
        self.links=[]
        self.scripts=[]
        self.attrs=[]
    def handle_starttag(self, tag, attrs):
        a=dict(attrs);self.tags.append(tag);self.attrs.append((tag,a))
        if 'id' in a:self.ids.append(a['id'])
        if tag=='a':self.links.append(a.get('href',''))
        if tag=='script':self.scripts.append(a.get('src',''))
class StaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text=(ROOT/'index.html').read_text(encoding='utf-8')
        cls.page=Page();cls.page.feed(cls.text)
        cls.js=(ROOT/'assets/js/site.js').read_text(encoding='utf-8')
        cls.config=(ROOT/'assets/js/config.js').read_text(encoding='utf-8')
        cls.css=(ROOT/'assets/css/site.css').read_text(encoding='utf-8')
    def test_unique_ids(self):self.assertEqual(len(self.page.ids),len(set(self.page.ids)))
    def test_local_anchor_targets(self):
        for href in self.page.links:
            if href.startswith('#'): self.assertIn(href[1:],self.page.ids)
    def test_only_external_scripts_are_local_files(self):
        self.assertEqual(self.page.scripts,['assets/js/config.js?v=ls100-20260906','assets/js/site.js?v=ls100-20260906'])
        for src in self.page.scripts:self.assertTrue((ROOT/src.split('?')[0]).is_file())
    def test_no_public_form_or_iframe(self):
        for tag in ['form','input','textarea','iframe','video','audio']:self.assertNotIn(tag,self.page.tags)
    def test_no_inline_script_or_event_handlers(self):
        self.assertNotIn('',self.page.scripts)
        for _,a in self.page.attrs:
            for k in a:self.assertFalse(k.startswith('on'),k)
    def test_bilingual_semantics(self):
        self.assertIn('lang="he" dir="rtl"',self.text)
        self.assertIn('lang="en" dir="ltr"',self.text)
        self.assertEqual(self.text.count('data-page-locale='),2)
    def test_exact_fees(self):
        self.assertEqual(self.text.count('₪550'),2)
        self.assertEqual(self.text.count('₪2,200'),2)
        self.assertNotIn('₪450',self.text)
    def test_fee_is_after_approach_in_both_languages(self):
        for lang in ['he','en']:
            self.assertLess(self.text.index(f'id="questions-{lang}"'),self.text.index(f'id="fees-{lang}"'))
    def test_no_obsolete_price(self):
        for value in ['10,600','10,800','12,000','masterclass.html','apply.html','forms.js','GHL','gtag(','fbq(','googletagmanager']:
            self.assertNotIn(value,self.text+self.js)
    def test_no_sensitive_prefill_or_analytics(self):
        self.assertNotIn('?text=',self.js)
        for value in ['localStorage','sessionStorage','document.cookie','fetch(','XMLHttpRequest','sendBeacon']:
            self.assertNotIn(value,self.js)
    def test_no_external_requests_in_markup(self):
        for _,a in self.page.attrs:
            for k in ['src','href']:
                self.assertFalse(a.get(k,'').startswith(('https:','http:','//','data:')))
    def test_preview_noindex(self):self.assertIn('content="noindex, nofollow"',self.text)
    def test_csp_blocks_connections_and_forms(self):
        self.assertIn("connect-src 'none'",self.text)
        self.assertIn("form-action 'none'",self.text)
    def test_keyboard_and_reduced_motion(self):
        self.assertIn(':focus-visible',self.css)
        self.assertIn('prefers-reduced-motion:reduce',self.css)
        self.assertIn('class="skip-link"',self.text)
    def test_twelve_attended_and_four_week_summary(self):
        self.assertIn('Twelve attended meetings',self.text)
        self.assertIn('four-week calendar periods',self.text)
        self.assertIn('12 פגישות שהתקיימו',self.text)
    def test_notice_and_no_auto_debt(self):
        self.assertIn('at least 24 hours',self.text)
        self.assertIn('no automatic renewal',self.text)
        self.assertIn('24 שעות',self.text)
    def test_no_child_device(self):
        self.assertIn('Your child does not need an account or a phone',self.text)
    def test_review_is_not_observation(self):self.assertIn('witnessed or verified',self.text)
    def test_rtl_age_range_is_isolated(self):
        self.assertIn('בגילאי <bdi dir="ltr">8–12</bdi>',self.text)
    def test_current_identity(self):
        self.assertIn('Shlomo Dratler',self.text)
        self.assertIn('שלמה דרטלר',self.text)
        self.assertNotIn('Drautler',self.text)
        self.assertNotIn('Rabbi',self.text)
    def test_owner_approved_outcome_language(self):
        self.assertIn('Emotional Therapy for Boys Ages 8–12',self.text)
        self.assertIn('Clear communication.',self.text)
        self.assertIn('Handling frustration.',self.text)
        self.assertIn('Strong social skills.',self.text)
        self.assertIn('Practical tools for implementation at home.',self.text)
        self.assertIn('טיפול רגשי לבנים בגילאי <bdi dir="ltr">8–12</bdi>',self.text)
        self.assertIn('תקשורת ברורה.',self.text)
        self.assertIn('התמודדות עם תסכול.',self.text)
        self.assertIn('כישורים חברתיים חזקים.',self.text)
        self.assertIn('כלים מעשיים ליישום בבית.',self.text)
    def test_no_fixed_location_claim(self):
        for value in ['Beit Shemesh','בית שמש']:
            self.assertNotIn(value,self.text+self.js)
        self.assertIn('Families may inquire from any area.',self.text)
        self.assertIn('אפשר לפנות מכל אזור',self.text)
    def test_verified_public_configuration(self):
        self.assertIn('whatsappNumber: "972534932631"',self.config)
        self.assertIn('whatsappVerified: true',self.config)
        self.assertIn('locationVerified: true',self.config)
        self.assertIn('legalReviewApproved: true',self.config)
        self.assertIn('publicationApproved: true',self.config)
    def test_images_never_have_blank_src(self):
        for tag,a in self.page.attrs:
            if tag=='img':self.assertNotIn('src',a)
if __name__=='__main__': unittest.main(verbosity=2)
