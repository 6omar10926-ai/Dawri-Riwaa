/* =============================================================
   دوري رواء — النواة (State + Storage + Rules + Actions)
   كل شيء يُحفظ محليًا في المتصفح (localStorage). لا يوجد خادم.
   ============================================================= */
(function () {
  const App = (window.App = window.App || {});

  /* ---------- أدوات مساعدة ---------- */
  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  const fmtMoney = (n) => {
    const sign = n < 0 ? "−" : "";
    return sign + Math.abs(n).toLocaleString("en-US");
  };

  // اختصار المبالغ (2م / 500 ألف)
  const fmtShort = (n) => {
    const a = Math.abs(n);
    const sign = n < 0 ? "−" : "";
    if (a >= 1_000_000) {
      const v = n / 1_000_000;
      return sign + (Math.abs(v) % 1 === 0 ? Math.abs(v) : Math.abs(v).toFixed(1)) + "م";
    }
    if (a >= 1000) return sign + Math.round(a / 1000) + " ألف";
    return sign + a;
  };

  App.util = { uid, clamp, fmtMoney, fmtShort };

  /* ---------- تعريف الأحداث وقيمها (معايير الفلوس) ---------- */
  // القيم القابلة للتعديل من الإعدادات محفوظة في state.moneyRules
  App.EVENTS = [
    { key: "goal", label: "هدف", scores: true, defAmount: 1_000_000, side: "team" },
    { key: "penaltyGoal", label: "هدف بلنتي", scores: true, defAmount: 500_000, side: "team" },
    { key: "save", label: "تصدّي", scores: false, defAmount: 500_000, side: "team" },
    { key: "penaltySave", label: "تصدّي بلنتي", scores: false, defAmount: 2_000_000, side: "team" },
    { key: "freeKickSave", label: "تصدّي فاول", scores: false, defAmount: 1_000_000, side: "team" },
    { key: "yellow", label: "كرت أصفر", scores: false, defAmount: -500_000, side: "team" },
    { key: "red", label: "كرت أحمر", scores: false, defAmount: -1_000_000, side: "team" },
    { key: "nutmeg", label: "تسطيح", scores: false, defAmount: -1_000_000, side: "team" },
  ];

  App.RESULT_RULES = {
    win: { label: "فوز بالمباراة", defAmount: 2_000_000 },
    draw: { label: "تعادل", defAmount: 1_000_000 },
  };

  App.AWARD_RULES = {
    teamOfWeek: { label: "تشكيلة الأسبوع (لكل لاعب)", defAmount: 500_000 },
    clubLineup: { label: "تشكيلة النادي", defAmount: 500_000 },
  };

  const defaultMoneyRules = () => {
    const r = {};
    App.EVENTS.forEach((e) => (r[e.key] = e.defAmount));
    Object.entries(App.RESULT_RULES).forEach(([k, v]) => (r[k] = v.defAmount));
    Object.entries(App.AWARD_RULES).forEach(([k, v]) => (r[k] = v.defAmount));
    return r;
  };

  /* ---------- طاقات اللاعب الافتراضية ---------- */
  App.DEFAULT_STATS = [
    { key: "pace", label: "السرعة" },
    { key: "shooting", label: "التسديد" },
    { key: "passing", label: "التمرير" },
    { key: "dribbling", label: "المراوغة" },
    { key: "defending", label: "الدفاع" },
    { key: "physical", label: "البدنية" },
    { key: "goalkeeping", label: "الحراسة" },
  ];

  App.POSITIONS = ["حارس", "دفاع", "وسط", "هجوم"];

  /* ---------- معايير التقييم (طاقة اللاعب) ---------- */
  App.RATING_START = 50;
  App.RATING_MIN = 0;
  App.RATING_MAX = 99;

  App.RATING_RULES = {
    general: [
      { key: "goal", label: "هدف", pts: 10 },
      { key: "pass", label: "تمرير ناجح", pts: 1 },
      { key: "assist", label: "صناعة", pts: 7 },
      { key: "interception", label: "قطع الكرة", pts: 2 },
      { key: "outfieldSave", label: "تصدّي كرة على المرمى (غير الحارس)", pts: 5 },
    ],
    goalkeeper: [
      { key: "gkSave", label: "تصدّي ناجح", pts: 3 },
      { key: "cleanSheet", label: "شباك نظيفة", pts: 10 },
    ],
    deductions: [
      { key: "yellow", label: "بطاقة صفراء", pts: -5 },
      { key: "red", label: "بطاقة حمراء", pts: -13 },
      { key: "causePenalty", label: "تسبب بلنتي", pts: -7 },
      { key: "ownGoal", label: "هدف عكسي", pts: -10 },
      { key: "missedChance", label: "إضاعة فرصة محققة", pts: -4 },
      { key: "seriousFoul", label: "تسبب بفاول خطير", pts: -4 },
      { key: "generalFoul", label: "تسبب بخطأ عمومًا", pts: -2 },
      { key: "concededGoal", label: "استقبال هدف", pts: -3 },
    ],
  };
  App.ratingRuleList = () => [
    ...App.RATING_RULES.general,
    ...App.RATING_RULES.goalkeeper,
    ...App.RATING_RULES.deductions,
  ];
  const defaultRatingRules = () => {
    const r = {};
    App.ratingRuleList().forEach((e) => (r[e.key] = e.pts));
    return r;
  };

  /* ---------- حركات المباراة (مصدر موحّد) ----------
     كل حركة تُسجّل مرة واحدة في نموذج المباراة، وقد:
       • تسجّل هدفًا في النتيجة (scores)
       • تُضيف/تخصم فلوسًا للفريق (المفتاح نفسه موجود في moneyRules)
       • تغيّر تقييم اللاعب المرتبط بها (ratingKey — قد تكون دالة تفرّق بين الحارس واللاعب)
     بهذا يكفي إدخال الهدف/التصدّي مرة واحدة ليظهر في النتيجة ويُحدّث تقييم اللاعب معًا. */
  const GK = App.POSITIONS[0]; // "حارس"
  App.MATCH_ACTIONS = [
    { key: "goal",         label: "هدف",              scores: true,  money: true,  ratingKey: "goal" },
    { key: "penaltyGoal",  label: "هدف بلنتي",        scores: true,  money: true,  ratingKey: "goal" },
    { key: "assist",       label: "صناعة",                           ratingKey: "assist" },
    { key: "pass",         label: "تمرير ناجح",                      ratingKey: "pass" },
    { key: "interception", label: "قطع الكرة",                       ratingKey: "interception" },
    { key: "save",         label: "تصدّي",                          money: true,  ratingKey: (p) => (p && p.position === GK ? "gkSave" : "outfieldSave") },
    { key: "penaltySave",  label: "تصدّي بلنتي",       money: true,  ratingKey: "gkSave" },
    { key: "freeKickSave", label: "تصدّي فاول",        money: true,  ratingKey: "gkSave" },
    { key: "cleanSheet",   label: "شباك نظيفة",                      ratingKey: "cleanSheet" },
    { key: "yellow",       label: "كرت أصفر",          money: true,  ratingKey: "yellow" },
    { key: "red",          label: "كرت أحمر",          money: true,  ratingKey: "red" },
    { key: "nutmeg",       label: "تسطيح",             money: true },
    { key: "ownGoal",      label: "هدف عكسي",         scoresOpponent: true, ratingKey: "ownGoal" },
    { key: "concededGoal", label: "استقبال هدف",                     ratingKey: "concededGoal" },
    { key: "missedChance", label: "إضاعة فرصة محققة",                 ratingKey: "missedChance" },
    { key: "causePenalty", label: "تسبب بلنتي",                      ratingKey: "causePenalty" },
    { key: "seriousFoul",  label: "تسبب بفاول خطير",                  ratingKey: "seriousFoul" },
    { key: "generalFoul",  label: "تسبب بخطأ عمومًا",                 ratingKey: "generalFoul" },
  ];
  App.matchAction = (key) => App.MATCH_ACTIONS.find((a) => a.key === key) || null;
  // مفتاح قاعدة التقييم لحركة مباراة معيّنة (يراعي مركز اللاعب)
  App.actionRatingKey = (action, player) => {
    if (!action || !action.ratingKey) return null;
    return typeof action.ratingKey === "function" ? action.ratingKey(player) : action.ratingKey;
  };

  /* ---------- الحالة الافتراضية ---------- */
  // هويات الفرق (الاسم/اللون/الشعار مأخوذة من ملف الهويات)
  // code = كلمة مرور رئيس النادي الافتراضية (يمكن للمشرف تغييرها)
  const TEAM_IDENTITIES = [
    { name: "بؤرة", color: "#5e71e8", logo: "assets/teams/bura.png", code: "1111" },
    { name: "الرواد", color: "#b3b6fc", logo: "assets/teams/rowad.png", code: "2222" },
    { name: "الفهود", color: "#c9a24a", logo: "assets/teams/fuhood.png", code: "3333" },
  ];
  App.TEAM_IDENTITIES = TEAM_IDENTITIES;
  App.DEFAULT_ADMIN_CODE = "admin";
  // ميزانية البداية لكل فريق (تُمنح لكل الفرق بالتساوي عند إنشاء دوري جديد)
  App.START_BUDGET = 20_000_000;
  const OLD_DEFAULT_TEAM_NAMES = /^الفريق (الأول|الثاني|الثالث)$/;

  function defaultState() {
    const teams = TEAM_IDENTITIES.map((idn) => ({
      id: uid(),
      name: idn.name,
      color: idn.color,
      logo: idn.logo,
      code: idn.code,
      budget: App.START_BUDGET,
      captainId: null,
    }));
    return {
      version: 1,
      club: { name: "دوري رواء", currency: "﷼", season: 1, week: 1, adminCode: App.DEFAULT_ADMIN_CODE },
      teams,
      players: [],
      statDefs: App.DEFAULT_STATS.slice(),
      moneyRules: defaultMoneyRules(),
      customMoneyRules: [], // معايير فلوس مخصّصة يضيفها المشرف {key,label,amount}
      ratingRules: defaultRatingRules(),
      matches: [],
      fixtures: [],
      lineups: {},
      ledger: [],
      ratingLog: [],
      market: { active: false, week: 1, lots: [] },
      marketHistory: [], // أرشيف الأسواق المغلقة مع صفقاتها
      weekEvents: [], // أحداث يدوية لكل أسبوع {id,week,text,date}
    };
  }
  App.defaultState = defaultState;

  /* ---------- التخزين ---------- */
  const KEY = "dawri_rowad_v1";
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      return migrate(s);
    } catch (e) {
      console.error("فشل تحميل البيانات", e);
      return defaultState();
    }
  }
  function migrate(s) {
    const d = defaultState();
    s.club = Object.assign(d.club, s.club || {});
    // ترقية اسم الدوري القديم إلى الهوية الجديدة
    if (!s.club.name || s.club.name === "دوري الروّاد") s.club.name = d.club.name;
    s.moneyRules = Object.assign(defaultMoneyRules(), s.moneyRules || {});
    s.customMoneyRules = Array.isArray(s.customMoneyRules) ? s.customMoneyRules : [];
    s.ratingRules = Object.assign(defaultRatingRules(), s.ratingRules || {});
    if (!Array.isArray(s.statDefs) || !s.statDefs.length) s.statDefs = d.statDefs;
    s.teams = s.teams || d.teams;
    // إسناد هوية كل فريق (الاسم/اللون/الشعار) حسب الترتيب،
    // مع الحفاظ على الأسماء التي عدّلها المستخدم يدويًا.
    s.teams.forEach((t, i) => {
      const idn = TEAM_IDENTITIES[i];
      if (!idn) return;
      if (!t.logo) t.logo = idn.logo;
      if (!t.code) t.code = idn.code;
      if (OLD_DEFAULT_TEAM_NAMES.test(t.name || "")) {
        t.name = idn.name;
        t.color = idn.color;
      }
    });
    if (!s.club.adminCode) s.club.adminCode = App.DEFAULT_ADMIN_CODE;
    // ترقية لمرة واحدة: ضبط ميزانية كل فريق على 20 مليون بالضبط.
    if (!s.club.startBudgetSeeded) {
      s.teams.forEach((t) => { t.budget = App.START_BUDGET; });
      s.club.startBudgetSeeded = true;
    }
    s.players = s.players || [];
    s.players.forEach((p) => {
      if (typeof p.rating !== "number") p.rating = App.RATING_START;
      if (!p.stats) p.stats = {};
    });
    s.matches = s.matches || [];
    // حماية: تأكّد أن لكل مباراة مصفوفة أحداث ونتيجة، حتى لا تنهار صفحة النتائج
    // إذا وصلت بيانات ناقصة (من نسخة قديمة أو مزامنة جزئية).
    s.matches.forEach((m) => {
      if (!Array.isArray(m.events)) m.events = [];
      if (typeof m.homeScore !== "number" || typeof m.awayScore !== "number") {
        const sc = computeMatchScores(m);
        m.homeScore = sc.home;
        m.awayScore = sc.away;
      }
    });
    s.fixtures = s.fixtures || [];
    s.lineups = s.lineups || {};
    s.ledger = s.ledger || [];
    s.ratingLog = s.ratingLog || [];
    // تطبيع كائن السوق: قد تصل حالة قديمة أو مزامنة سحابية جزئية بلا مصفوفة
    // lots، أو عناصر مزاد بلا bids، فتنهار صفحة السوق عند قراءة .length.
    s.market = s.market || d.market;
    if (!Array.isArray(s.market.lots)) s.market.lots = [];
    if (typeof s.market.active !== "boolean") s.market.active = false;
    if (typeof s.market.week !== "number") s.market.week = s.club.week || 1;
    s.market.lots.forEach((lot) => {
      if (!Array.isArray(lot.bids)) lot.bids = [];
      if (lot.status !== "sold" && lot.status !== "unsold") lot.status = "open";
      if (typeof lot.finalPrice !== "number") lot.finalPrice = 0;
      if (lot.winnerTeamId === undefined) lot.winnerTeamId = null;
    });
    // حقول المزاد بالمؤقّت: سوق نشط قديم بلا started يُعتبر بدأ (إرساء يدوي يعمل)
    if (typeof s.market.started !== "boolean") s.market.started = !!s.market.active;
    if (typeof s.market.maxPerTeam !== "number") s.market.maxPerTeam = App.MARKET_MAX_PER_TEAM;
    if (typeof s.market.endsAt !== "number") s.market.endsAt = null;
    if (typeof s.market.currentIndex !== "number") s.market.currentIndex = 0;
    // سوق نشط بلا لاعبين لا معنى له — نعتبره مغلقًا حتى لا تظهر صفحة فارغة
    if (s.market.active && !s.market.lots.length) s.market.active = false;
    s.marketHistory = Array.isArray(s.marketHistory) ? s.marketHistory : [];
    s.weekEvents = Array.isArray(s.weekEvents) ? s.weekEvents : [];
    return s;
  }
  function saveLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify(App.state));
    } catch (e) {
      console.warn("تعذّر الحفظ المحلي", e);
    }
  }
  function save() {
    saveLocal();
    // خطّاف المزامنة السحابية (يضبطه sync.js عند توفّر Firebase)
    if (typeof App.afterSave === "function") App.afterSave();
  }
  App.save = save;
  App.saveLocal = saveLocal;

  // تطبيق حالة قادمة من السحابة (بدون إعادة رفعها) — يستخدمها sync.js
  App.applyCloudState = function (obj) {
    App.state = migrate(obj);
    saveLocal();
  };

  App.state = load();

  /* ---------- محددات (Selectors) ---------- */
  App.getTeam = (id) => App.state.teams.find((t) => t.id === id) || null;
  App.getPlayer = (id) => App.state.players.find((p) => p.id === id) || null;
  App.teamPlayers = (teamId) => App.state.players.filter((p) => p.teamId === teamId);
  App.freeAgents = () => App.state.players.filter((p) => !p.teamId);

  // طاقة اللاعب في أسبوع معيّن: تبدأ كل أسبوع من 50 وتتغيّر بمجموع تقييمات
  // ذلك الأسبوع فقط (مشتقّة من ratingLog حسب الأسبوع، لا رقم تراكمي واحد).
  App.playerWeekRating = function (playerId, week) {
    const sum = App.state.ratingLog
      .filter((l) => l.playerId === playerId && l.week === week)
      .reduce((s, l) => s + (l.delta || 0), 0);
    return clamp(App.RATING_START + sum, App.RATING_MIN, App.RATING_MAX);
  };

  // تقييم اللاعب (الرقم الكبير على البطاقة) = طاقته في الأسبوع الحالي.
  App.playerOverall = (p) => App.playerWeekRating(p.id, App.state.club.week);

  // الأسابيع التي فيها نشاط تقييمي للاعب (مرتّبة تصاعديًا)
  App.playerActiveWeeks = function (playerId) {
    const weeks = new Set();
    App.state.ratingLog.forEach((l) => { if (l.playerId === playerId) weeks.add(l.week); });
    return [...weeks].sort((a, b) => a - b);
  };

  // إحصائيات اللاعب في أسبوع (تجميع تفاصيل التقييمات): { ruleKey: count }
  App.playerWeekStats = function (playerId, week) {
    const agg = {};
    App.state.ratingLog
      .filter((l) => l.playerId === playerId && l.week === week)
      .forEach((l) => (l.breakdown || []).forEach((b) => { agg[b.key] = (agg[b.key] || 0) + (b.count || 0); }));
    return agg;
  };

  // متوسط المهارات الوصفية الاختيارية (لا يؤثر على التقييم)
  App.playerAttrAvg = (p) => {
    const defs = App.state.statDefs;
    let sum = 0,
      count = 0;
    defs.forEach((d) => {
      const v = p.stats && typeof p.stats[d.key] === "number" ? p.stats[d.key] : null;
      if (v !== null) {
        sum += v;
        count++;
      }
    });
    return count ? Math.round(sum / count) : null;
  };

  /* ---------- تقييم اللاعب (حساب الطاقة) ---------- */
  // counts: خريطة { ruleKey: عدد المرات }. تُحسب النقاط وتُطبّق على التقييم مع حفظ الحسبة.
  // opts (اختياري): { week, matchId } لربط التقييم بمباراة معيّنة.
  function applyRatingCounts(playerId, counts, note, opts) {
    const p = App.getPlayer(playerId);
    if (!p) return null;
    const rules = App.state.ratingRules;
    const breakdown = [];
    let delta = 0;
    App.ratingRuleList().forEach((rule) => {
      const c = parseInt(counts[rule.key], 10) || 0;
      if (!c) return;
      const pts = rules[rule.key] || 0;
      const subtotal = c * pts;
      delta += subtotal;
      breakdown.push({ key: rule.key, label: rule.label, count: c, pts, subtotal });
    });
    if (!breakdown.length) return null;
    const week = (opts && opts.week) || App.state.club.week;
    const oldRating = App.playerWeekRating(playerId, week); // طاقته في ذلك الأسبوع قبل الإضافة
    App.state.ratingLog.push({
      id: uid(),
      playerId,
      week,
      date: new Date().toISOString(),
      delta,
      breakdown,
      note: note || "",
      matchId: (opts && opts.matchId) || null,
    });
    const newRating = App.playerWeekRating(playerId, week); // بعده (يشمل السطر الجديد)
    const last = App.state.ratingLog[App.state.ratingLog.length - 1];
    last.oldRating = oldRating;
    last.newRating = newRating;
    last.applied = newRating - oldRating; // للعرض فقط
    return { oldRating, newRating, delta, breakdown };
  }
  App.applyRatingCounts = applyRatingCounts;

  function evaluatePlayer(playerId, counts, note) {
    const res = applyRatingCounts(playerId, counts, note, null);
    if (res) save();
    return res;
  }
  App.evaluatePlayer = evaluatePlayer;

  // يطبّق تقييمات المباراة تلقائيًا: يجمع أحداث كل لاعب في عملية تقييم واحدة مربوطة بالمباراة.
  function applyMatchRatings(match) {
    const byPlayer = {}; // playerId -> { ratingRuleKey: count }
    match.events.forEach((ev) => {
      if (!ev.playerId) return;
      const action = App.matchAction(ev.type);
      const p = App.getPlayer(ev.playerId);
      const rKey = App.actionRatingKey(action, p);
      if (!rKey || !p) return;
      (byPlayer[ev.playerId] = byPlayer[ev.playerId] || {});
      byPlayer[ev.playerId][rKey] = (byPlayer[ev.playerId][rKey] || 0) + 1;
    });
    const home = App.getTeam(match.homeTeamId);
    const away = App.getTeam(match.awayTeamId);
    const note = "مباراة: " + (home ? home.name : "؟") + " ضد " + (away ? away.name : "؟");
    Object.keys(byPlayer).forEach((pid) => {
      applyRatingCounts(pid, byPlayer[pid], note, { week: match.week, matchId: match.id });
    });
  }
  App.applyMatchRatings = applyMatchRatings;

  // إلغاء تقييمات مباراة (عند حذفها): يكفي حذف سجلّاتها لأن الطاقة مشتقّة من السجل.
  function reverseMatchRatings(matchId) {
    App.state.ratingLog = App.state.ratingLog.filter((l) => l.matchId !== matchId);
  }
  App.reverseMatchRatings = reverseMatchRatings;

  // تعديل يدوي مباشر لطاقة اللاعب في الأسبوع الحالي (يُسجَّل كفرق في ذلك الأسبوع)
  function adjustRating(playerId, newValue, note) {
    const p = App.getPlayer(playerId);
    if (!p) return;
    const week = App.state.club.week;
    const oldRating = App.playerWeekRating(playerId, week);
    const nv = clamp(parseInt(newValue, 10) || 0, App.RATING_MIN, App.RATING_MAX);
    App.state.ratingLog.push({
      id: uid(),
      playerId,
      week,
      date: new Date().toISOString(),
      delta: nv - oldRating,
      applied: nv - oldRating,
      oldRating,
      newRating: nv,
      breakdown: [],
      note: note || "تعديل يدوي",
    });
    save();
  }
  App.adjustRating = adjustRating;

  App.playerRatingLog = (playerId) =>
    App.state.ratingLog.filter((l) => l.playerId === playerId).slice().reverse();

  // مدّة المباراة بالدقائق (تُستخدم لحساب دقائق اللعب)
  App.MATCH_MINUTES = 15;

  // المباريات التي شارك فيها اللاعب (له حدث فيها) — الأحدث أولًا
  App.playerMatches = (playerId) =>
    App.state.matches
      .filter((m) => Array.isArray(m.events) && m.events.some((e) => e.playerId === playerId))
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date));

  // تشكيلة الأسبوع: 6 لاعبين مبنية على تقييماتهم (طاقاتهم) بخطة 1-2-2-1
  // (حارس + مدافعان + وسطان + مهاجم)، وتُكمَّل من الأعلى تقييمًا عند نقص مركز.
  App.teamOfWeek = function (size, week) {
    size = size || 6;
    const players = App.state.players.slice();
    const rate = (p) => (week ? App.playerWeekRating(p.id, week) : App.playerOverall(p));
    const byRating = (a, b) => rate(b) - rate(a);
    const used = new Set();
    const take = (pos, n) => {
      const picks = players
        .filter((p) => p.position === pos && !used.has(p.id))
        .sort(byRating)
        .slice(0, n);
      picks.forEach((p) => used.add(p.id));
      return picks;
    };
    let sel = [...take("حارس", 1), ...take("دفاع", 2), ...take("وسط", 2), ...take("هجوم", 1)];
    if (sel.length < size) {
      const fill = players.filter((p) => !used.has(p.id)).sort(byRating).slice(0, size - sel.length);
      sel = sel.concat(fill);
    }
    return sel.slice(0, size);
  };

  // إحصائيات مشتقّة للمباراة (استحواذ تقديري + تسديدات + أخطاء...) من الأحداث المسجّلة
  App.matchStats = function (m) {
    const events = (m && m.events) || [];
    const per = (teamId) => {
      const c = {};
      events.filter((e) => e.teamId === teamId).forEach((e) => (c[e.type] = (c[e.type] || 0) + 1));
      return c;
    };
    const H = per(m.homeTeamId), A = per(m.awayTeamId);
    const goals = (c) => (c.goal || 0) + (c.penaltyGoal || 0);
    const saves = (c) => (c.save || 0) + (c.penaltySave || 0) + (c.freeKickSave || 0);
    const fouls = (c) => (c.seriousFoul || 0) + (c.generalFoul || 0) + (c.causePenalty || 0);
    // تسديدات على المرمى = أهدافه + تصدّيات الخصم (كل تصدٍّ يعني تسديدة على المرمى)
    const sot = (mine, opp) => goals(mine) + saves(opp);
    const shots = (mine, opp) => sot(mine, opp) + (mine.missedChance || 0);
    const side = (mine, opp) => ({
      goals: goals(mine),
      shots: shots(mine, opp),
      shotsOnTarget: sot(mine, opp),
      passes: mine.pass || 0,
      assists: mine.assist || 0,
      interceptions: mine.interception || 0,
      saves: saves(mine),
      fouls: fouls(mine),
      yellow: mine.yellow || 0,
      red: mine.red || 0,
      nutmeg: mine.nutmeg || 0,
      missed: mine.missedChance || 0,
      // نسبة التحويل: أهداف ÷ تسديدات
      conversion: shots(mine, opp) ? Math.round((goals(mine) / shots(mine, opp)) * 100) : 0,
    });
    return { home: side(H, A), away: side(A, H), hasData: events.length > 0 };
  };

  /* ---------- المعاملات المالية (مصدر الحقيقة الوحيد للميزانية) ---------- */
  // كل تغيير على ميزانية فريق يمر من هنا: يحدّث budget ويضيف سطر في الدفتر.
  function addTransaction(teamId, amount, reason, meta) {
    const team = App.getTeam(teamId);
    if (!team) return;
    team.budget += amount;
    App.state.ledger.push({
      id: uid(),
      teamId,
      amount,
      reason,
      refType: (meta && meta.refType) || "manual",
      refId: (meta && meta.refId) || null,
      week: App.state.club.week,
      date: new Date().toISOString(),
    });
  }
  App.addTransaction = addTransaction;

  // حذف كل معاملات مرجع معيّن (لإلغاء مباراة مثلاً) وإرجاع المبالغ.
  function reverseByRef(refType, refId) {
    const affected = App.state.ledger.filter(
      (l) => l.refType === refType && l.refId === refId
    );
    affected.forEach((l) => {
      const t = App.getTeam(l.teamId);
      if (t) t.budget -= l.amount;
    });
    App.state.ledger = App.state.ledger.filter(
      (l) => !(l.refType === refType && l.refId === refId)
    );
  }
  App.reverseByRef = reverseByRef;

  /* ---------- المباريات ---------- */
  // match: { homeTeamId, awayTeamId, week, date, events:[{type,teamId,playerId}], note }
  function computeMatchScores(match) {
    let home = 0,
      away = 0;
    match.events.forEach((ev) => {
      const def = App.matchAction(ev.type);
      if (!def) return;
      if (def.scores) {
        // هدف عادي يُحسب لفريق صاحب الحدث
        if (ev.teamId === match.homeTeamId) home++;
        else if (ev.teamId === match.awayTeamId) away++;
      } else if (def.scoresOpponent) {
        // هدف عكسي يُحسب لصالح الفريق الخصم
        if (ev.teamId === match.homeTeamId) away++;
        else if (ev.teamId === match.awayTeamId) home++;
      }
    });
    return { home, away };
  }
  App.computeMatchScores = computeMatchScores;

  // حساب النتيجة والفائز وتخزينها على المباراة
  function computeMatchMeta(match) {
    const { home, away } = computeMatchScores(match);
    match.homeScore = home;
    match.awayScore = away;
    match.result = home === away ? "draw" : home > away ? "home" : "away";
  }

  // تطبيق فلوس المباراة (الأحداث + النتيجة) على ميزانيات الفرق
  function applyMatchFinancials(match) {
    const rules = App.state.moneyRules;
    const id = match.id;
    // فلوس الأحداث
    match.events.forEach((ev) => {
      const def = App.matchAction(ev.type);
      // هدف عكسي: يُحتسب هدفًا للفريق الخصم، فتُضاف قيمة الهدف (فلوسه) لميزانية الخصم
      if (def && def.scoresOpponent) {
        const goalAmount = rules.goal || 0;
        if (goalAmount) {
          const oppId = ev.teamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
          addTransaction(oppId, goalAmount, "مباراة: هدف (من هدف عكسي للخصم)", {
            refType: "match",
            refId: id,
          });
        }
        return;
      }
      const amount = rules[ev.type] || 0;
      if (!amount) return;
      const pl = ev.playerId ? App.getPlayer(ev.playerId) : null;
      const label = def ? def.label : ev.type;
      const who = pl ? " — " + pl.name : "";
      addTransaction(ev.teamId, amount, "مباراة: " + label + who, {
        refType: "match",
        refId: id,
      });
    });
    // فلوس النتيجة
    if (match.result === "draw") {
      addTransaction(match.homeTeamId, rules.draw, "تعادل", { refType: "match", refId: id });
      addTransaction(match.awayTeamId, rules.draw, "تعادل", { refType: "match", refId: id });
    } else {
      const winnerId = match.result === "home" ? match.homeTeamId : match.awayTeamId;
      addTransaction(winnerId, rules.win, "فوز بالمباراة", { refType: "match", refId: id });
    }
  }

  function recordMatch(match) {
    const id = match.id || uid();
    match.id = id;
    match.date = match.date || new Date().toISOString();
    match.week = match.week || App.state.club.week;
    computeMatchMeta(match);
    applyMatchFinancials(match);
    App.state.matches.push(match);
    // تحديث تقييمات اللاعبين من أحداث المباراة (إدخال واحد → نتيجة + تقييم)
    applyMatchRatings(match);
    save();
    return match;
  }
  App.recordMatch = recordMatch;

  // تعديل مباراة مسجّلة: يلغي أثرها القديم (فلوس + تقييمات) ثم يعيد تطبيقها بالبيانات الجديدة.
  function updateMatch(id, data) {
    const match = App.state.matches.find((m) => m.id === id);
    if (!match) return null;
    reverseByRef("match", id);
    reverseMatchRatings(id);
    if (data.homeTeamId) match.homeTeamId = data.homeTeamId;
    if (data.awayTeamId) match.awayTeamId = data.awayTeamId;
    if (data.events) match.events = data.events;
    if (typeof data.note === "string") match.note = data.note;
    if (data.week) match.week = parseInt(data.week, 10) || match.week;
    computeMatchMeta(match);
    applyMatchFinancials(match);
    applyMatchRatings(match);
    save();
    return match;
  }
  App.updateMatch = updateMatch;

  function deleteMatch(id) {
    reverseByRef("match", id);
    reverseMatchRatings(id);
    App.state.matches = App.state.matches.filter((m) => m.id !== id);
    save();
  }
  App.deleteMatch = deleteMatch;

  /* ---------- الجوائز (تشكيلة الأسبوع / تشكيلة النادي) ---------- */
  function grantAward(kind, teamId, playerId) {
    const rules = App.state.moneyRules;
    const amount = rules[kind] || 0;
    const meta = App.AWARD_RULES[kind];
    const pl = playerId ? App.getPlayer(playerId) : null;
    const reason = (meta ? meta.label : kind) + (pl ? " — " + pl.name : "");
    addTransaction(teamId, amount, reason, { refType: "award", refId: kind });
    save();
  }
  App.grantAward = grantAward;

  /* ---------- تعديل الميزانية يدويًا + معايير الفلوس المخصّصة ---------- */
  // تعديل يدوي لمرة واحدة على ميزانية فريق (إضافة أو خصم) يُسجَّل في الدفتر.
  App.adjustBudget = function (teamId, amount, reason) {
    amount = Math.round(Number(amount) || 0);
    if (!App.getTeam(teamId) || !amount) return { ok: false, msg: "أدخل مبلغًا صحيحًا" };
    addTransaction(teamId, amount, reason && reason.trim() ? reason.trim() : "تعديل يدوي", { refType: "manual" });
    save();
    return { ok: true };
  };

  // معايير مخصّصة: قائمة {key,label,amount} يديرها المشرف ويطبّقها يدويًا على أي فريق.
  App.addCustomMoneyRule = function (label, amount) {
    label = (label || "").trim();
    amount = Math.round(Number(amount) || 0);
    if (!label) return { ok: false, msg: "اكتب اسم المعيار" };
    App.state.customMoneyRules.push({ key: "cm_" + uid(), label, amount });
    save();
    return { ok: true };
  };
  App.updateCustomMoneyRule = function (key, patch) {
    const r = App.state.customMoneyRules.find((x) => x.key === key);
    if (!r) return;
    if (typeof patch.label === "string" && patch.label.trim()) r.label = patch.label.trim();
    if (patch.amount !== undefined) r.amount = Math.round(Number(patch.amount) || 0);
    save();
  };
  App.removeCustomMoneyRule = function (key) {
    App.state.customMoneyRules = App.state.customMoneyRules.filter((x) => x.key !== key);
    save();
  };

  /* ---------- سوق الانتقالات (المزاد) ---------- */
  // إعدادات المزاد بالمؤقّت
  App.AUCTION_DURATION_MS = 45_000;      // مدة المزاد لكل لاعب
  App.AUCTION_EXTEND_WINDOW_MS = 10_000; // آخر نافذة زمنية يُفعّل فيها التمديد
  App.AUCTION_EXTEND_MS = 5_000;         // مقدار التمديد عند مزايدة في آخر النافذة
  App.MARKET_MAX_PER_TEAM = 2;           // أقصى عدد لاعبين يشتريها الفريق في الجولة

  // تُنزّل اللاعبين في السوق دون بدء المزاد (مرحلة تحضير). البدء بزر "ابدأ السوق".
  function openMarket(playerIds) {
    // أرشف السوق السابق (إن كان فيه صفقات ولم يُؤرشَف) قبل استبداله
    archiveMarket(App.state.market);
    App.state.market = {
      id: uid(),
      active: true,
      started: false,   // لم يبدأ المزاد بعد (مرحلة التحضير)
      archived: false,
      week: App.state.club.week,
      // currentIndex: اللاعب المعروض حاليًا. يُكشف واحدًا تلو الآخر —
      // اللاعبون بعده مخفيون حتى يُرسى على الحالي فينتقل للتالي.
      currentIndex: 0,
      endsAt: null,     // وقت انتهاء مؤقّت اللاعب الحالي (ms) — يُضبط عند البدء
      maxPerTeam: App.MARKET_MAX_PER_TEAM,
      lots: playerIds.map((pid) => ({
        id: uid(),
        playerId: pid,
        bids: [],
        status: "open", // open | sold | unsold
        winnerTeamId: null,
        finalPrice: 0,
      })),
    };
    save();
  }
  App.openMarket = openMarket;

  // كم لاعبًا اشترى الفريق في هذه الجولة (لتطبيق الحد الأقصى)
  App.marketTeamPurchases = function (teamId, mk) {
    mk = mk || App.state.market;
    if (!mk || !Array.isArray(mk.lots)) return 0;
    return mk.lots.filter((l) => l.status === "sold" && l.winnerTeamId === teamId).length;
  };
  App.marketMaxPerTeam = function (mk) {
    mk = mk || App.state.market;
    return typeof (mk && mk.maxPerTeam) === "number" ? mk.maxPerTeam : App.MARKET_MAX_PER_TEAM;
  };
  App.marketTeamAtCap = function (teamId, mk) {
    mk = mk || App.state.market;
    return App.marketTeamPurchases(teamId, mk) >= App.marketMaxPerTeam(mk);
  };

  // يضبط وقت انتهاء مؤقّت اللاعب الحالي (أو يُفرغه لو انتهى السوق)
  function armLotTimer() {
    const mk = App.state.market;
    const lot = mk.lots[mk.currentIndex];
    mk.endsAt = lot && lot.status === "open" ? Date.now() + App.AUCTION_DURATION_MS : null;
  }

  // بدء المزاد: يذهب لأول لاعب مفتوح ويشغّل مؤقّته
  function startMarket() {
    const mk = App.state.market;
    if (!mk || !mk.active || mk.started) return;
    mk.started = true;
    const i = mk.lots.findIndex((l) => l.status === "open");
    mk.currentIndex = i === -1 ? mk.lots.length : i;
    armLotTimer();
    save();
  }
  App.startMarket = startMarket;

  // يُرسي اللاعب الحالي إذا انتهى وقته (يستدعيه المؤقّت في الواجهة — المشرف فقط)
  App.expireCurrentLot = function () {
    const mk = App.state.market;
    if (!mk || !mk.active || !mk.started || typeof mk.endsAt !== "number") return false;
    if (Date.now() < mk.endsAt) return false;
    const lot = mk.lots[mk.currentIndex];
    if (!lot || lot.status !== "open") { mk.endsAt = null; save(); return false; }
    finalizeLot(lot.id); // يُرسي ويتقدّم ويعيد ضبط المؤقّت ويحفظ
    return true;
  };

  function pickRandomForMarket(count) {
    const pool = App.freeAgents();
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map((p) => p.id);
  }
  App.pickRandomForMarket = pickRandomForMarket;

  // قواعد المزايدة: تبدأ من مليون، وكل مزايدة من مضاعفات 200 ألف
  App.MARKET_MIN_BID = 1_000_000;
  App.MARKET_BID_STEP = 200_000;

  // أقل مزايدة مسموحة للاعب: أول مزايدة = الحد الأدنى، وما بعدها = الأعلى + الخطوة
  App.marketMinBid = function (lot) {
    const highest = lot && lot.bids && lot.bids.length ? lot.bids[lot.bids.length - 1].amount : 0;
    return highest ? highest + App.MARKET_BID_STEP : App.MARKET_MIN_BID;
  };

  function placeBid(lotId, teamId, amount) {
    const mk = App.state.market;
    if (!mk.started) return { ok: false, msg: "لم يبدأ السوق بعد" };
    const lot = mk.lots.find((l) => l.id === lotId);
    if (!lot || lot.status !== "open") return { ok: false, msg: "المزايدة مغلقة" };
    // المزايدة على اللاعب المعروض حاليًا فقط
    const current = mk.lots[mk.currentIndex];
    if (current && current.id !== lot.id)
      return { ok: false, msg: "هذا ليس اللاعب المعروض حاليًا" };
    const team = App.getTeam(teamId);
    if (!team) return { ok: false, msg: "فريق غير موجود" };
    // حد الفريق: لا يشتري أكثر من العدد المسموح في الجولة
    if (App.marketTeamAtCap(teamId, mk))
      return { ok: false, msg: "الفريق استنفد نصيبه (" + App.marketMaxPerTeam(mk) + " لاعبين) في هذه الجولة" };
    const step = App.MARKET_BID_STEP;
    const minAllowed = App.marketMinBid(lot);
    if (amount % step !== 0)
      return { ok: false, msg: "المزايدة يجب أن تكون من مضاعفات " + fmtMoney(step) };
    if (amount < minAllowed)
      return { ok: false, msg: "أقل مزايدة مسموحة: " + fmtMoney(minAllowed) };
    if (amount > team.budget)
      return { ok: false, msg: "ميزانية الفريق لا تكفي (" + fmtMoney(team.budget) + ")" };
    lot.bids.push({ teamId, amount, at: new Date().toISOString() });
    // مانع القنص: مزايدة في آخر نافذة زمنية تمدّد الوقت 5 ثوانٍ
    if (typeof mk.endsAt === "number") {
      const remaining = mk.endsAt - Date.now();
      if (remaining > 0 && remaining <= App.AUCTION_EXTEND_WINDOW_MS)
        mk.endsAt += App.AUCTION_EXTEND_MS;
    }
    save();
    return { ok: true };
  }
  App.placeBid = placeBid;

  // ينتقل للاعب التالي (يكشفه) بعد إرساء اللاعب الحالي أو تخطّيه
  function advanceMarket(idx) {
    const mk = App.state.market;
    if (typeof mk.currentIndex === "number" && idx === mk.currentIndex) {
      mk.currentIndex = Math.min(mk.currentIndex + 1, mk.lots.length);
    }
  }

  function finalizeLot(lotId) {
    const mk = App.state.market;
    const idx = mk.lots.findIndex((l) => l.id === lotId);
    const lot = mk.lots[idx];
    if (!lot || lot.status !== "open") return;
    if (!lot.bids.length) {
      lot.status = "unsold";
    } else {
      const top = lot.bids[lot.bids.length - 1];
      const player = App.getPlayer(lot.playerId);
      lot.status = "sold";
      lot.winnerTeamId = top.teamId;
      lot.finalPrice = top.amount;
      // خصم الثمن من المشتري فقط — القيمة "تختفي" ولا تُضاف لأي فريق (حتى لو كان
      // اللاعب مملوكًا لفريق آخر، فريقه السابق لا يحصل على شيء).
      addTransaction(top.teamId, -top.amount, "شراء لاعب: " + (player ? player.name : ""), {
        refType: "transfer",
        refId: lot.id,
      });
      if (player) player.teamId = top.teamId;
    }
    advanceMarket(idx);
    if (mk.started) armLotTimer(); // ابدأ مؤقّت اللاعب التالي (أو أفرغه لو انتهى السوق)
    save();
  }
  App.finalizeLot = finalizeLot;

  // مؤشّر اللاعب المعروض حاليًا (مع دعم أسواق قديمة بلا currentIndex)
  App.marketCurrentIndex = function (mk) {
    mk = mk || App.state.market;
    if (typeof mk.currentIndex === "number") return mk.currentIndex;
    const i = mk.lots.findIndex((l) => l.status === "open");
    return i === -1 ? mk.lots.length : i;
  };

  // أرشفة سوق مغلق: يبني لقطة بأسماء اللاعبين والفرق والأسعار وقت الإغلاق.
  // يؤرشف مرة واحدة فقط (mk.archived) وفقط إن وُجدت صفقة مُرساة.
  function archiveMarket(mk) {
    if (!mk || mk.archived || !Array.isArray(mk.lots)) return;
    const resolved = mk.lots.filter((l) => l.status === "sold" || l.status === "unsold");
    if (!resolved.length) return;
    const deals = mk.lots
      .filter((l) => l.status === "sold")
      .map((l) => {
        const p = App.getPlayer(l.playerId);
        const t = App.getTeam(l.winnerTeamId);
        return {
          playerId: l.playerId,
          playerName: p ? p.name : "لاعب محذوف",
          teamId: l.winnerTeamId,
          teamName: t ? t.name : "",
          teamColor: t ? t.color : "#888",
          price: l.finalPrice,
        };
      })
      .sort((a, b) => b.price - a.price);
    mk.archived = true;
    App.state.marketHistory.push({
      id: mk.id || uid(),
      week: mk.week,
      closedAt: new Date().toISOString(),
      deals,
      unsoldCount: mk.lots.filter((l) => l.status === "unsold").length,
    });
  }
  App.archiveMarket = archiveMarket;

  function closeMarket() {
    archiveMarket(App.state.market);
    App.state.market.active = false;
    save();
  }
  App.closeMarket = closeMarket;

  // صفقات أسبوع معيّن (من السوق الحالي + الأرشيف)، مرتّبة بالأعلى سعرًا.
  App.weekDeals = function (week) {
    const out = [];
    const mk = App.state.market;
    // السوق الحالي يُحتسب فقط إن لم يُؤرشَف بعد (وإلا ازدواج مع الأرشيف)
    if (mk && !mk.archived && mk.week === week && Array.isArray(mk.lots)) {
      mk.lots.filter((l) => l.status === "sold").forEach((l) => {
        const p = App.getPlayer(l.playerId);
        const t = App.getTeam(l.winnerTeamId);
        out.push({
          playerId: l.playerId,
          playerName: p ? p.name : "لاعب محذوف",
          teamId: l.winnerTeamId,
          teamName: t ? t.name : "",
          teamColor: t ? t.color : "#888",
          price: l.finalPrice,
        });
      });
    }
    (App.state.marketHistory || []).forEach((h) => {
      if (h.week === week) h.deals.forEach((d) => out.push(d));
    });
    return out.sort((a, b) => b.price - a.price);
  };

  /* ---------- الأسبوع ---------- */
  // جوائز تشكيلة الأسبوع: كل لاعب في تشكيلة الأسبوع → فريقه يأخذ مبلغ الجائزة
  // (moneyRules.teamOfWeek، افتراضيًا 500 ألف). تُمنح مرة واحدة لكل أسبوع.
  function awardTeamOfWeek(week) {
    const amount = App.state.moneyRules.teamOfWeek || 0;
    if (!amount) return;
    // تفادي التكرار لنفس الأسبوع
    if (App.state.ledger.some((l) => l.refType === "award" && l.refId === "totw-auto" && l.week === week)) return;
    App.teamOfWeek(6, week).forEach((p) => {
      if (!p.teamId) return; // لاعب حر لا نادي له
      addTransaction(p.teamId, amount, "جائزة تشكيلة الأسبوع " + week + " — " + p.name, {
        refType: "award",
        refId: "totw-auto",
      });
    });
  }
  App.awardTeamOfWeek = awardTeamOfWeek;

  function advanceWeek() {
    awardTeamOfWeek(App.state.club.week); // جوائز الأسبوع المنتهي قبل الانتقال
    App.state.club.week += 1;
    save();
  }
  App.advanceWeek = advanceWeek;

  /* ---------- أحداث الأسبوع اليدوية (إعلانات/عقوبات...) ---------- */
  App.addWeekEvent = function (text, week) {
    text = (text || "").trim();
    if (!text) return { ok: false, msg: "اكتب نص الحدث" };
    App.state.weekEvents.push({
      id: uid(),
      week: week || App.state.club.week,
      text,
      date: new Date().toISOString(),
    });
    save();
    return { ok: true };
  };
  App.removeWeekEvent = function (id) {
    App.state.weekEvents = App.state.weekEvents.filter((e) => e.id !== id);
    save();
  };
  App.weekEventsFor = function (week) {
    return (App.state.weekEvents || []).filter((e) => e.week === week);
  };

  /* ---------- المباريات القادمة (Fixtures) — يديرها المشرف ---------- */
  // fixture: { id, homeTeamId, awayTeamId, week, datetime, note, status:"upcoming"|"done" }
  App.getFixture = (id) => App.state.fixtures.find((f) => f.id === id) || null;
  App.addFixture = (data) => {
    const f = Object.assign(
      { id: uid(), homeTeamId: null, awayTeamId: null, week: App.state.club.week, datetime: "", note: "", status: "upcoming" },
      data
    );
    App.state.fixtures.push(f);
    save();
    return f;
  };
  App.updateFixture = (id, data) => {
    const f = App.getFixture(id);
    if (!f) return;
    Object.assign(f, data);
    save();
  };
  App.deleteFixture = (id) => {
    App.state.fixtures = App.state.fixtures.filter((f) => f.id !== id);
    // احذف تشكيلات هذه المباراة
    Object.keys(App.state.lineups).forEach((k) => {
      if (k.indexOf(id + ":") === 0) delete App.state.lineups[k];
    });
    save();
  };
  // المباريات القادمة التي يشارك فيها فريق معيّن
  App.teamFixtures = (teamId) =>
    App.state.fixtures.filter((f) => f.homeTeamId === teamId || f.awayTeamId === teamId);

  /* ---------- الخطط والتشكيلات ---------- */
  // كل خطة: قائمة خطوط اللاعبين (الحارس مضاف تلقائيًا). المجموع = 1 + مجموع الخطوط.
  App.FORMATIONS = [
    { id: "2-2-1", label: "2-2-1", lines: [2, 2, 1] },
    { id: "2-1-2", label: "2-1-2", lines: [2, 1, 2] },
    { id: "1-3-1", label: "1-3-1", lines: [1, 3, 1] },
    { id: "3-2-1", label: "3-2-1", lines: [3, 2, 1] },
    { id: "2-3-1", label: "2-3-1", lines: [2, 3, 1] },
    { id: "3-1-2", label: "3-1-2", lines: [3, 1, 2] },
    { id: "3-3-1", label: "3-3-1", lines: [3, 3, 1] },
    { id: "3-2-2", label: "3-2-2", lines: [3, 2, 2] },
    { id: "2-3-2", label: "2-3-2", lines: [2, 3, 2] },
  ];
  App.getFormation = (id) => App.FORMATIONS.find((f) => f.id === id) || App.FORMATIONS[0];
  // إحداثيات المراكز (x,y) بنسب 0..1 — y=0 عند مرمى الفريق (أسفل) و1 عند مرمى الخصم (أعلى)
  App.formationSlots = (formationId) => {
    const f = App.getFormation(formationId);
    const slots = [{ role: "حارس", x: 0.5, y: 0.09 }];
    const L = f.lines.length;
    f.lines.forEach((count, li) => {
      const y = 0.30 + (L === 1 ? 0.3 : (li * 0.56) / (L - 1 || 1));
      const roleName = li === L - 1 ? "هجوم" : li === 0 ? "دفاع" : "وسط";
      for (let i = 0; i < count; i++) {
        const x = (i + 1) / (count + 1);
        slots.push({ role: roleName, x, y });
      }
    });
    return slots;
  };

  // مفتاح التشكيلة = "fixtureId:teamId"
  const lineupKey = (fixtureId, teamId) => fixtureId + ":" + teamId;
  App.getLineup = (fixtureId, teamId) => App.state.lineups[lineupKey(fixtureId, teamId)] || null;
  App.saveLineup = (fixtureId, teamId, data) => {
    App.state.lineups[lineupKey(fixtureId, teamId)] = Object.assign(
      { formationId: "2-2-1", assign: {}, updatedAt: Date.now() },
      App.state.lineups[lineupKey(fixtureId, teamId)] || {},
      data,
      { updatedAt: Date.now() }
    );
    save();
    return App.state.lineups[lineupKey(fixtureId, teamId)];
  };

  /* ---------- تحقق كلمات المرور (حماية على مستوى الواجهة) ---------- */
  App.checkAdminCode = (code) => (code || "") === (App.state.club.adminCode || App.DEFAULT_ADMIN_CODE);
  App.checkTeamCode = (teamId, code) => {
    const t = App.getTeam(teamId);
    return !!t && (code || "") === (t.code || "");
  };

  /* ---------- استيراد / تصدير ---------- */
  App.exportData = () => JSON.stringify(App.state, null, 2);
  App.importData = (json) => {
    const s = JSON.parse(json);
    App.state = migrate(s);
    save();
  };
  App.resetData = () => {
    App.state = defaultState();
    save();
  };
})();
