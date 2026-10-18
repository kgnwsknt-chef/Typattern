// ローマ字入力の判定。お題のかなに合う打ち方だけを正解とする（決まりは docs/japanese-input.md）
//   - 打ち方の一覧は「かな → キーの並び」の表から作る。先に書いた打ち方を手引きに使う
//   - 「ん」は次のかなが母音・ナ行・ヤ行で始まらなければ n 1つでもよい
//   - 「っ」は次のかなの最初の子音を重ねてもよい（kka など）
//   - どの打ち方の続きにもならないキーを押したら、今のかなを間違いとして確定し、次のかなに進む
const Romaji = (function () {
  "use strict";

  // かな（1文字または2文字） → 打ち方。「|」で区切り、打ち方は空白で区切る（「、」の打ち方が「,」のため）
  const SOURCE =
    "あ:a|い:i yi|う:u wu whu|え:e|お:o|" +
    "か:ka ca|き:ki|く:ku cu qu|け:ke|こ:ko co|" +
    "さ:sa|し:shi si ci|す:su|せ:se ce|そ:so|" +
    "た:ta|ち:chi ti|つ:tsu tu|て:te|と:to|" +
    "な:na|に:ni|ぬ:nu|ね:ne|の:no|" +
    "は:ha|ひ:hi|ふ:fu hu|へ:he|ほ:ho|" +
    "ま:ma|み:mi|む:mu|め:me|も:mo|" +
    "や:ya|ゆ:yu|よ:yo|" +
    "ら:ra|り:ri|る:ru|れ:re|ろ:ro|" +
    "わ:wa|を:wo|ん:nn xn|" +
    "が:ga|ぎ:gi|ぐ:gu|げ:ge|ご:go|" +
    "ざ:za|じ:ji zi|ず:zu|ぜ:ze|ぞ:zo|" +
    "だ:da|ぢ:di|づ:du|で:de|ど:do|" +
    "ば:ba|び:bi|ぶ:bu|べ:be|ぼ:bo|" +
    "ぱ:pa|ぴ:pi|ぷ:pu|ぺ:pe|ぽ:po|ゔ:vu|" +
    "ぁ:xa la|ぃ:xi li xyi lyi|ぅ:xu lu|ぇ:xe le xye lye|ぉ:xo lo|" +
    "ゃ:xya lya|ゅ:xyu lyu|ょ:xyo lyo|っ:xtu ltu xtsu ltsu|ゎ:xwa lwa|" +
    "ー:-|、:,|。:.|" +
    "きゃ:kya|きぃ:kyi|きゅ:kyu|きぇ:kye|きょ:kyo|" +
    "しゃ:sha sya|しぃ:syi|しゅ:shu syu|しぇ:she sye|しょ:sho syo|" +
    "ちゃ:cha tya cya|ちぃ:tyi cyi|ちゅ:chu tyu cyu|ちぇ:che tye cye|ちょ:cho tyo cyo|" +
    "にゃ:nya|にぃ:nyi|にゅ:nyu|にぇ:nye|にょ:nyo|" +
    "ひゃ:hya|ひぃ:hyi|ひゅ:hyu|ひぇ:hye|ひょ:hyo|" +
    "みゃ:mya|みぃ:myi|みゅ:myu|みぇ:mye|みょ:myo|" +
    "りゃ:rya|りぃ:ryi|りゅ:ryu|りぇ:rye|りょ:ryo|" +
    "ぎゃ:gya|ぎぃ:gyi|ぎゅ:gyu|ぎぇ:gye|ぎょ:gyo|" +
    "じゃ:ja jya zya|じぃ:jyi zyi|じゅ:ju jyu zyu|じぇ:je jye zye|じょ:jo jyo zyo|" +
    "ぢゃ:dya|ぢぃ:dyi|ぢゅ:dyu|ぢぇ:dye|ぢょ:dyo|" +
    "びゃ:bya|びぃ:byi|びゅ:byu|びぇ:bye|びょ:byo|" +
    "ぴゃ:pya|ぴぃ:pyi|ぴゅ:pyu|ぴぇ:pye|ぴょ:pyo|" +
    "ふぁ:fa|ふぃ:fi fyi|ふぇ:fe fye|ふぉ:fo|ふゅ:fyu|" +
    "てぃ:thi|てゅ:thu|でぃ:dhi|でゅ:dhu|とぅ:twu|どぅ:dwu|" +
    "うぃ:wi|うぇ:we|うぉ:who|いぇ:ye|" +
    "ゔぁ:va|ゔぃ:vi|ゔぇ:ve|ゔぉ:vo|" +
    "くぁ:qa kwa|くぃ:qi|くぇ:qe|くぉ:qo|ぐぁ:gwa|" +
    "つぁ:tsa|つぃ:tsi|つぇ:tse|つぉ:tso|すぃ:swi";

  const TABLE = {};
  SOURCE.split("|").forEach(function (entry) {
    const i = entry.indexOf(":");
    TABLE[entry.slice(0, i)] = entry.slice(i + 1).split(" ");
  });

  // お題 text の pos 文字目から打てる打ち方の一覧 [{ seq, len, doubled }]。手引きに使う順に並べる
  //   seq：キーの並び、len：確定するかなの数、doubled：「っ」を子音の重ねで打つときのその子音
  function options(text, pos) {
    const res = [];
    const k = text[pos];
    if (k === undefined) return res;
    const two = text.substr(pos, 2);
    if (two.length === 2 && TABLE[two]) {
      TABLE[two].forEach(function (seq) { res.push({ seq: seq, len: 2 }); });
    }
    if (k === "っ") {
      // 次のかなの最初の子音を重ねる（母音と n は重ねられない）
      const seen = {};
      options(text, pos + 1).forEach(function (o) {
        const c = o.seq[0];
        if (/[a-z]/.test(c) && !/[aiueon]/.test(c) && !seen[c]) {
          seen[c] = true;
          res.push({ seq: c, len: 1, doubled: c });
        }
      });
    }
    if (k === "ん") {
      // 次のかなが母音・ナ行・ヤ行で始まらなければ n 1つでよい（お題の最後の「ん」は nn）
      const next = options(text, pos + 1);
      if (next.length > 0 && next.every(function (o) { return !/^[aiueoyn]/.test(o.seq); })) {
        res.push({ seq: "n", len: 1 });
      }
    }
    (TABLE[k] || []).forEach(function (seq) { res.push({ seq: seq, len: 1 }); });
    return res;
  }

  // 打ち方の一覧を、前のかなの「っ」の重ねに合わせて絞る（kka の2つ目の k から始まるものだけ）
  function constrain(opts, doubled) {
    if (!doubled) return opts;
    return opts.filter(function (o) { return o.seq[0] === doubled; });
  }

  // お題1つ分の入力の状態を作る
  function create(text) {
    let pos = 0;           // 確定したかなの数（次に打つかなの位置）
    let pending = "";      // 今のかなに打ちかけのキー
    let pendingStart = null; // 打ちかけの最初のキーの直前のキーの時刻
    let lastTime = null;   // 直前のキー（Backspace を含む）の時刻
    let lastPendingTime = null; // 打ちかけの最後のキーの時刻
    const units = [];      // 確定したかなのまとまり { pos, len, keys, correct, doubled, time, prevTime }

    function current() {
      const prev = units[units.length - 1];
      const doubled = prev && prev.correct && prev.pos + prev.len === pos ? prev.doubled : null;
      return constrain(options(text, pos), doubled);
    }

    // 今のかなを確定する。time はそのかなの最後のキーの時刻
    function confirm(len, keys, correct, doubled, time) {
      const u = { pos: pos, len: len, keys: keys, correct: correct, doubled: correct ? doubled : undefined, time: time, prevTime: pendingStart };
      units.push(u);
      pos += len;
      pending = "";
      pendingStart = null;
      lastPendingTime = null;
      return u;
    }

    // キーを1つ押す。ch は US キーボードの文字、time は押した時刻
    // 返り値 { pos: このキーを当てたかなの位置, judge: 正解 1・ミス 0, confirmed: このキーで確定したまとまり }
    function press(ch, time) {
      const confirmed = [];
      let opts = current();
      if (pending && !opts.some(function (o) { return o.seq.indexOf(pending + ch) === 0; })) {
        // 打ちかけがそれだけで完成していれば（ん の n など）、それを確定してから次のかなに当てる
        const done = opts.filter(function (o) { return o.seq === pending; })[0];
        if (done) {
          confirmed.push(confirm(done.len, pending, true, done.doubled, lastPendingTime));
          opts = current();
        }
      }
      const at = pos;
      if (pending === "") pendingStart = lastTime;
      const s = pending + ch;
      let judge;
      if (opts.some(function (o) { return o.seq.indexOf(s) === 0; })) {
        judge = 1;
        pending = s;
        lastPendingTime = time;
        // 打ち方が完成し、それより長い打ち方の途中でもなければ確定する
        const exact = opts.filter(function (o) { return o.seq === s; })[0];
        const longer = opts.some(function (o) { return o.seq.length > s.length && o.seq.indexOf(s) === 0; });
        if (exact && !longer) confirmed.push(confirm(exact.len, s, true, exact.doubled, time));
      } else {
        // どの打ち方の続きにもならない：今のかな1文字を間違いとして確定する
        judge = 0;
        confirmed.push(confirm(1, s, false, null, time));
      }
      lastTime = time;
      return { pos: at, judge: judge, confirmed: confirmed };
    }

    // Backspace。打ちかけがあればキーを1つ消し、なければ最後に確定したまとまりを消す
    // 返り値は消したまとまり（打ちかけのキーを消したときは null）
    function backspace(time) {
      lastTime = time;
      if (pending) {
        pending = pending.slice(0, -1);
        if (!pending) pendingStart = null;
        return null;
      }
      const u = units.pop();
      if (!u) return null;
      pos = u.pos;
      return u;
    }

    // 手引き：{ typed: 打ちかけ, rest: 今のかなの残り, ahead: その先の打ち方 }
    function guide(maxAhead) {
      const opts = current();
      const o = opts.filter(function (x) { return x.seq.indexOf(pending) === 0; })[0];
      if (!o) return { typed: pending, rest: "", ahead: "" };
      let ahead = "";
      let p = pos + o.len;
      let doubled = o.doubled;
      while (p < text.length && ahead.length < maxAhead) {
        const n = constrain(options(text, p), doubled)[0];
        if (!n) break;
        ahead += n.seq;
        p += n.len;
        doubled = n.doubled;
      }
      return { typed: pending, rest: o.seq.slice(pending.length), ahead: ahead };
    }

    return {
      press: press,
      backspace: backspace,
      guide: guide,
      units: units,
      get pos() { return pos; },
      get pending() { return pending; },
      done: function () { return pos >= text.length; }
    };
  }

  return { create: create, options: options };
})();
