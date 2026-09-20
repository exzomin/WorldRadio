(() => {
  "use strict";

  /* ---------- Ayarlar ---------- */
  const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
  const API_BASES = [
    "https://de1.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
    "https://at1.api.radio-browser.info"
  ];

  // Haritadaki ülke numarası -> iki harfli ülke kodu (Radio Browser bunu kullanıyor)
  const NUM_TO_A2 = {
    "004":"AF","008":"AL","012":"DZ","024":"AO","031":"AZ","032":"AR","036":"AU","040":"AT","044":"BS","050":"BD",
    "051":"AM","056":"BE","064":"BT","068":"BO","070":"BA","072":"BW","076":"BR","084":"BZ","090":"SB","096":"BN",
    "100":"BG","104":"MM","108":"BI","112":"BY","116":"KH","120":"CM","124":"CA","140":"CF","144":"LK","148":"TD",
    "152":"CL","156":"CN","158":"TW","170":"CO","178":"CG","180":"CD","188":"CR","191":"HR","192":"CU","196":"CY",
    "203":"CZ","204":"BJ","208":"DK","214":"DO","218":"EC","222":"SV","226":"GQ","231":"ET","232":"ER","233":"EE",
    "238":"FK","242":"FJ","246":"FI","250":"FR","260":"TF","262":"DJ","266":"GA","268":"GE","270":"GM","275":"PS",
    "276":"DE","288":"GH","300":"GR","304":"GL","320":"GT","324":"GN","328":"GY","332":"HT","340":"HN","348":"HU",
    "352":"IS","356":"IN","360":"ID","364":"IR","368":"IQ","372":"IE","376":"IL","380":"IT","384":"CI","388":"JM",
    "392":"JP","398":"KZ","400":"JO","404":"KE","408":"KP","410":"KR","414":"KW","417":"KG","418":"LA","422":"LB",
    "426":"LS","428":"LV","430":"LR","434":"LY","440":"LT","442":"LU","450":"MG","454":"MW","458":"MY","466":"ML",
    "478":"MR","484":"MX","496":"MN","498":"MD","499":"ME","504":"MA","508":"MZ","512":"OM","516":"NA","524":"NP",
    "528":"NL","540":"NC","554":"NZ","558":"NI","562":"NE","566":"NG","578":"NO","586":"PK","591":"PA","598":"PG",
    "600":"PY","604":"PE","608":"PH","616":"PL","620":"PT","624":"GW","626":"TL","630":"PR","634":"QA","642":"RO",
    "643":"RU","646":"RW","682":"SA","686":"SN","688":"RS","694":"SL","703":"SK","704":"VN","705":"SI","706":"SO",
    "710":"ZA","716":"ZW","724":"ES","728":"SS","729":"SD","732":"EH","740":"SR","748":"SZ","752":"SE","756":"CH",
    "760":"SY","762":"TJ","764":"TH","768":"TG","780":"TT","784":"AE","788":"TN","792":"TR","795":"TM","800":"UG",
    "804":"UA","807":"MK","818":"EG","826":"GB","834":"TZ","840":"US","854":"BF","858":"UY","860":"UZ","862":"VE",
    "887":"YE","894":"ZM"
  };

  const $ = (s) => document.querySelector(s);
  const el = {
    stage: $("#stage"), svg: $("#map"), status: $("#map-status"), tooltip: $("#tooltip"),
    player: $("#player"), country: $("#country-name"), station: $("#station-name"), meta: $("#station-meta"),
    list: $("#list"), listToggle: $("#list-toggle"), listLabel: $("#list-label"),
    play: $("#play"), prev: $("#prev"), next: $("#next"), close: $("#close"), volume: $("#volume"),
    shuffle: $("#shuffle"), theme: $("#theme"), toast: $("#toast"),
    zoomIn: $("#zoom-in"), zoomOut: $("#zoom-out"),
    search: $("#search"), trial: $("#trial"), trialBar: $("#trial-bar"), trialText: $("#trial-text"), trialJoin: $("#trial-join"),
    account: $("#account"), menu: $("#menu"), menuEmail: $("#menu-email"), logout: $("#logout"),
    dialog: $("#auth"), authX: $("#auth-x"), authTitle: $("#auth-title"), authSub: $("#auth-sub"),
    tabSignup: $("#tab-signup"), tabLogin: $("#tab-login"), authForm: $("#auth-form"),
    authEmail: $("#auth-email"), authPw: $("#auth-pw"), authError: $("#auth-error"), authSubmit: $("#auth-submit")
  };

  /* ---------- Tema ---------- */
  const root = document.documentElement;
  let savedTheme = null;
  try { savedTheme = localStorage.getItem("theme"); } catch (e) {}
  root.dataset.theme = savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  el.theme.addEventListener("click", () => {
    const t = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = t;
    try { localStorage.setItem("theme", t); } catch (e) {}
  });

  /* ---------- Yardımcılar ---------- */
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 3400);
  }

  let apiIndex = 0;
  async function api(path) {
    let lastErr;
    for (let i = 0; i < API_BASES.length; i++) {
      const at = (apiIndex + i) % API_BASES.length;
      try {
        const r = await fetch(API_BASES[at] + path);
        if (!r.ok) throw new Error("HTTP " + r.status);
        apiIndex = at;
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(["tr"], { type: "region" }); } catch (e) {}
  function countryLabel(f) {
    try {
      const n = regionNames && regionNames.of(f.code);
      if (n && n !== f.code) return n;
    } catch (e) {}
    return f.properties.name;
  }

  /* ---------- Oynatıcı durumu ---------- */
  const audio = new Audio();
  audio.preload = "none";
  audio.volume = parseFloat(el.volume.value);

  let stations = [];
  let current = 0;
  let state = "idle"; // idle | loading | playing | paused | error
  let attempts = 0;
  let token = 0;
  let paths; // d3 seçimi

  function setState(s) {
    state = s;
    el.player.dataset.state = s;
    updateMeta();
  }

  function updateMeta() {
    const st = stations[current];
    if (state === "loading") { el.meta.textContent = "Bağlanıyor"; return; }
    if (state === "paused")  { el.meta.textContent = "Duraklatıldı"; return; }
    if (state === "error")   { el.meta.textContent = "Açılamadı"; return; }
    if (!st) { el.meta.textContent = ""; return; }
    const tags = (st.tags || "").split(",").map(t => t.trim()).filter(Boolean).slice(0, 3).join(", ");
    el.meta.textContent = tags;
  }

  function showPlayer(open) { document.body.classList.toggle("playing-open", open); }

  function renderList() {
    el.list.textContent = "";
    stations.forEach((s, i) => {
      const li = document.createElement("li");
      if (i === current) li.className = "current";
      li.dataset.q = ((s.name || "") + " " + (s.tags || "")).toLocaleLowerCase("tr");
      const b = document.createElement("button");
      const n = document.createElement("span"); n.className = "n"; n.textContent = s.name.trim();
      const t = document.createElement("span"); t.className = "t";
      t.textContent = (s.tags || "").split(",").map(x => x.trim()).filter(Boolean)[0] || "";
      b.append(n, t);
      b.addEventListener("click", () => { attempts = 0; playStation(i); });
      li.append(b);
      el.list.append(li);
    });
    el.listLabel.textContent = stations.length ? "Radyolar (" + stations.length + ")" : "Radyolar";
  }

  function markCurrent() {
    [...el.list.children].forEach((li, i) => li.classList.toggle("current", i === current));
    const cur = el.list.children[current];
    if (cur && el.player.classList.contains("open")) cur.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function fetchStations(code) {
    const https = location.protocol === "https:" ? "&is_https=true" : "";
    const data = await api(
      "/json/stations/search?countrycode=" + encodeURIComponent(code) +
      "&hidebroken=true&order=clickcount&reverse=true&limit=1000" + https
    );
    const seen = new Set();
    const out = [];
    for (const s of data) {
      const url = s.url_resolved || s.url;
      const key = (s.name || "").trim().toLowerCase();
      if (!url || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= 1000) break;
    }
    return out;
  }

  function playStation(i) {
    current = i;
    const s = stations[i];
    el.station.textContent = s.name.trim();
    markCurrent();
    if (!canListen()) {
      audio.pause();
      setState("paused");
      pending = () => playStation(i);
      openAuth("limit");
      return;
    }
    setState("loading");
    audio.src = s.url_resolved || s.url;
    const p = audio.play();
    if (p && p.catch) {
      p.catch((err) => {
        if (err.name === "AbortError") return;
        if (err.name === "NotAllowedError") { setState("paused"); toast("Başlatmak için oynat düğmesine bas."); return; }
        onFail();
      });
    }
    api("/json/url/" + s.stationuuid).catch(() => {}); // radyo tıklama sayacı (API nezaketi)
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: s.name.trim(), artist: el.country.textContent, album: "Dünya Radyosu" });
      } catch (e) {}
    }
  }

  function onFail() {
    if (state === "paused" || state === "idle") return;
    if (attempts < 4 && stations.length > 1) {
      attempts++;
      toast("Bu yayın açılmadı, sıradaki deneniyor.");
      playStation((current + 1) % stations.length);
    } else {
      setState("error");
      toast("Yayın açılamadı. Listeden başka bir radyo seç.");
    }
  }

  audio.addEventListener("playing", () => { attempts = 0; setState("playing"); });
  audio.addEventListener("waiting", () => { if (state === "playing") setState("loading"); });
  audio.addEventListener("error", onFail);

  function step(dir) {
    if (!stations.length) return;
    attempts = 0;
    playStation((current + dir + stations.length) % stations.length);
  }

  el.play.addEventListener("click", () => {
    if (!stations.length) return;
    if (state === "playing" || state === "loading") { audio.pause(); setState("paused"); }
    else { attempts = 0; playStation(current); } // canlı yayına yeniden bağlan
  });
  el.prev.addEventListener("click", () => step(-1));
  el.next.addEventListener("click", () => step(1));
  el.volume.addEventListener("input", () => { audio.volume = parseFloat(el.volume.value); });
  el.listToggle.addEventListener("click", () => {
    const open = el.player.classList.toggle("open");
    el.listToggle.setAttribute("aria-expanded", String(open));
    if (open) markCurrent();
  });
  el.close.addEventListener("click", () => {
    token++;
    audio.pause();
    setState("idle");
    stations = [];
    showPlayer(false);
    el.player.classList.remove("open");
    paths && paths.classed("active", false);
  });

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", () => el.play.click());
      navigator.mediaSession.setActionHandler("pause", () => el.play.click());
      navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
      navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    } catch (e) {}
  }

  /* ---------- Hesap ve deneme süresi ---------- */
  // NOT: Hesaplar şimdilik sadece bu tarayıcının içinde (localStorage) tutuluyor.
  // Gerçek hesaplar için ileride Firebase / Supabase gibi bir servise bağlanacak.
  const TRIAL_LIMIT = 30; // saniye
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  let session = store.get("dr_session", null); // giriş yapmış kişinin e-postası
  let trialUsed = Number(store.get("dr_trial_used", 0)) || 0;
  let pending = null; // hesap açınca devam edilecek iş

  const isMember = () => !!session;
  const trialLeft = () => Math.max(0, TRIAL_LIMIT - trialUsed);
  const canListen = () => isMember() || trialLeft() > 0;

  function randomHex(n) {
    const a = new Uint8Array(n);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function hashPw(pw, salt) {
    const enc = new TextEncoder();
    if (window.crypto && crypto.subtle) {
      const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
      return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 5381; // eski tarayıcılar için basit yedek
    for (const b of enc.encode(salt + ":" + pw)) h = ((h << 5) + h + b) >>> 0;
    return "x" + h.toString(16);
  }

  function updateTrialUI() {
    el.trial.hidden = isMember();
    if (isMember()) return;
    const left = trialLeft();
    el.trialText.textContent = left > 0 ? "Deneme: " + Math.ceil(left) + " sn kaldı" : "Deneme süresi bitti";
    el.trialBar.style.transform = "scaleX(" + (left / TRIAL_LIMIT) + ")";
  }

  function updateAccountUI() {
    el.account.classList.toggle("member", isMember());
    el.account.querySelector(".initial").textContent = session ? session.charAt(0) : "";
    el.account.setAttribute("aria-label", isMember() ? "Hesap menüsü" : "Giriş yap");
    el.menuEmail.textContent = session || "";
    if (!isMember()) el.menu.hidden = true;
  }

  let mode = "signup";
  function setMode(m) {
    mode = m;
    el.tabSignup.setAttribute("aria-selected", String(m === "signup"));
    el.tabLogin.setAttribute("aria-selected", String(m === "login"));
    el.authSubmit.textContent = m === "signup" ? "Hesap aç" : "Giriş yap";
    el.authPw.autocomplete = m === "signup" ? "new-password" : "current-password";
    el.authError.textContent = "";
  }
  function openAuth(reason) {
    setMode("signup");
    if (reason === "limit") {
      el.authTitle.textContent = "Deneme süren bitti";
      el.authSub.textContent = "Dinlemeye devam etmek için ücretsiz hesap aç.";
    } else {
      el.authTitle.textContent = "Hoş geldin";
      el.authSub.textContent = "Hesap aç ya da giriş yap.";
    }
    if (!el.dialog.open) el.dialog.showModal();
    el.authEmail.focus();
  }
  function afterAuth() {
    if (pending) { const p = pending; pending = null; p(); return; }
    if (stations.length && state !== "playing") { attempts = 0; playStation(current); }
  }

  el.tabSignup.addEventListener("click", () => setMode("signup"));
  el.tabLogin.addEventListener("click", () => setMode("login"));
  el.authX.addEventListener("click", () => el.dialog.close());
  el.dialog.addEventListener("click", (e) => { if (e.target === el.dialog) el.dialog.close(); });
  el.trialJoin.addEventListener("click", () => openAuth("manual"));

  el.authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fail = (msg) => { el.authError.textContent = msg; };
    const email = el.authEmail.value.trim().toLowerCase();
    const pw = el.authPw.value;
    el.authError.textContent = "";
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail("Geçerli bir e-posta yaz.");
    if (pw.length < 6) return fail("Şifre en az 6 karakter olmalı.");

    el.authSubmit.disabled = true;
    try {
      const users = store.get("dr_users", {});
      if (mode === "signup") {
        if (users[email]) return fail("Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.");
        const salt = randomHex(16);
        users[email] = { salt, hash: await hashPw(pw, salt), created: Date.now() };
        store.set("dr_users", users);
      } else {
        const u = users[email];
        if (!u || (await hashPw(pw, u.salt)) !== u.hash) return fail("E-posta veya şifre hatalı.");
      }
      session = email;
      store.set("dr_session", email);
      el.authForm.reset();
      el.dialog.close();
      updateAccountUI();
      updateTrialUI();
      toast("Hoş geldin!");
      afterAuth();
    } finally {
      el.authSubmit.disabled = false;
    }
  });

  el.account.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isMember()) el.menu.hidden = !el.menu.hidden;
    else openAuth("manual");
  });
  document.addEventListener("click", (e) => {
    if (!el.menu.hidden && !el.menu.contains(e.target)) el.menu.hidden = true;
  });
  el.logout.addEventListener("click", () => {
    session = null;
    store.del("dr_session");
    el.menu.hidden = true;
    updateAccountUI();
    updateTrialUI();
    toast("Çıkış yapıldı.");
    if (!canListen() && (state === "playing" || state === "loading")) {
      audio.pause();
      setState("paused");
      openAuth("limit");
    }
  });

  // Deneme sayacı: sadece radyo gerçekten çalarken işler
  let lastTick = performance.now(), sinceSave = 0;
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - lastTick) / 1000, 1);
    lastTick = now;
    if (isMember() || state !== "playing") return;
    trialUsed = Math.min(TRIAL_LIMIT, trialUsed + dt);
    sinceSave += dt;
    if (sinceSave >= 1 || trialUsed >= TRIAL_LIMIT) { store.set("dr_trial_used", trialUsed); sinceSave = 0; }
    updateTrialUI();
    if (trialUsed >= TRIAL_LIMIT) {
      audio.pause();
      setState("paused");
      openAuth("limit");
    }
  }, 250);
  window.addEventListener("pagehide", () => store.set("dr_trial_used", trialUsed));

  // Radyo arama
  el.search.addEventListener("input", () => {
    const q = el.search.value.trim().toLocaleLowerCase("tr");
    [...el.list.children].forEach((li) => { li.hidden = !!q && !li.dataset.q.includes(q); });
  });

  updateTrialUI();
  updateAccountUI();

  /* ---------- Harita ---------- */
  async function init() {
    let world, codes = null;
    try {
      [world, codes] = await Promise.all([
        d3.json(WORLD_URL),
        api("/json/countrycodes").catch(() => null)
      ]);
    } catch (e) {
      el.status.textContent = "Harita yüklenemedi. İnternet bağlantını kontrol edip sayfayı yenile.";
      return;
    }

    const available = codes ? new Set(codes.filter(c => c.stationcount > 0).map(c => String(c.name).toUpperCase())) : null;
    const hasRadio = (code) => !!code && (!available || available.has(code));

    const features = topojson.feature(world, world.objects.countries).features
      .filter(f => f.id !== "010") // Antarktika
      .map(f => {
        f.code = NUM_TO_A2[f.id] || (f.properties.name === "Kosovo" ? "XK" : null);
        return f;
      });

    const svg = d3.select(el.svg);
    const view = svg.append("g");
    const sphere = view.append("path").attr("class", "sphere");
    const gCountries = view.append("g");
    const gFx = view.append("g");

    const projection = d3.geoNaturalEarth1();
    const path = d3.geoPath(projection);

    paths = gCountries.selectAll("path").data(features).join("path")
      .attr("class", d => "country" + (hasRadio(d.code) ? " has-radio" : ""))
      .on("pointermove", (e, d) => {
        if (e.pointerType !== "mouse") return;
        el.tooltip.textContent = countryLabel(d);
        if (!hasRadio(d.code)) {
          const small = document.createElement("small");
          small.textContent = "radyo yok";
          el.tooltip.append(small);
        }
        el.tooltip.style.left = e.clientX + "px";
        el.tooltip.style.top = e.clientY + "px";
        el.tooltip.classList.add("show");
      })
      .on("pointerleave", () => el.tooltip.classList.remove("show"))
      .on("click", (e, d) => {
        if (!hasRadio(d.code)) { toast(countryLabel(d) + " için radyo bulunamadı."); return; }
        selectCountry(d, d3.pointer(e, view.node()));
      });

    const zoom = d3.zoom()
      .scaleExtent([1, 12])
      .on("zoom", (e) => view.attr("transform", e.transform));
    svg.call(zoom).on("dblclick.zoom", null);

    function layout() {
      const { width: w, height: h } = el.stage.getBoundingClientRect();
      svg.attr("viewBox", "0 0 " + w + " " + h);
      projection.fitExtent([[16, 64], [w - 16, h - 130]], { type: "Sphere" });
      sphere.attr("d", path({ type: "Sphere" }));
      paths.attr("d", path);
      zoom.extent([[0, 0], [w, h]]).translateExtent([[0, 0], [w, h]]);
    }
    layout();
    el.status.classList.add("done");

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { svg.call(zoom.transform, d3.zoomIdentity); layout(); }, 120);
    });

    el.zoomIn.addEventListener("click", () => svg.transition().duration(350).call(zoom.scaleBy, 1.7));
    el.zoomOut.addEventListener("click", () => svg.transition().duration(350).call(zoom.scaleBy, 1 / 1.7));

    function ripple(pt) {
      [0, 180].forEach((delay) => {
        const c = gFx.append("circle")
          .attr("class", "ripple").attr("cx", pt[0]).attr("cy", pt[1]).attr("r", 8)
          .style("animation-delay", delay + "ms");
        c.on("animationend", () => c.remove());
      });
    }

    function mainCentroid(f) {
      if (f.geometry.type === "Polygon") return path.centroid(f);
      let best = null, area = -1;
      f.geometry.coordinates.forEach((coords) => {
        const poly = { type: "Polygon", coordinates: coords };
        const a = d3.geoArea(poly);
        if (a > area) { area = a; best = poly; }
      });
      return path.centroid(best);
    }

    async function selectCountry(f, pt) {
      if (!canListen()) { pending = () => selectCountry(f, pt); openAuth("limit"); return; }
      const my = ++token;
      paths.classed("active", d => d.code === f.code);
      ripple(pt || mainCentroid(f));

      audio.pause();
      stations = [];
      current = 0;
      attempts = 0;
      el.country.textContent = countryLabel(f);
      el.station.textContent = "Radyolar aranıyor";
      el.search.value = "";
      renderList();
      setState("loading");
      showPlayer(true);

      let list;
      try {
        list = await fetchStations(f.code);
      } catch (e) {
        if (my !== token) return;
        el.station.textContent = "Radyo listesi alınamadı";
        setState("error");
        toast("Radyo listesi alınamadı. İnternet bağlantını kontrol et.");
        return;
      }
      if (my !== token) return;

      if (!list.length) {
        el.station.textContent = "Çalışan radyo bulunamadı";
        setState("error");
        return;
      }
      stations = list;
      renderList();
      playStation(0);
    }

    el.shuffle.addEventListener("click", () => {
      const pool = features.filter(f => hasRadio(f.code) && (!paths.filter(d => d === f).classed("active")));
      const f = pool[Math.floor(Math.random() * pool.length)];
      if (f) selectCountry(f);
    });
  }

  init();
})();
