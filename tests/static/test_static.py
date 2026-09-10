"""WEB-020 bilingual teal-release regression checks (stdlib only)."""
import hashlib
import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.ids = []
        self.scripts = []
        self.attrs = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        self.tags.append(tag)
        self.attrs.append((tag, values))
        if "id" in values:
            self.ids.append(values["id"])
        if tag == "script":
            self.scripts.append(values.get("src", ""))


class StaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.page = Page()
        cls.page.feed(cls.text)
        cls.react = (ROOT / "src/life-skills-page.jsx").read_text(encoding="utf-8")
        cls.bundle = (ROOT / "assets/js/site-react.js").read_text(encoding="utf-8")
        cls.config = (ROOT / "assets/js/config.js").read_text(encoding="utf-8")
        cls.css = (ROOT / "assets/css/site.css").read_text(encoding="utf-8")
        cls.copy = json.loads((ROOT / "website/redesign-copy.json").read_text(encoding="utf-8"))

    def test_unique_shell_ids(self):
        self.assertEqual(len(self.page.ids), len(set(self.page.ids)))

    def test_local_anchor_targets(self):
        for target in ["teaching", "founder", "faq", "contact"]:
            self.assertIn('id={`' + target + '-${locale}`}', self.react)

    def test_scripts_are_local_files(self):
        self.assertEqual([s.split("?")[0] for s in self.page.scripts], ["assets/js/config.js", "assets/js/site-react.js"])
        for src in self.page.scripts:
            self.assertTrue((ROOT / src.split("?")[0]).is_file())

    def test_no_public_form_or_embed(self):
        for tag in ["form", "input", "textarea", "iframe", "video", "audio"]:
            self.assertNotIn(tag, self.page.tags)

    def test_no_inline_script_or_event_handlers(self):
        self.assertNotIn("", self.page.scripts)
        for _, attrs in self.page.attrs:
            for key in attrs:
                self.assertFalse(key.startswith("on"), key)

    def test_bilingual_semantics_and_copy_source(self):
        self.assertIn("from '../website/redesign-copy.json'", self.react)
        self.assertIn("const redesignCopy = {contact: contactCopy, en: englishCopy, he: hebrewCopy}", self.react)
        self.assertIn("document.documentElement.lang = locale", self.react)
        self.assertEqual(self.copy["he"]["direction"], "rtl")
        self.assertEqual(self.copy["en"]["direction"], "ltr")

    def test_approved_hero_and_brand(self):
        self.assertEqual(self.copy["he"]["hero"]["headline"], "בכל ילד יש גיבור.")
        self.assertEqual(self.copy["en"]["hero"]["headline"], "There’s a hero in every child.")
        self.assertEqual(self.copy["he"]["brand"]["tagline"], "לחיים שלמים")
        self.assertIsNone(self.copy["en"]["brand"]["tagline"])
        self.assertIn("images/LS_LOGO_HE_LEAF_APPROVED_20260910-transparent.png", self.react)
        master = ROOT / "assets/images/LS_LOGO_HE_LEAF_APPROVED_20260910.png"
        self.assertEqual(hashlib.sha256(master.read_bytes()).hexdigest(), "a95609b2ce76f5062be6619e5131430f11b99d7579148affebb2b545f66cc07c")
        self.assertTrue((ROOT / "assets/images/LS_LOGO_HE_LEAF_APPROVED_20260910-transparent.png").is_file())
        self.assertNotIn("v43-approved-twig.png", self.react)
        self.assertNotIn("section.link", self.react)

    def test_twelve_modules_are_accessible_ordered_carousel(self):
        for locale in ["he", "en"]:
            modules = self.copy[locale]["teaching"]["modules"]
            self.assertEqual(len(modules), 12)
            self.assertEqual([m["internal_theme_key"] for m in modules], [f"W{i:02d}" for i in range(1, 13)])
            for module in modules:
                self.assertEqual(len(module["bullets"]), 2)
                self.assertTrue(module["title"])
                self.assertTrue(module["example"])
        self.assertNotIn("theme-disclosure", self.react)
        self.assertNotIn('<details className="curriculum', self.react)
        self.assertIn("function CurriculumCarousel", self.react)
        self.assertIn("modules.map", self.react)
        self.assertIn('aria-roledescription="carousel"', self.react)
        self.assertIn("scroll-snap-type:x mandatory", self.css)
        self.assertIn("prefers-reduced-motion: reduce", self.react)
        self.assertNotIn("autoplay", (self.react + self.css).lower())
        self.assertIn("data-theme-key={key}", self.react)

    def test_required_method_language(self):
        combined = json.dumps(self.copy, ensure_ascii=False).lower()
        for phrase in ["self-determination theory", "mindfulness", "meditation", "disagreeing respectfully", "sodas", "ifs", "cbt", "קשיבות", "מדיטציה", "לא להסכים בכבוד"]:
            self.assertIn(phrase, combined)

    def test_price_only_in_faq_source(self):
        for locale in ["he", "en"]:
            whole = json.dumps(self.copy[locale], ensure_ascii=False)
            faq = json.dumps(self.copy[locale]["faq"], ensure_ascii=False)
            self.assertEqual(whole.count("2,200"), faq.count("2,200"))
            self.assertNotIn("550", faq)
            self.assertNotIn("60-minute", faq)
            self.assertNotIn("60 דקות", faq)
        self.assertNotIn("price-card", self.react + self.css)

    def test_current_terms_and_location(self):
        combined = self.react + json.dumps(self.copy, ensure_ascii=False)
        for phrase in ["After 12 attended sessions", "12 מפגשים", "at least 24 hours", "24 שעות", "מפגשים במרכז הארץ", "Meetings in central Israel"]:
            self.assertIn(phrase, combined)
        self.assertNotIn("Beit Shemesh", combined)
        self.assertNotIn("בית שמש", combined)

    def test_verified_contact_and_real_links(self):
        for phrase in ['whatsappNumber: "972534932631"', "whatsappVerified: true", "locationVerified: true", "legalReviewApproved: true", "publicationApproved: true"]:
            self.assertIn(phrase, self.config)
        self.assertEqual(self.copy["contact"]["whatsapp_url"], "https://wa.me/972534932631")
        self.assertEqual(self.copy["en"]["footer"]["phone_href"], "tel:+972534932631")

    def test_all_referenced_images_exist(self):
        module_block = self.react.split("const MODULE_ALTS", 1)[0]
        mapping = dict(re.findall(r"(W\d{2}): '([^']+)'", module_block))
        self.assertEqual(len(mapping), 12)
        for src in set(mapping.values()):
            self.assertTrue((ROOT / "assets" / src).is_file(), src)
        for name in ["founder-boy-hero-desktop.webp", "founder-boy-hero-mobile.webp", "founder-grass-group.webp", "l-bars-2024.png", "meir-bunny.png", "bna-logo-nobg.png", "LS_LOGO_HE_LEAF_APPROVED_20260910.png", "LS_LOGO_HE_LEAF_APPROVED_20260910-transparent.png"]:
            self.assertTrue((ROOT / "assets/images" / name).is_file(), name)

    def test_v455_fonts_and_visual_copy_are_real(self):
        for name in ["FrankRuhlLibre-wght.ttf", "Heebo-wght.ttf", "OFL-Frank-Ruhl-Libre.txt", "OFL-Heebo.txt"]:
            self.assertTrue((ROOT / "assets/fonts" / name).is_file(), name)
        self.assertIn('@font-face{font-family:"Frank Ruhl Libre"', self.css)
        self.assertIn('@font-face{font-family:"Heebo"', self.css)
        self.assertEqual(self.copy["he"]["hero"]["service_title"], "טיפול רגשי לבנים")
        self.assertEqual(self.copy["he"]["teaching"]["eyebrow"], "12 מפגשים אישיים")
        self.assertEqual(self.copy["he"]["teaching"]["heading"], "כישורים לחיים.")
        self.assertEqual(self.copy["en"]["teaching"]["heading"], "Skills for life.")
        self.assertNotIn("flow", self.copy["he"]["teaching"]["approach_intro"])
        self.assertNotIn("flow", self.copy["en"]["teaching"]["approach_intro"])
        self.assertIn("section.principles.map", self.react)
        self.assertIn("c.teaching.intro_support", self.react)
        self.assertNotIn("section.flow", self.react)

    def test_approach_band_uses_requested_real_photo(self):
        self.assertIn('url("../images/meir-bunny.png")', self.css)
        self.assertIn("linear-gradient(118deg,rgba(22,63,72,.72),rgba(36,81,89,.58))", self.css)
        self.assertIn("border:2px solid var(--gold)", self.css)
        self.assertIn("border-radius:32px", self.css)
        for phrase in ["section.feature.sodas_steps", "section.feature.frustration_steps", "section.principles.map"]:
            self.assertIn(phrase, self.react)

    def test_locked_teal_system_and_mobile_geometry(self):
        for token in ["--teal:#245159", "--deep-teal:#163F48", "--cream:#FBF7EF", "--gold:#E6D0A4"]:
            self.assertIn(token, self.css)
        for geometry in ["min-height:98px", "padding-inline:22px", "width:170px", "font-size:64px", "line-height:66px", "width:72px", "min-height:56px"]:
            self.assertIn(geometry, self.css)
        self.assertIn("opacity:.72", self.css)
        self.assertIn("opacity:.32", self.css)
        self.assertNotIn("#153E2C", self.css)

    def test_mobile_menu_and_real_ctas(self):
        self.assertIn('aria-expanded={menuOpen}', self.react)
        self.assertIn('aria-controls="mobile-menu"', self.react)
        self.assertIn("event.key === 'Escape'", self.react)
        self.assertIn("https://wa.me/972534932631", self.copy["contact"]["whatsapp_url"])
        self.assertEqual(self.copy["he"]["cta"]["button"], "לתיאום פגישה בוואטסאפ")
        self.assertEqual(self.copy["en"]["cta"]["button"], "Arrange an appointment on WhatsApp")

    def test_about_copy_and_claim_boundary(self):
        self.assertEqual(self.copy["he"]["founder"]["name"], "על שלמה דרטלר")
        self.assertEqual(self.copy["en"]["founder"]["name"], "About Shlomo Dratler")
        self.assertEqual(len(self.copy["he"]["founder"]["paragraphs"]), 3)
        self.assertEqual(len(self.copy["en"]["founder"]["paragraphs"]), 3)
        self.assertEqual(len(self.copy["he"]["founder"]["capabilities"]), 3)
        self.assertEqual(len(self.copy["en"]["founder"]["capabilities"]), 3)
        self.assertIn("object-position:66% 50%", self.css)
        combined = json.dumps(self.copy, ensure_ascii=False).lower()
        for forbidden in ["completely reversed social anxiety", "healed trauma", "cured", "success percentage"]:
            self.assertNotIn(forbidden, combined)

    def test_private_testimonial_and_floating_whatsapp(self):
        component = (ROOT / "src/FloatingWhatsAppButton.jsx").read_text(encoding="utf-8")
        self.assertIn("https://wa.me/972534932631", component)
        self.assertIn("FloatingWhatsAppButton", self.react)
        self.assertIn("Medication is no longer relevant…", self.react)
        self.assertIn("<cite>LB</cite><time dateTime=\"2024\">2024</time>", self.react)
        self.assertIn("privateTestimonialPreview: true", self.config)
        self.assertIn("testimonialConsentOwnerConfirmed: true", self.config)
        self.assertIn('testimonialConsentReference: "LS-LB-CONSENT-20260909-001"', self.config)
        self.assertIn(".floating-whatsapp[hidden]{display:none}", self.css)
        self.assertNotIn("L Bars", self.react)

    def test_icons_are_real_svg_exports(self):
        expected = ["self-governance.svg", "emotional-regulation.svg", "responsibility.svg", "parent-guidance.svg"]
        for name in expected:
            self.assertIn(name, self.react)
            svg = (ROOT / "assets/icons" / name).read_text(encoding="utf-8")
            self.assertIn("<svg", svg)
            self.assertNotIn("<text", svg)

    def test_founder_and_exact_nonprofit_footer(self):
        self.assertIn("images/founder-grass-group.webp", self.react)
        self.assertIn("founder-boy-hero-desktop.webp", self.react)
        self.assertEqual(self.copy["en"]["footer"]["relationship"], "Life Skills is a project of Bnei Neviim Academy, a New Jersey nonprofit supporting Jewish children’s emotional and educational development, autonomy and self-directed growth.")
        self.assertNotIn("LLC", json.dumps(self.copy))

    def test_centered_closing_and_footer(self):
        self.assertEqual(self.copy["he"]["closing_cta"]["heading"], "לקביעת פגישה")
        self.assertEqual(self.copy["en"]["closing_cta"]["heading"], "Arrange an appointment")
        self.assertIn("closing-inner", self.css)
        self.assertIn("text-align:center", self.css)
        self.assertIn("max-width:640px", self.css)
        self.assertIn('className="footer-whatsapp"', self.react)
        self.assertIn('className="footer-phone"', self.react)

    def test_requested_components_are_rendered(self):
        for name in ["CampaignHero", "OutcomeCards", "CurriculumModule", "ModuleImageGallery", "OrganicBulletList", "FounderSection", "FAQAccordion"]:
            self.assertIn(f"function {name}", self.react)
        self.assertGreater(len(self.bundle), 50000)

    def test_accessibility_controls(self):
        self.assertIn(":focus-visible", self.css)
        self.assertIn("prefers-reduced-motion:reduce", self.css)
        self.assertIn('className="skip-link"', self.react)
        self.assertIn("aria-current", self.react)
        self.assertIn('bdi dir="ltr"', self.react)

    def test_preview_security(self):
        self.assertIn('content="noindex, nofollow"', self.text)
        self.assertIn("connect-src 'none'", self.text)

    def test_production_hides_review_banner_and_keeps_owner_confirmed_testimonial(self):
        self.assertIn("reviewPreview: true", self.config)
        self.assertIn("reviewPreview ?", self.react)
        self.assertIn("form-action 'none'", self.text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
