from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

HEAD = '''
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#173c2d">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Hebrew:wght@400;500;600;700;800&family=Noto+Serif+Hebrew:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/site.css">
<script src="assets/js/config.js"></script>
<script src="assets/js/site.js" defer></script>
<script src="assets/js/forms.js" defer></script>
'''

HEADER = '''
<a class="skip-link lang-en" href="#main">Skip to content</a>
<a class="skip-link lang-he" href="#main">דלגו לתוכן</a>
<header class="site-header">
  <div class="container nav-wrap">
    <a class="brand" href="index.html" aria-label="Inner Leadership home">
      <span class="brand-mark" aria-hidden="true">IL</span>
      <span>
        <span class="brand-name lang-en">Inner Leadership</span>
        <span class="brand-name lang-he">הנהגה מבפנים</span>
        <span class="brand-sub lang-en">Self-governance for boys</span>
        <span class="brand-sub lang-he">הנהגה עצמית לבנים</span>
      </span>
    </a>
    <nav class="nav-links" data-nav-links aria-label="Primary navigation">
      <a class="lang-en" href="index.html#outcomes">The Change</a>
      <a class="lang-he" href="index.html#outcomes">השינוי</a>
      <a class="lang-en" href="index.html#program">The Program</a>
      <a class="lang-he" href="index.html#program">התוכנית</a>
      <a class="lang-en" href="index.html#curriculum">Curriculum</a>
      <a class="lang-he" href="index.html#curriculum">תוכנית הלימודים</a>
      <a class="lang-en" href="index.html#about">About</a>
      <a class="lang-he" href="index.html#about">אודות</a>
    </nav>
    <div class="nav-actions">
      <button class="lang-toggle" type="button" data-language-toggle><span data-lang-label>עברית</span></button>
      <a class="btn btn-primary btn-sm lang-en" href="masterclass.html">Free masterclass</a>
      <a class="btn btn-primary btn-sm lang-he" href="masterclass.html?lang=he">שיעור חינם</a>
      <button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-label="Open menu"><span></span><span></span><span></span></button>
    </div>
  </div>
</header>
'''

FOOTER = '''
<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="brand" href="index.html">
          <span class="brand-mark" style="border-color:#f3ecdf;color:#f3ecdf" aria-hidden="true">IL</span>
          <span>
            <span class="brand-name lang-en">Inner Leadership</span>
            <span class="brand-name lang-he">הנהגה מבפנים</span>
            <span class="brand-sub lang-en">A 12-week program for boys ages 6–11</span>
            <span class="brand-sub lang-he">תוכנית בת 12 שבועות לבנים בגילאי 6–11</span>
          </span>
        </a>
        <p class="lang-en" style="margin-top:20px;max-width:500px">Helping boys develop the words, judgment and inner authority to lead themselves—and helping families feel the difference at home.</p>
        <p class="lang-he" style="margin-top:20px;max-width:500px">עוזרים לבנים לפתח שפה, שיקול דעת וסמכות פנימית כדי להנהיג את עצמם—ולמשפחות להרגיש את השינוי בבית.</p>
      </div>
      <div>
        <h4 class="lang-en">Explore</h4><h4 class="lang-he">מידע</h4>
        <a class="lang-en" href="masterclass.html">Free masterclass</a>
        <a class="lang-he" href="masterclass.html?lang=he">שיעור הורים חינם</a>
        <a class="lang-en" href="apply.html">Apply for the program</a>
        <a class="lang-he" href="apply.html?lang=he">הגשת מועמדות</a>
        <a class="lang-en" href="index.html#curriculum">Curriculum</a>
        <a class="lang-he" href="index.html#curriculum">תוכנית הלימודים</a>
      </div>
      <div>
        <h4 class="lang-en">Information</h4><h4 class="lang-he">מידע משפטי</h4>
        <a class="lang-en" href="privacy.html">Privacy</a>
        <a class="lang-he" href="privacy.html?lang=he">פרטיות</a>
        <a class="lang-en" href="terms.html">Terms & scope</a>
        <a class="lang-he" href="terms.html?lang=he">תנאים ותחום השירות</a>
        <a href="#" data-whatsapp-link>WhatsApp</a>
        <a href="#" data-contact-email></a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© <span data-year></span> <span class="lang-en">Inner Leadership. All rights reserved.</span><span class="lang-he">הנהגה מבפנים. כל הזכויות שמורות.</span></span>
      <span class="lang-en">Beit Shemesh, Israel · English & Hebrew</span>
      <span class="lang-he">בית שמש, ישראל · עברית ואנגלית</span>
    </div>
  </div>
</footer>
'''

SCHEMA = '''
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  "name": "Inner Leadership",
  "alternateName": "הנהגה מבפנים",
  "description": "A 12-week practical emotional-development and self-governance program for boys ages 6–11, offered in English and Hebrew.",
  "areaServed": "Israel",
  "availableLanguage": ["English", "Hebrew"],
  "founder": {"@type": "Person", "name": "Rabbi Shloimie Dratler"}
}
</script>
'''


def page(title_en, title_he, description, body, extra_head=""):
    return f'''<!doctype html>
<html lang="en" dir="ltr">
<head>
<title>{title_en} | Inner Leadership</title>
<meta name="description" content="{description}">
<meta property="og:title" content="{title_en} | Inner Leadership">
<meta property="og:description" content="{description}">
<meta property="og:type" content="website">
{HEAD}{extra_head}{SCHEMA}
</head>
<body>
{HEADER}
<main id="main">{body}</main>
{FOOTER}
</body>
</html>'''

HOME = r'''
<section class="hero">
  <div class="container hero-grid">
    <div class="hero-copy reveal">
      <span class="eyebrow lang-en">The 12-Week Self-Governance Program</span>
      <span class="eyebrow lang-he">תוכנית הנהגה עצמית בת 12 שבועות</span>
      <h1 class="lang-en">Raise a boy who can <em style="color:var(--forest);font-style:normal">lead himself.</em></h1>
      <h1 class="lang-he">לגדל ילד שיודע <em style="color:var(--forest);font-style:normal">להנהיג את עצמו.</em></h1>
      <p class="lead lang-en">The words begin to flow through the house. Your son can explain what he wants, hear another person, think through a problem and take responsibility for the life he is building.</p>
      <p class="lead lang-he">המילים מתחילות לזרום בבית. הבן שלכם יודע להסביר מה הוא רוצה, לשמוע אדם אחר, לחשוב דרך בעיה ולקחת אחריות על החיים שהוא בונה.</p>
      <div class="hero-actions">
        <a class="btn btn-clay btn-arrow lang-en" href="masterclass.html">Watch the free parent masterclass</a>
        <a class="btn btn-clay btn-arrow lang-he" href="masterclass.html?lang=he">צפו בשיעור ההורים החינמי</a>
        <a class="btn btn-outline lang-en" data-consultation-link href="apply.html">Apply for a parent conversation</a>
        <a class="btn btn-outline lang-he" data-consultation-link href="apply.html?lang=he">הגישו בקשה לשיחת הורים</a>
      </div>
      <div class="hero-proof">
        <span class="lang-en">Boys ages 6–11</span><span class="lang-he">לבנים בגילאי 6–11</span>
        <span class="lang-en">English & Hebrew</span><span class="lang-he">עברית ואנגלית</span>
        <span class="lang-en">12 weeks · limited enrollment</span><span class="lang-he">12 שבועות · מספר מקומות מוגבל</span>
      </div>
    </div>
    <div class="image-placeholder reveal" data-label-en="Replace with: father and son in open, natural conversation" data-label-he="להחליף בתמונה: אב ובן בשיחה פתוחה וטבעית">
      <span class="sketch-line" aria-hidden="true"></span>
    </div>
  </div>
</section>

<div class="promise-band">
  <div class="container promise-items">
    <span class="lang-en">Open dialogue</span><span class="lang-he">שיח פתוח</span>
    <span class="lang-en">Inner motivation</span><span class="lang-he">מוטיבציה פנימית</span>
    <span class="lang-en">Critical thinking</span><span class="lang-he">חשיבה ביקורתית</span>
    <span class="lang-en">Responsibility</span><span class="lang-he">אחריות</span>
    <span class="lang-en">Self-governance</span><span class="lang-he">הנהגה עצמית</span>
  </div>
</div>

<section class="section section-paper" id="outcomes">
  <div class="container">
    <div class="split">
      <div class="reveal">
        <span class="eyebrow lang-en">The feeling inside the family</span>
        <span class="eyebrow lang-he">התחושה בתוך המשפחה</span>
        <p class="statement lang-en">A family that can speak. A son who can think. A home where problems become <em>open dialogue instead of another fight.</em></p>
        <p class="statement lang-he">משפחה שיודעת לדבר. בן שיודע לחשוב. בית שבו בעיות הופכות ל־<em>שיח פתוח במקום לעוד מאבק.</em></p>
      </div>
      <div class="quote-panel reveal">
        <blockquote class="lang-en">“Feel proud to raise a leader—not because he controls other people, but because he is learning to take control of his own life.”</blockquote>
        <blockquote class="lang-he">״להרגיש גאווה לגדל מנהיג—לא מפני שהוא שולט באחרים, אלא מפני שהוא לומד לקחת אחריות על החיים שלו.״</blockquote>
        <p class="lang-en">That is the transformation this program is built to begin.</p>
        <p class="lang-he">זהו השינוי שהתוכנית נבנתה כדי להתחיל.</p>
      </div>
    </div>

    <div class="outcome-grid">
      <article class="outcome-card reveal" data-number="01"><div class="outcome-icon">↔</div><h3 class="lang-en">Communication</h3><h3 class="lang-he">תקשורת</h3><p class="lang-en">He learns to identify the result he wants from a conversation, find the words, hear another perspective and repair conflict.</p><p class="lang-he">הוא לומד לזהות מה הוא רוצה להשיג בשיחה, למצוא את המילים, לשמוע נקודת מבט אחרת ולתקן קונפליקט.</p></article>
      <article class="outcome-card reveal" data-number="02"><div class="outcome-icon">◎</div><h3 class="lang-en">Emotional regulation</h3><h3 class="lang-he">ויסות רגשי</h3><p class="lang-en">Regulation becomes something he experiences and practices—not another instruction somebody gives him when he is already overwhelmed.</p><p class="lang-he">ויסות הופך למשהו שהוא חווה ומתרגל—לא לעוד הוראה שמישהו נותן לו כשהוא כבר מוצף.</p></article>
      <article class="outcome-card reveal" data-number="03"><div class="outcome-icon">◇</div><h3 class="lang-en">Values & purpose</h3><h3 class="lang-he">ערכים ותכלית</h3><p class="lang-en">He begins to name what matters to him, picture the future he wants and translate values into goals and follow-through.</p><p class="lang-he">הוא מתחיל לנסח מה חשוב לו, לראות את העתיד שהוא רוצה ולתרגם ערכים למטרות ולביצוע.</p></article>
      <article class="outcome-card reveal" data-number="04"><div class="outcome-icon">S</div><h3 class="lang-en">Problem solving</h3><h3 class="lang-he">פתרון בעיות</h3><p class="lang-en">He learns to slow down, define the situation, see options, weigh consequences and test a solution.</p><p class="lang-he">הוא לומד להאט, להגדיר את המצב, לראות אפשרויות, לשקול השלכות ולבדוק פתרון.</p></article>
      <article class="outcome-card reveal" data-number="05"><div class="outcome-icon">↑</div><h3 class="lang-en">Confidence</h3><h3 class="lang-he">ביטחון עצמי</h3><p class="lang-en">Confidence grows from evidence: finishing, repairing, speaking clearly, tolerating discomfort and discovering that he can handle real life.</p><p class="lang-he">ביטחון נבנה מהוכחות: לסיים, לתקן, לדבר ברור, לשאת אי־נוחות ולגלות שהוא מסוגל להתמודד עם החיים.</p></article>
      <article class="outcome-card reveal" data-number="06"><div class="outcome-icon">IL</div><h3 class="lang-en">Self-governance</h3><h3 class="lang-he">הנהגה עצמית</h3><p class="lang-en">The growing ability to direct his choices, behavior, body and responsibilities from the inside.</p><p class="lang-he">היכולת ההולכת וגדלה לכוון מבפנים את הבחירות, ההתנהגות, הגוף והאחריות שלו.</p></article>
    </div>
  </div>
</section>

<section class="section" id="program">
  <div class="container">
    <div class="split reverse">
      <div class="image-placeholder reveal" data-label-en="Replace with: boys building one meaningful object together" data-label-he="להחליף בתמונה: בנים בונים יחד חפץ משמעותי אחד"><span class="sketch-line" aria-hidden="true"></span></div>
      <div class="reveal">
        <span class="eyebrow lang-en">Conversation becomes real life</span><span class="eyebrow lang-he">השיחה הופכת לחיים</span>
        <h2 class="lang-en">We do not only talk about growth. We create somewhere for it to happen.</h2>
        <h2 class="lang-he">אנחנו לא רק מדברים על צמיחה. אנחנו יוצרים מקום שבו היא יכולה לקרות.</h2>
        <p class="lead lang-en">The private meeting gives a boy language, clarity and a personal direction. The lab puts him beside other boys with one shared task. Now there is something worth communicating about. Somebody disagrees. Something breaks. The group needs a decision. A commitment has consequences.</p>
        <p class="lead lang-he">המפגש האישי נותן לילד שפה, בהירות וכיוון אישי. המעבדה מציבה אותו לצד בנים אחרים עם משימה משותפת אחת. עכשיו יש על מה לתקשר. מישהו לא מסכים. משהו נשבר. הקבוצה צריכה החלטה. להתחייבות יש השלכות.</p>
        <p class="lang-en"><strong>That is where self-governance becomes organic.</strong> He understands it, practices it, sees the outcome, reflects and tries again.</p>
        <p class="lang-he"><strong>שם ההנהגה העצמית נעשית אורגנית.</strong> הוא מבין, מתרגל, רואה את התוצאה, מתבונן ומנסה שוב.</p>
      </div>
    </div>

    <div class="process-grid">
      <article class="process-card reveal"><div class="process-num">1</div><h3 class="lang-en">One private meeting each week</h3><h3 class="lang-he">מפגש אישי אחד בכל שבוע</h3><p class="lang-en">Values, purpose, communication, relationships, choices, body awareness and the real situations of his week.</p><p class="lang-he">ערכים, תכלית, תקשורת, קשרים, בחירות, מודעות גופנית והמצבים האמיתיים של השבוע שלו.</p></article>
      <article class="process-card reveal"><div class="process-num">2</div><h3 class="lang-en">Two 90-minute applied labs</h3><h3 class="lang-he">שתי מעבדות יישומיות של 90 דקות</h3><p class="lang-en">Hands-on projects in small groups. Two compatible boys are enough to begin; the lab does not wait for a full class.</p><p class="lang-he">פרויקטים מעשיים בקבוצות קטנות. שני בנים מתאימים מספיקים כדי להתחיל; המעבדה לא מחכה לכיתה מלאה.</p></article>
      <article class="process-card reveal"><div class="process-num">3</div><h3 class="lang-en">Three parent strategy sessions</h3><h3 class="lang-he">שלוש פגישות אסטרטגיה להורים</h3><p class="lang-en">A concentrated crash course for both parents in agency, critical thinking, communication and transferring responsibility at home.</p><p class="lang-he">קורס מזורז וממוקד לשני ההורים על סוכנות אישית, חשיבה ביקורתית, תקשורת והעברת אחריות בבית.</p></article>
    </div>
  </div>
</section>

<section class="section section-sand" id="curriculum">
  <div class="container">
    <span class="eyebrow lang-en">Four modules. One inner direction.</span><span class="eyebrow lang-he">ארבעה מודולים. כיוון פנימי אחד.</span>
    <h2 class="lang-en">The 12-week curriculum</h2><h2 class="lang-he">תוכנית הלימודים ל־12 שבועות</h2>
    <p class="lead lang-en">Each module has its own psychological sequence and one substantial project designed to make the skill visible.</p>
    <p class="lead lang-he">לכל מודול יש רצף פסיכולוגי משלו ופרויקט משמעותי אחד שנועד להפוך את המיומנות לנראית.</p>

    <div class="module-list">
      <article class="module reveal">
        <div class="module-index">01</div>
        <div class="module-copy">
          <h3 class="lang-en">Values, Identity, Purpose & Goals</h3><h3 class="lang-he">ערכים, זהות, תכלית ומטרות</h3>
          <p class="lang-en">What is important to me? What are my strengths and interests? What kind of future am I building? What does a value look like as a concrete goal, a manageable next step and a commitment I follow through on?</p>
          <p class="lang-he">מה חשוב לי? מהם הכוחות והתחומים שמעניינים אותי? איזה עתיד אני בונה? איך נראה ערך כשהוא הופך למטרה ברורה, לצעד אפשרי ולהתחייבות שאני עומד בה?</p>
          <ul>
            <li class="lang-en">Values and the qualities I want my life to express</li><li class="lang-he">ערכים והתכונות שאני רוצה שהחיים שלי יבטאו</li>
            <li class="lang-en">Purpose, future vision and the man I want to become</li><li class="lang-he">תכלית, חזון עתידי והאדם שאני רוצה להיות</li>
            <li class="lang-en">Values → goals → next actions → responsibility</li><li class="lang-he">ערכים ← מטרות ← צעדים הבאים ← אחריות</li>
          </ul>
        </div>
        <div class="project-card"><span class="project-label lang-en">Primary applied project</span><span class="project-label lang-he">הפרויקט היישומי המרכזי</span><strong class="lang-en">The Door Sign for My Future Home</strong><strong class="lang-he">שלט הדלת לבית העתידי שלי</strong><p class="lang-en">Each boy designs and builds a wooden door sign for the home he hopes to have one day. Its name, materials, symbols and details must express the values, work, atmosphere and family life he wants to create. He keeps it for that future home.</p><p class="lang-he">כל ילד מתכנן ובונה שלט עץ לבית שהוא רוצה להקים בעתיד. השם, החומרים, הסמלים והפרטים חייבים לבטא את הערכים, העבודה, האווירה וחיי המשפחה שהוא רוצה ליצור. הוא שומר אותו לבית העתידי.</p></div>
      </article>

      <article class="module reveal">
        <div class="module-index">02</div>
        <div class="module-copy">
          <h3 class="lang-en">Communication</h3><h3 class="lang-he">תקשורת</h3>
          <p class="lang-en">Communication begins with purpose: What result am I trying to create? What do I want the other person to understand? What words can carry that meaning without destroying the relationship?</p>
          <p class="lang-he">תקשורת מתחילה בתכלית: איזו תוצאה אני מנסה ליצור? מה אני רוצה שהאדם השני יבין? אילו מילים יכולות לשאת את המשמעות בלי להרוס את הקשר?</p>
          <ul>
            <li class="lang-en">Finding and organizing the words for what I want</li><li class="lang-he">למצוא ולסדר את המילים למה שאני רוצה</li>
            <li class="lang-en">Perspective, validation, listening and different interpretations</li><li class="lang-he">נקודת מבט, תיקוף, הקשבה ופרשנויות שונות</li>
            <li class="lang-en">Asking for help, boundaries, refusals and receiving “no”</li><li class="lang-he">בקשת עזרה, גבולות, סירוב והיכולת לקבל ״לא״</li>
            <li class="lang-en">Disagreement without attacking identity, compromise and repair</li><li class="lang-he">אי־הסכמה בלי לתקוף זהות, פשרה ותיקון</li>
          </ul>
        </div>
        <div class="project-card"><span class="project-label lang-en">One shared goal</span><span class="project-label lang-he">מטרה משותפת אחת</span><strong class="lang-en">The Conversation Bench</strong><strong class="lang-he">ספסל השיחה</strong><p class="lang-en">The group plans and builds one real wooden bench together. Every important decision must be communicated, heard and agreed upon. The bench only works if the boys can make their words work.</p><p class="lang-he">הקבוצה מתכננת ובונה יחד ספסל עץ אמיתי. כל החלטה חשובה חייבת להיאמר, להישמע ולהתקבל. הספסל מצליח רק אם הבנים מצליחים לגרום למילים שלהם לעבוד.</p></div>
      </article>

      <article class="module reveal">
        <div class="module-index">03</div>
        <div class="module-copy">
          <h3 class="lang-en">Problem Solving</h3><h3 class="lang-he">פתרון בעיות</h3>
          <p class="lang-en">Humility comes first: I may not understand the situation yet. I may need another person. Then we identify what is controllable, generate solutions, test them and study the outcome.</p>
          <p class="lang-he">ענווה באה ראשונה: ייתכן שעוד לא הבנתי את המצב. ייתכן שאני צריך אדם אחר. אחר כך מזהים מה בשליטתי, מייצרים פתרונות, בודקים אותם ולומדים מהתוצאה.</p>
          <ul>
            <li class="lang-en"><strong>SODAS:</strong> Situation, Options, Disadvantages, Advantages, Solution</li><li class="lang-he"><strong>SODAS:</strong> מצב, אפשרויות, חסרונות, יתרונות, פתרון</li>
            <li class="lang-en">Choices, natural consequences and long-term effects</li><li class="lang-he">בחירות, השלכות טבעיות והשפעות לטווח ארוך</li>
            <li class="lang-en">Commitments, responsibility and asking the right person</li><li class="lang-he">התחייבויות, אחריות ופנייה לאדם הנכון</li>
            <li class="lang-en">Frustration, discomfort, testing and redesign</li><li class="lang-he">תסכול, אי־נוחות, בדיקה ותכנון מחדש</li>
          </ul>
        </div>
        <div class="project-card"><span class="project-label lang-en">Primary applied project</span><span class="project-label lang-he">הפרויקט היישומי המרכזי</span><strong class="lang-en">The Load-Bearing Bridge</strong><strong class="lang-he">הגשר נושא המשקל</strong><p class="lang-en">The group must build one bridge to carry a defined load. It is tested until it fails, diagnosed through SODAS, redesigned and tested again. Failure is not the end of the project; it is the information the project needed.</p><p class="lang-he">הקבוצה חייבת לבנות גשר אחד שנושא משקל מוגדר. בודקים אותו עד שהוא נכשל, מנתחים דרך SODAS, מתכננים מחדש ובודקים שוב. הכישלון אינו סוף הפרויקט; הוא המידע שהפרויקט היה צריך.</p></div>
      </article>

      <article class="module reveal">
        <div class="module-index">04</div>
        <div class="module-copy">
          <h3 class="lang-en">Bodily Awareness</h3><h3 class="lang-he">מודעות גופנית</h3>
          <p class="lang-en">The body is not a machine carrying the mind. It is where tension, hunger, strength, fear, energy, impulse and calm first become visible.</p>
          <p class="lang-he">הגוף אינו מכונה שסוחבת את המוח. הוא המקום שבו מתח, רעב, כוח, פחד, אנרגיה, דחף ורוגע נעשים נראים לראשונה.</p>
          <ul>
            <li class="lang-en">Meditation, stillness and body scans</li><li class="lang-he">מדיטציה, שקט וסריקות גוף</li>
            <li class="lang-en">Interoception and gentle “parts” language</li><li class="lang-he">אינטרוספציה ושפה עדינה של ״חלקים״</li>
            <li class="lang-en">Food, meals, energy and learning how to eat well</li><li class="lang-he">אוכל, ארוחות, אנרגיה וללמוד לאכול נכון</li>
            <li class="lang-en">Exercise, strength, discomfort and recovery</li><li class="lang-he">אימון, כוח, אי־נוחות והתאוששות</li>
          </ul>
        </div>
        <div class="project-card"><span class="project-label lang-en">Primary applied project</span><span class="project-label lang-he">הפרויקט היישומי המרכזי</span><strong class="lang-en">The Family Table</strong><strong class="lang-he">שולחן המשפחה</strong><p class="lang-en">The boys plan, budget, shop for, cook and serve a balanced meal. The module also includes a strength-and-stillness challenge: reading the body under effort, returning to calm and deciding what care the body needs.</p><p class="lang-he">הבנים מתכננים, מתקצבים, קונים, מבשלים ומגישים ארוחה מאוזנת. המודול כולל גם אתגר של כוח ושקט: לקרוא את הגוף בזמן מאמץ, לחזור לרוגע ולהחליט איזו שמירה הגוף צריך.</p></div>
      </article>
    </div>
  </div>
</section>

<section class="section section-paper" id="parents">
  <div class="container">
    <div class="split">
      <div class="reveal">
        <span class="eyebrow lang-en">Three parent strategy sessions</span><span class="eyebrow lang-he">שלוש פגישות אסטרטגיה להורים</span>
        <h2 class="lang-en">The same language begins to live at home.</h2><h2 class="lang-he">אותה שפה מתחילה לחיות בבית.</h2>
        <p class="lead lang-en">Both parents are invited together whenever possible. This is not another membership, app or weekly course. It is a concentrated crash course in the conversations that build agency, judgment and responsibility.</p>
        <p class="lead lang-he">שני ההורים מוזמנים יחד ככל האפשר. זו אינה עוד חברות, אפליקציה או קורס שבועי. זהו קורס מזורז ומרוכז בשיחות שבונות סוכנות אישית, שיקול דעת ואחריות.</p>
      </div>
      <div class="image-placeholder reveal" style="min-height:410px" data-label-en="Replace with: parents in calm conversation with their son" data-label-he="להחליף בתמונה: הורים בשיחה רגועה עם בנם"><span class="sketch-line" aria-hidden="true"></span></div>
    </div>
    <div class="parent-session-grid">
      <article class="parent-session reveal"><span class="session-tag lang-en">Session 1</span><span class="session-tag lang-he">פגישה 1</span><h3 class="lang-en">Motivation, agency and values</h3><h3 class="lang-he">מוטיבציה, סוכנות אישית וערכים</h3><p class="lang-en">Why external control can produce behavior without building the boy. How autonomy, competence, relatedness and relevance help motivation move inward.</p><p class="lang-he">מדוע שליטה חיצונית יכולה לייצר התנהגות בלי לבנות את הילד. כיצד אוטונומיה, מסוגלות, קשר ורלוונטיות מסייעים למוטיבציה לעבור פנימה.</p></article>
      <article class="parent-session reveal"><span class="session-tag lang-en">Session 2</span><span class="session-tag lang-he">פגישה 2</span><h3 class="lang-en">Communication, attachment and critical thinking</h3><h3 class="lang-he">תקשורת, התקשרות וחשיבה ביקורתית</h3><p class="lang-en">How to create enough connection for honest dialogue, ask questions that make the child think and stop doing all of the thinking for him.</p><p class="lang-he">כיצד ליצור מספיק קשר לשיח כנה, לשאול שאלות שגורמות לילד לחשוב ולהפסיק לעשות עבורו את כל החשיבה.</p></article>
      <article class="parent-session reveal"><span class="session-tag lang-en">Session 3</span><span class="session-tag lang-he">פגישה 3</span><h3 class="lang-en">Transfer responsibility</h3><h3 class="lang-he">העברת אחריות</h3><p class="lang-en">Goals, natural consequences, repair and deciding what the parents should stop managing so the boy can begin managing it.</p><p class="lang-he">מטרות, השלכות טבעיות, תיקון והחלטה מה ההורים צריכים להפסיק לנהל כדי שהילד יוכל להתחיל לנהל אותו בעצמו.</p></article>
    </div>
  </div>
</section>

<section class="section" id="membership">
  <div class="container">
    <div class="membership-card reveal">
      <div>
        <span class="eyebrow lang-en">After graduation</span><span class="eyebrow lang-he">לאחר סיום התוכנית</span>
        <h2 class="lang-en">The relationship does not have to disappear after week twelve.</h2><h2 class="lang-he">הקשר לא חייב להיעלם אחרי השבוע השנים־עשר.</h2>
        <p class="lead lang-en">Graduates become eligible for the Inner Leadership Circle: one monthly leadership class, continued connection with the boys and optional trips or field experiences offered separately.</p>
        <p class="lead lang-he">בוגרים זכאים להצטרף למעגל הנהגה מבפנים: שיעור מנהיגות חודשי, המשך קשר עם הבנים וטיולים או חוויות שטח אופציונליים המוצעים בנפרד.</p>
        <ul class="plain-list">
          <li class="lang-en">One monthly learning and reflection gathering</li><li class="lang-he">מפגש לימוד והתבוננות חודשי אחד</li>
          <li class="lang-en">A continuing peer circle and relationship with the mentor</li><li class="lang-he">מעגל חברים מתמשך וקשר עם המנחה</li>
          <li class="lang-en">Optional trips priced separately so the membership remains sustainable</li><li class="lang-he">טיולים אופציונליים בתשלום נפרד כדי שהחברות תישאר בת־קיימא</li>
        </ul>
      </div>
      <div class="price-box"><div class="price">₪180 <small class="lang-en">/ month</small><small class="lang-he">/ לחודש</small></div><p class="lang-en">Founding alumni membership. Trips and higher-cost experiences are separate.</p><p class="lang-he">מחיר מייסדים לבוגרים. טיולים וחוויות בעלות גבוהה מחויבים בנפרד.</p></div>
    </div>
  </div>
</section>

<section class="section section-sand" id="about">
  <div class="container">
    <div class="founder-card reveal">
      <div class="image-placeholder founder-photo" data-label-en="Replace with: Rabbi Shloimie Dratler portrait" data-label-he="להחליף בתמונה: הרב שלוימי דרטלר"><span class="sketch-line" aria-hidden="true"></span></div>
      <div>
        <span class="eyebrow lang-en">About the founder</span><span class="eyebrow lang-he">אודות המייסד</span>
        <h2 class="lang-en">Rabbi Shloimie Dratler</h2><h2 class="lang-he">הרב שלוימי דרטלר</h2>
        <p class="lead lang-en">Rabbi Shloimie Dratler has dedicated his life to intrinsic motivation, autonomous Torah learning and inspiring youth.</p>
        <p class="lead lang-he">הרב שלוימי דרטלר הקדיש את חייו למוטיבציה פנימית, ללימוד תורה אוטונומי ולהשראת בני נוער וילדים.</p>
        <p class="lang-en">He specializes in teaching boys self-governance and communication skills, and in helping parents and children build agency in learning, navigate friendships and social environments, and create healthier dialogue between parents, siblings and children inside the family.</p>
        <p class="lang-he">הוא מתמחה בהקניית הנהגה עצמית וכישורי תקשורת לבנים, ובעזרה להורים ולילדים לבנות סוכנות אישית בלמידה, לנווט חברויות וסביבות חברתיות וליצור שיח בריא יותר בין הורים, אחים וילדים בתוך המשפחה.</p>
        <p class="lang-en">He lives in Ramat Beit Shemesh Gimmel with his five children and works in both English and Hebrew with families from every background.</p>
        <p class="lang-he">הוא מתגורר ברמת בית שמש ג׳ עם חמשת ילדיו ועובד בעברית ובאנגלית עם משפחות מכל רקע.</p>
        <div class="founder-meta"><span class="lang-en">Intrinsic motivation</span><span class="lang-he">מוטיבציה פנימית</span><span class="lang-en">Autonomous Torah learning</span><span class="lang-he">לימוד תורה אוטונומי</span><span class="lang-en">Family communication</span><span class="lang-he">תקשורת משפחתית</span></div>
      </div>
    </div>
  </div>
</section>

<section class="section section-paper" id="faq">
  <div class="container narrow">
    <span class="eyebrow lang-en">Practical questions</span><span class="eyebrow lang-he">שאלות מעשיות</span>
    <h2 class="lang-en">Before you apply</h2><h2 class="lang-he">לפני שמגישים בקשה</h2>
    <div class="faq-list">
      <div class="faq-item"><button class="faq-question" data-faq-question aria-expanded="false"><span class="lang-en">Who is the program for?</span><span class="lang-he">למי מיועדת התוכנית?</span></button><div class="faq-answer"><p class="lang-en">Boys approximately ages 6–11 who would benefit from stronger communication, confidence, problem-solving, emotional regulation, values, bodily awareness or self-governance. Fit is determined through a parent conversation; the program is not appropriate for every child.</p><p class="lang-he">לבנים בערך בגילאי 6–11 שיכולים להפיק תועלת מתקשורת, ביטחון, פתרון בעיות, ויסות רגשי, ערכים, מודעות גופנית או הנהגה עצמית חזקים יותר. התאמה נקבעת בשיחת הורים; התוכנית אינה מתאימה לכל ילד.</p></div></div>
      <div class="faq-item"><button class="faq-question" data-faq-question aria-expanded="false"><span class="lang-en">Does the group wait until it is full?</span><span class="lang-he">האם מחכים שהקבוצה תתמלא?</span></button><div class="faq-answer"><p class="lang-en">No. Two compatible boys begin the applied lab immediately. The group grows carefully, based on age, temperament, safety and developmental fit.</p><p class="lang-he">לא. שני בנים מתאימים מתחילים מיד את המעבדה היישומית. הקבוצה גדלה בזהירות בהתאם לגיל, מזג, בטיחות והתאמה התפתחותית.</p></div></div>
      <div class="faq-item"><button class="faq-question" data-faq-question aria-expanded="false"><span class="lang-en">Is this a school or replacement for school?</span><span class="lang-he">האם זו מסגרת בית ספרית?</span></button><div class="faq-answer"><p class="lang-en">No. It is a defined 12-week program that normally runs around the child’s existing school schedule.</p><p class="lang-he">לא. זו תוכנית מוגדרת בת 12 שבועות שבדרך כלל פועלת סביב מערכת בית הספר הקיימת של הילד.</p></div></div>
      <div class="faq-item"><button class="faq-question" data-faq-question aria-expanded="false"><span class="lang-en">Is this medical or psychiatric care?</span><span class="lang-he">האם זה טיפול רפואי או פסיכיאטרי?</span></button><div class="faq-answer"><p class="lang-en">The program focuses on practical emotional development, communication, decision-making, responsibility and self-governance. It does not provide psychiatric diagnosis and does not replace medical, psychiatric or licensed psychological care when those services are needed.</p><p class="lang-he">התוכנית מתמקדת בהתפתחות רגשית מעשית, תקשורת, קבלת החלטות, אחריות והנהגה עצמית. היא אינה מספקת אבחון פסיכיאטרי ואינה מחליפה טיפול רפואי, פסיכיאטרי או פסיכולוגי מורשה כאשר שירותים אלה נדרשים.</p></div></div>
      <div class="faq-item"><button class="faq-question" data-faq-question aria-expanded="false"><span class="lang-en">Where does the program take place?</span><span class="lang-he">היכן מתקיימת התוכנית?</span></button><div class="faq-answer"><p class="lang-en">The founding program is based in Israel. Private meetings and cohort locations may be arranged according to demand in Beit Shemesh, Jerusalem, Modi’in or another practical location. Confirm current availability during the parent conversation.</p><p class="lang-he">התוכנית המייסדת מבוססת בישראל. מקום המפגשים האישיים והקבוצות יכול להיקבע לפי ביקוש בבית שמש, ירושלים, מודיעין או מיקום מעשי אחר. יש לאשר זמינות עדכנית בשיחת ההורים.</p></div></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="cta-panel reveal">
      <span class="eyebrow lang-en">Start with the masterclass</span><span class="eyebrow lang-he">מתחילים בשיעור ההורים</span>
      <h2 class="lang-en">The goal is not a child who needs less guidance because he has stopped feeling. It is a child who can feel, think, speak—and increasingly guide himself.</h2>
      <h2 class="lang-he">המטרה אינה ילד שזקוק לפחות הכוונה מפני שהוא הפסיק להרגיש. המטרה היא ילד שיכול להרגיש, לחשוב, לדבר—ובהדרגה להכווין את עצמו.</h2>
      <p class="lang-en">Watch the free parent masterclass, understand the model and then decide whether a parent conversation makes sense for your family.</p>
      <p class="lang-he">צפו בשיעור ההורים החינמי, הבינו את המודל ואז החליטו אם שיחת הורים מתאימה למשפחה שלכם.</p>
      <div class="hero-actions"><a class="btn btn-primary btn-arrow lang-en" href="masterclass.html">Watch the free masterclass</a><a class="btn btn-primary btn-arrow lang-he" href="masterclass.html?lang=he">צפו בשיעור החינמי</a></div>
    </div>
  </div>
</section>
'''

MASTERCLASS = r'''
<section class="page-hero">
  <div class="container narrow reveal">
    <span class="eyebrow lang-en">Free 35–40 minute parent masterclass</span><span class="eyebrow lang-he">שיעור הורים חינמי של 35–40 דקות</span>
    <h1 class="lang-en">Teach Your Son the Skills School Isn’t Teaching Him</h1>
    <h1 class="lang-he">ללמד את הבן שלכם את הכלים שבית הספר אינו מלמד</h1>
    <p class="lead lang-en">How intrinsic motivation, critical thinking, communication and self-governance begin to grow inside a boy—and how the conversations in your home can help.</p>
    <p class="lead lang-he">כיצד מוטיבציה פנימית, חשיבה ביקורתית, תקשורת והנהגה עצמית מתחילות לצמוח בתוך ילד—וכיצד השיחות בבית יכולות לעזור.</p>
  </div>
</section>
<section class="section compact">
  <div class="container">
    <div class="split">
      <div class="form-shell reveal">
        <h2 class="lang-en" style="font-size:2.7rem">Get immediate access</h2><h2 class="lang-he" style="font-size:2.7rem">קבלו גישה מיידית</h2>
        <p class="lang-en">Enter your details and the masterclass will open immediately.</p><p class="lang-he">הכניסו פרטים והשיעור ייפתח מיד.</p>
        <form data-connected-form data-form-type="masterclass" data-success-url="watch.html">
          <div class="honeypot"><label>Website<input name="website" autocomplete="off" tabindex="-1"></label></div>
          <div class="form-group"><label class="lang-en" for="name">Parent name</label><label class="lang-he" for="name">שם ההורה</label><input id="name" name="parent_name" required autocomplete="name"></div>
          <div class="form-group"><label class="lang-en" for="email">Email</label><label class="lang-he" for="email">אימייל</label><input id="email" name="email" type="email" required autocomplete="email"></div>
          <div class="form-group"><label class="lang-en" for="phone">Phone / WhatsApp</label><label class="lang-he" for="phone">טלפון / ווטסאפ</label><input id="phone" name="phone" type="tel" required autocomplete="tel"></div>
          <div class="form-group"><label class="lang-en" for="child-age">Son’s age</label><label class="lang-he" for="child-age">גיל הבן</label><select id="child-age" name="child_age" required><option value="">—</option><option>6</option><option>7</option><option>8</option><option>9</option><option>10</option><option>11</option><option value="other">Other / אחר</option></select></div>
          <div class="form-group"><label class="checkbox"><input type="checkbox" name="consent" value="yes" required><span class="lang-en">I agree to receive the masterclass and relevant follow-up messages. I can unsubscribe at any time.</span><span class="lang-he">אני מסכים/ה לקבל את השיעור והודעות המשך רלוונטיות. ניתן להסיר את ההרשמה בכל עת.</span></label></div>
          <button class="btn btn-clay btn-wide btn-arrow" type="submit"><span class="lang-en">Open the masterclass</span><span class="lang-he">פתחו את השיעור</span></button>
          <div class="form-message" data-form-message role="status"></div>
        </form>
      </div>
      <div class="reveal">
        <span class="eyebrow lang-en">Inside the masterclass</span><span class="eyebrow lang-he">בתוך השיעור</span>
        <h2 class="lang-en">A child does not become self-governing because adults manage him more efficiently.</h2>
        <h2 class="lang-he">ילד אינו נעשה בעל הנהגה עצמית מפני שמבוגרים מנהלים אותו בצורה יעילה יותר.</h2>
        <ul class="plain-list">
          <li class="lang-en">Why pressure can produce action without producing motivation</li><li class="lang-he">מדוע לחץ יכול לייצר פעולה בלי לייצר מוטיבציה</li>
          <li class="lang-en">Autonomy, competence, relationship and relevance</li><li class="lang-he">אוטונומיה, מסוגלות, קשר ורלוונטיות</li>
          <li class="lang-en">The questions that teach a child to think</li><li class="lang-he">השאלות שמלמדות ילד לחשוב</li>
          <li class="lang-en">How values become goals and responsibility</li><li class="lang-he">כיצד ערכים הופכים למטרות ולאחריות</li>
          <li class="lang-en">Why projects reveal what talking alone cannot</li><li class="lang-he">מדוע פרויקטים מגלים את מה ששיחה בלבד אינה יכולה לגלות</li>
          <li class="lang-en">How open dialogue changes the feeling of a family</li><li class="lang-he">כיצד שיח פתוח משנה את התחושה במשפחה</li>
        </ul>
        <div class="note-box" style="margin-top:28px"><span class="lang-en">This masterclass is educational. It does not diagnose a child and does not replace appropriate professional care.</span><span class="lang-he">השיעור הוא חינוכי. הוא אינו מאבחן ילד ואינו מחליף טיפול מקצועי מתאים.</span></div>
      </div>
    </div>
  </div>
</section>
'''

WATCH = r'''
<section class="page-hero compact">
  <div class="container narrow reveal"><span class="eyebrow lang-en">Parent masterclass</span><span class="eyebrow lang-he">שיעור הורים</span><h1 class="lang-en">Teach Your Son the Skills School Isn’t Teaching Him</h1><h1 class="lang-he">ללמד את הבן שלכם את הכלים שבית הספר אינו מלמד</h1></div>
</section>
<section class="section compact">
  <div class="container">
    <div class="video-shell reveal" data-masterclass-video>
      <div class="video-placeholder"><div><div class="play">▶</div><h3 class="lang-en">Masterclass video placeholder</h3><h3 class="lang-he">מקום לסרטון השיעור</h3><p class="lang-en">Add the Vimeo, YouTube or hosted video URL in <code>assets/js/config.js</code>.</p><p class="lang-he">הוסיפו את כתובת Vimeo, YouTube או הסרטון המאוחסן בקובץ <code>assets/js/config.js</code>.</p></div></div>
    </div>
  </div>
</section>
<section class="section compact section-paper">
  <div class="container narrow">
    <div class="cta-panel reveal"><span class="eyebrow lang-en">The next step</span><span class="eyebrow lang-he">השלב הבא</span><h2 class="lang-en">You do not have to decide whether the program is right by yourself.</h2><h2 class="lang-he">אינכם צריכים להחליט לבד אם התוכנית מתאימה.</h2><p class="lang-en">Complete the short application. The next step is a parent conversation to understand your son, the family situation and whether this process is likely to serve him.</p><p class="lang-he">מלאו את הבקשה הקצרה. השלב הבא הוא שיחת הורים כדי להבין את בנכם, את המצב המשפחתי והאם התהליך עשוי לשרת אותו.</p><div class="hero-actions"><a class="btn btn-clay btn-arrow lang-en" href="apply.html">Apply for a parent conversation</a><a class="btn btn-clay btn-arrow lang-he" href="apply.html?lang=he">הגישו בקשה לשיחת הורים</a></div></div>
  </div>
</section>
'''

APPLY = r'''
<section class="page-hero compact">
  <div class="container narrow reveal"><span class="eyebrow lang-en">Program application</span><span class="eyebrow lang-he">בקשה לתוכנית</span><h1 class="lang-en">Let us understand your son before we offer him a place.</h1><h1 class="lang-he">נבין את בנכם לפני שנציע לו מקום.</h1><p class="lead lang-en">This is not an automatic registration. The information below prepares us for a focused parent conversation.</p><p class="lead lang-he">זו אינה הרשמה אוטומטית. המידע שלהלן מכין אותנו לשיחת הורים ממוקדת.</p></div>
</section>
<section class="section compact">
  <div class="container">
    <div class="form-shell reveal">
      <form data-connected-form data-form-type="application" data-success-url="thank-you.html">
        <div class="honeypot"><label>Website<input name="website" autocomplete="off" tabindex="-1"></label></div>
        <div class="form-grid">
          <div class="form-group"><label class="lang-en" for="pname">Parent name</label><label class="lang-he" for="pname">שם ההורה</label><input id="pname" name="parent_name" required autocomplete="name"></div>
          <div class="form-group"><label class="lang-en" for="spouse">Second parent’s name</label><label class="lang-he" for="spouse">שם ההורה השני</label><input id="spouse" name="second_parent_name"></div>
          <div class="form-group"><label class="lang-en" for="aemail">Email</label><label class="lang-he" for="aemail">אימייל</label><input id="aemail" name="email" type="email" required autocomplete="email"></div>
          <div class="form-group"><label class="lang-en" for="aphone">Phone / WhatsApp</label><label class="lang-he" for="aphone">טלפון / ווטסאפ</label><input id="aphone" name="phone" type="tel" required autocomplete="tel"></div>
          <div class="form-group"><label class="lang-en" for="city">City</label><label class="lang-he" for="city">עיר</label><input id="city" name="city" required></div>
          <div class="form-group"><label class="lang-en" for="language">Preferred language</label><label class="lang-he" for="language">שפה מועדפת</label><select id="language" name="preferred_language" required><option value="">—</option><option value="English">English</option><option value="Hebrew">עברית</option><option value="Both">Both / שניהם</option></select></div>
          <div class="form-group"><label class="lang-en" for="son">Son’s first name</label><label class="lang-he" for="son">שם פרטי של הבן</label><input id="son" name="child_first_name" required></div>
          <div class="form-group"><label class="lang-en" for="age">Age</label><label class="lang-he" for="age">גיל</label><select id="age" name="child_age" required><option value="">—</option><option>6</option><option>7</option><option>8</option><option>9</option><option>10</option><option>11</option><option value="other">Other / אחר</option></select></div>
          <div class="form-group full"><label class="lang-en" for="framework">Current school or learning framework</label><label class="lang-he" for="framework">בית ספר או מסגרת לימודית נוכחית</label><input id="framework" name="current_framework"></div>
          <div class="form-group full"><label class="lang-en" for="concerns">What are the three main things you are seeing right now?</label><label class="lang-he" for="concerns">מהם שלושת הדברים המרכזיים שאתם רואים כרגע?</label><textarea id="concerns" name="main_concerns" required></textarea></div>
          <div class="form-group full"><label class="lang-en" for="change">What would make these 12 weeks genuinely valuable for your son and family?</label><label class="lang-he" for="change">מה יהפוך את 12 השבועות האלה לבעלי ערך אמיתי עבור בנכם ומשפחתכם?</label><textarea id="change" name="desired_change" required></textarea></div>
          <div class="form-group full"><label class="lang-en" for="strengths">What are his strengths, interests and the situations in which he comes alive?</label><label class="lang-he" for="strengths">מהם הכוחות והתחומים שמעניינים אותו, ובאילו מצבים הוא מתעורר לחיים?</label><textarea id="strengths" name="strengths_interests" required></textarea></div>
          <div class="form-group full"><label class="lang-en" for="support">Is he currently receiving professional, medical, psychological, educational or psychiatric support that is relevant to program fit or safety?</label><label class="lang-he" for="support">האם הוא מקבל כיום תמיכה מקצועית, רפואית, פסיכולוגית, חינוכית או פסיכיאטרית הרלוונטית להתאמה או לבטיחות?</label><textarea id="support" name="current_support"><!-- Detailed diagnoses should be collected only in the confidential accepted-client intake. --></textarea><p class="help lang-en">Share only what is necessary for an initial fit conversation. Detailed records are not required here.</p><p class="help lang-he">שתפו רק את הנדרש לשיחת התאמה ראשונית. אין צורך במסמכים מפורטים כאן.</p></div>
          <div class="form-group full"><label class="lang-en" for="schedule">Can your family commit to one private meeting, two after-school labs and three parent sessions during the 12 weeks?</label><label class="lang-he" for="schedule">האם המשפחה יכולה להתחייב למפגש אישי אחד, שתי מעבדות אחר הצהריים ושלוש פגישות הורים לאורך 12 השבועות?</label><select id="schedule" name="schedule_commitment" required><option value="">—</option><option value="Yes">Yes / כן</option><option value="Need to discuss">Need to discuss / צריך לדון</option><option value="No">No / לא</option></select></div>
          <div class="form-group full"><label class="checkbox"><input type="checkbox" name="parent_session_commitment" value="yes" required><span class="lang-en">Both parents will make a serious effort to attend the three strategy sessions together when possible.</span><span class="lang-he">שני ההורים יעשו מאמץ רציני להשתתף יחד בשלוש פגישות האסטרטגיה ככל האפשר.</span></label></div>
          <div class="form-group full"><label class="checkbox"><input type="checkbox" name="privacy_consent" value="yes" required><span class="lang-en">I consent to the use of this information to assess fit and arrange a parent conversation, as described in the privacy policy.</span><span class="lang-he">אני מסכים/ה לשימוש במידע לצורך בדיקת התאמה ותיאום שיחת הורים, כפי שמתואר במדיניות הפרטיות.</span></label></div>
        </div>
        <button class="btn btn-clay btn-wide btn-arrow" type="submit"><span class="lang-en">Submit the application</span><span class="lang-he">שלחו את הבקשה</span></button>
        <div class="form-message" data-form-message role="status"></div>
      </form>
    </div>
  </div>
</section>
'''

THANK_YOU = r'''
<section class="page-hero" style="min-height:65vh;display:flex;align-items:center">
  <div class="container narrow reveal">
    <span class="eyebrow lang-en">Application received</span><span class="eyebrow lang-he">הבקשה התקבלה</span>
    <h1 class="lang-en">Thank you. The next step is a real conversation.</h1><h1 class="lang-he">תודה. השלב הבא הוא שיחה אמיתית.</h1>
    <p class="lead lang-en">We will review the application and contact you to arrange the parent conversation. No place is reserved until fit, schedule and payment are confirmed.</p><p class="lead lang-he">נבדוק את הבקשה וניצור קשר לתיאום שיחת ההורים. מקום אינו שמור עד לאישור התאמה, לוח זמנים ותשלום.</p>
    <div class="hero-actions" style="justify-content:center"><a class="btn btn-primary lang-en" href="index.html">Return to the website</a><a class="btn btn-primary lang-he" href="index.html?lang=he">חזרה לאתר</a></div>
  </div>
</section>
'''

PRIVACY = r'''
<section class="page-hero compact"><div class="container narrow"><span class="eyebrow lang-en">Privacy</span><span class="eyebrow lang-he">פרטיות</span><h1 class="lang-en">Privacy policy</h1><h1 class="lang-he">מדיניות פרטיות</h1></div></section>
<section class="section compact"><div class="container narrow legal">
<div class="lang-en">
<p><strong>Last updated: August 20, 2026.</strong></p>
<p>This template must be reviewed and completed before publication. Replace bracketed operational details and confirm compliance with Israeli law and the platforms you use.</p>
<h2>Information collected</h2><p>We may collect parent contact details, a child’s first name and age, city, language, general concerns, strengths, scheduling information, source/advertising attribution and information voluntarily submitted in an application.</p>
<h2>Purpose</h2><p>Information is used to deliver the masterclass, respond to inquiries, assess initial program fit, arrange conversations, operate enrollment and improve marketing performance.</p>
<h2>Children’s information</h2><p>The public application is intentionally limited. Detailed diagnoses, medical records, legal documents and sensitive treatment information should not be entered unless specifically requested through a confidential accepted-client process.</p>
<h2>Processors and advertising</h2><p>Data may be processed by website hosting, GoHighLevel or another CRM, email/SMS/WhatsApp providers, payment providers and analytics services. We do not intentionally send child diagnoses or other sensitive health information to advertising platforms.</p>
<h2>Retention and rights</h2><p>State the retention period, the legal basis for processing, who controls the data and how a person may request access, correction or deletion: [INSERT CONTROLLER NAME, CONTACT, RETENTION POLICY].</p>
<h2>Contact</h2><p>[INSERT PRIVACY CONTACT EMAIL AND BUSINESS DETAILS]</p>
</div>
<div class="lang-he">
<p><strong>עודכן לאחרונה: 20 באוגוסט 2026.</strong></p>
<p>יש לבדוק ולהשלים תבנית זו לפני פרסום. יש להחליף פרטים בסוגריים ולאשר התאמה לדין הישראלי ולפלטפורמות שבהן נעשה שימוש.</p>
<h2>מידע שנאסף</h2><p>אנו עשויים לאסוף פרטי קשר של הורים, שם פרטי וגיל של ילד, עיר, שפה, קשיים כלליים, כוחות, מידע על זמינות, ייחוס פרסומי ומידע שנמסר מרצון בטופס.</p>
<h2>מטרה</h2><p>המידע משמש למסירת השיעור, מענה לפניות, בדיקת התאמה ראשונית, תיאום שיחות, ניהול הרשמה ושיפור ביצועי שיווק.</p>
<h2>מידע על ילדים</h2><p>הטופס הציבורי מוגבל בכוונה. אין להזין אבחנות מפורטות, מסמכים רפואיים, מסמכים משפטיים או מידע טיפולי רגיש אלא אם התבקש במסגרת קליטה חסויה לאחר קבלה.</p>
<h2>ספקים ופרסום</h2><p>המידע עשוי להיות מעובד על ידי אחסון האתר, GoHighLevel או CRM אחר, ספקי אימייל/SMS/ווטסאפ, ספקי תשלום ושירותי אנליטיקה. איננו שולחים ביודעין אבחנות של ילדים או מידע בריאותי רגיש לפלטפורמות פרסום.</p>
<h2>שמירה וזכויות</h2><p>יש לציין תקופת שמירה, בסיס חוקי, זהות בעל המאגר ואופן בקשת עיון, תיקון או מחיקה: [יש להוסיף שם, קשר ומדיניות שמירה].</p>
<h2>יצירת קשר</h2><p>[יש להוסיף אימייל ופרטי עסק]</p>
</div>
</div></section>
'''

TERMS = r'''
<section class="page-hero compact"><div class="container narrow"><span class="eyebrow lang-en">Terms & scope</span><span class="eyebrow lang-he">תנאים ותחום השירות</span><h1 class="lang-en">Program terms and scope</h1><h1 class="lang-he">תנאי התוכנית ותחום השירות</h1></div></section>
<section class="section compact"><div class="container narrow legal">
<div class="lang-en">
<p><strong>Draft for professional review before use.</strong></p>
<h2>Nature of the program</h2><p>Inner Leadership is a structured educational and developmental program focused on communication, values, problem-solving, bodily awareness, responsibility and self-governance. It is not a school and does not replace compulsory education.</p>
<h2>No guaranteed outcome</h2><p>The program is designed to help a child practice and develop skills. Results vary according to the child, family participation, attendance, fit, external conditions and other factors. Marketing statements describe intended outcomes, not guarantees.</p>
<h2>Professional scope</h2><p>The program does not provide psychiatric diagnosis and does not replace emergency, medical, psychiatric or licensed psychological care. Families are responsible for disclosing information needed for safety and for maintaining other appropriate care.</p>
<h2>Safety and group participation</h2><p>Participation in tools, cooking, movement and trips requires signed consent, emergency details, allergy and medical disclosures, age-appropriate safety rules and compliance with instructions. The program may refuse or end participation when safety or group fit requires it.</p>
<h2>Fees and attendance</h2><p>The 12-week fee, payment schedule, cancellation policy, missed-session policy, materials, travel, photography consent and alumni membership are governed by the signed enrollment agreement. Insert the final policy here before launch.</p>
</div>
<div class="lang-he">
<p><strong>טיוטה לבדיקה מקצועית לפני שימוש.</strong></p>
<h2>מהות התוכנית</h2><p>הנהגה מבפנים היא תוכנית חינוכית והתפתחותית מובנית המתמקדת בתקשורת, ערכים, פתרון בעיות, מודעות גופנית, אחריות והנהגה עצמית. היא אינה בית ספר ואינה מחליפה חינוך חובה.</p>
<h2>אין הבטחת תוצאה</h2><p>התוכנית נועדה לסייע לילד לתרגל ולפתח מיומנויות. התוצאות משתנות לפי הילד, השתתפות המשפחה, נוכחות, התאמה, תנאים חיצוניים וגורמים נוספים. הצהרות שיווקיות מתארות תוצאות רצויות ולא הבטחות.</p>
<h2>תחום מקצועי</h2><p>התוכנית אינה מספקת אבחון פסיכיאטרי ואינה מחליפה טיפול חירום, רפואי, פסיכיאטרי או פסיכולוגי מורשה. המשפחה אחראית למסור מידע הנדרש לבטיחות ולהמשיך טיפול מתאים אחר.</p>
<h2>בטיחות והשתתפות בקבוצה</h2><p>השתתפות בכלים, בישול, תנועה וטיולים דורשת הסכמה חתומה, פרטי חירום, מידע על אלרגיות ומצב רפואי, כללי בטיחות מותאמי גיל וציות להנחיות. התוכנית רשאית לסרב או להפסיק השתתפות כאשר בטיחות או התאמה קבוצתית דורשות זאת.</p>
<h2>תשלום ונוכחות</h2><p>המחיר ל־12 שבועות, לוח התשלומים, ביטולים, מפגשים שהוחמצו, חומרים, נסיעות, הסכמה לצילום וחברות בוגרים מוסדרים בהסכם ההרשמה החתום. יש להוסיף כאן את המדיניות הסופית לפני ההשקה.</p>
</div>
</div></section>
'''

NOT_FOUND = r'''
<section class="page-hero" style="min-height:65vh;display:flex;align-items:center"><div class="container narrow"><span class="eyebrow">404</span><h1 class="lang-en">This page is not here.</h1><h1 class="lang-he">העמוד הזה אינו כאן.</h1><p class="lead lang-en">Return to the Inner Leadership home page.</p><p class="lead lang-he">חזרו לעמוד הבית של הנהגה מבפנים.</p><div class="hero-actions" style="justify-content:center"><a class="btn btn-primary lang-en" href="index.html">Home</a><a class="btn btn-primary lang-he" href="index.html?lang=he">בית</a></div></div></section>
'''

pages = {
    "index.html": page("Inner Leadership for Boys", "הנהגה מבפנים לבנים", "A 12-week bilingual program helping boys ages 6–11 develop communication, values, critical thinking, bodily awareness and self-governance.", HOME),
    "masterclass.html": page("Free Parent Masterclass", "שיעור הורים חינם", "Free parent masterclass on intrinsic motivation, critical thinking, communication and self-governance in boys.", MASTERCLASS),
    "watch.html": page("Watch the Parent Masterclass", "צפייה בשיעור ההורים", "Watch the Inner Leadership parent masterclass and apply for a parent conversation.", WATCH),
    "apply.html": page("Apply for the 12-Week Program", "הגשת בקשה לתוכנית", "Apply for a parent conversation about the 12-week Inner Leadership program for boys ages 6–11.", APPLY),
    "thank-you.html": page("Application Received", "הבקשה התקבלה", "Your application to Inner Leadership has been received.", THANK_YOU),
    "privacy.html": page("Privacy Policy", "מדיניות פרטיות", "Privacy policy for the Inner Leadership website and program.", PRIVACY),
    "terms.html": page("Program Terms and Scope", "תנאים ותחום השירות", "Terms and professional scope for the Inner Leadership program.", TERMS),
    "404.html": page("Page Not Found", "העמוד לא נמצא", "Page not found.", NOT_FOUND),
}

for filename, content in pages.items():
    (ROOT / filename).write_text(content, encoding="utf-8")
    print(f"wrote {filename}")
