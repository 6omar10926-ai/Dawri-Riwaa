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

  /* ---------- نافذة منبثقة ---------- */
  function modal({ title, body, foot, onOpen }) {
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = `
      <div class="modal" role="dialog">
        <div class="m-head"><h3>${esc(title)}</h3><button class="x" data-close>×</button></div>
        <div class="m-body"></div>
        ${foot ? `<div class="m-foot"></div>` : ""}
      </div>`;
    $(".m-body", back).innerHTML = typeof body === "string" ? body : "";
    if (typeof body !== "string" && body) $(".m-body", back).appendChild(body);
    if (foot) $(".m-foot", back).innerHTML = foot;
    document.body.appendChild(back);
    const close = () => back.remove();
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

  /* ---------- عناصر مشتركة ---------- */
  function teamOptions(selected, includeEmpty) {
    let html = includeEmpty ? `<option value="">— بدون فريق —</option>` : "";
    App.state.teams.forEach((t) => {
      html += `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${esc(t.name)}</option>`;
    });
    return html;
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
    return `
      <div class="player-card" data-player="${p.id}">
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
  const TABS = [
    { key: "dashboard", label: "الرئيسية", ico: "🏠" },
    { key: "teams", label: "الفرق", ico: "🛡️" },
    { key: "players", label: "اللاعبون", ico: "🎽" },
    { key: "matches", label: "المباريات", ico: "⚽" },
    { key: "market", label: "السوق", ico: "💰" },
    { key: "ledger", label: "الحسبة", ico: "📒" },
  ];
  let route = "dashboard";

  function renderNav() {
    return `<nav class="tabs"><div class="inner">
      ${TABS.map(
        (t) => `<button data-nav="${t.key}" class="${route === t.key ? "active" : ""}">
          <span class="ico">${t.ico}</span><span>${t.label}</span></button>`
      ).join("")}
    </div></nav>`;
  }

  function renderTopbar() {
    const c = App.state.club;
    return `<header class="topbar"><div class="inner">
      <div class="logo">⚽</div>
      <div class="brand"><h1>${esc(c.name)}</h1><small>الموسم ${c.season}</small></div>
      <div class="spacer"></div>
      <div class="week-pill">الأسبوع <b>${c.week}</b></div>
      <button class="btn sm ghost" data-action="settings" title="الإعدادات">⚙️</button>
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

  function viewDashboard() {
    const teams = App.state.teams;
    const teamCards = teams
      .map((t) => {
        const players = App.teamPlayers(t.id);
        const cls = t.budget < 0 ? "neg" : "pos";
        return `<div class="card team-card">
          <div class="stripe" style="background:${t.color}"></div>
          <div style="padding-inline-start:8px">
            <h3>${esc(t.name)}</h3>
            <div class="budget ${cls} mono">${fmtMoney(t.budget)} <span class="small muted">${esc(App.state.club.currency)}</span></div>
            <div class="row wrap" style="margin-top:8px">
              <span class="chip">👥 ${players.length} لاعب</span>
              <span class="chip">💵 ${fmtShort(t.budget)}</span>
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

    return `
      <div class="section-title"><h2>نظرة عامة</h2><span class="hint">ميزانيات الفرق الثلاثة</span></div>
      <div class="grid cols-3">${teamCards}</div>

      <div class="section-title"><h2>إجراءات سريعة</h2></div>
      <div class="grid cols-3">
        <button class="btn primary block" data-action="new-match">⚽ تسجيل مباراة</button>
        <button class="btn gold block" data-action="go-market">💰 سوق الانتقالات</button>
        <button class="btn block" data-action="awards">🏅 منح جوائز</button>
      </div>

      <div class="section-title"><h2>الترتيب</h2><span class="hint">من نتائج المباريات</span></div>
      <div class="card" style="overflow:auto">
        <table>
          <thead><tr><th>#</th><th>الفريق</th><th>لعب</th><th>فاز</th><th>تعادل</th><th>خسر</th><th>أهداف</th><th>نقاط</th></tr></thead>
          <tbody>${standingsRows}</tbody>
        </table>
      </div>

      <div class="section-title"><h2>الأسبوع الحالي</h2></div>
      <div class="card row between">
        <div>أنت في الأسبوع <b style="color:var(--gold)">${App.state.club.week}</b></div>
        <button class="btn sm" data-action="advance-week">إنهاء الأسبوع ▶</button>
      </div>`;
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
              <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${t.color}"></span>
              <h3 style="margin:0">${esc(t.name)}</h3>
            </div>
            <div class="row">
              <span class="budget ${t.budget < 0 ? "neg" : "pos"} mono" style="font-size:18px">${fmtMoney(t.budget)}</span>
              <button class="btn sm ghost" data-action="edit-team" data-id="${t.id}">تعديل</button>
            </div>
          </div>
          <div class="row wrap small muted" style="margin-top:6px">
            <span class="chip">👥 ${players.length}/8</span>
            <span class="chip">🎽 القائد: ${captain ? esc(captain.name) : "—"}</span>
            <button class="btn sm" data-action="add-player-to" data-id="${t.id}">＋ إضافة لاعب</button>
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

    const body = list.length
      ? `<div class="grid cols-2">${list.map((p) => playerCardHTML(p, { actions: true })).join("")}</div>`
      : `<div class="empty"><div class="big">🎽</div>لا يوجد لاعبون. أضِف أول لاعب.</div>`;

    return `<div class="section-title"><h2>اللاعبون</h2>
        <span class="hint">${all.length} لاعب</span>
        <div class="spacer"></div>
        <button class="btn primary sm" data-action="add-player">＋ لاعب جديد</button>
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
            return `<div class="card">
              <div class="row between">
                <div class="small muted">الأسبوع ${m.week} • ${new Date(m.date).toLocaleDateString("ar")}</div>
                <button class="btn sm danger" data-action="del-match" data-id="${m.id}">حذف</button>
              </div>
              <div class="row between" style="margin-top:8px;font-size:16px;font-weight:700">
                <span>${esc(h ? h.name : "؟")}</span>
                <span class="mono" style="font-size:22px">${m.homeScore} - ${m.awayScore}</span>
                <span>${esc(a ? a.name : "؟")}</span>
              </div>
              <div class="small muted" style="margin-top:8px">${m.events.length} حدث • أُضيف ${fmtMoney(money)} ${esc(App.state.club.currency)}</div>
            </div>`;
          })
          .join("")
      : `<div class="empty"><div class="big">⚽</div>لا توجد مباريات مسجّلة.</div>`;

    return `<div class="section-title"><h2>المباريات</h2>
        <div class="spacer"></div>
        <button class="btn primary sm" data-action="new-match">＋ تسجيل مباراة</button>
      </div>
      <div class="grid">${list}</div>`;
  }

  function viewMarket() {
    const mk = App.state.market;
    if (!mk.active) {
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

    const lots = mk.lots
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
        const bidControls =
          lot.status === "open"
            ? `<div class="row wrap" style="margin-top:12px;gap:8px">
                 <select data-bid-team="${lot.id}" style="width:auto;min-width:130px">${teamOptions(highTeam ? highTeam.id : App.state.teams[0].id)}</select>
                 <input type="number" data-bid-amount="${lot.id}" placeholder="مبلغ المزايدة" style="width:150px" step="100000">
                 <button class="btn sm primary" data-action="place-bid" data-id="${lot.id}">مزايدة</button>
                 <button class="btn sm gold" data-action="finalize-lot" data-id="${lot.id}">إرساء ✔</button>
               </div>`
            : "";
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

    return `<div class="section-title"><h2>سوق الانتقالات</h2><span class="hint">أسبوع ${mk.week}</span>
        <div class="spacer"></div>
        <button class="btn sm danger" data-action="close-market">إغلاق السوق</button>
      </div>
      <div class="grid cols-2">${lots}</div>`;
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

  const VIEWS = {
    dashboard: viewDashboard,
    teams: viewTeams,
    players: viewPlayers,
    matches: viewMatches,
    market: viewMarket,
    ledger: viewLedger,
  };

  /* =========================================================
     التطبيق (Render + Router)
     ========================================================= */
  function render() {
    document.body.innerHTML =
      renderTopbar() +
      `<main class="app" id="app">${(VIEWS[route] || viewDashboard)()}</main>` +
      renderNav();
    wire();
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

  function handleAction(action, id) {
    switch (action) {
      case "settings": return openSettings();
      case "advance-week":
        return confirmBox("إنهاء الأسبوع الحالي والانتقال للأسبوع التالي؟", () => {
          App.advanceWeek();
          toast("انتقلنا للأسبوع " + App.state.club.week, "ok");
          render();
        });
      case "new-match": return openMatchForm();
      case "del-match":
        return confirmBox("حذف المباراة وإرجاع فلوسها؟", () => { App.deleteMatch(id); toast("حُذفت المباراة"); render(); }, true);
      case "go-market": return go("market");
      case "awards": return openAwards();
      case "add-player": return openPlayerForm(null, null);
      case "add-player-to": return openPlayerForm(null, id);
      case "edit-player": return openPlayerForm(App.getPlayer(id));
      case "eval-player": return openEvaluate(id);
      case "player-detail": return openPlayerDetail(id);
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
      <label class="field"><span>اللون</span><input id="tm-color" type="color" value="${team.color}"></label>
      <label class="field"><span>القائد</span><select id="tm-cap"><option value="">—</option>${players.map((p) => `<option value="${p.id}" ${p.id === team.captainId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>`;
    modal({
      title: "تعديل الفريق",
      body,
      foot: `<button class="btn primary" data-save>حفظ</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-save]", root).onclick = () => {
          team.name = $("#tm-name", root).value.trim() || team.name;
          team.color = $("#tm-color", root).value;
          team.captainId = $("#tm-cap", root).value || null;
          App.save();
          toast("حُفظ الفريق", "ok");
          close();
          render();
        };
      },
    });
  }

  /* ---------- نموذج المباراة ---------- */
  function openMatchForm() {
    if (App.state.teams.length < 2) return toast("تحتاج فريقين على الأقل", "err");
    const events = [];
    const teams = App.state.teams;

    function eventsHTML() {
      if (!events.length) return `<div class="small muted">لا أحداث بعد</div>`;
      return events
        .map((ev, i) => {
          const def = App.EVENTS.find((e) => e.key === ev.type);
          const t = App.getTeam(ev.teamId);
          const pl = ev.playerId ? App.getPlayer(ev.playerId) : null;
          return `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--line)">
            <span>${def.label} — <b style="color:${t?.color}">${esc(t?.name)}</b>${pl ? " • " + esc(pl.name) : ""} <span class="muted mono">(${fmtMoney(App.state.moneyRules[ev.type])})</span></span>
            <button class="btn sm danger" data-ev-del="${i}">×</button>
          </div>`;
        })
        .join("");
    }

    const body = document.createElement("div");
    function renderBody() {
      const homeId = body.querySelector("#mt-home")?.value || teams[0].id;
      const awayId = body.querySelector("#mt-away")?.value || teams[1].id;
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
            <label class="field"><span>النوع</span><select id="ev-type">${App.EVENTS.map((e) => `<option value="${e.key}">${e.label} (${fmtShort(App.state.moneyRules[e.key])})</option>`).join("")}</select></label>
            <label class="field"><span>الفريق</span><select id="ev-team">${teamOptions(evTeamId)}</select></label>
          </div>
          <label class="field"><span>اللاعب (اختياري)</span><select id="ev-player"><option value="">—</option>${evPlayers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
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
      title: "تسجيل مباراة",
      body,
      foot: `<button class="btn primary" data-save>حفظ المباراة</button><button class="btn ghost" data-close>إلغاء</button>`,
      onOpen(root, close) {
        $("[data-save]", root).onclick = () => {
          const homeTeamId = body.querySelector("#mt-home").value;
          const awayTeamId = body.querySelector("#mt-away").value;
          if (homeTeamId === awayTeamId) return toast("اختر فريقين مختلفين", "err");
          App.recordMatch({ homeTeamId, awayTeamId, events });
          toast("سُجّلت المباراة وحُدّثت الميزانيات", "ok");
          close();
          render();
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
    const body = `
      <label class="field"><span>اسم النادي</span><input id="s-name" value="${esc(c.name)}"></label>
      <div class="grid cols-2">
        <label class="field"><span>العملة</span><input id="s-cur" value="${esc(c.currency)}"></label>
        <label class="field"><span>الأسبوع الحالي</span><input id="s-week" type="number" value="${c.week}"></label>
      </div>
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
