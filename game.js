(() => {
  'use strict';

  // ───────────────────────── Telegram ─────────────────────────
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) {}
    try { tg.setHeaderColor('#12141a'); tg.setBackgroundColor('#12141a'); } catch (e) {}
    try { tg.disableVerticalSwipes(); } catch (e) {}
  }
  const haptic = (kind) => {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === 'light') tg.HapticFeedback.impactOccurred('light');
      else if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success');
      else if (kind === 'err') tg.HapticFeedback.notificationOccurred('error');
    } catch (e) {}
  };

  // ───────────────────────── Данные игры ─────────────────────────
  // th — сколько ₽ нужно заработать за всё время, чтобы получить машину
  // mult — множитель к доходу за тап и в секунду
  const CARS = [
    { name: 'ВАЗ-2107',        sub: 'Классика. С неё всё начиналось',   th: 0,           mult: 1,   shape: 'classic', color: '#c8b99a', accent: null },
    { name: 'ВАЗ-2110',        sub: 'Та самая «десятка»',               th: 3e3,         mult: 2,   shape: 'sedan',   color: '#8ea0b3', accent: '#5c6b7a' },
    { name: 'Lada Priora',     sub: 'Тот же двигатель, новый уровень',  th: 2e4,         mult: 4,   shape: 'sedan',   color: '#b8bcc4', accent: '#3a86ff' },
    { name: 'Lada Vesta',      sub: 'Современно и по-русски',           th: 1.2e5,       mult: 7,   shape: 'sedan',   color: '#2a9d8f', accent: '#e9c46a' },
    { name: 'Toyota Camry',    sub: 'Бизнес-класс. Ты уже в деле',      th: 7e5,         mult: 12,  shape: 'sedan',   color: '#f1f1f1', accent: '#2b2d42' },
    { name: 'BMW M5',          sub: 'Седан, который ведёт себя как спорткар', th: 4e6,    mult: 20,  shape: 'sedan',   color: '#1d3557', accent: '#e63946' },
    { name: 'Mercedes G-Class',sub: 'Король бездорожья и парковок',     th: 2.5e7,       mult: 35,  shape: 'suv',     color: '#2b2b2b', accent: '#ffb703' },
    { name: 'Porsche 911',     sub: 'Легенда. Заднемоторная классика',  th: 1.5e8,       mult: 60,  shape: 'sport',   color: '#e63946', accent: '#ffffff' },
    { name: 'Lamborghini',     sub: 'Мечта со стен в детской',          th: 1e9,         mult: 100, shape: 'sport',   color: '#ffd60a', accent: '#111111' },
    { name: 'Bugatti',         sub: 'Вершина. Дальше только космос',    th: 8e9,         mult: 200, shape: 'sport',   color: '#1e5fa8', accent: '#e5e5e5' },
  ];

  // type: tap (+к тапу), sec (+₽/сек), energy (+макс. энергия), regen (+энергии/сек)
  const UPGRADES = [
    { id: 'engine',   group: 'Двигатель и ходовая', ico: '🔩', name: 'Двигатель',        type: 'tap',    per: 1,   base: 25,    growth: 1.5 },
    { id: 'turbo',    group: 'Двигатель и ходовая', ico: '🌀', name: 'Турбина',          type: 'tap',    per: 5,   base: 400,   growth: 1.55 },
    { id: 'comp',     group: 'Двигатель и ходовая', ico: '⚙️', name: 'Компрессор',       type: 'tap',    per: 30,  base: 6000,  growth: 1.6 },
    { id: 'taxi',     group: 'Пассивный заработок', ico: '🚕', name: 'Подработка в такси',type: 'sec',   per: 1,   base: 60,    growth: 1.5 },
    { id: 'delivery', group: 'Пассивный заработок', ico: '📦', name: 'Доставка',         type: 'sec',    per: 8,   base: 800,   growth: 1.55 },
    { id: 'sto',      group: 'Пассивный заработок', ico: '🛠️', name: 'Своё СТО',         type: 'sec',    per: 60,  base: 9000,  growth: 1.6 },
    { id: 'tank',     group: 'Бензобак и энергия',  ico: '⛽', name: 'Бензобак',         type: 'energy', per: 100, base: 100,   growth: 1.5, max: 40 },
    { id: 'chip',     group: 'Бензобак и энергия',  ico: '💾', name: 'Чип-тюнинг',       type: 'regen',  per: 1,   base: 200,   growth: 1.6, max: 25 },
  ];

  const BASE_ENERGY = 500;
  const BASE_REGEN = 1;            // энергии в секунду
  const OFFLINE_CAP = 3 * 3600;    // максимум 3 часа офлайн-дохода
  const CRIT_CHANCE = 0.05;
  const CRIT_MULT = 5;
  const SAVE_KEY = 'carclicker_v1';

  // ───────────────────────── Состояние ─────────────────────────
  const defaults = () => ({ coins: 0, lifetime: 0, taps: 0, levels: {}, energy: BASE_ENERGY, carIdx: 0, last: Date.now() });
  let state = defaults();

  const lvl = (id) => state.levels[id] || 0;
  const stat = (type) => UPGRADES.reduce((s, u) => (u.type === type ? s + lvl(u.id) * u.per : s), 0);
  const car = () => CARS[state.carIdx];
  const perTap = () => (1 + stat('tap')) * car().mult;
  const perSec = () => stat('sec') * car().mult;
  const maxEnergy = () => BASE_ENERGY + stat('energy');
  const regen = () => BASE_REGEN + stat('regen');
  const cost = (u) => Math.floor(u.base * Math.pow(u.growth, lvl(u.id)));
  const isMax = (u) => u.max !== undefined && lvl(u.id) >= u.max;

  function fmt(n) {
    n = Math.floor(n);
    if (n < 1000) return String(n);
    const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
    let u = 0, v = n;
    while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
    let s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
    if (s.includes('.')) s = s.replace(/\.?0+$/, '');
    return s + units[u];
  }

  // ───────────────────────── Сохранение ─────────────────────────
  function merge(data) {
    const s = Object.assign(defaults(), data || {});
    s.levels = Object.assign({}, (data && data.levels) || {});
    return s;
  }
  function saveLocal() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function saveCloud() {
    try {
      if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) {
        tg.CloudStorage.setItem(SAVE_KEY, JSON.stringify(state), () => {});
      }
    } catch (e) {}
  }
  function loadLocal() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) state = merge(JSON.parse(raw));
    } catch (e) {}
  }
  function loadCloud() {
    try {
      if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) {
        tg.CloudStorage.getItem(SAVE_KEY, (err, val) => {
          if (err || !val) return;
          try {
            const data = merge(JSON.parse(val));
            if (data.lifetime > state.lifetime) {
              state = data;
              syncCarIdx(true);
              tick(true);
              renderCar();
              renderGarage();
              updateShop();
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  // ───────────────────────── Машины ─────────────────────────
  function carIdxFor(lifetime) {
    let idx = 0;
    for (let i = 0; i < CARS.length; i++) if (lifetime >= CARS[i].th) idx = i;
    return idx;
  }
  function syncCarIdx(silent) {
    const idx = carIdxFor(state.lifetime);
    if (idx > state.carIdx) {
      state.carIdx = idx;
      if (!silent) {
        renderCar();
        renderGarage();
        haptic('ok');
        showToast('🎉 Новая машина!', CARS[idx].name + ' · доход x' + CARS[idx].mult, 2600);
      }
    }
  }

  function carSVG(c) {
    const wheel = (x, y, r) =>
      `<circle cx="${x}" cy="${y}" r="${r + 7}" fill="#0d0f13"/>` +
      `<circle cx="${x}" cy="${y}" r="${r}" fill="#15171c"/>` +
      `<g class="cc-spin"><circle cx="${x}" cy="${y}" r="${r * 0.56}" fill="#cfd3da"/>` +
      `<path d="M${x} ${y - r * 0.56} V${y + r * 0.56} M${x - r * 0.56} ${y} H${x + r * 0.56}" stroke="#7b8190" stroke-width="3"/></g>` +
      `<circle cx="${x}" cy="${y}" r="${r * 0.14}" fill="#3a3f4d"/>`;
    const glass = '#a9d6f5';
    let body = '', extra = '', wheels = '', stripeY = null;
    let hl = [0, 0], tl = [0, 0];

    if (c.shape === 'classic') {
      body = '<path d="M28 146 L28 110 Q28 100 40 98 L100 94 L128 56 L262 56 L292 94 L356 100 Q374 104 374 118 L374 146 Z"/>';
      extra = `<path d="M138 64 L194 64 L194 92 L114 92 Z" fill="${glass}"/><path d="M202 64 L256 64 L280 92 L202 92 Z" fill="${glass}"/>` +
              '<rect x="24" y="136" width="354" height="10" rx="5" fill="#7a7f8c"/>';
      wheels = wheel(106, 146, 30) + wheel(296, 146, 30);
      hl = [360, 106]; tl = [28, 106];
    } else if (c.shape === 'suv') {
      body = '<path d="M24 150 L24 102 Q24 92 38 90 L94 86 L112 46 L292 46 L312 86 L360 92 Q376 96 376 110 L376 150 Z"/>';
      extra = `<path d="M120 54 L196 54 L196 84 L106 84 Z" fill="${glass}"/><path d="M204 54 L286 54 L304 84 L204 84 Z" fill="${glass}"/>` +
              '<rect x="118" y="38" width="170" height="5" rx="2" fill="#2a2d36"/>';
      wheels = wheel(108, 152, 34) + wheel(294, 152, 34);
      hl = [362, 98]; tl = [26, 98]; stripeY = 128;
    } else if (c.shape === 'sport') {
      body = '<path d="M22 148 L22 124 Q22 110 44 106 L116 98 L162 68 Q172 60 186 60 L236 60 Q250 60 258 68 L300 98 L362 106 Q380 110 380 126 L380 148 Z"/>';
      extra = `<path d="M148 98 L176 70 L234 70 L268 98 Z" fill="${glass}"/>` +
              '<path d="M18 104 H64 V98 H18 Z" fill="#222"/><rect x="30" y="98" width="5" height="10" fill="#222"/><rect x="48" y="98" width="5" height="10" fill="#222"/>';
      wheels = wheel(110, 148, 30) + wheel(296, 148, 30);
      hl = [364, 112]; tl = [24, 112]; stripeY = 126;
    } else {
      body = '<path d="M26 146 L26 114 Q26 102 42 98 L108 90 L146 58 Q152 52 162 52 L248 52 Q258 52 266 58 L300 90 L354 98 Q374 102 374 116 L374 146 Z"/>';
      extra = `<path d="M126 88 L152 62 L196 62 L196 88 Z" fill="${glass}"/><path d="M204 62 L248 62 L276 88 L204 88 Z" fill="${glass}"/>`;
      wheels = wheel(106, 146, 30) + wheel(296, 146, 30);
      hl = [360, 104]; tl = [28, 104]; stripeY = 124;
    }
    const stripe = c.accent && stripeY ? `<path d="M32 ${stripeY} H368" stroke="${c.accent}" stroke-width="5" opacity=".9"/>` : '';
    const lights = `<rect x="${hl[0]}" y="${hl[1]}" width="12" height="10" rx="3" fill="#fff6b0"/>` +
                   `<rect x="${tl[0] - 2}" y="${tl[1]}" width="12" height="10" rx="3" fill="#e63946"/>`;
    return `<svg id="car" viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">` +
           `<style>.cc-spin{transform-box:fill-box;transform-origin:center;animation:ccspin .5s linear infinite}@keyframes ccspin{to{transform:rotate(360deg)}}</style>` +
           `<ellipse cx="200" cy="190" rx="170" ry="9" fill="rgba(0,0,0,.45)"/>` +
           `<g fill="${c.color}">${body}</g>${stripe}${extra}${lights}${wheels}</svg>`;
  }

  // ───────────────────────── Интерфейс ─────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    coins: $('coins'), perTap: $('perTap'), perSec: $('perSec'), carMult: $('carMult'),
    carName: $('carName'), carSub: $('carSub'), carBox: $('carBox'), stage: $('stage'),
    carProg: $('carProg'), nextLabel: $('nextLabel'), nextPct: $('nextPct'),
    energyBar: $('energyBar'), energyText: $('energyText'),
    shopList: $('shopList'), garageList: $('garageList'), toast: $('toast'),
  };

  let toastTimer = null;
  function showToast(title, text, ms) {
    el.toast.innerHTML = `<h3>${title}</h3><p>${text}</p>`;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms || 2000);
  }

  function renderCar() {
    const c = car();
    el.carName.textContent = c.name;
    el.carSub.textContent = c.sub;
    el.carBox.innerHTML = carSVG(c);
  }

  function renderHud() {
    el.coins.textContent = fmt(state.coins);
    el.perTap.textContent = fmt(perTap());
    el.perSec.textContent = fmt(perSec());
    el.carMult.textContent = 'x' + car().mult;

    const me = maxEnergy();
    el.energyText.textContent = Math.floor(state.energy) + ' / ' + me;
    el.energyBar.style.width = Math.min(100, (state.energy / me) * 100) + '%';

    const i = state.carIdx;
    if (i < CARS.length - 1) {
      const a = CARS[i].th, b = CARS[i + 1].th;
      const pct = Math.max(0, Math.min(100, ((state.lifetime - a) / (b - a)) * 100));
      el.carProg.style.width = pct + '%';
      el.nextLabel.textContent = 'До «' + CARS[i + 1].name + '»: ' + fmt(Math.max(0, b - state.lifetime)) + ' ₽';
      el.nextPct.textContent = Math.floor(pct) + '%';
    } else {
      el.carProg.style.width = '100%';
      el.nextLabel.textContent = 'Максимальная машина 🏁';
      el.nextPct.textContent = '100%';
    }
  }

  // — Магазин (строится один раз, потом только обновляется)
  const shopRefs = {};
  function buildShop() {
    let group = '';
    UPGRADES.forEach((u) => {
      if (u.group !== group) {
        group = u.group;
        const h = document.createElement('div');
        h.className = 'group';
        h.textContent = group;
        el.shopList.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML =
        `<div class="ico">${u.ico}</div>` +
        `<div class="info"><div class="name">${u.name} <span class="lvl"></span></div><div class="desc"></div></div>` +
        `<button class="buy"></button>`;
      const btn = row.querySelector('.buy');
      btn.addEventListener('click', () => buy(u));
      el.shopList.appendChild(row);
      shopRefs[u.id] = { row, lvl: row.querySelector('.lvl'), desc: row.querySelector('.desc'), btn };
    });
  }
  function descFor(u) {
    const m = car().mult;
    if (u.type === 'tap') return '+' + fmt(u.per * m) + ' ₽ за тап';
    if (u.type === 'sec') return '+' + fmt(u.per * m) + ' ₽ в секунду';
    if (u.type === 'energy') return '+' + u.per + ' к размеру бензобака';
    return '+' + u.per + ' энергии в секунду';
  }
  function updateShop() {
    UPGRADES.forEach((u) => {
      const r = shopRefs[u.id];
      if (!r) return;
      const l = lvl(u.id);
      r.lvl.textContent = l ? 'ур. ' + l + (u.max ? '/' + u.max : '') : '';
      r.desc.textContent = descFor(u);
      if (isMax(u)) {
        r.btn.textContent = 'МАКС';
        r.btn.disabled = true;
        r.row.classList.add('owned');
      } else {
        const c = cost(u);
        r.btn.textContent = fmt(c) + ' ₽';
        r.btn.disabled = state.coins < c;
      }
    });
  }
  function buy(u) {
    if (isMax(u)) return;
    const c = cost(u);
    if (state.coins < c) { haptic('err'); return; }
    state.coins -= c;
    state.levels[u.id] = lvl(u.id) + 1;
    haptic('ok');
    renderHud();
    updateShop();
    saveLocal();
  }

  // — Гараж
  function renderGarage() {
    el.garageList.innerHTML = '';
    CARS.forEach((c, i) => {
      const unlocked = i <= state.carIdx;
      const row = document.createElement('div');
      row.className = 'item' + (i === state.carIdx ? ' current' : unlocked ? ' owned' : ' locked');
      row.innerHTML =
        `<div class="ico">${unlocked ? '🚗' : '🔒'}</div>` +
        `<div class="info"><div class="name">${unlocked ? c.name : '???'} ${i === state.carIdx ? '<span class="lvl">· сейчас</span>' : ''}</div>` +
        `<div class="desc">${unlocked ? c.sub : 'Нужно заработать ' + fmt(c.th) + ' ₽ за всё время'}</div></div>` +
        `<div class="lvl" style="font-weight:800;font-size:16px">x${c.mult}</div>`;
      el.garageList.appendChild(row);
    });
    const info = document.createElement('div');
    info.className = 'center';
    info.innerHTML = `Всего тапов: <b>${fmt(state.taps)}</b> · Заработано: <b>${fmt(state.lifetime)} ₽</b><br>` +
      `Машина повышается сама, когда ты зарабатываешь нужную сумму.<br>` +
      `<button class="resetbtn" id="resetBtn">Сбросить прогресс</button>`;
    el.garageList.appendChild(info);
    $('resetBtn').addEventListener('click', () => {
      const doReset = () => {
        state = defaults();
        saveLocal(); saveCloud();
        renderCar(); renderGarage(); renderHud(); updateShop();
      };
      if (tg && tg.showConfirm) tg.showConfirm('Точно сбросить весь прогресс?', (ok) => ok && doReset());
      else if (confirm('Точно сбросить весь прогресс?')) doReset();
    });
  }

  // ───────────────────────── Тап ─────────────────────────
  let hitTimer = null;
  function onTap(e) {
    e.preventDefault();
    if (state.energy < 1) {
      haptic('err');
      el.energyText.style.color = '#e74c3c';
      setTimeout(() => (el.energyText.style.color = ''), 250);
      return;
    }
    state.energy -= 1;
    state.taps += 1;
    const crit = Math.random() < CRIT_CHANCE;
    const gain = perTap() * (crit ? CRIT_MULT : 1);
    state.coins += gain;
    state.lifetime += gain;
    syncCarIdx(false);

    haptic('light');
    const carEl = $('car');
    if (carEl) {
      carEl.classList.add('hit');
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => carEl.classList.remove('hit'), 70);
    }
    if (el.stage.querySelectorAll('.float').length < 30) {
      const rect = el.stage.getBoundingClientRect();
      const f = document.createElement('div');
      f.className = 'float';
      f.textContent = (crit ? '💥 ' : '+') + fmt(gain);
      f.style.left = (e.clientX - rect.left - 20 + (Math.random() * 20 - 10)) + 'px';
      f.style.top = (e.clientY - rect.top - 30) + 'px';
      if (crit) f.style.color = '#ff4d6d';
      el.stage.appendChild(f);
      setTimeout(() => f.remove(), 800);
    }
    renderHud();
  }
  el.stage.addEventListener('pointerdown', onTap);
  el.stage.addEventListener('contextmenu', (e) => e.preventDefault());

  // ───────────────────────── Игровой цикл ─────────────────────────
  function advance(dt, offline) {
    if (dt <= 0) return;
    if (offline) dt = Math.min(dt, OFFLINE_CAP);
    const earned = perSec() * dt;
    state.energy = Math.min(maxEnergy(), state.energy + regen() * dt);
    if (earned > 0) {
      state.coins += earned;
      state.lifetime += earned;
      syncCarIdx(false);
    }
    if (offline && earned >= 1 && dt >= 30) {
      showToast('⏱ Пока тебя не было', 'Машина заработала ' + fmt(earned) + ' ₽', 3000);
    }
  }
  function tick(force) {
    const now = Date.now();
    const dt = (now - state.last) / 1000;
    state.last = now;
    advance(dt, dt > 5 || force === true);
    renderHud();
  }
  setInterval(tick, 100);
  setInterval(updateShopIfVisible, 400);
  setInterval(() => { saveLocal(); saveCloud(); }, 10000);

  function updateShopIfVisible() {
    if ($('screen-shop').classList.contains('active')) updateShop();
  }
  const persist = () => { state.last = Date.now(); saveLocal(); saveCloud(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  window.addEventListener('pagehide', persist);

  // ───────────────────────── Вкладки ─────────────────────────
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + t.dataset.tab));
      if (t.dataset.tab === 'shop') updateShop();
      if (t.dataset.tab === 'garage') renderGarage();
      haptic('light');
    });
  });

  // ───────────────────────── Старт ─────────────────────────
  loadLocal();
  syncCarIdx(true);
  buildShop();
  renderCar();
  renderGarage();
  updateShop();
  tick(false);      // догоняем время, пока игра была закрыта (офлайн-доход)
  loadCloud();
})();
