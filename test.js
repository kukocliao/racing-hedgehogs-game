// node test.js —— 驗證牌組、出牌、結算、電腦玩家，以及各頁面全域變數不撞名
const assert = require('assert');
const g = require('./game.js');

// 牌組：55 張，每組 6 張走、5 張跑；賽道 15 格（起點＋14）
const ids = Array.from({ length: g.DECK_SIZE }, (_, i) => i);
for (const c of [...g.COLORS, 'rainbow']) {
    const mine = ids.filter((i) => g.cardColor(i) === c);
    assert.strictEqual(mine.length, 11, c + ' 要 11 張');
    assert.strictEqual(mine.filter((i) => g.cardSteps(i) === 1).length, 6, c + ' 走 6 張');
}
assert.deepStrictEqual(g.TRACK, [0, -1, -1, -1, -1, -1, -1, -1, 0, 0, 1, 1, 2, 2, 3]);

// 規則書的例子：藍在 1、綠在 2、黃在 0、紅在 -1；手上 3 藍 3 綠 1 黃 1 紅 1 彩虹，到終點的人 = 11 分
{
    const G = { seats: [{}, {}, {}], finisher: 0 };
    const posOf = (v) => g.TRACK.indexOf(v);
    G.hands = [[33, 34, 35, 22, 23, 24, 11, 0, 44], [], []];        // 藍×3、綠×3、黃、紅、彩虹
    G.pos = [1, 8, 12, 10];                                          // 紅 -1、黃 0、綠 2、藍 1
    assert.strictEqual(g.TRACK[G.pos[3]], 1); assert.strictEqual(g.TRACK[G.pos[2]], 2); assert(posOf(3) === g.FINISH);
    assert.deepStrictEqual(g.raceScores(G), [11, 0, 0]);
    G.finisher = null; G.hands = [[0, 1, 2], [], []];                // 3 張紅、紅在 -1：-3 → 算 0
    assert.deepStrictEqual(g.raceScores(G), [0, 0, 0], '負分算 0');
}

// 出牌：輪錯人、牌不在手上、彩虹沒選顏色都不行；跑超過終點停在終點
{
    const G = g.newGame([{ name: 'a' }, { name: 'b' }, { name: 'c' }], g.PRESETS.kid);
    assert.strictEqual(G.hands[0].length, 15);
    assert.strictEqual(new Set(G.hands.flat()).size, 45, '發出去的牌不重複');
    const other = G.hands[1][0];
    assert(!g.play(G, 1, other), '還沒輪到');
    assert(!g.play(G, 0, other), '不是自己的牌');
    G.hands[0][0] = 44;                                               // 塞一張彩虹
    assert(!g.play(G, 0, 44), '彩虹要選顏色');
    assert(!g.play(G, 0, 44, 'purple'));
    assert(g.play(G, 0, 44, 'green'));
    assert.strictEqual(G.pos[2], 1); assert.strictEqual(G.turn, 1); assert.strictEqual(G.t, 1);
    G.pos[3] = 13; G.hands[1][0] = 40;                                // 藍在倒數第二格，打藍色跑牌
    assert(g.play(G, 1, 40));
    assert.strictEqual(G.pos[3], g.FINISH, '跑超過也停在終點');
    assert.strictEqual(G.finisher, 1);
    assert.strictEqual(G.phase, 'raceEnd');
    assert(!g.play(G, 2, G.hands[2][0]), '結束後不能再出');
    assert(g.nextRace(G));
    assert.strictEqual(G.starter, 1, '第二場由左手邊（下一位）先出');
    assert.deepStrictEqual(G.pos, [0, 0, 0, 0]);
}

// 整局模擬：每種人數 × 電腦等級，一定會有人到終點、場數對、總分＝每場加總、手牌數對
for (let t = 0; t < 600; t++) {
    const n = 3 + (t % 3), lvl = t % 2 ? 'smart' : 'easy';
    const set = t % 4 === 0 ? g.PRESETS.elder : g.PRESETS.adult;
    const G = g.newGame(Array.from({ length: n }, (_, i) => ({ name: 'p' + i, bot: lvl })), set);
    assert.strictEqual(G.hands[0].length, g.HAND_SIZE[n]);
    let guard = 0;
    while (G.phase !== 'end') {
        if (G.phase === 'raceEnd') { g.nextRace(G); continue; }
        const m = g.botMove(G, G.turn);
        assert(g.play(G, G.turn, m.id, m.color), '電腦出的牌一定合法');
        assert(++guard < 1000);
    }
    assert.strictEqual(G.history.length, set.races === 'one' ? 1 : n);
    G.history.forEach((h) => assert(h.finisher !== null, '每場都有人到終點'));
    const sum = G.seats.map((_, i) => G.history.reduce((s, h) => s + h.scores[i], 0));
    assert.deepStrictEqual(G.totals, sum);
    G.totals.forEach((x) => assert(x >= 0));
    const r = g.ranking(G);
    for (let i = 1; i < r.length; i++) assert(G.totals[r[i - 1]] >= G.totals[r[i]]);
}

// 同分比最後一場
{
    const G = { seats: [{}, {}, {}], totals: [10, 10, 3], history: [{ scores: [6, 2, 0] }, { scores: [4, 8, 3] }] };
    assert.deepStrictEqual(g.ranking(G), [1, 0, 2]);
}

// 會算分的電腦：明顯該出的牌要會出（手上 2 張藍、1 張紅，紅出掉比較好）
{
    const G = { seats: [{ bot: 'smart' }], hands: [[33, 34, 0]], pos: [5, 5, 5, 11] };
    for (let i = 0; i < 20; i++) assert.strictEqual(g.botMove(G, 0).id, 0);
}

assert(g.catSVG('red').includes('#d9402b'));
assert(g.catSVG('rainbow').includes('#3b7dd8') && g.catSVG('rainbow').includes('#e8b923'));
assert.strictEqual((g.trackHTML([0, 0, 14, 3]).match(/class="cell/g) || []).length, 15);
assert(g.cardHTML(0, { pos: [3, 0, 0, 0] }).includes('-1 分'));

// 瀏覽器裡各 <script> 共用全域，撞名整頁會掛；接起來編譯一次就抓得到
const fs = require('fs'), vm = require('vm');
for (const page of fs.readdirSync('.').filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(page, 'utf8');
    const srcs = [...html.matchAll(/<script src="(game|sync)\.js[^"]*">/g)].map((m) => fs.readFileSync(m[1] + '.js', 'utf8'));
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    new vm.Script([...srcs, ...inline].join('\n;\n'), { filename: page });
}
console.log('all tests passed');
