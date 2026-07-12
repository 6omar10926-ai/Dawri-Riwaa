/* =============================================================
   دوري الروّاد — الواجهة (Views + Router + Interactions)
   ============================================================= */
(function () {
  const App = window.App;
  const { fmtMoney, fmtShort, uid, clamp } = App.util;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /* ---------- توست ---------- */
  function toast(msg, type) {
    let box = $("#toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "toast";
      document.body.appendChild(box);
    }
    const t = document.createElement("div");
    t.className = "toast " + (type || "");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  App.toast = toast;

  // إظهار أي خطأ غير مُلتقَط كرسالة مرئية بدل أن يفشل بصمت (يسهّل معرفة سبب "التعليق").
  window.addEventListener("error", (e) => {
    try { toast("خطأ: " + (e.message || (e.error && e.error.message) || "غير معروف"), "err"); } catch (_) {}
  });
  window.addEventListener("unhandledrejection", (e) => {
    try {
      const r = e.reason;
      toast("خطأ: " + (r && r.message ? r.message : r), "err");
    } catch (_) {}
  });

  /* ---------- نافذة منبثقة ---------- */
  // عدّاد النوافذ المفتوحة: يمنع المزامنة السحابية من إعادة رسم الصفحة
  // (وحذف النافذة وما بداخلها) أثناء تفاعل المستخدم مع نافذة منبثقة.
  let openModals = 0;
  let pendingRender = false;
  App.modalsOpen = () => openModals > 0;

  // يُستدعى عند إغلاق آخر نافذة: يطبّق أي حالة سحابية مؤجّلة ثم يعيد الرسم إن لزم.
  function afterModalsClosed() {
    if (typeof App.onModalsClosed === "function") App.onModalsClosed();
    if (pendingRender) { pendingRender = false; render(); }
  }

  function modal({ title, body, foot, onOpen, size }) {
    const back = document.createElement("div");
    // size:"full" → نافذة تملأ الشاشة كصفحة كاملة واضحة بدل نافذة ضيقة
    back.className = "modal-backdrop" + (size === "full" ? " full" : "");
    back.innerHTML = `
      <div class="modal${size === "full" ? " full" : ""}" role="dialog">
        <div class="m-head"><h3>${esc(title)}</h3><button class="x" data-close>×</button></div>
        <div class="m-body"></div>
        ${foot ? `<div class="m-foot"></div>` : ""}
      </div>`;
    $(".m-body", back).innerHTML = typeof body === "string" ? body : "";
    if (typeof body !== "string" && body) $(".m-body", back).appendChild(body);
    if (foot) $(".m-foot", back).innerHTML = foot;
    document.body.appendChild(back);
    openModals++;
    const close = () => {
      if (back._closed) return;
      back._closed = true;
      back.remove();
      openModals = Math.max(0, openModals - 1);
      if (openModals === 0) afterModalsClosed();
    };
    back.addEventListener("click", (e) => {
      if (e.target === back || e.target.hasAttribute("data-close")) close();
    });
    if (onOpen) onOpen(back, close);
    return { el: back, close };
  }
  App.modal = modal;

  function confirmBox(msg, onYes, danger) {
    modal({
      title: "تأكيد",
      body: `<p style="margin:0">${esc(msg)}</p>`,
      foot: `<button class="btn ${danger ? "danger" : "primary"}" data-yes>نعم</button>
             <button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-yes]", root).onclick = () => {
          onYes();
          close();
        };
      },
    });
  }
  App.confirmBox = confirmBox;

  /* =========================================================
     الأدوار والجلسة (حماية على مستوى الواجهة)
     ========================================================= */
  const SKEY = "dawri_session_v1";
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (e) { session = null; }
  // لو فريق الرئيس لم يعد موجودًا، ألغِ الجلسة
  if (session && session.role === "president" && !App.getTeam(session.teamId)) session = null;

  function setSession(s) {
    session = s;
    if (s) localStorage.setItem(SKEY, JSON.stringify(s));
    else localStorage.removeItem(SKEY);
  }
  App.session = () => session;
  const isAdmin = () => !!session && session.role === "admin";
  const isPresident = () => !!session && session.role === "president";
  const isPublic = () => !!session && session.role === "public";
  const myTeamId = () => (session && session.teamId) || null;
  App.isAdmin = isAdmin;

  function roleName() {
    if (isAdmin()) return "المشرف";
    if (isPresident()) return "رئيس " + (App.getTeam(myTeamId())?.name || "");
    return "عرض عام";
  }

  function logout() {
    setSession(null);
    route = "dashboard";
    render();
  }

  /* ---------- شاشة الدخول ---------- */
  function renderLogin() {
    const teamBtns = App.state.teams
      .map(
        (t) => `<button class="role-team" data-login-team="${t.id}">
          ${teamCrestHTML(t)}<span>${esc(t.name)}</span></button>`
      )
      .join("");
    document.body.innerHTML = `
      <div class="login-wrap">
        <div class="login-card card">
          <img class="login-logo" src="assets/logo.png" alt="${esc(App.state.club.name)}">
          <p class="muted" style="margin:4px 0 18px">اختر طريقة الدخول</p>
          <div id="login-body">
            <button class="btn primary block" data-login="admin">🛡️ المشرف المسؤول</button>
            <button class="btn block" style="margin-top:10px" data-login="president">🎽 رئيس نادٍ</button>
            <button class="btn ghost block" style="margin-top:10px" data-login="public">👁️ عرض عام (بدون دخول)</button>
          </div>
        </div>
      </div>`;

    const body = $("#login-body");
    const backHTML = `<button class="btn ghost sm" data-login-back style="margin-top:12px">‹ رجوع</button>`;

    function askCode(title, onSubmit, extra) {
      body.innerHTML = `
        <div class="small muted" style="margin-bottom:8px">${esc(title)}</div>
        ${extra || ""}
        <input id="login-code" type="password" placeholder="كلمة المرور" autocomplete="off">
        <button class="btn primary block" data-login-go style="margin-top:12px">دخول</button>
        ${backHTML}`;
      const codeEl = $("#login-code", body);
      codeEl.focus();
      const go2 = () => onSubmit(codeEl.value);
      $("[data-login-go]", body).onclick = go2;
      codeEl.onkeydown = (e) => { if (e.key === "Enter") go2(); };
      $("[data-login-back]", body).onclick = renderLogin;
    }

    body.querySelectorAll("[data-login]").forEach((b) => {
      b.onclick = () => {
        const role = b.getAttribute("data-login");
        if (role === "public") { setSession({ role: "public" }); route = "dashboard"; render(); return; }
        if (role === "admin") {
          askCode("أدخل كلمة مرور المشرف:", (code) => {
            if (!App.checkAdminCode(code)) return toast("كلمة المرور غير صحيحة", "err");
            setSession({ role: "admin" }); route = "dashboard"; render();
          });
          return;
        }
        // president: اختر الفريق ثم كلمة المرور
        body.innerHTML = `
          <div class="small muted" style="margin-bottom:10px">اختر ناديك:</div>
          <div class="role-teams">${teamBtns}</div>
          ${backHTML}`;
        $("[data-login-back]", body).onclick = renderLogin;
        body.querySelectorAll("[data-login-team]").forEach((tb) => {
          tb.onclick = () => {
            const teamId = tb.getAttribute("data-login-team");
            const team = App.getTeam(teamId);
            askCode(
              "كلمة مرور رئيس نادي " + (team?.name || ""),
              (code) => {
                if (!App.checkTeamCode(teamId, code)) return toast("كلمة المرور غير صحيحة", "err");
                setSession({ role: "president", teamId }); route = "lineups"; render();
              }
            );
          };
        });
      };
    });
  }

  /* ---------- عناصر مشتركة ---------- */
  function teamOptions(selected, includeEmpty) {
    let html = includeEmpty ? `<option value="">— بدون فريق —</option>` : "";
    App.state.teams.forEach((t) => {
      html += `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${esc(t.name)}</option>`;
    });
    return html;
  }

  // شعار الفريق (صورة الهوية) أو حرف بديل بلون الفريق
  function teamCrestHTML(t, big) {
    const cls = "team-crest" + (big ? " lg" : "");
    if (t && t.logo) return `<img class="${cls}" src="${esc(t.logo)}" alt="${esc(t.name)}">`;
    const c = t ? t.color : "var(--muted)";
    const initial = t ? esc((t.name || "?").trim().charAt(0)) : "?";
    return `<span class="${cls}" style="display:grid;place-items:center;background:${c};color:#0b1330;font-weight:800;font-size:18px">${initial}</span>`;
  }

  function playerCardHTML(p, opts = {}) {
    const team = App.getTeam(p.teamId);
    const ovr = App.playerOverall(p);
    const photo = p.photo
      ? `<img class="pc-photo" src="${p.photo}" alt="">`
      : `<div class="pc-photo">👤</div>`;
    const stats = App.state.statDefs
      .map((d) => {
        const v = p.stats && typeof p.stats[d.key] === "number" ? p.stats[d.key] : 0;
        return `<div class="pc-stat">
            <span class="k">${esc(d.label)}</span>
            <span class="bar"><i style="width:${clamp(v, 0, 99)}%"></i></span>
            <span class="v">${v}</span>
          </div>`;
      })
      .join("");
    const clickAttr = opts.clickable ? ` data-action="player-stats" data-id="${p.id}"` : "";
    return `
      <div class="player-card${opts.clickable ? " clickable" : ""}" data-player="${p.id}"${clickAttr}>
        <div class="pc-top">
          <div class="pc-ovr"><div class="num">${ovr}</div><div class="pos">${esc(p.position || "")}</div></div>
          ${photo}
          <div style="flex:1">
            <div class="pc-name">${esc(p.name)}</div>
            <div class="pc-team small" style="color:${team ? team.color : "var(--muted)"}">
              ${team ? esc(team.name) : "لاعب حر"}${p.number ? " • #" + esc(p.number) : ""}
            </div>
          </div>
        </div>
        <div class="pc-stats">${stats}</div>
        ${
          opts.actions
            ? `<div class="row wrap" style="margin-top:12px;gap:8px">
                 <button class="btn sm gold" data-action="eval-player" data-id="${p.id}">⚡ تقييم</button>
                 <button class="btn sm" data-action="player-detail" data-id="${p.id}">📊 الحسبة</button>
                 <button class="btn sm" data-action="edit-player" data-id="${p.id}">تعديل</button>
                 <button class="btn sm danger" data-action="del-player" data-id="${p.id}">حذف</button>
               </div>`
            : ""
        }
      </div>`;
  }

  /* ---------- التبويبات ---------- */
  const TAB = {
    dashboard: { key: "dashboard", label: "الرئيسية", ico: "🏠" },
    teams: { key: "teams", label: "الفرق", ico: "🛡️" },
    players: { key: "players", label: "اللاعبون", ico: "🎽" },
    matches: { key: "matches", label: "النتائج", ico: "⚽" },
    fixtures: { key: "fixtures", label: "القادمة", ico: "📅" },
    market: { key: "market", label: "السوق", ico: "💰" },
    ledger: { key: "ledger", label: "الحسبة", ico: "📒" },
    lineups: { key: "lineups", label: "التشكيلات", ico: "🧩" },
  };
  // تبويبات كل دور
  function roleTabs() {
    if (isAdmin())
      return [TAB.dashboard, TAB.teams, TAB.players, TAB.matches, TAB.fixtures, TAB.market, TAB.ledger];
    if (isPresident()) return [TAB.lineups, TAB.market];
    // عرض عام
    return [TAB.dashboard, TAB.teams, TAB.players, TAB.matches, TAB.fixtures];
  }
  let route = "dashboard";

  function renderNav() {
    const tabs = roleTabs();
    return `<nav class="tabs"><div class="inner" style="grid-template-columns:repeat(${tabs.length},1fr)">
      ${tabs
        .map(
          (t) => `<button data-nav="${t.key}" class="${route === t.key ? "active" : ""}">
          <span class="ico">${t.ico}</span><span>${t.label}</span></button>`
        )
        .join("")}
    </div></nav>`;
  }

  function renderTopbar() {
    const c = App.state.club;
    return `<header class="topbar"><div class="inner">
      <img class="brand-logo" src="assets/logo.png" alt="${esc(c.name)}">
      <span class="role-pill">${esc(roleName())}</span>
      <div class="spacer"></div>
      <span class="week-pill" id="cloud-status" title="حالة المزامنة السحابية">…</span>
      <div class="week-pill">الأسبوع <b>${c.week}</b></div>
      ${isAdmin() ? `<button class="btn sm ghost" data-action="settings" title="الإعدادات">⚙️</button>` : ""}
      <button class="btn sm ghost" data-action="logout" title="تسجيل الخروج">🚪</button>
    </div></header>`;
  }

  /* =========================================================
     العروض (Views)
     ========================================================= */

  // إحصاءات الترتيب من المباريات
  function standings() {
    const table = {};
    App.state.teams.forEach((t) => {
      table[t.id] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    });
    App.state.matches.forEach((m) => {
      const h = table[m.homeTeamId],
        a = table[m.awayTeamId];
      if (!h || !a) return;
      h.p++; a.p++;
      h.gf += m.homeScore; h.ga += m.awayScore;
      a.gf += m.awayScore; a.ga += m.homeScore;
      if (m.result === "draw") { h.d++; a.d++; h.pts += 1; a.pts += 1; }
      else if (m.result === "home") { h.w++; a.l++; h.pts += 3; }
      else { a.w++; h.l++; a.pts += 3; }
    });
    return Object.values(table).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga));
  }

  // تشكيلة الأسبوع (6 لاعبين حسب التقييم) — بطاقة على الملعب
  function teamOfWeekCard() {
    const sel = App.teamOfWeek(6);
    if (!sel.length) return "";
    const POS_ORDER = ["هجوم", "وسط", "دفاع", "حارس"];
    const token = (p) => {
      const team = App.getTeam(p.teamId);
      const photo = p.photo
        ? `<img class="totw-photo" src="${p.photo}" alt="">`
        : `<div class="totw-photo ph">👤</div>`;
      return `<div class="totw-player">
        <div class="totw-ovr">${App.playerOverall(p)}</div>
        ${photo}
        <div class="totw-name">${esc(p.name)}</div>
        <div class="totw-pos">${esc(p.position || "")}${team ? " • " + esc(team.name) : ""}</div>
      </div>`;
    };
    const lines = POS_ORDER.map((pos) => sel.filter((p) => p.position === pos));
    const others = sel.filter((p) => !POS_ORDER.includes(p.position || ""));
    if (others.length) lines[1] = lines[1].concat(others); // غير المصنّفين في خط الوسط
    const rows = lines.filter((l) => l.length).map((l) => `<div class="totw-line">${l.map(token).join("")}</div>`).join("");
    return `<div class="section-title"><h2>🏅 تشكيلة الأسبوع</h2><span class="hint">أفضل 6 حسب التقييم • أسبوع ${App.state.club.week}</span></div>
      <div class="card totw">${rows}</div>`;
  }

  function viewDashboard() {
    const teams = App.state.teams;
    const teamCards = teams
      .map((t) => {
        const players = App.teamPlayers(t.id);
        const cls = t.budget < 0 ? "neg" : "pos";
        return `<div class="card team-card">
          <div class="stripe" style="background:${t.color}"></div>
          <div class="row" style="padding-inline-start:8px;align-items:flex-start;gap:12px">
            ${teamCrestHTML(t, true)}
            <div style="flex:1">
              <h3>${esc(t.name)}</h3>
              <div class="budget ${cls} mono">${fmtMoney(t.budget)} <span class="small muted">${esc(App.state.club.currency)}</span></div>
              <div class="row wrap" style="margin-top:8px">
                <span class="chip">👥 ${players.length} لاعب</span>
                <span class="chip">💵 ${fmtShort(t.budget)}</span>
              </div>
            </div>
          </div>
        </div>`;
      })
      .join("");

    const st = standings();
    const standingsRows = st
      .map(
        (r, i) => `<tr>
        <td>${i + 1}</td>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${r.team.color};margin-inline-end:6px"></span>${esc(r.team.name)}</td>
        <td class="mono">${r.p}</td><td class="mono">${r.w}</td><td class="mono">${r.d}</td><td class="mono">${r.l}</td>
        <td class="mono">${r.gf}:${r.ga}</td><td class="mono"><b>${r.pts}</b></td>
      </tr>`
      )
      .join("");

    const quickActions = isAdmin()
      ? `<div class="section-title"><h2>إجراءات سريعة</h2></div>
      <div class="grid cols-3">
        <button class="btn primary block" data-action="new-match">⚽ تسجيل مباراة</button>
        <button class="btn gold block" data-action="go-market">💰 سوق الانتقالات</button>
        <button class="btn block" data-action="awards">🏅 منح جوائز</button>
      </div>`
      : "";
    const weekBox = isAdmin()
      ? `<div class="section-title"><h2>الأسبوع الحالي</h2></div>
      <div class="card row between">
        <div>أنت في الأسبوع <b style="color:var(--gold)">${App.state.club.week}</b></div>
        <button class="btn sm" data-action="advance-week">إنهاء الأسبوع ▶</button>
      </div>`
      : "";

    return `
      <div class="section-title"><h2>نظرة عامة</h2><span class="hint">ميزانيات الفرق الثلاثة</span></div>
      <div class="grid cols-3">${teamCards}</div>

      ${quickActions}

      <div class="section-title"><h2>الترتيب</h2><span class="hint">من نتائج المباريات</span></div>
      <div class="card" style="overflow:auto">
        <table>
          <thead><tr><th>#</th><th>الفريق</th><th>لعب</th><th>فاز</th><th>تعادل</th><th>خسر</th><th>أهداف</th><th>نقاط</th></tr></thead>
          <tbody>${standingsRows}</tbody>
        </table>
      </div>

      ${teamOfWeekCard()}
      ${upcomingFixturesCard()}
      ${weekBox}`;
  }

  function viewTeams() {
    const cards = App.state.teams
      .map((t) => {
        const players = App.teamPlayers(t.id);
        const list = players.length
          ? `<div class="grid cols-2" style="margin-top:12px">${players
              .map((p) => playerCardHTML(p))
              .join("")}</div>`
          : `<div class="empty small">لا يوجد لاعبون بعد</div>`;
        const captain = App.getPlayer(t.captainId);
        return `<div class="card">
          <div class="row between">
            <div class="row">
              ${teamCrestHTML(t)}
              <h3 style="margin:0">${esc(t.name)}</h3>
            </div>
            <div class="row">
              <span class="budget ${t.budget < 0 ? "neg" : "pos"} mono" style="font-size:18px">${fmtMoney(t.budget)}</span>
              ${isAdmin() ? `<button class="btn sm ghost" data-action="edit-team" data-id="${t.id}">تعديل</button>` : ""}
            </div>
          </div>
          <div class="row wrap small muted" style="margin-top:6px">
            <span class="chip">👥 ${players.length}/8</span>
            <span class="chip">🎽 القائد: ${captain ? esc(captain.name) : "—"}</span>
            ${isAdmin() ? `<button class="btn sm" data-action="add-player-to" data-id="${t.id}">＋ إضافة لاعب</button>` : ""}
          </div>
          ${list}
        </div>`;
      })
      .join("");
    return `<div class="section-title"><h2>الفرق</h2><span class="hint">3 فرق • 6-8 لاعبين لكل فريق</span></div>
      <div class="grid">${cards}</div>`;
  }

  let playersFilter = "all";
  function viewPlayers() {
    const all = App.state.players;
    let list = all;
    if (playersFilter === "free") list = App.freeAgents();
    else if (playersFilter !== "all") list = App.teamPlayers(playersFilter);

    const filters = `<div class="pill-toggle" style="flex-wrap:wrap">
      <button data-filter="all" class="${playersFilter === "all" ? "active" : ""}">الكل</button>
      <button data-filter="free" class="${playersFilter === "free" ? "active" : ""}">أحرار</button>
      ${App.state.teams
        .map(
          (t) =>
            `<button data-filter="${t.id}" class="${playersFilter === t.id ? "active" : ""}">${esc(t.name)}</button>`
        )
        .join("")}
    </div>`;

    // للمشاهدة العامة: البطاقة قابلة للنقر لعرض إحصائيات اللاعب
    const body = list.length
      ? `<div class="grid cols-2">${list.map((p) => playerCardHTML(p, { actions: isAdmin(), clickable: !isAdmin() })).join("")}</div>`
      : `<div class="empty"><div class="big">🎽</div>لا يوجد لاعبون.</div>`;

    return `<div class="section-title"><h2>اللاعبون</h2>
        <span class="hint">${all.length} لاعب</span>
        <div class="spacer"></div>
        ${isAdmin() ? `<button class="btn primary sm" data-action="add-player">＋ لاعب جديد</button>` : ""}
      </div>
      <div style="margin-bottom:14px">${filters}</div>
      ${body}`;
  }

  function viewMatches() {
    const matches = App.state.matches.slice().reverse();
    const list = matches.length
      ? matches
          .map((m) => {
            const h = App.getTeam(m.homeTeamId),
              a = App.getTeam(m.awayTeamId);
            const money = App.state.ledger
              .filter((l) => l.refId === m.id)
              .reduce((s, l) => s + l.amount, 0);
            const ratedPlayers = App.state.ratingLog.filter((l) => l.matchId === m.id).length;
            return `<div class="card">
              <div class="row between">
                <div class="small muted">الأسبوع ${m.week} • ${new Date(m.date).toLocaleDateString("ar")}</div>
                ${isAdmin() ? `<div class="row" style="gap:6px">
                  <button class="btn sm" data-action="edit-match" data-id="${m.id}">تعديل</button>
                  <button class="btn sm danger" data-action="del-match" data-id="${m.id}">حذف</button>
                </div>` : ""}
              </div>
              <div class="row between" style="margin-top:8px;font-size:16px;font-weight:700">
                <span>${esc(h ? h.name : "؟")}</span>
                <span class="mono" style="font-size:22px">${m.homeScore} - ${m.awayScore}</span>
                <span>${esc(a ? a.name : "؟")}</span>
              </div>
              <div class="small muted" style="margin-top:8px">${m.events.length} حدث • أُضيف ${fmtMoney(money)} ${esc(App.state.club.currency)}${ratedPlayers ? " • حُدّث تقييم " + ratedPlayers + " لاعب" : ""}</div>
              <button class="btn sm block" style="margin-top:10px" data-action="match-stats" data-id="${m.id}">📊 إحصائيات المباراة</button>
            </div>`;
          })
          .join("")
      : `<div class="empty"><div class="big">⚽</div>لا توجد مباريات مسجّلة.</div>`;

    return `<div class="section-title"><h2>النتائج</h2>
        <div class="spacer"></div>
        ${isAdmin() ? `<button class="btn sm gold" data-action="live-match">🎬 تسجيل مباشر</button>` : ""}
        ${isAdmin() ? `<button class="btn primary sm" data-action="new-match">＋ تسجيل مباراة</button>` : ""}
      </div>
      <div class="grid">${list}</div>`;
  }

  function viewMarket() {
    const mk = App.state.market;
    if (!mk.active) {
      if (!isAdmin())
        return `<div class="section-title"><h2>سوق الانتقالات</h2></div>
          <div class="empty"><div class="big">💰</div>لم يُفتح المزاد بعد. انتظر أن يفتحه المشرف.</div>`;
      const freeCount = App.freeAgents().length;
      return `<div class="section-title"><h2>سوق الانتقالات</h2><span class="hint">مزاد نهاية الأسبوع</span></div>
        <div class="card">
          <p class="muted" style="margin-top:0">افتح المزاد باختيار لاعبين أحرار (عشوائي أو يدوي)، ثم تتزايد الفرق عليهم بميزانياتها.</p>
          <div class="row wrap">
            <button class="btn primary" data-action="open-market-random" ${freeCount ? "" : "disabled"}>🎲 اختيار 8 عشوائي</button>
            <button class="btn" data-action="open-market-manual" ${freeCount ? "" : "disabled"}>✋ اختيار يدوي</button>
          </div>
          <p class="small muted">اللاعبون الأحرار المتاحون: ${freeCount}</p>
        </div>`;
    }

    const myTeam = isPresident() ? App.getTeam(myTeamId()) : null;
    // كشف اللاعبين واحدًا تلو الآخر: نعرض حتى اللاعب الحالي فقط، والباقي مخفي
    const curIdx = App.marketCurrentIndex(mk);
    const revealed = mk.lots.slice(0, Math.min(curIdx + 1, mk.lots.length));
    const hiddenCount = mk.lots.length - revealed.length;
    const lots = revealed
      .map((lot) => {
        const p = App.getPlayer(lot.playerId);
        if (!p) return "";
        const highest = lot.bids.length ? lot.bids[lot.bids.length - 1] : null;
        const highTeam = highest ? App.getTeam(highest.teamId) : null;
        const badge =
          lot.status === "sold"
            ? `<span class="badge sold">بيع لـ ${esc(App.getTeam(lot.winnerTeamId)?.name || "")} بـ ${fmtShort(lot.finalPrice)}</span>`
            : lot.status === "unsold"
            ? `<span class="badge unsold">لم يُبع</span>`
            : `<span class="badge open">مفتوح</span>`;
        // عناصر المزايدة: المشرف يرى الكل، رئيس النادي يزايد بفريقه فقط، العام لا يزايد
        const minBid = App.marketMinBid(lot);
        const bidHint = `<div class="small muted" style="width:100%">أقل مزايدة ${fmtMoney(minBid)} • من مضاعفات ${fmtMoney(App.MARKET_BID_STEP)}</div>`;
        let bidControls = "";
        if (lot.status === "open" && isAdmin()) {
          bidControls = `<div class="row wrap" style="margin-top:12px;gap:8px">
               <select data-bid-team="${lot.id}" style="width:auto;min-width:130px">${teamOptions(highTeam ? highTeam.id : App.state.teams[0].id)}</select>
               <input type="number" data-bid-amount="${lot.id}" value="${minBid}" min="${minBid}" step="${App.MARKET_BID_STEP}" style="width:150px">
               <button class="btn sm primary" data-action="place-bid" data-id="${lot.id}">مزايدة</button>
               <button class="btn sm gold" data-action="finalize-lot" data-id="${lot.id}">إرساء ✔</button>
               ${bidHint}
             </div>`;
        } else if (lot.status === "open" && isPresident() && myTeam) {
          bidControls = `<div class="row wrap" style="margin-top:12px;gap:8px">
               <input type="hidden" data-bid-team="${lot.id}" value="${myTeam.id}">
               <span class="chip"><span style="width:10px;height:10px;border-radius:3px;background:${myTeam.color};display:inline-block"></span> ميزانيتك: ${fmtMoney(myTeam.budget)}</span>
               <input type="number" data-bid-amount="${lot.id}" value="${minBid}" min="${minBid}" step="${App.MARKET_BID_STEP}" style="width:150px">
               <button class="btn sm primary" data-action="place-bid" data-id="${lot.id}">مزايدة</button>
               ${bidHint}
             </div>`;
        }
        const bidsLog = lot.bids.length
          ? `<div class="small muted" style="margin-top:8px">أعلى مزايدة: <b style="color:${highTeam?.color}">${esc(highTeam?.name)}</b> — ${fmtMoney(highest.amount)} • (${lot.bids.length} مزايدة)</div>`
          : `<div class="small muted" style="margin-top:8px">لا مزايدات بعد</div>`;
        return `<div class="card">
            <div class="row between">${badge}</div>
            <div style="margin-top:10px">${playerCardHTML(p)}</div>
            ${bidsLog}
            ${bidControls}
          </div>`;
      })
      .join("");

    const hiddenHint = hiddenCount
      ? `<div class="card" style="text-align:center;border-style:dashed">
          <div class="big" style="font-size:30px">🔒</div>
          <div class="muted">${hiddenCount} لاعب قادم — يظهر بعد الإرساء على الحالي</div>
        </div>`
      : "";

    return `<div class="section-title"><h2>سوق الانتقالات</h2><span class="hint">أسبوع ${mk.week}</span>
        <div class="spacer"></div>
        ${isAdmin() ? `<button class="btn sm gold" data-action="auction-screen">🖥️ اعرض على الشاشة</button>` : ""}
        ${isAdmin() ? `<button class="btn sm danger" data-action="close-market">إغلاق السوق</button>` : ""}
      </div>
      <div class="grid cols-2">${lots}</div>
      ${hiddenHint}`;
  }

  /* ---------- شاشة عرض المزاد المباشر (لعرضها على شاشة كبيرة) ---------- */
  function viewAuctionScreen() {
    const mk = App.state.market;
    const backBtn = `<button class="btn ghost" data-action="go-market">← رجوع للسوق</button>`;
    if (!mk || !mk.active) {
      return `<div class="auction-screen">
        <div class="auction-empty"><div class="big">💰</div>لا يوجد مزاد جارٍ حاليًا.</div>
        <div class="auction-bar">${backBtn}</div>
      </div>`;
    }
    const total = mk.lots.length;
    const idx = App.marketCurrentIndex(mk);
    const resolved = mk.lots.filter((l) => l.status !== "open").length;
    const lot = mk.lots[idx];

    // انتهى المزاد (لا لاعب حالي)
    if (!lot) {
      const soldList = mk.lots
        .filter((l) => l.status === "sold")
        .map((l) => {
          const p = App.getPlayer(l.playerId), t = App.getTeam(l.winnerTeamId);
          return `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <span>${esc(p ? p.name : "")}</span>
            <span class="mono" style="color:${t?.color}">${esc(t?.name || "")} — ${fmtMoney(l.finalPrice)}</span>
          </div>`;
        })
        .join("");
      return `<div class="auction-screen">
        <div class="auction-done">
          <div class="big">🏁</div>
          <h2>انتهى المزاد</h2>
          <div class="card" style="max-width:520px;margin:12px auto;text-align:right">${soldList || '<div class="muted">لم يُبع أحد</div>'}</div>
        </div>
        <div class="auction-bar">${backBtn}</div>
      </div>`;
    }

    const p = App.getPlayer(lot.playerId);
    const ovr = p ? App.playerOverall(p) : "؟";
    const photo = p && p.photo
      ? `<img class="auction-photo" src="${p.photo}" alt="">`
      : `<div class="auction-photo ph">👤</div>`;
    const highest = lot.bids.length ? lot.bids[lot.bids.length - 1] : null;
    const highTeam = highest ? App.getTeam(highest.teamId) : null;

    const bidBox = highest
      ? `<div class="auction-bid-label">أعلى مزايدة</div>
         <div class="auction-bid-amount">${fmtMoney(highest.amount)}</div>
         <div class="auction-bid-team" style="color:${highTeam?.color}">
           <span class="dot" style="background:${highTeam?.color}"></span>${esc(highTeam?.name || "")}
         </div>
         <div class="muted small" style="margin-top:6px">${lot.bids.length} مزايدة</div>`
      : `<div class="auction-bid-label">لا مزايدات بعد</div>
         <div class="auction-bid-amount muted">—</div>`;

    // أدوات المشرف: مزايدة سريعة + إرساء والانتقال للتالي
    const minBid = App.marketMinBid(lot);
    const controls = isAdmin()
      ? `<div class="auction-controls">
          <select data-bid-team="${lot.id}">${teamOptions(highTeam ? highTeam.id : App.state.teams[0].id)}</select>
          <input type="number" data-bid-amount="${lot.id}" value="${minBid}" min="${minBid}" step="${App.MARKET_BID_STEP}">
          <button class="btn primary" data-action="place-bid" data-id="${lot.id}">＋ مزايدة</button>
          <button class="btn gold" data-action="finalize-lot" data-id="${lot.id}">✔ إرساء والتالي</button>
        </div>
        <div class="muted small" style="text-align:center">أقل مزايدة ${fmtMoney(minBid)} • من مضاعفات ${fmtMoney(App.MARKET_BID_STEP)}</div>`
      : "";

    return `<div class="auction-screen">
      <div class="auction-top">
        <span class="chip">لاعب ${Math.min(idx + 1, total)} من ${total}</span>
        <span class="chip">أُرسي على ${resolved}</span>
      </div>
      <div class="auction-main">
        <div class="auction-player">
          ${photo}
          <div class="auction-ovr">${ovr}</div>
          <div class="auction-name">${esc(p ? p.name : "؟")}</div>
          <div class="auction-pos muted">${esc((p && p.position) || "")}${p && p.number ? " • #" + esc(p.number) : ""}</div>
        </div>
        <div class="auction-bidbox">${bidBox}</div>
      </div>
      ${controls}
      <div class="auction-bar">${backBtn}</div>
    </div>`;
  }

  let ledgerFilter = "all";
  function viewLedger() {
    const summary = App.state.teams
      .map((t) => {
        const earned = App.state.ledger.filter((l) => l.teamId === t.id && l.amount > 0).reduce((s, l) => s + l.amount, 0);
        const spent = App.state.ledger.filter((l) => l.teamId === t.id && l.amount < 0).reduce((s, l) => s + l.amount, 0);
        return `<div class="card">
          <div class="row"><span style="width:12px;height:12px;border-radius:4px;background:${t.color};display:inline-block"></span><b>${esc(t.name)}</b></div>
          <div class="budget ${t.budget < 0 ? "neg" : "pos"} mono" style="font-size:20px;margin-top:6px">${fmtMoney(t.budget)}</div>
          <div class="small muted" style="margin-top:6px">دخل: <span class="amt pos">${fmtMoney(earned)}</span> • صرف: <span class="amt neg">${fmtMoney(spent)}</span></div>
        </div>`;
      })
      .join("");

    let rows = App.state.ledger.slice().reverse();
    if (ledgerFilter !== "all") rows = rows.filter((l) => l.teamId === ledgerFilter);
    const tableRows = rows.length
      ? rows
          .map((l) => {
            const t = App.getTeam(l.teamId);
            return `<tr>
              <td>${new Date(l.date).toLocaleDateString("ar")}</td>
              <td><span style="color:${t?.color}">${esc(t?.name || "")}</span></td>
              <td>${esc(l.reason)}</td>
              <td class="mono amt ${l.amount < 0 ? "neg" : "pos"}">${fmtMoney(l.amount)}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="4" class="empty small">لا توجد حركات مالية بعد</td></tr>`;

    const filterBtns = `<div class="pill-toggle" style="flex-wrap:wrap">
      <button data-lfilter="all" class="${ledgerFilter === "all" ? "active" : ""}">الكل</button>
      ${App.state.teams.map((t) => `<button data-lfilter="${t.id}" class="${ledgerFilter === t.id ? "active" : ""}">${esc(t.name)}</button>`).join("")}
    </div>`;

    return `<div class="section-title"><h2>الحسبة</h2><span class="hint">سجل جميع الحركات المالية</span></div>
      <div class="grid cols-3">${summary}</div>
      <div class="section-title"><h2>الحركات</h2><div class="spacer"></div>
        <button class="btn sm" data-action="export">⬇ تصدير</button>
        <button class="btn sm" data-action="import">⬆ استيراد</button>
      </div>
      <div style="margin-bottom:12px">${filterBtns}</div>
      <div class="card" style="overflow:auto">
        <table><thead><tr><th>التاريخ</th><th>الفريق</th><th>السبب</th><th>المبلغ</th></tr></thead>
        <tbody>${tableRows}</tbody></table>
      </div>`;
  }

  /* =========================================================
     المباريات القادمة (Fixtures)
     ========================================================= */
  function fixtureWhen(f) {
    if (!f.datetime) return "الأسبوع " + (f.week || "?");
    const d = new Date(f.datetime);
    if (isNaN(d)) return esc(f.datetime);
    return d.toLocaleString("ar", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function fixtureTeamsHTML(f) {
    const h = App.getTeam(f.homeTeamId), a = App.getTeam(f.awayTeamId);
    return `<div class="row between" style="font-weight:800;font-size:16px;gap:10px">
        <span class="row" style="gap:8px">${h ? teamCrestHTML(h) : ""}<span>${esc(h?.name || "؟")}</span></span>
        <span class="muted">×</span>
        <span class="row" style="gap:8px"><span>${esc(a?.name || "؟")}</span>${a ? teamCrestHTML(a) : ""}</span>
      </div>`;
  }

  // بطاقة مصغّرة للمباريات القادمة على الرئيسية (لكل الأدوار)
  function upcomingFixturesCard() {
    const up = App.state.fixtures.filter((f) => f.status !== "done").slice(0, 4);
    if (!up.length) return "";
    const rows = up
      .map(
        (f) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
        ${fixtureTeamsHTML(f)}
        <div class="small muted" style="margin-top:4px">${fixtureWhen(f)}${f.note ? " • " + esc(f.note) : ""}</div>
      </div>`
      )
      .join("");
    return `<div class="section-title"><h2>المباريات القادمة</h2></div>
      <div class="card">${rows}</div>`;
  }

  function viewFixtures() {
    const admin = isAdmin();
    const fixtures = App.state.fixtures
      .slice()
      .sort((a, b) => (a.status === b.status ? (a.week || 0) - (b.week || 0) : a.status === "done" ? 1 : -1));
    const list = fixtures.length
      ? fixtures
          .map((f) => {
            const done = f.status === "done";
            const adminBtns = admin
              ? `<div class="row wrap" style="margin-top:10px;gap:6px">
                   ${!done ? `<button class="btn sm gold" data-action="live-fixture" data-id="${f.id}">🎬 تسجيل مباشر</button>` : ""}
                   <button class="btn sm" data-action="build-lineup" data-id="${f.id}::${f.homeTeamId}">🧩 تشكيلة ${esc(App.getTeam(f.homeTeamId)?.name || "")}</button>
                   <button class="btn sm" data-action="build-lineup" data-id="${f.id}::${f.awayTeamId}">🧩 تشكيلة ${esc(App.getTeam(f.awayTeamId)?.name || "")}</button>
                   <button class="btn sm ghost" data-action="edit-fixture" data-id="${f.id}">تعديل</button>
                   <button class="btn sm ghost" data-action="fixture-done" data-id="${f.id}">${done ? "إرجاع" : "أُقيمت"}</button>
                   <button class="btn sm danger" data-action="del-fixture" data-id="${f.id}">حذف</button>
                 </div>`
              : "";
            return `<div class="card" style="opacity:${done ? 0.6 : 1}">
              <div class="row between">
                <span class="badge ${done ? "sold" : "open"}">${done ? "أُقيمت" : "قادمة"}</span>
                <span class="small muted">${fixtureWhen(f)}</span>
              </div>
              <div style="margin-top:10px">${fixtureTeamsHTML(f)}</div>
              ${f.note ? `<div class="small muted" style="margin-top:6px">${esc(f.note)}</div>` : ""}
              ${adminBtns}
            </div>`;
          })
          .join("")
      : `<div class="empty"><div class="big">📅</div>لا توجد مباريات قادمة${admin ? ". أضِف أول مباراة." : "."}</div>`;
    return `<div class="section-title"><h2>المباريات القادمة</h2>
        <div class="spacer"></div>
        ${admin ? `<button class="btn primary sm" data-action="add-fixture">＋ إضافة مباراة</button>` : ""}
      </div>
      <div class="grid">${list}</div>`;
  }

  function openFixtureForm(fixture) {
    const f = fixture || { homeTeamId: App.state.teams[0]?.id, awayTeamId: App.state.teams[1]?.id, week: App.state.club.week, datetime: "", note: "" };
    const body = `
      <div class="grid cols-2">
        <label class="field"><span>الفريق الأول</span><select id="fx-home">${teamOptions(f.homeTeamId)}</select></label>
        <label class="field"><span>الفريق الثاني</span><select id="fx-away">${teamOptions(f.awayTeamId)}</select></label>
      </div>
      <div class="grid cols-2">
        <label class="field"><span>الأسبوع</span><input id="fx-week" type="number" value="${f.week || App.state.club.week}"></label>
        <label class="field"><span>التاريخ والوقت</span><input id="fx-dt" type="datetime-local" value="${esc(f.datetime || "")}"></label>
      </div>
      <label class="field"><span>ملاحظة (اختياري)</span><input id="fx-note" value="${esc(f.note || "")}" placeholder="مثال: الملعب الرئيسي"></label>`;
    modal({
      title: fixture ? "تعديل مباراة قادمة" : "مباراة قادمة جديدة",
      body,
      foot: `<button class="btn primary" data-save>حفظ</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-save]", root).onclick = () => {
          const homeTeamId = $("#fx-home", root).value;
          const awayTeamId = $("#fx-away", root).value;
          if (homeTeamId === awayTeamId) return toast("اختر فريقين مختلفين", "err");
          const data = {
            homeTeamId, awayTeamId,
            week: parseInt($("#fx-week", root).value, 10) || App.state.club.week,
            datetime: $("#fx-dt", root).value,
            note: $("#fx-note", root).value.trim(),
          };
          if (fixture) App.updateFixture(fixture.id, data);
          else App.addFixture(data);
          toast("حُفظت المباراة", "ok");
          close();
          render();
        };
      },
    });
  }

  /* =========================================================
     التشكيلات (Lineups) — رئيس النادي يبني تشكيلة فريقه
     ========================================================= */
  function viewLineups() {
    const teamId = myTeamId();
    const team = App.getTeam(teamId);
    if (!team) return `<div class="empty">لا يوجد فريق مرتبط بحسابك.</div>`;
    const fixtures = App.teamFixtures(teamId);
    const cards = fixtures.length
      ? fixtures
          .map((f) => {
            const opp = App.getTeam(f.homeTeamId === teamId ? f.awayTeamId : f.homeTeamId);
            const lu = App.getLineup(f.id, teamId);
            const count = lu ? Object.values(lu.assign || {}).filter(Boolean).length : 0;
            return `<div class="card">
              <div class="row between">
                <span class="badge ${f.status === "done" ? "sold" : "open"}">${f.status === "done" ? "أُقيمت" : "قادمة"}</span>
                <span class="small muted">${fixtureWhen(f)}</span>
              </div>
              <div class="row" style="gap:8px;margin-top:8px;font-weight:800">
                <span>ضد</span> ${opp ? teamCrestHTML(opp) : ""} <span>${esc(opp?.name || "؟")}</span>
              </div>
              <div class="small muted" style="margin-top:6px">${lu ? `الخطة ${esc(lu.formationId)} • ${count} لاعب` : "لم تُبنَ التشكيلة بعد"}</div>
              <div class="row wrap" style="margin-top:10px;gap:8px">
                <button class="btn sm primary" data-action="build-lineup" data-id="${f.id}::${teamId}">🧩 ${lu ? "تعديل" : "بناء"} التشكيلة</button>
                ${lu ? `<button class="btn sm gold" data-action="export-lineup" data-id="${f.id}::${teamId}">🖼️ تصدير PNG</button>` : ""}
              </div>
            </div>`;
          })
          .join("")
      : `<div class="empty"><div class="big">🧩</div>لا توجد مباريات قادمة لفريقك بعد.<br><span class="small">يضيفها المشرف في «المباريات القادمة».</span></div>`;
    return `<div class="section-title"><h2>تشكيلات ${esc(team.name)}</h2><span class="hint">ابنِ تشكيلة كل مباراة وصدّرها صورة</span></div>
      <div class="grid">${cards}</div>`;
  }

  // معاينة الملعب (HTML) — تُستخدم داخل البنّاء
  function pitchPreviewHTML(team, formationId, assign) {
    const slots = App.formationSlots(formationId);
    const tokens = slots
      .map((s, i) => {
        const p = assign[i] ? App.getPlayer(assign[i]) : null;
        const label = p ? (p.number || (p.name || "?").trim().charAt(0)) : "?";
        const name = p ? p.name : "—";
        return `<div class="pitch-token" style="left:${s.x * 100}%;top:${(1 - s.y) * 100}%">
          <span class="pt-badge" style="background:${team.color}">${esc(String(label))}</span>
          <span class="pt-name">${esc(name)}</span>
        </div>`;
      })
      .join("");
    return `<div class="pitch">${tokens}</div>`;
  }

  function openLineupBuilder(fixtureId, teamId) {
    const team = App.getTeam(teamId);
    const fixture = App.getFixture(fixtureId);
    if (!team || !fixture) return toast("بيانات غير مكتملة", "err");
    const players = App.teamPlayers(teamId);
    if (!players.length) return toast("لا يوجد لاعبون في هذا الفريق", "err");
    const saved = App.getLineup(fixtureId, teamId);
    let formationId = saved?.formationId || "2-2-1";
    let assign = Object.assign({}, saved?.assign || {});

    const body = document.createElement("div");
    function renderBody() {
      const slots = App.formationSlots(formationId);
      // نظّف الإسنادات الزائدة عن عدد المراكز
      Object.keys(assign).forEach((k) => { if (+k >= slots.length) delete assign[k]; });
      const formationOpts = App.FORMATIONS.map(
        (f) => `<option value="${f.id}" ${f.id === formationId ? "selected" : ""}>${f.label} (${f.lines.reduce((a, b) => a + b, 0) + 1})</option>`
      ).join("");
      const slotRows = slots
        .map((s, i) => {
          const opts = `<option value="">—</option>` + players
            .map((p) => `<option value="${p.id}" ${assign[i] === p.id ? "selected" : ""}>${esc(p.name)}${p.number ? " #" + esc(p.number) : ""}</option>`)
            .join("");
          return `<div class="row" style="gap:8px;margin-bottom:6px;align-items:center">
            <span class="chip" style="min-width:52px;justify-content:center">${esc(s.role)}</span>
            <select data-slot="${i}" style="flex:1">${opts}</select>
          </div>`;
        })
        .join("");
      body.innerHTML = `
        <label class="field"><span>الخطة</span><select id="lu-formation">${formationOpts}</select></label>
        ${pitchPreviewHTML(team, formationId, assign)}
        <div class="section-title" style="margin:12px 0 6px"><h2 style="font-size:15px">المراكز</h2></div>
        ${slotRows}`;
      $("#lu-formation", body).onchange = (e) => { formationId = e.target.value; renderBody(); };
      body.querySelectorAll("[data-slot]").forEach((sel) => {
        sel.onchange = () => {
          const i = sel.getAttribute("data-slot");
          const pid = sel.value;
          // امنع تكرار نفس اللاعب في مركزين
          if (pid) Object.keys(assign).forEach((k) => { if (assign[k] === pid) delete assign[k]; });
          if (pid) assign[i] = pid; else delete assign[i];
          renderBody();
        };
      });
    }
    renderBody();

    modal({
      title: "تشكيلة " + team.name,
      body,
      foot: `<button class="btn primary" data-save>حفظ</button>
             <button class="btn gold" data-export>🖼️ حفظ وتصدير PNG</button>
             <button class="btn ghost" data-close>إغلاق</button>`,
      onOpen(root, close) {
        const doSave = () => App.saveLineup(fixtureId, teamId, { formationId, assign });
        $("[data-save]", root).onclick = () => { doSave(); toast("حُفظت التشكيلة", "ok"); close(); render(); };
        $("[data-export]", root).onclick = () => { doSave(); close(); render(); exportLineupPNG(fixtureId, teamId); };
      },
    });
  }

  /* ---------- تصدير التشكيلة صورة PNG (canvas) ---------- */
  function exportLineupPNG(fixtureId, teamId) {
    const team = App.getTeam(teamId);
    const fixture = App.getFixture(fixtureId);
    const lu = App.getLineup(fixtureId, teamId);
    if (!team || !fixture || !lu) return toast("لا توجد تشكيلة للتصدير", "err");
    const opp = App.getTeam(fixture.homeTeamId === teamId ? fixture.awayTeamId : fixture.homeTeamId);
    const slots = App.formationSlots(lu.formationId);

    const W = 900, H = 1280, HEAD = 200;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    function draw(imgs) {
      const crestImg = imgs[team.logo];
      // خلفية عامة
      ctx.fillStyle = "#0d1836"; ctx.fillRect(0, 0, W, H);
      // رأس
      ctx.fillStyle = "#111f45"; ctx.fillRect(0, 0, W, HEAD);
      ctx.fillStyle = team.color; ctx.fillRect(0, HEAD - 6, W, 6);
      if (crestImg) { try { ctx.drawImage(crestImg, W - 150, 30, 120, 120); } catch (e) {} }
      ctx.textAlign = "right"; ctx.direction = "rtl";
      ctx.fillStyle = "#fff"; ctx.font = "bold 46px 'Segoe UI', Tahoma, sans-serif";
      ctx.fillText(team.name, W - 40, 78);
      ctx.fillStyle = "#a7b2d8"; ctx.font = "26px 'Segoe UI', Tahoma, sans-serif";
      ctx.fillText("ضد " + (opp?.name || "؟") + " • " + fixtureWhen(fixture), W - 40, 120);
      ctx.fillStyle = "#c9a24a"; ctx.font = "bold 28px 'Segoe UI', Tahoma, sans-serif";
      ctx.fillText("الخطة " + lu.formationId, W - 40, 162);
      ctx.textAlign = "left";
      ctx.fillStyle = "#7d8bb5"; ctx.font = "22px 'Segoe UI', Tahoma, sans-serif";
      ctx.fillText(App.state.club.name, 40, 120);

      // الملعب
      const px = 30, py = HEAD + 20, pw = W - 60, ph = H - HEAD - 50;
      const grad = ctx.createLinearGradient(0, py, 0, py + ph);
      grad.addColorStop(0, "#1f7a43"); grad.addColorStop(1, "#176036");
      ctx.fillStyle = grad; ctx.fillRect(px, py, pw, ph);
      // خطوط الملعب
      ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 3;
      ctx.strokeRect(px + 8, py + 8, pw - 16, ph - 16);
      ctx.beginPath(); ctx.moveTo(px + 8, py + ph / 2); ctx.lineTo(px + pw - 8, py + ph / 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(px + pw / 2, py + ph / 2, 70, 0, Math.PI * 2); ctx.stroke();
      // منطقتا الجزاء
      const boxW = pw * 0.5, boxH = ph * 0.12;
      ctx.strokeRect(px + (pw - boxW) / 2, py + 8, boxW, boxH);
      ctx.strokeRect(px + (pw - boxW) / 2, py + ph - 8 - boxH, boxW, boxH);

      // اللاعبون (بصورهم إن وُجدت)
      slots.forEach((s, i) => {
        const p = lu.assign[i] ? App.getPlayer(lu.assign[i]) : null;
        const cx = px + s.x * pw;
        const cy = py + (1 - s.y) * ph;
        const r = 42;
        const photo = p && p.photo ? imgs[p.photo] : null;
        if (photo) {
          // صورة اللاعب داخل دائرة (تغطية مع قصّ)
          ctx.save();
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
          const scale = Math.max((2 * r) / photo.width, (2 * r) / photo.height);
          const dw = photo.width * scale, dh = photo.height * scale;
          try { ctx.drawImage(photo, cx - dw / 2, cy - dh / 2, dw, dh); } catch (e) {}
          ctx.restore();
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.lineWidth = 3; ctx.strokeStyle = team.color; ctx.stroke();
          ctx.lineWidth = 1; ctx.strokeStyle = "#fff"; ctx.stroke();
          // شارة الرقم في الزاوية
          if (p.number) {
            const bx = cx + r * 0.72, by = cy - r * 0.72;
            ctx.beginPath(); ctx.arc(bx, by, 15, 0, Math.PI * 2);
            ctx.fillStyle = team.color; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
            ctx.textAlign = "center"; ctx.fillStyle = "#fff";
            ctx.font = "bold 17px 'Segoe UI', Tahoma, sans-serif";
            ctx.fillText(String(p.number), bx, by + 6);
          }
        } else {
          // لا صورة → دائرة ملوّنة بالرقم/الحرف (السلوك السابق)
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = p ? team.color : "rgba(0,0,0,0.35)";
          ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
          ctx.textAlign = "center"; ctx.direction = "rtl";
          ctx.fillStyle = "#fff"; ctx.font = "bold 30px 'Segoe UI', Tahoma, sans-serif";
          const label = p ? String(p.number || (p.name || "?").trim().charAt(0)) : "?";
          ctx.fillText(label, cx, cy + 11);
        }
        // الاسم أسفل الدائرة
        const nm = p ? p.name : s.role;
        ctx.textAlign = "center"; ctx.direction = "rtl";
        ctx.font = "bold 22px 'Segoe UI', Tahoma, sans-serif";
        const tw = ctx.measureText(nm).width + 16;
        ctx.fillStyle = "rgba(13,24,54,0.85)";
        ctx.fillRect(cx - tw / 2, cy + r + 6, tw, 30);
        ctx.fillStyle = "#fff";
        ctx.fillText(nm, cx, cy + r + 28);
      });

      // تنزيل
      try {
        const url = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = `تشكيلة-${team.name}-${(opp?.name || "")}.png`.replace(/\s+/g, "_");
        a.click();
        toast("تم تصدير الصورة", "ok");
      } catch (e) {
        console.error(e);
        toast("تعذّر التصدير", "err");
      }
    }

    // حمّل شعار الفريق وصور اللاعبين ثم ارسم (وإن فشل أي منها يُرسم بدونه)
    const srcs = [team.logo];
    slots.forEach((s, i) => {
      const p = lu.assign[i] ? App.getPlayer(lu.assign[i]) : null;
      if (p && p.photo) srcs.push(p.photo);
    });
    loadImages(srcs, draw);
  }

  // تحميل مجموعة صور (شعارات/صور لاعبين) ثم استدعاء cb بخريطة {src: Image|null}
  function loadImages(srcs, cb) {
    const map = {};
    const uniq = [...new Set(srcs.filter(Boolean))];
    if (!uniq.length) return cb(map);
    let left = uniq.length;
    uniq.forEach((src) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { map[src] = img; if (--left === 0) cb(map); };
      img.onerror = () => { map[src] = null; if (--left === 0) cb(map); };
      img.src = src;
    });
  }

  const VIEWS = {
    dashboard: viewDashboard,
    teams: viewTeams,
    players: viewPlayers,
    matches: viewMatches,
    fixtures: viewFixtures,
    market: viewMarket,
    ledger: viewLedger,
    lineups: viewLineups,
    auction: viewAuctionScreen,
  };
  // مسارات تُعرض بملء الشاشة (بدون الشريط العلوي/السفلي) — مناسبة للعرض على شاشة كبيرة
  const FULLSCREEN_ROUTES = new Set(["auction"]);

  /* =========================================================
     التطبيق (Render + Router)
     ========================================================= */
  function render() {
    // نافذة منبثقة مفتوحة → أجّل إعادة الرسم حتى تُغلق، حتى لا نمسح
    // النافذة وما يكتبه المستخدم بداخلها (يحدث مع تحديثات المزامنة السحابية).
    if (openModals > 0) { pendingRender = true; return; }
    // لا جلسة → شاشة الدخول
    if (!session) { renderLogin(); return; }
    // تأكد أن التبويب الحالي مسموح للدور، وإلا اذهب لأول تبويب مسموح
    // (المسارات كاملة الشاشة مثل شاشة المزاد مستثناة لأنها ليست تبويبات)
    const tabs = roleTabs();
    if (!FULLSCREEN_ROUTES.has(route) && !tabs.some((t) => t.key === route)) route = tabs[0].key;
    // بناء محتوى التبويب داخل try: لو انهار عرض تبويب بسبب بيانات ناقصة،
    // نُظهر رسالة بدل ترك الصفحة فارغة/معلّقة وبقية الأزرار بلا ربط.
    let main;
    try {
      main = (VIEWS[route] || viewDashboard)();
    } catch (e) {
      console.error("خطأ في عرض التبويب", route, e);
      main = `<div class="empty"><div class="big">⚠️</div>تعذّر عرض هذه الصفحة.<br><span class="small muted">${esc(e && e.message ? e.message : e)}</span></div>`;
    }
    if (FULLSCREEN_ROUTES.has(route)) {
      document.body.innerHTML = `<main class="app fullscreen-view" id="app">${main}</main>`;
    } else {
      document.body.innerHTML = renderTopbar() + `<main class="app" id="app">${main}</main>` + renderNav();
    }
    wire();
    if (App.cloud && App.cloud.updateBadge) App.cloud.updateBadge();
  }
  App.render = render;

  function go(r) {
    route = r;
    if (location.hash !== "#" + r) history.replaceState(null, "", "#" + r);
    render();
    window.scrollTo(0, 0);
  }
  App.go = go;

  /* ---------- ربط الأحداث ---------- */
  function wire() {
    document.querySelectorAll("[data-nav]").forEach((b) => {
      b.onclick = () => go(b.getAttribute("data-nav"));
    });
    // فلاتر اللاعبين
    document.querySelectorAll("[data-filter]").forEach((b) => {
      b.onclick = () => {
        playersFilter = b.getAttribute("data-filter");
        render();
      };
    });
    document.querySelectorAll("[data-lfilter]").forEach((b) => {
      b.onclick = () => {
        ledgerFilter = b.getAttribute("data-lfilter");
        render();
      };
    });
    // الأفعال
    document.querySelectorAll("[data-action]").forEach((b) => {
      b.onclick = () => handleAction(b.getAttribute("data-action"), b.getAttribute("data-id"));
    });
  }

  // أفعال يقتصر تنفيذها على المشرف
  const ADMIN_ACTIONS = new Set([
    "settings", "advance-week", "new-match", "edit-match", "del-match", "live-match", "live-fixture", "awards",
    "add-player", "add-player-to", "edit-player", "eval-player", "del-player",
    "edit-team", "open-market-random", "open-market-manual", "finalize-lot",
    "close-market", "auction-screen", "export", "import",
    "add-fixture", "edit-fixture", "del-fixture", "fixture-done",
  ]);

  // غلاف يلتقط أي خطأ أثناء تنفيذ الإجراء (مثل فتح نافذة) فيُظهره كرسالة
  // بدل أن يفشل الضغط بصمت فتبدو الصفحة "معلّقة" ولا تفتح النافذة.
  function handleAction(action, id) {
    try {
      return handleActionImpl(action, id);
    } catch (e) {
      console.error("خطأ في تنفيذ الإجراء", action, e);
      toast("حدث خطأ: " + (e && e.message ? e.message : e), "err");
    }
  }

  function handleActionImpl(action, id) {
    if (ADMIN_ACTIONS.has(action) && !isAdmin())
      return toast("لا تملك صلاحية لهذا الإجراء", "err");
    switch (action) {
      case "logout":
        return confirmBox("تسجيل الخروج من الحساب الحالي؟", logout);
      case "settings": return openSettings();
      case "advance-week":
        return confirmBox("إنهاء الأسبوع الحالي والانتقال للأسبوع التالي؟", () => {
          App.advanceWeek();
          toast("انتقلنا للأسبوع " + App.state.club.week, "ok");
          render();
        });
      case "new-match": return openMatchForm();
      case "edit-match": {
        const m = App.state.matches.find((x) => x.id === id);
        if (!m) return toast("المباراة غير موجودة", "err");
        return openMatchForm(m);
      }
      case "live-match": return openLiveMatchPicker();
      case "live-fixture": {
        const f = App.getFixture(id);
        if (!f) return toast("المباراة غير موجودة", "err");
        return openLiveMatch(f.homeTeamId, f.awayTeamId, f.id);
      }
      case "del-match":
        return confirmBox("حذف المباراة وإرجاع فلوسها وتقييماتها؟", () => { App.deleteMatch(id); toast("حُذفت المباراة"); render(); }, true);
      case "go-market": return go("market");
      case "auction-screen": return go("auction");
      case "awards": return openAwards();
      case "add-player": return openPlayerForm(null, null);
      case "add-player-to": return openPlayerForm(null, id);
      case "edit-player": return openPlayerForm(App.getPlayer(id));
      case "eval-player": return openEvaluate(id);
      case "player-detail": return openPlayerDetail(id);
      case "player-stats": return openPlayerStats(id);
      case "match-stats": return openMatchStats(id);
      case "del-player":
        return confirmBox("حذف هذا اللاعب نهائيًا؟", () => {
          App.state.players = App.state.players.filter((p) => p.id !== id);
          App.state.ratingLog = App.state.ratingLog.filter((l) => l.playerId !== id);
          App.state.teams.forEach((t) => { if (t.captainId === id) t.captainId = null; });
          App.save(); toast("حُذف اللاعب"); render();
        }, true);
      case "edit-team": return openTeamForm(App.getTeam(id));
      case "open-market-random": {
        const ids = App.pickRandomForMarket(8);
        if (!ids.length) return toast("لا يوجد لاعبون أحرار", "err");
        App.openMarket(ids); toast("فُتح السوق بـ " + ids.length + " لاعب", "ok"); return render();
      }
      case "open-market-manual": return openMarketManual();
      case "place-bid": return doBid(id);
      case "finalize-lot":
        return confirmBox("إرساء المزاد على أعلى مزايد؟", () => { App.finalizeLot(id); toast("تم الإرساء", "ok"); render(); });
      case "close-market":
        return confirmBox("إغلاق السوق؟ اللاعبون غير المُباعين يبقون أحرارًا.", () => { App.closeMarket(); toast("أُغلق السوق"); go("dashboard"); });
      case "export": return doExport();
      case "import": return doImport();
      // المباريات القادمة
      case "add-fixture": return openFixtureForm(null);
      case "edit-fixture": return openFixtureForm(App.getFixture(id));
      case "del-fixture":
        return confirmBox("حذف هذه المباراة القادمة؟", () => { App.deleteFixture(id); toast("حُذفت"); render(); }, true);
      case "fixture-done":
        App.updateFixture(id, { status: App.getFixture(id)?.status === "done" ? "upcoming" : "done" });
        return render();
      // التشكيلة (id = "fixtureId::teamId")
      case "build-lineup": {
        const [fid, tid] = String(id).split("::");
        const teamId = tid || myTeamId();
        if (!teamId) return toast("لا يوجد فريق", "err");
        if (isPresident() && teamId !== myTeamId()) return toast("لا تملك صلاحية", "err");
        return openLineupBuilder(fid, teamId);
      }
      case "export-lineup": {
        const [fid, tid] = String(id).split("::");
        return exportLineupPNG(fid, tid || myTeamId());
      }
    }
  }

  /* ---------- نموذج اللاعب ---------- */
  function openPlayerForm(player, presetTeam) {
    const isEdit = !!player;
    const p = player || { name: "", position: "", number: "", teamId: presetTeam || "", stats: {}, photo: null, rating: App.RATING_START };
    const statsInputs = App.state.statDefs
      .map(
        (d) => `<div class="stat-input">
          <span>${esc(d.label)}</span>
          <input type="number" min="0" max="99" data-stat="${d.key}" value="${p.stats && p.stats[d.key] != null ? p.stats[d.key] : ""}" placeholder="0-99">
        </div>`
      )
      .join("");
    const body = `
      <label class="field"><span>اسم اللاعب</span><input id="pl-name" value="${esc(p.name)}" placeholder="مثال: أحمد"></label>
      <div class="grid cols-2">
        <label class="field"><span>المركز</span><select id="pl-pos"><option value="">—</option>${App.POSITIONS.map((x) => `<option ${x === p.position ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="field"><span>الرقم</span><input id="pl-num" type="number" value="${esc(p.number)}"></label>
      </div>
      <label class="field"><span>الفريق</span><select id="pl-team">${teamOptions(p.teamId, true)}</select></label>
      <div class="grid cols-2">
        <label class="field"><span>التقييم (الطاقة)</span><input id="pl-rating" type="number" min="${App.RATING_MIN}" max="${App.RATING_MAX}" value="${p.rating != null ? p.rating : App.RATING_START}"></label>
        <label class="field"><span>صورة (اختياري)</span><input id="pl-photo" type="file" accept="image/*"></label>
      </div>
      <div class="small muted" style="margin-bottom:10px">يبدأ اللاعب من ${App.RATING_START} ويتغيّر بالتقييم لاحقًا (الحد الأقصى ${App.RATING_MAX}).</div>
      <details style="margin-bottom:6px"><summary class="muted small" style="cursor:pointer">مهارات وصفية اختيارية (لا تؤثر على التقييم)</summary>
      <div style="margin-top:10px">${statsInputs}</div></details>`;
    let photoData = p.photo;
    modal({
      title: isEdit ? "تعديل لاعب" : "لاعب جديد",
      body,
      foot: `<button class="btn primary" data-save>حفظ</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("#pl-photo", root).onchange = (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => (photoData = rd.result);
          rd.readAsDataURL(f);
        };
        $("[data-save]", root).onclick = () => {
          const name = $("#pl-name", root).value.trim();
          if (!name) return toast("اكتب اسم اللاعب", "err");
          const stats = {};
          root.querySelectorAll("[data-stat]").forEach((inp) => {
            const v = inp.value === "" ? null : clamp(parseInt(inp.value, 10) || 0, 0, 99);
            if (v !== null) stats[inp.getAttribute("data-stat")] = v;
          });
          const data = {
            name,
            position: $("#pl-pos", root).value,
            number: $("#pl-num", root).value,
            teamId: $("#pl-team", root).value || null,
            rating: clamp(parseInt($("#pl-rating", root).value, 10) || App.RATING_START, App.RATING_MIN, App.RATING_MAX),
            stats,
            photo: photoData || null,
          };
          if (isEdit) Object.assign(player, data);
          else App.state.players.push(Object.assign({ id: uid(), createdAt: Date.now() }, data));
          App.save();
          toast(isEdit ? "حُفظت التعديلات" : "أُضيف اللاعب", "ok");
          close();
          render();
        };
      },
    });
  }

  /* ---------- تقييم اللاعب (حساب الطاقة) ---------- */
  function openEvaluate(playerId) {
    const p = App.getPlayer(playerId);
    if (!p) return;
    const rules = App.state.ratingRules;
    const isGK = p.position === "حارس";

    const ruleRow = (rule) => `
      <div class="stat-input">
        <span>${esc(rule.label)} <b style="color:${rules[rule.key] < 0 ? "var(--danger)" : "var(--brand)"}">${rules[rule.key] > 0 ? "+" : ""}${rules[rule.key]}</b></span>
        <input type="number" min="0" data-eval="${rule.key}" value="0" style="width:70px">
      </div>`;

    const section = (title, arr, hint) =>
      `<div class="section-title" style="margin:10px 0 6px"><h2 style="font-size:14px">${title}</h2>${hint ? `<span class="hint">${hint}</span>` : ""}</div>${arr.map(ruleRow).join("")}`;

    const body = document.createElement("div");
    body.innerHTML = `
      <div class="card" style="background:#0e1830;margin-bottom:12px">
        <div class="row between">
          <div><b>${esc(p.name)}</b> <span class="muted small">${esc(p.position || "")}</span></div>
          <div>التقييم الحالي: <b style="color:var(--gold);font-size:20px">${App.playerOverall(p)}</b></div>
        </div>
        <div class="row between" style="margin-top:8px">
          <span class="muted small">التغيير:</span>
          <span id="ev-delta" class="mono" style="font-size:16px;font-weight:800">0</span>
          <span class="muted small">التقييم الجديد:</span>
          <span id="ev-new" class="mono" style="font-size:18px;font-weight:800;color:var(--brand)">${App.playerOverall(p)}</span>
        </div>
      </div>
      ${section("للجميع", App.RATING_RULES.general)}
      ${section("للحارس", App.RATING_RULES.goalkeeper, isGK ? "" : "(هذا اللاعب ليس حارسًا)")}
      ${section("الخصومات", App.RATING_RULES.deductions)}
      <label class="field" style="margin-top:10px"><span>ملاحظة (اختياري)</span><input id="ev-note" placeholder="مثال: مباراة الأسبوع 3"></label>`;

    function recompute() {
      let delta = 0;
      body.querySelectorAll("[data-eval]").forEach((inp) => {
        const c = parseInt(inp.value, 10) || 0;
        delta += c * (rules[inp.getAttribute("data-eval")] || 0);
      });
      const cur = App.playerOverall(p);
      const nw = clamp(cur + delta, App.RATING_MIN, App.RATING_MAX);
      const dEl = body.querySelector("#ev-delta");
      dEl.textContent = (delta > 0 ? "+" : "") + delta;
      dEl.style.color = delta < 0 ? "var(--danger)" : delta > 0 ? "var(--brand)" : "var(--muted)";
      body.querySelector("#ev-new").textContent = nw;
    }
    body.addEventListener("input", recompute);

    modal({
      title: "⚡ تقييم لاعب",
      body,
      foot: `<button class="btn primary" data-save>تطبيق التقييم</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-save]", root).onclick = () => {
          const counts = {};
          let any = false;
          body.querySelectorAll("[data-eval]").forEach((inp) => {
            const c = parseInt(inp.value, 10) || 0;
            if (c) { counts[inp.getAttribute("data-eval")] = c; any = true; }
          });
          if (!any) return toast("أدخل عدد حدث واحد على الأقل", "err");
          const res = App.evaluatePlayer(playerId, counts, body.querySelector("#ev-note").value.trim());
          toast(`التقييم ${res.oldRating} ← ${res.newRating}`, "ok");
          close();
          render();
        };
      },
    });
  }

  /* ---------- إحصائيات المباراة (مرتّبة لكل فريق) ---------- */
  function openMatchStats(matchId) {
    const m = App.state.matches.find((x) => x.id === matchId);
    if (!m) return toast("المباراة غير موجودة", "err");
    const h = App.getTeam(m.homeTeamId), a = App.getTeam(m.awayTeamId);
    const events = m.events || [];
    const cH = {}, cA = {};
    events.forEach((ev) => {
      const bag = ev.teamId === m.homeTeamId ? cH : ev.teamId === m.awayTeamId ? cA : null;
      if (bag) bag[ev.type] = (bag[ev.type] || 0) + 1;
    });
    const hColor = (h && h.color) || "#888", aColor = (a && a.color) || "#888";

    // صف مقارنة عام (قيمة يمين/يسار + شريط بلون كل فريق)
    const cmpRow = (label, hv, av, suffix) => {
      const tot = hv + av, hp = tot ? Math.round((hv / tot) * 100) : 50;
      const sfx = suffix || "";
      return `<div class="ms-row">
        <span class="ms-val">${hv}${sfx}</span>
        <div class="ms-bars">
          <div class="ms-label">${esc(label)}</div>
          <div class="ms-track"><i style="width:${hp}%;background:${hColor}"></i><i style="width:${100 - hp}%;background:${aColor}"></i></div>
        </div>
        <span class="ms-val">${av}${sfx}</span>
      </div>`;
    };

    // إحصائيات مشتقّة (تسديدات + أخطاء + كروت + تسطيح...)
    const S = App.matchStats(m);
    const advRows = [
      ["التسديدات", S.home.shots, S.away.shots, ""],
      ["على المرمى", S.home.shotsOnTarget, S.away.shotsOnTarget, ""],
      ["دقّة التحويل", S.home.conversion, S.away.conversion, "%"],
      ["التمريرات", S.home.passes, S.away.passes, ""],
      ["قطع الكرات", S.home.interceptions, S.away.interceptions, ""],
      ["التصدّيات", S.home.saves, S.away.saves, ""],
      ["الأخطاء", S.home.fouls, S.away.fouls, ""],
      ["تسطيح الكرة", S.home.nutmeg, S.away.nutmeg, ""],
      ["كرت أصفر 🟨", S.home.yellow, S.away.yellow, ""],
      ["كرت أحمر 🟥", S.home.red, S.away.red, ""],
    ]
      .filter((r) => r[1] + r[2] > 0)
      .map((r) => cmpRow(r[0], r[1], r[2], r[3]))
      .join("");

    // تفصيل كل نوع حدث كما سُجّل
    const rows = App.MATCH_ACTIONS
      .filter((act) => (cH[act.key] || 0) + (cA[act.key] || 0) > 0)
      .map((act) => cmpRow(act.label, cH[act.key] || 0, cA[act.key] || 0))
      .join("") || `<div class="small muted" style="text-align:center">لا أحداث مسجّلة في هذه المباراة.</div>`;

    const scorersFor = (teamId) => {
      const map = {};
      events
        .filter((e) => e.teamId === teamId && (e.type === "goal" || e.type === "penaltyGoal") && e.playerId)
        .forEach((e) => { map[e.playerId] = (map[e.playerId] || 0) + 1; });
      const names = Object.keys(map).map((pid) => {
        const p = App.getPlayer(pid);
        return (p ? esc(p.name) : "") + (map[pid] > 1 ? ` (${map[pid]})` : "");
      });
      return names.length ? names.join("، ") : "—";
    };

    const body = `
      <div class="ms-head">
        <div class="ms-team">${h ? teamCrestHTML(h) : ""}<div class="ms-tn">${esc(h ? h.name : "؟")}</div></div>
        <div class="ms-score mono">${m.homeScore} - ${m.awayScore}</div>
        <div class="ms-team">${a ? teamCrestHTML(a) : ""}<div class="ms-tn">${esc(a ? a.name : "؟")}</div></div>
      </div>
      <div class="small muted" style="text-align:center;margin:8px 0 12px">الأسبوع ${m.week} • ${new Date(m.date).toLocaleDateString("ar")}</div>
      <div class="ms-scorers" style="margin-top:14px">
        <div><div class="small muted">⚽ هدّافو ${esc(h ? h.name : "")}</div>${scorersFor(m.homeTeamId)}</div>
        <div style="text-align:left"><div class="small muted">⚽ هدّافو ${esc(a ? a.name : "")}</div>${scorersFor(m.awayTeamId)}</div>
      </div>
      ${advRows ? `<div class="section-title" style="margin:16px 0 8px"><h2 style="font-size:15px">أبرز الأرقام</h2></div><div class="ms-rows">${advRows}</div>` : ""}
      <div class="section-title" style="margin:16px 0 8px"><h2 style="font-size:15px">تفصيل الأحداث</h2></div>
      <div class="ms-rows">${rows}</div>`;

    modal({ title: "إحصائيات المباراة", body, foot: `<button class="btn ghost" data-close>إغلاق</button>` });
  }

  /* ---------- إحصائيات اللاعب (للعرض العام) ---------- */
  function openPlayerStats(playerId) {
    const p = App.getPlayer(playerId);
    if (!p) return toast("اللاعب غير موجود", "err");
    const MM = App.MATCH_MINUTES || 15;
    const matches = App.playerMatches(playerId);
    const totalMatches = matches.length;
    const totalMinutes = totalMatches * MM;
    const team = App.getTeam(p.teamId);

    const last2 = matches.slice(0, 2).map((m) => {
      const myEv = m.events.find((e) => e.playerId === playerId);
      const myTeamId = myEv ? myEv.teamId : p.teamId;
      const myTeam = App.getTeam(myTeamId);
      const oppId = myTeamId === m.homeTeamId ? m.awayTeamId : m.homeTeamId;
      const opp = App.getTeam(oppId);
      const myScore = myTeamId === m.homeTeamId ? m.homeScore : m.awayScore;
      const oppScore = myTeamId === m.homeTeamId ? m.awayScore : m.homeScore;
      const evCount = m.events.filter((e) => e.playerId === playerId).length;
      const ratingDelta = App.state.ratingLog
        .filter((l) => l.matchId === m.id && l.playerId === playerId)
        .reduce((s, l) => s + (l.applied != null ? l.applied : l.delta || 0), 0);
      return `<div class="card" style="margin-bottom:10px">
        <div class="row between">
          <div class="small muted">${new Date(m.date).toLocaleDateString("ar")} • الأسبوع ${m.week}</div>
          <span class="mono" style="font-weight:800;font-size:16px">${myScore} - ${oppScore}</span>
        </div>
        <div style="margin-top:6px;font-weight:700">${esc(myTeam ? myTeam.name : "")} <span class="muted">ضد</span> ${esc(opp ? opp.name : "؟")}</div>
        <div class="small muted" style="margin-top:6px">
          المركز: ${esc(p.position || "—")} • الدقائق: ${MM} د • مساهمات: ${evCount}${ratingDelta ? " • التقييم " + (ratingDelta > 0 ? "+" : "") + ratingDelta : ""}
        </div>
      </div>`;
    }).join("") || `<div class="small muted">لم يلعب أي مباراة بعد.</div>`;

    const photo = p.photo
      ? `<img class="pc-photo" src="${p.photo}" alt="" style="width:72px;height:72px">`
      : `<div class="pc-photo" style="width:72px;height:72px">👤</div>`;

    const body = `
      <div class="row" style="gap:14px;align-items:center">
        ${photo}
        <div style="flex:1">
          <div style="font-size:20px;font-weight:800">${esc(p.name)}</div>
          <div class="small" style="color:${team ? team.color : "var(--muted)"}">${team ? esc(team.name) : "لاعب حر"}${p.number ? " • #" + esc(p.number) : ""}</div>
          <div class="small muted">المركز: ${esc(p.position || "—")} • التقييم: <b style="color:var(--gold)">${App.playerOverall(p)}</b></div>
        </div>
      </div>
      <div class="grid cols-2" style="margin:14px 0">
        <div class="card" style="text-align:center"><div class="muted small">مباريات لعبها</div><div style="font-size:26px;font-weight:800">${totalMatches}</div></div>
        <div class="card" style="text-align:center"><div class="muted small">إجمالي الدقائق</div><div style="font-size:26px;font-weight:800">${totalMinutes} <span class="small muted">د</span></div></div>
      </div>
      <div class="section-title" style="margin:6px 0 8px"><h2 style="font-size:15px">آخر مباراتين</h2></div>
      ${last2}`;

    modal({ title: "إحصائيات " + p.name, body, foot: `<button class="btn ghost" data-close>إغلاق</button>` });
  }

  /* ---------- تفاصيل اللاعب + سجل الحسبة ---------- */
  function openPlayerDetail(playerId) {
    const p = App.getPlayer(playerId);
    if (!p) return;
    const log = App.playerRatingLog(playerId);
    const attrAvg = App.playerAttrAvg(p);

    const history = log.length
      ? log
          .map((l) => {
            const bd = l.breakdown.length
              ? l.breakdown.map((b) => `${esc(b.label)} ×${b.count} (${b.subtotal > 0 ? "+" : ""}${b.subtotal})`).join("، ")
              : esc(l.note || "");
            return `<tr>
              <td class="small">أسبوع ${l.week}<br><span class="muted">${new Date(l.date).toLocaleDateString("ar")}</span></td>
              <td class="small">${bd || "—"}</td>
              <td class="mono"><span class="muted">${l.oldRating}</span> ← <b>${l.newRating}</b>
                <span class="amt ${l.applied < 0 ? "neg" : "pos"}"> (${l.applied > 0 ? "+" : ""}${l.applied})</span></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="3" class="empty small">لا يوجد سجل تقييم بعد</td></tr>`;

    const body = `
      ${playerCardHTML(p)}
      ${attrAvg != null ? `<div class="small muted" style="margin:10px 2px">متوسط المهارات الوصفية: ${attrAvg}</div>` : ""}
      <div class="row wrap" style="margin:12px 0;gap:8px">
        <button class="btn sm gold" data-action="eval-player" data-id="${p.id}">⚡ تقييم جديد</button>
        <button class="btn sm" id="pd-adjust">✏️ تعديل يدوي للتقييم</button>
        <button class="btn sm" data-action="edit-player" data-id="${p.id}">تعديل البيانات</button>
      </div>
      <div class="section-title" style="margin:8px 0"><h2 style="font-size:15px">📒 حسبة التقييم</h2><span class="hint">${log.length} عملية</span></div>
      <div class="card" style="overflow:auto;padding:8px">
        <table><thead><tr><th>الوقت</th><th>التفاصيل</th><th>التقييم</th></tr></thead><tbody>${history}</tbody></table>
      </div>`;

    modal({
      title: "بطاقة " + p.name,
      body,
      foot: `<button class="btn ghost" data-close>إغلاق</button>`,
      onOpen(root, close) {
        // إعادة ربط الأزرار داخل النافذة
        root.querySelectorAll("[data-action]").forEach((b) => {
          b.onclick = () => {
            close();
            handleAction(b.getAttribute("data-action"), b.getAttribute("data-id"));
          };
        });
        $("#pd-adjust", root).onclick = () => {
          close();
          openAdjustRating(playerId);
        };
      },
    });
  }

  function openAdjustRating(playerId) {
    const p = App.getPlayer(playerId);
    modal({
      title: "تعديل يدوي للتقييم",
      body: `<label class="field"><span>التقييم الجديد لـ ${esc(p.name)} (${App.RATING_MIN}-${App.RATING_MAX})</span>
        <input id="adj-val" type="number" min="${App.RATING_MIN}" max="${App.RATING_MAX}" value="${App.playerOverall(p)}"></label>
        <label class="field"><span>سبب (اختياري)</span><input id="adj-note" placeholder="تعديل يدوي"></label>`,
      foot: `<button class="btn primary" data-save>حفظ</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-save]", root).onclick = () => {
          App.adjustRating(playerId, $("#adj-val", root).value, $("#adj-note", root).value.trim());
          toast("حُدّث التقييم", "ok");
          close();
          render();
        };
      },
    });
  }

  /* ---------- نموذج الفريق ---------- */
  function openTeamForm(team) {
    const players = App.teamPlayers(team.id);
    const body = `
      <label class="field"><span>اسم الفريق</span><input id="tm-name" value="${esc(team.name)}"></label>
      <div class="row" style="gap:12px;margin-bottom:12px">
        <span id="tm-crest">${teamCrestHTML(team, true)}</span>
        <label class="field" style="flex:1;margin:0"><span>شعار الفريق (اختياري)</span><input id="tm-logo" type="file" accept="image/*"></label>
      </div>
      <label class="field"><span>اللون</span><input id="tm-color" type="color" value="${team.color}"></label>
      <label class="field"><span>القائد</span><select id="tm-cap"><option value="">—</option>${players.map((p) => `<option value="${p.id}" ${p.id === team.captainId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>`;
    let logoData = team.logo || null;
    modal({
      title: "تعديل الفريق",
      body,
      foot: `<button class="btn primary" data-save>حفظ</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("#tm-logo", root).onchange = (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => {
            logoData = rd.result;
            $("#tm-crest", root).innerHTML = `<img class="team-crest lg" src="${logoData}" alt="">`;
          };
          rd.readAsDataURL(f);
        };
        $("[data-save]", root).onclick = () => {
          team.name = $("#tm-name", root).value.trim() || team.name;
          team.color = $("#tm-color", root).value;
          team.logo = logoData || null;
          team.captainId = $("#tm-cap", root).value || null;
          App.save();
          toast("حُفظ الفريق", "ok");
          close();
          render();
        };
      },
    });
  }

  /* ---------- نموذج المباراة (تسجيل / تعديل) ---------- */
  function openMatchForm(existing) {
    if (App.state.teams.length < 2) return toast("تحتاج فريقين على الأقل", "err");
    const isEdit = !!existing;
    // نسخة قابلة للتعديل من أحداث المباراة (حتى لا نغيّر الأصل قبل الحفظ)
    const events = isEdit ? existing.events.map((e) => Object.assign({}, e)) : [];
    const teams = App.state.teams;

    // لاحقة مختصرة لخيار نوع الحدث: الفلوس و/أو نقاط التقييم
    function actionOptionTag(a) {
      const bits = [];
      if (a.money && App.state.moneyRules[a.key]) bits.push(fmtShort(App.state.moneyRules[a.key]));
      if (a.ratingKey) {
        if (typeof a.ratingKey === "function") bits.push("تقييم");
        else {
          const pts = App.state.ratingRules[a.ratingKey] || 0;
          if (pts) bits.push("تقييم " + (pts > 0 ? "+" : "") + pts);
        }
      }
      return bits.length ? " (" + bits.join(" • ") + ")" : "";
    }

    // وصف أثر الحركة: الفلوس (إن وُجدت) وتغيّر التقييم (إن ارتبطت بلاعب)
    function eventEffectHTML(ev, pl) {
      const parts = [];
      const money = App.state.moneyRules[ev.type];
      if (App.matchAction(ev.type)?.money && money) parts.push(`<span class="muted mono">${fmtMoney(money)}</span>`);
      if (pl) {
        const rKey = App.actionRatingKey(App.matchAction(ev.type), pl);
        const pts = rKey ? App.state.ratingRules[rKey] || 0 : 0;
        if (pts) parts.push(`<span class="mono" style="color:${pts < 0 ? "var(--danger)" : "var(--brand)"}">التقييم ${pts > 0 ? "+" : ""}${pts}</span>`);
      }
      return parts.length ? " " + parts.join(" • ") : "";
    }

    function eventsHTML() {
      if (!events.length) return `<div class="small muted">لا أحداث بعد</div>`;
      return events
        .map((ev, i) => {
          const def = App.matchAction(ev.type);
          const t = App.getTeam(ev.teamId);
          const pl = ev.playerId ? App.getPlayer(ev.playerId) : null;
          return `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--line)">
            <span>${def ? esc(def.label) : esc(ev.type)} — <b style="color:${t?.color}">${esc(t?.name)}</b>${pl ? " • " + esc(pl.name) : ""}${eventEffectHTML(ev, pl)}</span>
            <button class="btn sm danger" data-ev-del="${i}">×</button>
          </div>`;
        })
        .join("");
    }

    const body = document.createElement("div");
    function renderBody() {
      const homeId = body.querySelector("#mt-home")?.value || (isEdit ? existing.homeTeamId : teams[0].id);
      const awayId = body.querySelector("#mt-away")?.value || (isEdit ? existing.awayTeamId : teams[1].id);
      const evTeamId = body.querySelector("#ev-team")?.value || homeId;
      const evPlayers = App.teamPlayers(evTeamId);
      body.innerHTML = `
        <div class="grid cols-2">
          <label class="field"><span>الفريق الأول</span><select id="mt-home">${teamOptions(homeId)}</select></label>
          <label class="field"><span>الفريق الثاني</span><select id="mt-away">${teamOptions(awayId)}</select></label>
        </div>
        <div class="card" style="background:#0e1830">
          <div class="small muted" style="margin-bottom:8px">إضافة حدث</div>
          <div class="grid cols-2">
            <label class="field"><span>النوع</span><select id="ev-type">${App.MATCH_ACTIONS.map((a) => `<option value="${a.key}">${esc(a.label)}${actionOptionTag(a)}</option>`).join("")}</select></label>
            <label class="field"><span>الفريق</span><select id="ev-team">${teamOptions(evTeamId)}</select></label>
          </div>
          <label class="field"><span>اللاعب</span><select id="ev-player"><option value="">—</option>${evPlayers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
          <div class="small muted" style="margin-top:4px">اختيار لاعب يُحدّث تقييمه تلقائيًا حسب نوع الحدث.</div>
          <button class="btn sm primary" id="ev-add">＋ أضف الحدث</button>
        </div>
        <div class="section-title" style="margin:12px 0 6px"><h2 style="font-size:15px">الأحداث</h2></div>
        <div id="ev-list">${eventsHTML()}</div>`;

      body.querySelector("#mt-home").onchange = renderBody;
      body.querySelector("#mt-away").onchange = renderBody;
      body.querySelector("#ev-team").onchange = renderBody;
      body.querySelector("#ev-add").onclick = () => {
        events.push({
          type: body.querySelector("#ev-type").value,
          teamId: body.querySelector("#ev-team").value,
          playerId: body.querySelector("#ev-player").value || null,
        });
        renderBody();
      };
      body.querySelectorAll("[data-ev-del]").forEach((b) => {
        b.onclick = () => { events.splice(+b.getAttribute("data-ev-del"), 1); renderBody(); };
      });
    }
    renderBody();

    modal({
      title: isEdit ? "تعديل المباراة" : "تسجيل مباراة",
      body,
      foot: `<button class="btn primary" data-save>${isEdit ? "حفظ التعديلات" : "حفظ المباراة"}</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-save]", root).onclick = () => {
          const homeTeamId = body.querySelector("#mt-home").value;
          const awayTeamId = body.querySelector("#mt-away").value;
          if (homeTeamId === awayTeamId) return toast("اختر فريقين مختلفين", "err");
          if (isEdit) {
            App.updateMatch(existing.id, { homeTeamId, awayTeamId, events });
            toast("حُفظت تعديلات المباراة (النتيجة والفلوس والتقييمات)", "ok");
          } else {
            App.recordMatch({ homeTeamId, awayTeamId, events });
            toast("سُجّلت المباراة وحُدّثت الميزانيات والتقييمات", "ok");
          }
          close();
          render();
        };
      },
    });
  }

  /* ---------- التسجيل المباشر أثناء المباراة ---------- */
  // خطوة 1: اختيار المباراة المتاحة (من القادمة) أو اختيار الفريقين يدويًا
  function openLiveMatchPicker() {
    if (App.state.teams.length < 2) return toast("تحتاج فريقين على الأقل", "err");
    const upcoming = App.state.fixtures.filter((f) => f.status !== "done");
    const fxHTML = upcoming.length
      ? upcoming
          .map((f) => {
            const h = App.getTeam(f.homeTeamId),
              a = App.getTeam(f.awayTeamId);
            return `<button class="btn" style="width:100%;justify-content:space-between;margin-bottom:8px" data-fx="${f.id}">
              <span>${esc(h?.name || "؟")} <span class="muted">ضد</span> ${esc(a?.name || "؟")}</span>
              <span class="small muted">${fixtureWhen(f)}</span>
            </button>`;
          })
          .join("")
      : `<div class="small muted" style="margin-bottom:8px">لا توجد مباريات قادمة — اختر الفريقين يدويًا.</div>`;

    const body = document.createElement("div");
    body.innerHTML = `
      <div class="section-title" style="margin:0 0 8px"><h2 style="font-size:15px">اختر مباراة قادمة</h2></div>
      ${fxHTML}
      <div class="section-title" style="margin:14px 0 8px"><h2 style="font-size:15px">أو ابدأ يدويًا</h2></div>
      <div class="grid cols-2">
        <label class="field"><span>الفريق الأول (يمين)</span><select id="lm-home">${teamOptions(App.state.teams[0].id)}</select></label>
        <label class="field"><span>الفريق الثاني (يسار)</span><select id="lm-away">${teamOptions(App.state.teams[1].id)}</select></label>
      </div>
      <button class="btn primary" id="lm-start" style="width:100%">▶️ ابدأ التسجيل المباشر</button>`;

    modal({
      title: "🎬 تسجيل مباشر",
      body,
      foot: `<button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        body.querySelectorAll("[data-fx]").forEach((b) => {
          b.onclick = () => {
            const f = App.getFixture(b.getAttribute("data-fx"));
            if (!f) return;
            close();
            openLiveMatch(f.homeTeamId, f.awayTeamId, f.id);
          };
        });
        body.querySelector("#lm-start").onclick = () => {
          const home = body.querySelector("#lm-home").value;
          const away = body.querySelector("#lm-away").value;
          if (home === away) return toast("اختر فريقين مختلفين", "err");
          close();
          openLiveMatch(home, away, null);
        };
      },
    });
  }

  // خطوة 2: لوحة الإدخال المباشر — معايير التقييم فوق، واللاعبون (فريق يمين وفريق يسار) بأزرار ＋/－
  function openLiveMatch(homeId, awayId, fixtureId) {
    const home = App.getTeam(homeId),
      away = App.getTeam(awayId);
    if (!home || !away) return toast("فريق غير موجود", "err");
    const events = []; // {type, teamId, playerId}
    let activeType = "goal"; // الحدث المختار حاليًا من معايير التقييم

    const actionLabel = (key) => App.matchAction(key)?.label || key;
    const countFor = (playerId) =>
      events.filter((e) => e.playerId === playerId && e.type === activeType).length;
    const totalFor = (playerId) => events.filter((e) => e.playerId === playerId).length;

    function addEvent(playerId, teamId) {
      events.push({ type: activeType, teamId, playerId });
    }
    function removeEvent(playerId) {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].playerId === playerId && events[i].type === activeType) {
          events.splice(i, 1);
          return;
        }
      }
    }

    // بطاقة لاعب مصغّرة مع أزرار ＋/－
    function playerRow(p, teamId) {
      const c = countFor(p.id);
      const tot = totalFor(p.id);
      const photo = p.photo
        ? `<img class="live-photo" src="${p.photo}" alt="">`
        : `<div class="live-photo ph">👤</div>`;
      return `<div class="live-pl${c ? " has" : ""}">
        <button class="live-btn minus" data-minus="${p.id}" ${c ? "" : "disabled"}>－</button>
        <div class="live-pl-info">
          ${photo}
          <div class="live-pl-txt">
            <div class="nm">${esc(p.name)}${p.number ? ` <span class="muted">#${esc(p.number)}</span>` : ""}</div>
            <div class="ct">${esc(actionLabel(activeType))}: <b>${c}</b>${tot ? ` <span class="muted">• الكل ${tot}</span>` : ""}</div>
          </div>
        </div>
        <button class="live-btn plus" data-plus="${p.id}" data-team="${teamId}">＋</button>
      </div>`;
    }

    function teamColumn(team) {
      const players = App.teamPlayers(team.id);
      const rows = players.length
        ? players.map((p) => playerRow(p, team.id)).join("")
        : `<div class="small muted" style="padding:8px">لا لاعبون في هذا الفريق</div>`;
      return `<div class="live-col">
        <div class="live-col-head" style="border-color:${team.color}">
          ${teamCrestHTML(team)} <b>${esc(team.name)}</b>
        </div>
        ${rows}
      </div>`;
    }

    // شريط معايير التقييم (قابل للاختيار) — يظهر الأثر (فلوس/نقاط تقييم)
    function actionsBar() {
      return App.MATCH_ACTIONS.map((a) => {
        const bits = [];
        if (a.money && App.state.moneyRules[a.key]) bits.push(fmtShort(App.state.moneyRules[a.key]));
        if (a.ratingKey && typeof a.ratingKey !== "function") {
          const pts = App.state.ratingRules[a.ratingKey] || 0;
          if (pts) bits.push((pts > 0 ? "+" : "") + pts);
        } else if (typeof a.ratingKey === "function") bits.push("±");
        return `<button class="live-chip${a.key === activeType ? " on" : ""}" data-act="${a.key}">
          ${esc(a.label)}${bits.length ? ` <span class="tag">${bits.join(" / ")}</span>` : ""}
        </button>`;
      }).join("");
    }

    const body = document.createElement("div");
    function renderLive() {
      const { home: hs, away: as } = App.computeMatchScores({ homeTeamId: homeId, awayTeamId: awayId, events });
      body.innerHTML = `
        <div class="live-score">
          <span>${esc(home.name)}</span>
          <span class="sc mono">${hs} - ${as}</span>
          <span>${esc(away.name)}</span>
        </div>
        <div class="live-hint small muted">اختر نوع الحدث ثم اضغط ＋ عند اللاعب. (－ للتراجع)</div>
        <div class="live-actions">${actionsBar()}</div>
        <div class="grid cols-2 live-cols">
          ${teamColumn(home)}
          ${teamColumn(away)}
        </div>
        <div class="small muted" style="margin-top:10px">إجمالي الأحداث المُسجّلة: <b>${events.length}</b></div>`;

      body.querySelectorAll("[data-act]").forEach((b) => {
        b.onclick = () => { activeType = b.getAttribute("data-act"); renderLive(); };
      });
      body.querySelectorAll("[data-plus]").forEach((b) => {
        b.onclick = () => { addEvent(b.getAttribute("data-plus"), b.getAttribute("data-team")); renderLive(); };
      });
      body.querySelectorAll("[data-minus]").forEach((b) => {
        b.onclick = () => { removeEvent(b.getAttribute("data-minus")); renderLive(); };
      });
    }
    renderLive();

    modal({
      title: "🎬 " + home.name + " ضد " + away.name,
      size: "full",
      body,
      foot: `<button class="btn primary" data-save>💾 حفظ المباراة</button><button class="btn ghost" data-cancel>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-save]", root).onclick = () => {
          if (!events.length) return toast("لم تُسجَّل أي أحداث بعد", "err");
          App.recordMatch({ homeTeamId: homeId, awayTeamId: awayId, events });
          if (fixtureId) App.updateFixture(fixtureId, { status: "done" });
          toast("سُجّلت المباراة وحُدّثت الميزانيات والتقييمات", "ok");
          close();
          go("matches");
        };
        $("[data-cancel]", root).onclick = () => {
          if (events.length)
            return confirmBox("إلغاء المباراة المباشرة؟ ستفقد الأحداث غير المحفوظة.", close, true);
          close();
        };
      },
    });
  }

  /* ---------- المزايدة ---------- */
  function doBid(lotId) {
    const teamSel = document.querySelector(`[data-bid-team="${lotId}"]`);
    const amtInp = document.querySelector(`[data-bid-amount="${lotId}"]`);
    const amount = parseInt(amtInp.value, 10);
    if (!amount || amount <= 0) return toast("أدخل مبلغًا صحيحًا", "err");
    const res = App.placeBid(lotId, teamSel.value, amount);
    if (!res.ok) return toast(res.msg, "err");
    toast("سُجّلت المزايدة", "ok");
    render();
  }

  /* ---------- اختيار يدوي للسوق ---------- */
  function openMarketManual() {
    const free = App.freeAgents();
    if (!free.length) return toast("لا يوجد لاعبون أحرار", "err");
    const selected = new Set();
    const body = document.createElement("div");
    body.innerHTML =
      `<p class="small muted">اختر اللاعبين للمزاد:</p>` +
      free
        .map(
          (p) => `<label class="row" style="padding:8px;border-bottom:1px solid var(--line);gap:10px">
          <input type="checkbox" style="width:auto" data-pick="${p.id}">
          <span>${esc(p.name)} <span class="muted small">(${App.playerOverall(p)})</span></span>
        </label>`
        )
        .join("");
    modal({
      title: "اختيار لاعبي المزاد",
      body,
      foot: `<button class="btn primary" data-save>فتح السوق</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-save]", root).onclick = () => {
          root.querySelectorAll("[data-pick]:checked").forEach((c) => selected.add(c.getAttribute("data-pick")));
          if (!selected.size) return toast("اختر لاعبًا واحدًا على الأقل", "err");
          App.openMarket([...selected]);
          toast("فُتح السوق", "ok");
          close();
          render();
        };
      },
    });
  }

  /* ---------- الجوائز ---------- */
  function openAwards() {
    const body = `
      <label class="field"><span>نوع الجائزة</span>
        <select id="aw-kind">
          <option value="teamOfWeek">${App.AWARD_RULES.teamOfWeek.label} (${fmtShort(App.state.moneyRules.teamOfWeek)})</option>
          <option value="clubLineup">${App.AWARD_RULES.clubLineup.label} (${fmtShort(App.state.moneyRules.clubLineup)})</option>
        </select>
      </label>
      <label class="field"><span>اللاعب</span>
        <select id="aw-player"><option value="">— اختر —</option>
          ${App.state.players.filter((p) => p.teamId).map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(App.getTeam(p.teamId)?.name)})</option>`).join("")}
        </select>
      </label>
      <p class="small muted">تُضاف الجائزة لميزانية فريق اللاعب.</p>`;
    modal({
      title: "منح جائزة",
      body,
      foot: `<button class="btn gold" data-save>منح</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-save]", root).onclick = () => {
          const kind = $("#aw-kind", root).value;
          const pid = $("#aw-player", root).value;
          const pl = App.getPlayer(pid);
          if (!pl || !pl.teamId) return toast("اختر لاعبًا ضمن فريق", "err");
          App.grantAward(kind, pl.teamId, pid);
          toast("مُنحت الجائزة", "ok");
          close();
          render();
        };
      },
    });
  }

  /* ---------- الإعدادات ---------- */
  function openSettings() {
    const c = App.state.club;
    const rulesHTML = [...App.EVENTS.map((e) => [e.key, e.label]), ["win", App.RESULT_RULES.win.label], ["draw", App.RESULT_RULES.draw.label], ["teamOfWeek", App.AWARD_RULES.teamOfWeek.label], ["clubLineup", App.AWARD_RULES.clubLineup.label]]
      .map(
        ([k, label]) => `<div class="stat-input">
          <span>${esc(label)}</span>
          <input type="number" step="100000" data-rule="${k}" value="${App.state.moneyRules[k]}">
        </div>`
      )
      .join("");
    const ratingRulesHTML = App.ratingRuleList()
      .map(
        (rule) => `<div class="stat-input">
          <span>${esc(rule.label)}</span>
          <input type="number" data-rrule="${rule.key}" value="${App.state.ratingRules[rule.key]}" style="width:70px">
        </div>`
      )
      .join("");
    const statsHTML = App.state.statDefs
      .map(
        (d, i) => `<div class="row" style="gap:8px;margin-bottom:6px">
          <input value="${esc(d.label)}" data-statlabel="${d.key}" style="flex:1">
          <button class="btn sm danger" data-statdel="${d.key}">×</button>
        </div>`
      )
      .join("");
    const codesHTML = App.state.teams
      .map(
        (t) => `<label class="field"><span>كلمة مرور رئيس ${esc(t.name)}</span>
          <input data-teamcode="${t.id}" value="${esc(t.code || "")}"></label>`
      )
      .join("");
    const body = `
      <label class="field"><span>اسم النادي</span><input id="s-name" value="${esc(c.name)}"></label>
      <div class="grid cols-2">
        <label class="field"><span>العملة</span><input id="s-cur" value="${esc(c.currency)}"></label>
        <label class="field"><span>الأسبوع الحالي</span><input id="s-week" type="number" value="${c.week}"></label>
      </div>
      <div class="section-title" style="margin:8px 0"><h2 style="font-size:15px">كلمات المرور والصلاحيات</h2><span class="hint">حماية على مستوى الواجهة</span></div>
      <label class="field"><span>كلمة مرور المشرف</span><input id="s-admincode" value="${esc(c.adminCode || "")}"></label>
      ${codesHTML}
      <div class="section-title" style="margin:8px 0"><h2 style="font-size:15px">معايير الفلوس</h2></div>
      ${rulesHTML}
      <div class="section-title" style="margin:14px 0 8px"><h2 style="font-size:15px">معايير التقييم (الطاقة)</h2><span class="hint">نقاط كل حدث</span></div>
      ${ratingRulesHTML}
      <div class="section-title" style="margin:14px 0 8px"><h2 style="font-size:15px">مهارات وصفية</h2><span class="hint">اختيارية</span></div>
      <div id="stats-list">${statsHTML}</div>
      <div class="row" style="gap:8px;margin-top:8px">
        <input id="new-stat" placeholder="طاقة جديدة (مثال: التمركز)" style="flex:1">
        <button class="btn sm" id="add-stat">＋</button>
      </div>
      <div class="section-title" style="margin:16px 0 8px"><h2 style="font-size:15px;color:var(--danger)">منطقة الخطر</h2></div>
      <div class="row wrap">
        <button class="btn danger sm" id="reset-all">حذف كل البيانات</button>
      </div>`;
    modal({
      title: "الإعدادات",
      body,
      foot: `<button class="btn primary" data-save>حفظ</button><button class="btn ghost" data-close>إغلاق</button>`,
      onOpen(root, close) {
        $("#add-stat", root).onclick = () => {
          const label = $("#new-stat", root).value.trim();
          if (!label) return;
          App.state.statDefs.push({ key: "s_" + uid(), label });
          App.save();
          close();
          openSettings();
        };
        root.querySelectorAll("[data-statdel]").forEach((b) => {
          b.onclick = () => {
            const key = b.getAttribute("data-statdel");
            App.state.statDefs = App.state.statDefs.filter((d) => d.key !== key);
            App.save();
            close();
            openSettings();
          };
        });
        $("#reset-all", root).onclick = () =>
          confirmBox("سيتم حذف كل الفرق واللاعبين والمباريات والحركات. متأكد؟", () => {
            App.resetData();
            close();
            toast("أُعيد ضبط التطبيق");
            go("dashboard");
          }, true);
        $("[data-save]", root).onclick = () => {
          c.name = $("#s-name", root).value.trim() || c.name;
          c.currency = $("#s-cur", root).value.trim() || c.currency;
          c.week = parseInt($("#s-week", root).value, 10) || c.week;
          c.adminCode = $("#s-admincode", root).value.trim() || c.adminCode;
          root.querySelectorAll("[data-teamcode]").forEach((inp) => {
            const t = App.getTeam(inp.getAttribute("data-teamcode"));
            if (t) t.code = inp.value.trim() || t.code;
          });
          root.querySelectorAll("[data-rule]").forEach((inp) => {
            App.state.moneyRules[inp.getAttribute("data-rule")] = parseInt(inp.value, 10) || 0;
          });
          root.querySelectorAll("[data-rrule]").forEach((inp) => {
            App.state.ratingRules[inp.getAttribute("data-rrule")] = parseInt(inp.value, 10) || 0;
          });
          root.querySelectorAll("[data-statlabel]").forEach((inp) => {
            const key = inp.getAttribute("data-statlabel");
            const d = App.state.statDefs.find((x) => x.key === key);
            if (d) d.label = inp.value.trim() || d.label;
          });
          App.save();
          toast("حُفظت الإعدادات", "ok");
          close();
          render();
        };
      },
    });
  }

  /* ---------- تصدير / استيراد ---------- */
  function doExport() {
    const blob = new Blob([App.exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dawri-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    toast("تم تصدير نسخة احتياطية", "ok");
  }
  function doImport() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json";
    inp.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          App.importData(rd.result);
          toast("تم الاستيراد", "ok");
          go("dashboard");
        } catch (err) {
          toast("ملف غير صالح", "err");
        }
      };
      rd.readAsText(f);
    };
    inp.click();
  }

  /* ---------- الإقلاع ---------- */
  const initRoute = (location.hash || "").replace("#", "");
  if (VIEWS[initRoute]) route = initRoute;
  document.addEventListener("DOMContentLoaded", render);
  if (document.readyState !== "loading") render();
})();
