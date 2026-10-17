// Firebase 同步層：匿名登入拿 uid，玩家資料以 uid 為 key
// 規則（database.rules.json）靠 uid 限制：玩家只能寫自己的 players / answers，state 與 scores 只有主控端能寫
const ROOM = 'hedgehogs-main';
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const room = db.ref('rooms/' + ROOM);

// 計時一律用伺服器時間戳；各裝置時鐘不準，用 serverTimeOffset 校正
let serverOffset = 0;
db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });
const serverNow = () => Date.now() + serverOffset;

// 匿名登入的 uid 存在瀏覽器裡，重新整理／斷線重進還是同一個人，分數自然沿用
function signIn() {
    return firebase.auth().signInAnonymously().then((cred) => cred.user.uid);
}

// 玩家名稱來自資料庫，放進畫面前一律跳脫
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 濾掉 Firebase key 不允許的 . # $ [ ] /，順便限制長度
function cleanName(s) {
    return String(s ?? '').replace(/[.#$\[\]\/]/g, '').trim().slice(0, 12);
}
