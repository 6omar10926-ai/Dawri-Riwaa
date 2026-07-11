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
    return clean;
  }

  function pushState() {
    if (!cloud.enabled || !cloud.ref) return;
    const rev = uid();
    cloud.lastRev = rev;
    const payload = Object.assign({}, App.state, { __rev: rev, __at: Date.now() });
    cloud.ref.set(payload).catch((e) => {
      console.error("فشل رفع الحالة", e);
      if (App.toast) App.toast("تعذّر الرفع للسحابة", "err");
    });
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
          // تجاهل صدى كتابتنا نفسها
          if (remote.__rev && remote.__rev === cloud.lastRev) return;
          cloud.lastRev = remote.__rev || null;
          App.applyCloudState(stripMeta(remote));
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
