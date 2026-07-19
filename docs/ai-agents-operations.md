# תוכנית הפעלת סוכני AI — ניהול אוטונומי של AI Bookmarks

<div dir="rtl">

> **מטרה:** להפעיל את המוצר עם **שעה אחת של עבודת אדם בשבוע**. צי של 6 סוכני AI מטפל בתמיכה, שיווק, צמיחה, ניטור, ביקורות ולוקליזציה — עם guardrails ברורים, קריטריוני אסקלציה לאדם, ועלות הפעלה כוללת של **~$150–250/חודש**.

---

## 1. סגל הסוכנים (Agent Roster)

| # | סוכן | תפקיד בשורה אחת | תדירות | עלות/חודש משוערת |
|---|---|---|---|---|
| 1 | **Support Agent** | מענה למיילים ופניות משתמשים | Event-driven (כל מייל נכנס) | $20–40 |
| 2 | **Content/Marketing Agent** | בלוג, סושיאל, SEO | 3×/שבוע | $30–50 |
| 3 | **Growth Agent** | ניטור משפך והצעות A/B | שבועי | $10–20 |
| 4 | **Ops/Monitoring Agent** | שגיאות, עלויות API, uptime | כל שעה + התראות | $20–40 |
| 5 | **Review-Response Agent** | מענה לביקורות Chrome Web Store | יומי | $5–10 |
| 6 | **Localization Agent** | עדכון תרגומים (i18n) | על כל שינוי strings | $5–10 |
| | | | **סה"כ** | **~$90–170** (+תשתית ~$30–60) |

---

## 2. מפרט לכל סוכן

### 2.1 Support Agent — סוכן תמיכה

| היבט | פירוט |
|---|---|
| **Trigger** | Webhook על מייל נכנס ל-support@ (Resend/Gmail API) + הודעות מטופס in-app |
| **כלים/אינטגרציות** | Gmail/Resend API (קריאה+טיוטה), Stripe API (read-only: סטטוס מנוי, חשבוניות), Firestore (read-only: מכסת AI של המשתמש, שגיאות אחרונות), knowledge base (FAQ.md בריפו) |
| **תהליך** | מסווג את הפנייה (billing / bug / how-to / feature request / refund) → מרכיב תשובה מה-KB + נתוני המשתמש → שולח; רושם כל פנייה ל-log מסודר; מוסיף feature requests ל-backlog אוטומטית |
| **Guardrails** | ❌ אסור: לבצע refund או לשנות מנוי (רק לינק ל-self-service portal של Paddle/Stripe); להבטיח פיצ'רים או תאריכים; לחשוף נתוני משתמש אחר; לשלוח יותר מ-2 תגובות לשרשור בלי אישור אדם |
| **אסקלציה לאדם** | איום משפטי/GDPR/מחיקת דאטה; בקשת refund מעל $60; טון עוין אחרי תגובה אחת; confidence נמוך (הסוכן מסמן "לא בטוח"); באג שלא מופיע ב-KB ומדווח ע"י 3+ משתמשים |

### 2.2 Content/Marketing Agent — סוכן תוכן ושיווק

| היבט | פירוט |
|---|---|
| **Trigger** | Cron: ב'/ד'/ו' 09:00; בנוסף trigger ידני לפני השקות |
| **כלים/אינטגרציות** | גישת כתיבה לריפו הבלוג (PR בלבד, לא merge), Buffer/Typefully API לתזמון סושיאל (X, LinkedIn), Google Search Console API (ביצועי מילות מפתח), רשימת אוספים ציבוריים פופולריים מ-Firestore |
| **תהליך** | לוח תוכן חודשי → כותב פוסט SEO (למשל "Pocket alternatives", "awesome AI tools for X") → פותח PR; מייצר 5 פוסטים לסושיאל מכל פוסט בלוג; מדגיש "Collection of the week" מתוך אוספים ציבוריים |
| **Guardrails** | ❌ אסור: לפרסם בלי מעבר דרך תור טיוטות (בלוג=PR, סושיאל=scheduled queue שהאדם יכול למחוק תוך 24h); לטעון טענות מספריות על המוצר שלא מגיעות מקובץ facts.md מאושר; להגיב למשתמשים בסושיאל (רק לפרסם) |
| **אסקלציה לאדם** | כל פוסט בלוג = אישור PR של האדם (5 דק'); נושא רגיש (תמחור, השוואת מתחרים ישירה, אירוע אבטחה) — טיוטה בלבד |

### 2.3 Growth Agent — סוכן צמיחה

| היבט | פירוט |
|---|---|
| **Trigger** | Cron: יום ב' 07:00 (דוח שבועי); התראה מיידית אם מדד סוטה >20% מהממוצע הנע |
| **כלים/אינטגרציות** | PostHog/GA4 API (funnel: install→activation→D30→paid), Stripe/Paddle webhooks (MRR, churn, trials), Chrome Web Store stats (התקנות, uninstalls), נתוני K-factor של clone loop מ-Firestore |
| **תהליך** | מרכיב דוח שבועי: MRR, growth rate, נקודת הנטישה הגדולה במשפך, ביצועי onboarding → מציע 2–3 ניסויי A/B מנומקים (למשל: שינוי מכסת Free מ-25 ל-15, הזזת prompt השדרוג) עם הערכת impact |
| **Guardrails** | ❌ אסור: לשנות תמחור, מכסות או קופי במוצר בעצמו — **הצעות בלבד**; לא שולח מיילים למשתמשים |
| **אסקלציה לאדם** | תמיד — הדוח וההצעות נקראים בסקירה השבועית; התראה מיידית (Slack/Telegram) אם churn שבועי >2% או צניחת התקנות >30% |

### 2.4 Ops/Monitoring Agent — סוכן תפעול וניטור

| היבט | פירוט |
|---|---|
| **Trigger** | Cron כל שעה (בדיקת בריאות); Sentry webhook על שגיאה חדשה; Anthropic usage API פעמיים ביום |
| **כלים/אינטגרציות** | Sentry API (שגיאות backend + extension), UptimeRobot/health endpoints, Anthropic Console usage API (עלות יומית), Firebase metrics (Firestore reads, function errors), Stripe webhooks (payment failures) |
| **תהליך** | משווה לכל baseline: error rate, latency של enrichment, עלות API יומית מול תקציב, אחוז כשלונות תשלום → מתעד ב-ops-log; פותח issue בגיטהאב עם ניתוח stack trace לשגיאות חדשות |
| **Guardrails** | ✅ מותר אוטומטית: להפעיל kill-switch של פיצ'ר enrichment אם עלות API יומית חורגת פי 3 מהתקציב (feature flag), לעבור ל-Haiku-only במצב חירום. ❌ אסור: deploy קוד, שינוי כללי billing, מחיקת דאטה |
| **אסקלציה לאדם** | מיידית (SMS/Telegram): downtime >10 דקות, עלות API יומית >$100, זינוק שגיאות פי 5, אירוע אבטחה חשוד (דפוס abuse על ה-API proxy) |

### 2.5 Review-Response Agent — סוכן ביקורות

| היבט | פירוט |
|---|---|
| **Trigger** | Cron יומי 08:00 — scraping/API של ביקורות חדשות ב-Chrome Web Store וב-Firefox Add-ons |
| **כלים/אינטגרציות** | CWS Developer Dashboard (מענה לביקורות), sheet מעקב ביקורות, גישת read ל-known-issues.md |
| **תהליך** | ביקורת 4–5★ → תודה אישית קצרה + טיפ על פיצ'ר; ביקורת 1–3★ → מזהה את הבעיה, מגיב עם פתרון או "תוקן בגרסה X", מזמין לתמיכה במייל; מזין באגים חוזרים ל-backlog; עוקב אחר ממוצע הדירוג |
| **Guardrails** | ❌ אסור: להתווכח או להטיל ספק בחוויית המשתמש; להבטיח מועדי תיקון; תבנית תגובה זהה מילה במילה (נראה בוטי); יותר מתגובה אחת לביקורת |
| **אסקלציה לאדם** | ביקורת שמזכירה אבטחה/פרטיות/חיוב כפול; ירידת ממוצע מתחת 4.2★; גל של 3+ ביקורות שליליות על אותה בעיה ב-48 שעות (סימן לרגרסיה) |

### 2.6 Localization Agent — סוכן לוקליזציה

| היבט | פירוט |
|---|---|
| **Trigger** | GitHub Action על כל PR שמשנה `_locales/en/messages.json` או strings ב-dashboard |
| **כלים/אינטגרציות** | גישת PR לריפו, glossary.md (מונחים שלא מתרגמים: "bookmark star", שמות פיצ'רים), קבצי i18n של ההרחבה וה-dashboard |
| **תהליך** | מזהה מפתחות חדשים/שהשתנו → מתרגם ל-8 שפות (es, de, fr, pt, ja, he, ru, hi) בהתאם ל-glossary ולמגבלות אורך UI → פותח PR עם diff לכל שפה; מתרגם גם את דף ה-store listing |
| **Guardrails** | ❌ אסור: merge עצמאי; שינוי מפתח ה-source (אנגלית); חריגה ממגבלות אורך של שדות CWS |
| **אסקלציה לאדם** | strings משפטיים (privacy policy, ToS) — תמיד סימון לבדיקה אנושית/מקצועית; מונח חדש שאינו ב-glossary |

---

## 3. אפשרויות מימוש קונקרטיות

### אפשרות A — Claude API + Cron Jobs (הכי זול, הכי גמיש)

- כל סוכן = סקריפט TypeScript/Python שרץ כ-scheduled Cloud Function / GitHub Action / fly.io machine.
- קריאות Claude API (Haiku לסיווג וטיוטות שגרתיות, Sonnet לתוכן ולניתוח) עם tool use מוגדר (schema לכל אינטגרציה).
- state ב-Firestore (תור פניות, ops-log, לוח תוכן).
- **יתרונות:** שליטה מלאה, עלות מינימלית. **חסרונות:** צריך לכתוב את ה-plumbing (retry, logging) בעצמך.

### אפשרות B — Claude Code Automation (מומלץ למשימות ריפו)

- ריצות headless מתוזמנות: `claude -p "<prompt>" --allowedTools ...` מתוך GitHub Actions.
- אידיאלי לסוכנים שהתוצר שלהם הוא PR: **Localization Agent**, פוסטי בלוג של **Content Agent**, ניתוח stack traces של **Ops Agent** (כולל הצעת fix כ-PR).
- כל סוכן מוגדר כקובץ agent + skill בריפו — versioned, ניתן לביקורת.

### אפשרות C — n8n / Zapier Orchestration (הכי מהיר להקמה)

- n8n self-hosted (~$10/חודש על VPS, או n8n cloud ~$24) כשכבת החיווט: webhooks של Gmail/Stripe/Sentry → node של Claude API → פעולה (שליחה, פתיחת issue, Slack).
- מתאים במיוחד ל-**Support Agent** ו-**Review-Response Agent** (זרימות event-driven עם human-approval node מובנה).
- Zapier פשוט יותר אך מתייקר מהר (~$50+/חודש בנפחים שלנו) — עדיף n8n.

**ארכיטקטורה מומלצת (היברידית):**

| שכבה | טכנולוגיה | סוכנים |
|---|---|---|
| Event-driven | n8n + Claude API | Support, Review-Response, התראות Ops |
| Scheduled repo work | Claude Code ב-GitHub Actions | Content (בלוג), Localization, ניתוחי Ops |
| Analytics & reporting | Cloud Function + Claude API | Growth (דוח שבועי), Ops (בדיקות שעתיות) |

---

## 4. קצב תפעול שבועי אוטונומי

| יום | פעילות אוטומטית |
|---|---|
| **ראשון** | Content Agent מכין את לוח התוכן השבועי (טיוטה) |
| **שני** | Growth Agent: דוח משפך שבועי + הצעות A/B → נשלח לתיבת הסקירה; פוסט בלוג #1 כ-PR |
| **שלישי** | Review-Response Agent: סיכום ביקורות שבועי; Ops Agent: דוח עלויות API שבועי |
| **רביעי** | פוסט בלוג/סושיאל #2; Localization Agent מסנכרן strings שהצטברו |
| **חמישי** | Support Agent: דוח מגמות פניות (top issues) → מוזן ל-backlog |
| **שישי** | פוסט סושיאל #3 + "Collection of the week"; Ops: בדיקת בריאות מסכמת |
| **כל יום, רציף** | תמיכה במיילים, מענה לביקורות, ניטור שעתי, התראות חריגים |

### רשימת הסקירה האנושית — שעה אחת בשבוע (מומלץ: שני בערב)

| ⏱️ | משימה | מה בודקים |
|---|---|---|
| 10 דק' | דוח Growth שבועי | MRR, churn, משפך; אישור/דחיית 2–3 הצעות A/B |
| 10 דק' | תור אסקלציות Support | refunds, מקרים רגישים שהסוכן סימן |
| 10 דק' | אישור PRs של תוכן ולוקליזציה | פוסט בלוג (סריקה מהירה), תרגומים |
| 10 דק' | תור הסושיאל המתוזמן | מחיקה/עריכה של פוסטים ל-7 הימים הקרובים |
| 5 דק' | ביקורות CWS | ממוצע דירוג + תגובות הסוכן לביקורות שליליות |
| 10 דק' | דוח Ops ועלויות | עלות API מול תקציב, שגיאות פתוחות, חשבוניות |
| 5 דק' | החלטות | עדכון priorities לסוכנים לשבוע הבא (קובץ priorities.md אחד) |

**עיקרון על:** לסוכנים יש הרשאת **טיוטה ותגובה** — לאדם שמורה הרשאת **פרסום, כסף וקוד**. כל פעולה של סוכן נרשמת ל-audit log אחיד, כך שאפשר לשחזר כל החלטה.

---

## 5. אומדן עלות הפעלה חודשי

| סעיף | פירוט | עלות/חודש |
|---|---|---|
| Claude API — Support | ~600 פניות × ~3 קריאות × Haiku/Sonnet | $20–40 |
| Claude API — Content | 8–10 פוסטים + 20 פוסטי סושיאל × Sonnet | $30–50 |
| Claude API — Growth + Ops | דוחות שבועיים + בדיקות שעתיות (Haiku ברובן) | $30–60 |
| Claude API — Reviews + Localization | נפח קטן | $10–20 |
| n8n (self-hosted VPS) | Hetzner/fly.io | $10 |
| GitHub Actions | ברובו בתוך free tier | $0–10 |
| כלים (Buffer/Typefully, UptimeRobot, PostHog) | free/starter tiers בשלב זה | $20–40 |
| **סה"כ** | | **~$120–230/חודש** |

לשם השוואה: עוזר/ת וירטואלי/ת אנושי/ת במשרה חלקית לאותן משימות = $800–1,500/חודש. הסוכנים מחזירים את עלותם כבר ב-25–40 מנויי Pro — פחות מהיעד של סוף Q1 בתוכנית העסקית ([business-plan.md](./business-plan.md)).

## 6. סדר הקמה מומלץ (4 שבועות)

1. **שבוע 1:** Ops/Monitoring (הגנה קודם לכל) + audit log מרכזי.
2. **שבוע 2:** Support Agent + Review-Response (החוב התפעולי הכי כואב).
3. **שבוע 3:** Content Agent + לוח סושיאל; Localization כ-GitHub Action.
4. **שבוע 4:** Growth Agent + גיבוש טקס הסקירה השבועי של שעה אחת.

</div>
