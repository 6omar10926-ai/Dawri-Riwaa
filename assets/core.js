/* =============================================================
   دوري الروّاد — النواة (State + Storage + Rules + Actions)
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

  /* ---------- الحالة الافتراضية ---------- */
  const TEAM_COLORS = ["#e11d48", "#2563eb", "#16a34a"];
  function defaultState() {
    const teams = ["الفريق الأول", "الفريق الثاني", "الفريق الثالث"].map((name, i) => ({
      id: uid(),
      name,
      color: TEAM_COLORS[i],
      budget: 0,
      captainId: null,
    }));
    return {
      version: 1,
      club: { name: "دوري الروّاد", currency: "﷼", season: 1, week: 1 },
      teams,
      players: [],
      statDefs: App.DEFAULT_STATS.slice(),
      moneyRules: defaultMoneyRules(),
      ratingRules: defaultRatingRules(),
      matches: [],
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
    s.moneyRules = Object.assign(defaultMoneyRules(), s.moneyRules || {});
    s.ratingRules = Object.assign(defaultRatingRules(), s.ratingRules || {});
    if (!Array.isArray(s.statDefs) || !s.statDefs.length) s.statDefs = d.statDefs;
    s.teams = s.teams || d.teams;
    s.players = s.players || [];
    s.players.forEach((p) => {
      if (typeof p.rating !== "number") p.rating = App.RATING_START;
      if (!p.stats) p.stats = {};
    });
    s.matches = s.matches || [];
    s.ledger = s.ledger || [];
    s.ratingLog = s.ratingLog || [];
    s.market = s.market || d.market;
    return s;
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(App.state));
    } catch (e) {
      alert("تعذّر الحفظ (قد تكون المساحة ممتلئة). حاول تصدير نسخة احتياطية.");
    }
  }
  App.save = save;

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
  function evaluatePlayer(playerId, counts, note) {
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
    const oldRating = App.playerOverall(p);
    const newRating = clamp(oldRating + delta, App.RATING_MIN, App.RATING_MAX);
    p.rating = newRating;
    App.state.ratingLog.push({
      id: uid(),
      playerId,
      week: App.state.club.week,
      date: new Date().toISOString(),
      delta,
      applied: newRating - oldRating, // الفرق الفعلي بعد السقف
      oldRating,
      newRating,
      breakdown,
      note: note || "",
    });
    save();
    return { oldRating, newRating, delta, breakdown };
  }
  App.evaluatePlayer = evaluatePlayer;

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
      const def = App.EVENTS.find((e) => e.key === ev.type);
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
      const def = App.EVENTS.find((e) => e.key === ev.type);
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
    save();
    return match;
  }
  App.recordMatch = recordMatch;

  function deleteMatch(id) {
    reverseByRef("match", id);
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
