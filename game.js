// 純遊戲邏輯＋角色 SVG：host / player / local 共用，node test.js 也能直接跑
// 規則照《Racing Hedgehogs》：打一張牌讓同色刺蝟走 1 或 2 步，有刺蝟到終點就結算手上剩下的牌

// 賽道：0 是起點（沒有數字，算 0 分），1–14 照實體棋盤；14 是終點
const TRACK = [0, -1, -1, -1, -1, -1, -1, -1, 0, 0, 1, 1, 2, 2, 3];
const FINISH = TRACK.length - 1;
const BRIDGE = [7, 8];                     // 木橋那兩格，畫面上換顏色
const FINISH_BONUS = 3;
const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_NAMES = { red: '紅', yellow: '黃', green: '綠', blue: '藍', rainbow: '彩虹' };
const COLOR_HEX = { red: '#d9402b', yellow: '#e8b923', green: '#3d9a4a', blue: '#3b7dd8' };
const HAND_SIZE = { 3: 15, 4: 13, 5: 11 };
const MIN_SEATS = 3, MAX_SEATS = 5;

// 55 張牌用 0–54 表示：每 11 張一組（紅黃綠藍、最後一組是彩虹萬用），組內前 6 張走 1 步、後 5 張跑 2 步
const DECK_SIZE = 55;
const cardColor = (id) => (Math.floor(id / 11) === 4 ? 'rainbow' : COLORS[Math.floor(id / 11)]);
const cardSteps = (id) => (id % 11 < 6 ? 1 : 2);
const isJoker = (id) => cardColor(id) === 'rainbow';

function shuffle(arr, rng = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// 手牌排好：同色放一起、走在跑前面，手機上比較好找
const sortHand = (h) => h.slice().sort((a, b) => a - b);

// 這張牌「留在手上」現在值幾分（萬用牌 0 分）
function cardValue(id, pos) { return isJoker(id) ? 0 : TRACK[pos[COLORS.indexOf(cardColor(id))]]; }
function handValue(hand, pos) { return (hand || []).reduce((s, id) => s + cardValue(id, pos), 0); }

// ── 一局遊戲的狀態 G：純資料，本機模式存 localStorage，主控端存 Firebase ──
// seats：[{ name, bot }]，bot 是 null（真人）或 'easy' / 'smart'
function newGame(seats, set, rng = Math.random) {
    if (seats.length < MIN_SEATS || seats.length > MAX_SEATS) throw new Error('要 3–5 個座位');
    const n = seats.length;
    const G = { seats, set, races: set.races === 'one' ? 1 : n, race: 0, totals: Array(n).fill(0), history: [], phase: 'play' };
    return startRace(G, rng);
}

function startRace(G, rng = Math.random) {
    const n = G.seats.length, k = HAND_SIZE[n];
    const deck = shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i), rng);
    G.hands = G.seats.map((_, i) => sortHand(deck.slice(i * k, i * k + k)));
    G.pos = [0, 0, 0, 0];
    G.starter = G.race % n;                // 第一場座位 0 先，之後每場換左手邊（下一個座位）
    G.turn = G.starter;
    G.t = 0;                               // 第幾手，Firebase 規則用它擋重複出牌
    G.last = null;
    G.finisher = null;
    G.phase = 'play';
    return G;
}

// 出牌：回傳 true 表示成功；牌不在手上、輪錯人、萬用牌沒選顏色都回 false
function play(G, seat, id, color) {
    if (G.phase !== 'play' || seat !== G.turn) return false;
    const at = G.hands[seat].indexOf(id);
    if (at < 0) return false;
    const c = isJoker(id) ? color : cardColor(id);
    const h = COLORS.indexOf(c);
    if (h < 0) return false;
    G.hands[seat].splice(at, 1);
    const from = G.pos[h];
    G.pos[h] = Math.min(FINISH, from + cardSteps(id));   // 「跑」超過終點也算到，停在終點
    G.last = { seat, id, color: c, from, to: G.pos[h] };
    G.t++;
    if (G.pos[h] === FINISH) { G.finisher = seat; endRace(G); }
    else if (G.hands.every((hd) => hd.length === 0)) endRace(G);   // 理論上不會發生，保險起見
    else G.turn = (G.turn + 1) % G.seats.length;
    return true;
}

// 這場分數：剩下的牌照刺蝟所在格計分，到終點的人 +3；總和是負的算 0
function raceScores(G) {
    return G.seats.map((_, i) => Math.max(0, handValue(G.hands[i], G.pos) + (G.finisher === i ? FINISH_BONUS : 0)));
}

function endRace(G) {
    const sc = raceScores(G);
    G.history.push({ scores: sc, finisher: G.finisher, pos: G.pos.slice(), hands: G.hands.map((h) => h.slice()) });
    sc.forEach((s, i) => { G.totals[i] += s; });
    G.phase = G.race + 1 >= G.races ? 'end' : 'raceEnd';
}

function nextRace(G, rng = Math.random) {
    if (G.phase !== 'raceEnd') return false;
    G.race++;
    startRace(G, rng);
    return true;
}

// 名次：總分高的在前；同分比最後一場
function ranking(G) {
    const lastRace = G.history[G.history.length - 1]?.scores || [];
    return G.seats.map((_, i) => i).sort((a, b) => G.totals[b] - G.totals[a] || (lastRace[b] || 0) - (lastRace[a] || 0));
}

// Firebase 會把空陣列存成 null（整個欄位消失），讀回來先補齊
function fixArrays(G) {
    const n = G.seats.length, fill = (a) => G.seats.map((_, i) => (a && a[i]) || []);
    G.hands = fill(G.hands);
    G.history = (G.history || []).map((h) => ({ ...h, hands: fill(h.hands), scores: h.scores || Array(n).fill(0) }));
    G.counts = G.counts || Array(n).fill(0);
    return G;
}

// ── 電腦玩家 ──
// easy：隨便出；smart：挑「出完之後手上剩的牌最值錢（加上到終點的 3 分）」的那張
function botMove(G, seat, rng = Math.random) {
    const hand = G.hands[seat];
    const options = [];
    hand.forEach((id) => (isJoker(id) ? COLORS : [cardColor(id)]).forEach((c) => options.push({ id, color: c })));
    if (G.seats[seat].bot !== 'smart') return options[Math.floor(rng() * options.length)];
    let best = null, bestV = -Infinity;
    for (const o of options) {
        const pos = G.pos.slice();
        const h = COLORS.indexOf(o.color);
        pos[h] = Math.min(FINISH, pos[h] + cardSteps(o.id));
        const rest = hand.filter((x) => x !== o.id);
        const v = handValue(rest, pos) + (pos[h] === FINISH ? FINISH_BONUS : 0) + rng() * 0.5;   // 一點亂數，同分時不會每次都一樣
        if (v > bestV) { bestV = v; best = o; }
    }
    return best;
}

// ── 角色：摺耳貓戴刺蝟帽（貓的配色比例沿用 croc-outfit-game 的 CAT_PARTS）──
const INK = '#3b3330';
const stk = (w) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const BODY_RECT = 'x="-105" y="-320" width="210" height="320" rx="74"';
const whiskers = [-1, 1].map((sd) => [0, 1, 2].map((i) => {
    const y0 = -230 + i * 11;
    return `M${sd * 63},${y0} Q${sd * 105},${y0 - 6 + i * 4} ${sd * 131},${y0 - 8 + i * 8}`;
}).join(' ')).join(' ');
const CAT_BODY = `<path d="M80,-30 Q160,-40 150,-130" fill="none" stroke="${INK}" stroke-width="26" stroke-linecap="round"/><path d="M80,-30 Q160,-40 150,-130" fill="none" stroke="#F3DDA6" stroke-width="16" stroke-linecap="round"/>`
    + `<rect x="-62" y="-14" width="26" height="36" rx="8" fill="#F3DDA6" ${stk(4)}/><rect x="36" y="-14" width="26" height="36" rx="8" fill="#F3DDA6" ${stk(4)}/>`
    + `<rect ${BODY_RECT} fill="#F3DDA6" ${stk(5)}/>`
    + `<path d="M-50,-236 A8,8 0 0 0 -34,-236 Z M34,-236 A8,8 0 0 0 50,-236 Z" fill="${INK}"/><path d="M-64,-234 L-22,-237 M20,-238 L62,-235" ${stk(4.5)}/>`
    + `<path d="M-7,-214 Q0,-217 7,-214 Q2,-205 0,-205 Q-2,-205 -7,-214 Z" fill="${INK}"/><path d="M0,-205 V-200 M0,-200 Q-6,-194 -13,-198 M0,-200 Q6,-194 13,-198" fill="none" ${stk(3.5)}/>`
    + `<g transform="translate(0 20)"><path d="${whiskers}" fill="none" ${stk(3.5)}/></g>`
    + `<path d="M-100,-150 Q-130,-130 -138,-92 M100,-150 Q130,-130 138,-92" fill="none" ${stk(5)}/><circle cx="-138" cy="-92" r="10.5" fill="#F3DDA6" ${stk(3.5)}/><circle cx="138" cy="-92" r="10.5" fill="#F3DDA6" ${stk(3.5)}/>`;

// 刺蝟帽：半圓帽身＋一圈尖刺；彩虹萬用牌的刺四色輪流
function hogHat(color) {
    const fills = color === 'rainbow' ? COLORS.map((c) => COLOR_HEX[c]) : [COLOR_HEX[color]];
    const spikes = [];
    const N = 13;
    for (let i = 0; i < N; i++) {
        const a0 = Math.PI * (i / N), a1 = Math.PI * ((i + 1) / N), am = (a0 + a1) / 2;
        const p = (a, r) => `${(-Math.cos(a) * r * 1.12).toFixed(1)},${(-268 - Math.sin(a) * r).toFixed(1)}`;
        spikes.push(`<polygon points="${p(a0, 100)} ${p(am, 150)} ${p(a1, 100)}" fill="${fills[i % fills.length]}" ${stk(4)}/>`);
    }
    const base = color === 'rainbow' ? '#f6efe0' : COLOR_HEX[color];
    return spikes.join('') + `<path d="M-112,-268 A112,100 0 0 1 112,-268 Q0,-252 -112,-268 Z" fill="${base}" ${stk(5)}/>`
        + `<path d="M-60,-300 l14,-22 M-20,-320 l8,-24 M24,-320 l-6,-24 M64,-300 l-12,-22" stroke="${INK}" stroke-opacity=".3" stroke-width="4" stroke-linecap="round"/>`;
}

function catSVG(color, label = '') {
    return `<svg viewBox="-175 -440 350 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label || COLOR_NAMES[color] + '刺蝟貓'}">${CAT_BODY}${hogHat(color)}</svg>`;
}

// ── 畫面零件 ──
// 賽道排成 3 列 S 形：0–4 往右、5–9 往左、10–14 往右
function trackHTML(pos, opts = {}) {
    const cells = TRACK.map((v, i) => {
        const row = Math.floor(i / 5), col = row === 1 ? 4 - (i % 5) : i % 5;
        const kind = i === 0 ? 'start' : i === FINISH ? 'finish' : BRIDGE.includes(i) ? 'bridge' : v < 0 ? 'neg' : 'pos';
        const here = COLORS.filter((_, h) => pos[h] === i);
        const hogs = here.map((c) => `<span class="hog${COLORS.indexOf(c) === opts.moved ? ' moved' : ''}">${catSVG(c)}</span>`).join('');
        const label = i === 0 ? '起點' : (v > 0 ? '+' : '') + v;
        return `<div class="cell ${kind}" style="grid-row:${row + 1};grid-column:${col + 1}"><b>${label}</b><div class="hogs n${here.length}">${hogs}</div></div>`;
    });
    return `<div class="track">${cells.join('')}</div>`;
}

// 一張牌：貓＋腳印數；hint 時在下面標「現在值幾分」
function cardHTML(id, opts = {}) {
    const c = cardColor(id), steps = cardSteps(id);
    const val = opts.pos ? cardValue(id, opts.pos) : null;
    const hint = val === null ? '' : `<em class="${val < 0 ? 'minus' : ''}">${isJoker(id) ? '0 分' : (val > 0 ? '+' : '') + val + ' 分'}</em>`;
    return `<button class="pcard ${c}" data-id="${id}"${opts.disabled ? ' disabled' : ''}>${catSVG(c)}<span class="steps">${'🐾'.repeat(steps)}</span>${hint}</button>`;
}

const describeMove = (G, names) => {
    const L = G.last;
    if (!L) return '';
    const who = names[L.seat];
    const card = isJoker(L.id) ? `彩虹牌（選${COLOR_NAMES[L.color]}）` : `${COLOR_NAMES[L.color]}色牌`;
    return `${who} 打出${card}，${COLOR_NAMES[L.color]}刺蝟${L.to === FINISH ? '衝到終點！' : `走 ${L.to - L.from} 步`}`;
};

// ── 難度設定：三種預設，也可以逐項調 ──
const PRESETS = {
    elder: { races: 'one', secs: 0, hint: true, big: true, bot: 'easy' },
    kid: { races: 'all', secs: 0, hint: true, big: false, bot: 'easy' },
    adult: { races: 'all', secs: 30, hint: false, big: false, bot: 'smart' },
};
const PRESET_NAMES = { elder: '長者', kid: '兒童', adult: '一般' };
const SETTING_FIELDS = [
    ['races', '場數', [['one', '只打 1 場'], ['all', '場數＝人數（原版）']]],
    ['secs', '出牌提醒', [[0, '不計時'], [60, '60 秒'], [30, '30 秒']]],
    ['hint', '分數提示', [[true, '牌上顯示現在值幾分'], [false, '不顯示']]],
    ['big', '字級', [[true, '特大'], [false, '一般']]],
    ['bot', '電腦玩家', [['easy', '隨便出（放水）'], ['smart', '會算分']]],
];
const DEFAULT_SETTINGS = { ...PRESETS.kid };

function settingsHTML(cur, skip = []) {
    const presets = Object.keys(PRESETS).map((k) => `<button type="button" class="btn alt" data-preset="${k}">${PRESET_NAMES[k]}</button>`).join('');
    const fields = SETTING_FIELDS.filter(([key]) => !skip.includes(key)).map(([key, label, opts]) =>
        `<label>${label} <select data-set="${key}">${opts.map(([v, t]) => `<option value="${v}"${String(cur[key]) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`
    ).join('');
    return `<div class="settings"><div class="row">快速選：${presets}</div><div class="row">${fields}</div></div>`;
}

const parseSetting = (key, v) => (key === 'secs' ? Number(v) : key === 'hint' || key === 'big' ? v === 'true' : v);

// 表單改了就寫回 cur（同一個物件），畫面重畫時再用 cur 畫，選過的值不會跳掉
function bindSettings(root, cur, onChange = () => {}) {
    const sync = () => root.querySelectorAll('[data-set]').forEach((el) => { el.value = String(cur[el.dataset.set]); });
    root.querySelectorAll('[data-set]').forEach((el) => {
        el.onchange = () => { cur[el.dataset.set] = parseSetting(el.dataset.set, el.value); saveSettings(cur); onChange(); };
    });
    root.querySelectorAll('[data-preset]').forEach((b) => {
        b.onclick = () => { Object.assign(cur, PRESETS[b.dataset.preset]); saveSettings(cur); sync(); onChange(); };
    });
}

// 記住上次的設定只是方便，讀不到就用預設
function loadSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('hedgehog-settings') || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(cur) { try { localStorage.setItem('hedgehog-settings', JSON.stringify(cur)); } catch { /* 私密模式存不了就算了 */ } }

if (typeof module !== 'undefined') {
    module.exports = { TRACK, FINISH, COLORS, HAND_SIZE, DECK_SIZE, FINISH_BONUS, cardColor, cardSteps, isJoker, cardValue, handValue, shuffle, newGame, startRace, play, raceScores, nextRace, ranking, botMove, catSVG, trackHTML, cardHTML, describeMove, fixArrays, PRESETS };
}
