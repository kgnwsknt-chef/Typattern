// ノーミス連続タイプ：ミスなしでどこまで続けて打てるかを数えるモード。決まりは docs/no-mistype.md
// お題の単語の選び方（何語目かで単語リストを広げる）と、自己ベストの求め方（タイピング画面と記録のページで使う）
const NoMistype = (function () {
  "use strict";

  const MODE = "no-mistype";
  const CHUNK = 40;        // 単語の並びから一度に作る単語の数
  const ROWS = 4;          // お題を見せる段の数（行を 1・2・3・4・1 …の段に順に入れる）
  const FIRST_LINES = 8;   // はじめに作る行の数
  const MORE_LINES = 4;    // 足すときに作る行の数
  const AHEAD_CHARS = 200; // 打っている位置からお題の終わりまでがこの文字数より短くなったら、行を足す
  const RECENT = 50;       // 同じ単語を、この語数のあいだは重ねない

  // 何語目（1 から）の単語を、どの単語リストから選ぶか（日本語）。英語は最初から最後まで単語モードの単語リスト
  //   basic：単語モードの単語リスト（wordlists/ja/）、a〜d：キー配列習得の単語リスト A〜D（wordlists/layout-learning/）
  const STAGES = [
    { upTo: 20, lists: ["a"] },
    { upTo: 100, lists: ["a", "b"] },
    { upTo: 200, lists: ["a", "b", "c"] },
    { upTo: Infinity, lists: ["basic", "a", "b", "c", "d"] }
  ];

  // 単語の並びを作るもの。pools は { basic, a, b, c, d } → 単語の並び（英語は basic だけ）
  //   next(n)：続きの n 語。同じ単語は RECENT 語のあいだ重ねない（候補が少なくて選べなければ重ねる）
  function stream(pools) {
    let count = 0; // ここまでに出した単語の数
    const recent = [];
    const key = function (w) { return typeof w === "string" ? w : w.reading; };
    function poolFor(index) {
      const stage = STAGES.find(function (s) { return index <= s.upTo; });
      let list = [].concat.apply([], stage.lists.map(function (k) { return pools[k] || []; }));
      // 配列にないかなを含む語を除いたら空になった段は、使える単語リストを全部使う
      if (!list.length) list = [].concat.apply([], ["basic", "a", "b", "c", "d"].map(function (k) { return pools[k] || []; }));
      return list;
    }
    return {
      next: function (n) {
        const out = [];
        for (let i = 0; i < n; i++) {
          const pool = poolFor(count + 1);
          if (!pool.length) break;
          let w = null;
          for (let tries = 0; tries < 20; tries++) {
            const c = pool[Math.floor(Math.random() * pool.length)];
            if (recent.indexOf(key(c)) === -1) { w = c; break; }
          }
          if (w === null) w = pool[Math.floor(Math.random() * pool.length)];
          recent.push(key(w));
          if (recent.length > RECENT) recent.shift();
          out.push(w);
          count++;
        }
        return out;
      },
      get count() { return count; }
    };
  }

  // 言語ごとの自己ベスト（文字数の一番多い回。同じなら時間の短い回）。なければ null
  function best(sessions, lang) {
    let b = null;
    sessions.forEach(function (s) {
      if (s.mode !== MODE || s.lang !== lang) return;
      if (!b || s.textLength > b.textLength || (s.textLength === b.textLength && s.result.timeSec < b.result.timeSec)) b = s;
    });
    return b;
  }

  return { MODE: MODE, CHUNK: CHUNK, ROWS: ROWS, FIRST_LINES: FIRST_LINES, MORE_LINES: MORE_LINES, AHEAD_CHARS: AHEAD_CHARS, stream: stream, best: best };
})();
