/* =============================================================
   دوري الروّاد — المزامنة السحابية (Firebase Realtime Database)
   يزامن كائن الحالة كاملًا مع عقدة واحدة "state".
   - عند أي حفظ محلي → يُرفع للسحابة
   - عند أي تغيير في السحابة → يُطبّق محليًا ويُعاد الرسم
   - يعمل بأسلوب "آخر كتابة تفوز" (مناسب لمجموعة صغيرة يديرها مسؤول)
   - لو Firebase غير متاح (بدون نت / محجوب) → يعمل التطبيق محليًا فقط
   ============================================================= */
(function () {
  const App = window.App;
  if (!App) return;

  const cloud = (App.cloud = {
    enabled: false,
    status: "local", // local | connecting | online | offline | error
    lastRev: null,
    ref: null,
    seeded: false,
    // عدّاد نسخة تصاعدي: لا نطمس السحابة إلا إذا كانت نسختنا مبنية على أحدث ما رأيناه.
    // يُقدَّم فقط عند "تطبيق" حالة قادمة فعلًا (لا عند التأجيل)، فيُرفض أي رفع من نسخة قديمة.
    ver: 0,
  });

  const uid = App.util.uid;

  const STATUS_TEXT = {
    local: { t: "محلي", c: "var(--muted)" },
    connecting: { t: "جارٍ الاتصال…", c: "var(--gold)" },
    online: { t: "متصل ☁", c: "var(--brand)" },
    offline: { t: "غير متصل", c: "var(--danger)" },
    error: { t: "خطأ اتصال", c: "var(--danger)" },
  };

  function setStatus(s) {
    cloud.status = s;
    updateBadge();
  }
  function updateBadge() {
    const el = document.getElementById("cloud-status");
    if (!el) return;
    const info = STATUS_TEXT[cloud.status] || STATUS_TEXT.local;
    el.textContent = info.t;
    el.style.color = info.c;
  }
  App.cloud.updateBadge = updateBadge;

  // إزالة الحقول الوصفية قبل تطبيق الحالة
  function stripMeta(obj) {
    const clean = Object.assign({}, obj);
    delete clean.__rev;
    delete clean.__at;
    delete clean.__ver;
    return clean;
  }

  // آخر حالة سحابية وصلت أثناء فتح نافذة منبثقة (تُطبَّق عند إغلاقها)
  let pendingRemote = null;
  let pendingRemoteVer = 0;

  // يقدّم عدّاد النسخة إلى قيمة الحالة المُطبَّقة (لا يتراجع أبدًا)
  function adoptVer(v) {
    if (typeof v === "number" && v > cloud.ver) cloud.ver = v;
  }

  // يستدعيه ui.js عند إغلاق آخر نافذة منبثقة: يطبّق الحالة المؤجّلة إن وُجدت.
  App.onModalsClosed = function () {
    if (!pendingRemote) return;
    const clean = pendingRemote;
    const ver = pendingRemoteVer;
    pendingRemote = null;
    pendingRemoteVer = 0;
    App.applyCloudState(clean);
    adoptVer(ver); // النسخة تُقدَّم الآن فقط لأننا طبّقنا فعلًا
    if (App.render) App.render();
  };

  // رفع الحالة عبر معاملة تُرفض إن كانت السحابة أحدث مما رأيناه (حماية من طمس نسخة قديمة).
  function pushState() {
    if (!cloud.enabled || !cloud.ref) return;
    const rev = uid();
    const baseVer = cloud.ver || 0;
    cloud.ref.transaction(
      (cur) => {
        if (cur) {
          const curVer = typeof cur.__ver === "number" ? cur.__ver : 0;
          // السحابة تقدّمت بما لم نطبّقه بعد → حالتنا قديمة، لا نكتب (نُلغي المعاملة)
          if (curVer > baseVer) return undefined;
        }
        cloud.lastRev = rev;
        return Object.assign({}, App.state, { __rev: rev, __at: Date.now(), __ver: baseVer + 1 });
      },
      (err, committed) => {
        if (err) {
          console.error("فشل رفع الحالة", err);
          if (App.toast) App.toast("تعذّر الرفع للسحابة", "err");
          return;
        }
        if (committed) {
          cloud.ver = baseVer + 1;
        }
        // لو لم تُلتزم: نسختنا كانت قديمة، والمستمع سيسلّمنا الأحدث فنبني عليها.
      },
      false // لا نطبّق محليًا بشكل متفائل — ننتظر الالتزام الفعلي
    );
  }

  function initCloud() {
    const cfg = window.DAWRI_FIREBASE_CONFIG;
    if (!cfg || !window.firebase || !firebase.database) {
      setStatus("local");
      return; // العمل محليًا فقط
    }
    try {
      firebase.initializeApp(cfg);
      const db = firebase.database();
      const ref = db.ref("state");
      cloud.ref = ref;
      cloud.enabled = true;
      setStatus("connecting");

      // ربط الرفع بالحفظ المحلي
      App.afterSave = pushState;

      // مؤشّر الاتصال
      db.ref(".info/connected").on("value", (s) => {
        if (cloud.status === "error") return;
        setStatus(s.val() ? "online" : "offline");
      });

      // الاستماع للتغييرات (يشمل التحميل الأول)
      ref.on(
        "value",
        (snap) => {
          const remote = snap.val();
          if (!remote) {
            // السحابة فارغة → ازرعها من الحالة المحلية مرة واحدة
            if (!cloud.seeded) {
              cloud.seeded = true;
              pushState();
            }
            return;
          }
          cloud.seeded = true;
          const incomingVer = typeof remote.__ver === "number" ? remote.__ver : 0;
          // تجاهل صدى كتابتنا نفسها (لكن اعتمد نسختها)
          if (remote.__rev && remote.__rev === cloud.lastRev) { adoptVer(incomingVer); return; }
          cloud.lastRev = remote.__rev || null;
          const clean = stripMeta(remote);
          // نافذة منبثقة مفتوحة (مثلاً تسجيل مباراة) → أجّل التطبيق حتى تُغلق،
          // حتى لا نمسح النافذة وما أدخله المستخدم بداخلها.
          // مهم: لا نقدّم عدّاد النسخة هنا — يبقى رفعنا القادم "قديمًا" فيُرفض
          // بدل أن يطمس ما في السحابة (تفاديًا لاستعادة فلوس/مزايدات).
          if (App.modalsOpen && App.modalsOpen()) {
            pendingRemote = clean;
            pendingRemoteVer = incomingVer;
            return;
          }
          App.applyCloudState(clean);
          adoptVer(incomingVer); // النسخة تُقدَّم فقط لأننا طبّقنا فعلًا
          if (App.render) App.render();
        },
        (err) => {
          console.error("خطأ في الاستماع", err);
          setStatus("error");
          if (App.toast)
            App.toast("تعذّر الاتصال بقاعدة البيانات — تحقق من قواعد الأمان", "err");
        }
      );
    } catch (e) {
      console.error("فشل تهيئة Firebase", e);
      setStatus("error");
    }
  }

  // ابدأ بعد جاهزية DOM (بعد تعريف App.render في ui.js)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCloud);
  } else {
    initCloud();
  }
})();
