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
    { key: "ownGoal",      label: "هدف عكسي",                        ratingKey: "ownGoal" },
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
  const OLD_DEFAULT_TEAM_NAMES = /^الفريق (الأول|الثاني|الثالث)$/;

  function defaultState() {
    const teams = TEAM_IDENTITIES.map((idn) => ({
      id: uid(),
      name: idn.name,
      color: idn.color,
      logo: idn.logo,
      code: idn.code,
      budget: 0,
      captainId: null,
    }));
    return {
      version: 1,
      club: { name: "دوري رواء", currency: "﷼", season: 1, week: 1, adminCode: App.DEFAULT_ADMIN_CODE },
      teams,
      players: [],
      statDefs: App.DEFAULT_STATS.slice(),
      moneyRules: defaultMoneyRules(),
      ratingRules: defaultRatingRules(),
      matches: [],
      fixtures: [],
      lineups: {},
      ledger: [],
      ratingLog: [],
      market: { active: false, week: 1, lots: [] },
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
    s.players = s.players || [];
    s.players.forEach((p) => {
      if (typeof p.rating !== "number") p.rating = App.RATING_START;
      if (!p.stats) p.stats = {};
    });
    s.matches = s.matches || [];
    s.fixtures = s.fixtures || [];
    s.lineups = s.lineups || {};
    s.ledger = s.ledger || [];
    s.ratingLog = s.ratingLog || [];
    s.market = s.market || d.market;
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

  // تقييم اللاعب = طاقته (يبدأ من 50، سقف 99). هذا الرقم الكبير على البطاقة.
  App.playerOverall = (p) =>
    typeof p.rating === "number" ? p.rating : App.RATING_START;

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
    const oldRating = App.playerOverall(p);
    const newRating = clamp(oldRating + delta, App.RATING_MIN, App.RATING_MAX);
    p.rating = newRating;
    App.state.ratingLog.push({
      id: uid(),
      playerId,
      week: (opts && opts.week) || App.state.club.week,
      date: new Date().toISOString(),
      delta,
      applied: newRating - oldRating, // الفرق الفعلي بعد السقف
      oldRating,
      newRating,
      breakdown,
      note: note || "",
      matchId: (opts && opts.matchId) || null,
    });
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

  // إلغاء تقييمات مباراة (عند حذفها): يعيد التقييم بطرح الفرق المطبّق ويحذف سجلّاتها.
  function reverseMatchRatings(matchId) {
    App.state.ratingLog
      .filter((l) => l.matchId === matchId)
      .forEach((l) => {
        const p = App.getPlayer(l.playerId);
        if (p) p.rating = clamp(App.playerOverall(p) - (l.applied || 0), App.RATING_MIN, App.RATING_MAX);
      });
    App.state.ratingLog = App.state.ratingLog.filter((l) => l.matchId !== matchId);
  }
  App.reverseMatchRatings = reverseMatchRatings;

  // تعديل يدوي مباشر للتقييم (بدون أحداث)
  function adjustRating(playerId, newValue, note) {
    const p = App.getPlayer(playerId);
    if (!p) return;
    const oldRating = App.playerOverall(p);
    const nv = clamp(parseInt(newValue, 10) || 0, App.RATING_MIN, App.RATING_MAX);
    p.rating = nv;
    App.state.ratingLog.push({
      id: uid(),
      playerId,
      week: App.state.club.week,
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
      if (def && def.scores) {
        if (ev.teamId === match.homeTeamId) home++;
        else if (ev.teamId === match.awayTeamId) away++;
      }
    });
    return { home, away };
  }
  App.computeMatchScores = computeMatchScores;

  function recordMatch(match) {
    const rules = App.state.moneyRules;
    const id = match.id || uid();
    match.id = id;
    match.date = match.date || new Date().toISOString();
    match.week = match.week || App.state.club.week;
    const { home, away } = computeMatchScores(match);
    match.homeScore = home;
    match.awayScore = away;
    match.result =
      home === away ? "draw" : home > away ? "home" : "away";

    // فلوس الأحداث
    match.events.forEach((ev) => {
      const amount = rules[ev.type] || 0;
      if (!amount) return;
      const def = App.matchAction(ev.type);
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

    App.state.matches.push(match);
    // تحديث تقييمات اللاعبين من أحداث المباراة (إدخال واحد → نتيجة + تقييم)
    applyMatchRatings(match);
    save();
    return match;
  }
  App.recordMatch = recordMatch;

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

  /* ---------- سوق الانتقالات (المزاد) ---------- */
  function openMarket(playerIds) {
    App.state.market = {
      active: true,
      week: App.state.club.week,
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

  function pickRandomForMarket(count) {
    const pool = App.freeAgents();
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map((p) => p.id);
  }
  App.pickRandomForMarket = pickRandomForMarket;

  function placeBid(lotId, teamId, amount) {
    const lot = App.state.market.lots.find((l) => l.id === lotId);
    if (!lot || lot.status !== "open") return { ok: false, msg: "المزايدة مغلقة" };
    const team = App.getTeam(teamId);
    if (!team) return { ok: false, msg: "فريق غير موجود" };
    const highest = lot.bids.length ? lot.bids[lot.bids.length - 1].amount : 0;
    if (amount <= highest)
      return { ok: false, msg: "المزايدة يجب أن تكون أعلى من " + fmtMoney(highest) };
    if (amount > team.budget)
      return { ok: false, msg: "ميزانية الفريق لا تكفي (" + fmtMoney(team.budget) + ")" };
    lot.bids.push({ teamId, amount, at: new Date().toISOString() });
    save();
    return { ok: true };
  }
  App.placeBid = placeBid;

  function finalizeLot(lotId) {
    const lot = App.state.market.lots.find((l) => l.id === lotId);
    if (!lot || lot.status !== "open") return;
    if (!lot.bids.length) {
      lot.status = "unsold";
      save();
      return;
    }
    const top = lot.bids[lot.bids.length - 1];
    const player = App.getPlayer(lot.playerId);
    lot.status = "sold";
    lot.winnerTeamId = top.teamId;
    lot.finalPrice = top.amount;
    // خصم الثمن وتحويل اللاعب
    addTransaction(top.teamId, -top.amount, "شراء لاعب: " + (player ? player.name : ""), {
      refType: "transfer",
      refId: lot.id,
    });
    if (player) player.teamId = top.teamId;
    save();
  }
  App.finalizeLot = finalizeLot;

  function closeMarket() {
    App.state.market.active = false;
    save();
  }
  App.closeMarket = closeMarket;

  /* ---------- الأسبوع ---------- */
  function advanceWeek() {
    App.state.club.week += 1;
    save();
  }
  App.advanceWeek = advanceWeek;

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
