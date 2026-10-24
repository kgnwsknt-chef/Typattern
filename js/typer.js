// 日本語の入力の判定（ローマ字・かな配列で共通）。お題のかなに合う打ち方だけを正解とする（決まりは docs/measurement.md）
// 打ち方の一覧を作る関数 optionsFn(text, pos) だけを入力方式ごとに差し替える
//   ローマ字：Romaji.options（js/romaji.js）、かな配列：割り当て表の options（js/kana-layout.js）
//   一覧の各要素 { seq: キーの並び（US の QWERTY の文字）, len: 確定するかなの数, doubled: ローマ字の「っ」の重ねの子音 }
//   - どの打ち方の続きにもならないキーを押したら、今のかなを間違いとして確定し、次のかなに進む
//   - 打ち方が1つもないかな（かな配列の割り当て表にないかな）は、そこまで進んだときに間違いとして確定して飛ばす
const Typer = (function () {
  "use strict";

  // 打ち方の一覧を、前のかなの「っ」の重ねに合わせて絞る（kka の2つ目の k から始まるものだけ）
  function constrain(opts, doubled) {
    if (!doubled) return opts;
    return opts.filter(function (o) { return o.seq[0] === doubled; });
  }

  // お題1つ分の入力の状態を作る
  function create(text, optionsFn) {
    let pos = 0;           // 確定したかなの数（次に打つかなの位置）
    let pending = "";      // 今のかなに打ちかけのキー
    let pendingStart = null; // 打ちかけの最初のキーの直前のキーの時刻
    let lastTime = null;   // 直前のキー（Backspace を含む）の時刻
    let lastPendingTime = null; // 打ちかけの最後のキーの時刻
    let pendingKeys = [];  // 打ちかけのキー { ch, time, prev, wrong }（prev はその直前のキーの時刻、wrong は間違えたキーか）
    // 打ちかけに間違えたキーがあるときの打ち方（間違えたときの手引きの打ち方）。そのかなを打ち終えるまでこの打ち方の位置で進める
    let locked = null;
    // 確定したかなのまとまり { pos, len, keys, keyList, correct, doubled, skipped, time, prevTime }
    // skipped：打ち方がないので飛ばしたかな（間違いとして確定。keys は空）
    const units = [];

    function current() {
      const prev = units[units.length - 1];
      const doubled = prev && prev.correct && prev.pos + prev.len === pos ? prev.doubled : null;
      return constrain(optionsFn(text, pos), doubled);
    }

    // 今のかなを確定する。time はそのかなの最後のキーの時刻
    function confirm(len, keys, correct, doubled, time) {
      const u = { pos: pos, len: len, keys: keys, keyList: pendingKeys, correct: correct, doubled: correct ? doubled : undefined, time: time, prevTime: pendingStart };
      pendingKeys = [];
      units.push(u);
      pos += len;
      pending = "";
      pendingStart = null;
      lastPendingTime = null;
      locked = null;
      return u;
    }

    // 打ち方がないかなを、間違いとして確定して飛ばす。time は飛ばすきっかけになったキーの時刻
    function skipUntypable(time, confirmed) {
      while (pos < text.length && !pending && optionsFn(text, pos).length === 0) {
        const u = confirm(1, "", false, null, time);
        u.skipped = true;
        u.prevTime = null;
        confirmed.push(u);
      }
    }

    // キーを1つ押す。ch は US キーボードの文字、time は押した時刻
    // 返り値 { pos: このキーを当てたかなの位置, judge: 正解 1・ミス 0, confirmed: このキーで確定したまとまり（飛ばしたかなを含む） }
    function press(ch, time) {
      const confirmed = [];
      skipUntypable(time, confirmed);
      let opts = current();
      if (pending && !locked && !opts.some(function (o) { return o.seq.indexOf(pending + ch) === 0; })) {
        // 打ちかけがそれだけで完成していれば（ん の n など）、それを確定してから次のかなに当てる
        const done = opts.filter(function (o) { return o.seq === pending; })[0];
        if (done) {
          confirmed.push(confirm(done.len, pending, true, done.doubled, lastPendingTime));
          skipUntypable(time, confirmed);
          opts = current();
        }
      }
      const at = pos;
      if (pos >= text.length) {
        // 飛ばしたかなでお題が終わった（このキーは当てるかながない）
        lastTime = time;
        return { pos: at, judge: 0, confirmed: confirmed };
      }
      const key = { ch: ch, time: time, prev: lastTime };
      if (pending === "") pendingStart = lastTime;
      const s = pending + ch;
      let judge;
      if (locked) {
        // 打ちかけに間違えたキーがある：決めた打ち方の次のキーと比べ、キー1つ分進める。打ち方の長さまで打ったら、間違いとして確定する
        judge = ch === locked.seq[pending.length] ? 1 : 0;
        key.wrong = judge === 0;
        pending = s;
        pendingKeys.push(key);
        lastPendingTime = time;
        if (s.length >= locked.seq.length) confirmed.push(confirm(locked.len, s, false, null, time));
      } else if (opts.some(function (o) { return o.seq.indexOf(s) === 0; })) {
        judge = 1;
        pending = s;
        pendingKeys.push(key);
        lastPendingTime = time;
        // 打ち方が完成し、それより長い打ち方の途中でもなければ確定する
        const exact = opts.filter(function (o) { return o.seq === s; })[0];
        const longer = opts.some(function (o) { return o.seq.length > s.length && o.seq.indexOf(s) === 0; });
        if (exact && !longer) confirmed.push(confirm(exact.len, s, true, exact.doubled, time));
      } else {
        // どの打ち方の続きにもならない：打つべきだったキー1つ分のミスとして進める（docs/measurement.md の「間違い」）。
        // 打ち方は、正しく打った途中までに続く手引きの打ち方に決め、そのかなを打ち終えるまで変えない
        judge = 0;
        key.wrong = true;
        locked = opts.filter(function (o) { return o.seq.indexOf(pending) === 0; })[0] || null;
        pending = s;
        pendingKeys.push(key);
        lastPendingTime = time;
        if (!locked || s.length >= locked.seq.length) confirmed.push(confirm(locked ? locked.len : 1, s, false, null, time));
      }
      skipUntypable(time, confirmed);
      lastTime = time;
      return { pos: at, judge: judge, confirmed: confirmed };
    }

    // Backspace。打ちかけがあればキーを1つ消し、なければ最後に確定したかなを1文字消す（IME と同じ）。
    // 「しゃ」のように2文字以上まとめて打ったまとまりは、後ろの1文字だけ消す。キーは残ったかなのまとまりに残す（かなごとに分けられないため）
    // 最後が飛ばしたかなのときは、飛ばしたかなと、その前に打ったかな1文字を一緒に消す（飛ばしたかなだけ消しても、また飛ばすため）
    // 返り値は消したまとまりの一覧（前から順。打ちかけのキーを消したときは空）。後ろの1文字だけ消したときは、その1文字の { pos, len: 1 }
    function backspace(time) {
      lastTime = time;
      if (pending) {
        pending = pending.slice(0, -1);
        pendingKeys.pop();
        lastPendingTime = pendingKeys.length ? pendingKeys[pendingKeys.length - 1].time : null;
        if (!pending) pendingStart = null;
        // 間違えたキーがなくなれば、またどの打ち方でも打てる
        if (!pendingKeys.some(function (k) { return k.wrong; })) locked = null;
        return [];
      }
      const removed = [];
      while (units.length && units[units.length - 1].skipped) removed.unshift(units.pop());
      if (units.length) {
        const last = units[units.length - 1];
        if (last.len > 1) {
          last.len--;
          removed.unshift({ pos: last.pos + last.len, len: 1, keys: "", keyList: [], correct: last.correct });
        } else {
          removed.unshift(units.pop());
        }
      }
      if (removed.length) pos = removed[0].pos;
      return removed;
    }

    // 手引き：{ typed: 打ちかけ, rest: 今のかなの残り, ahead: その先の打ち方 }
    function guide(maxAhead) {
      const opts = current();
      const o = locked || opts.filter(function (x) { return x.seq.indexOf(pending) === 0; })[0]; // 間違えたキーがあれば決めた打ち方
      if (!o) return { typed: pending, rest: "", ahead: "" };
      let ahead = "";
      let p = pos + o.len;
      let doubled = o.doubled;
      while (p < text.length && ahead.length < maxAhead) {
        const n = constrain(optionsFn(text, p), doubled)[0];
        if (!n) break;
        ahead += n.seq;
        p += n.len;
        doubled = n.doubled;
      }
      return { typed: pending, rest: o.seq.slice(pending.length), ahead: ahead };
    }

    // お題のかなごとのキーの並び（お題の2行目をローマ字で出すのに使う）。長さはお題と同じ
    //   正しく打ち終えたかなは実際に打ったキー、これから打つかなは手引きと同じ打ち方。まとめて打つかな（しゃ = sha）は最初のかなに並び全体、残りは ""
    //   間違えたかなは、そのかな1文字の打ち方（手引きと同じく一覧の最初。打ったキーは画面でその上に出す）
    function plan() {
      const out = new Array(text.length).fill("");
      units.forEach(function (u) {
        if (u.correct || u.skipped) {
          out[u.pos] = u.keys;
          return;
        }
        const opts = optionsFn(text, u.pos);
        const one = opts.filter(function (o) { return o.len === 1; })[0] || opts[0];
        out[u.pos] = one ? one.seq : u.keys;
      });
      let o = locked || current().filter(function (x) { return x.seq.indexOf(pending) === 0; })[0];
      let p = pos;
      while (o && p < text.length) {
        out[p] = o.seq;
        p += o.len;
        o = constrain(optionsFn(text, p), o.doubled)[0];
      }
      return out;
    }

    // 次に押すと正解になるキー（US キーボードの文字）の一覧と、手引きが示すキー（ミスタイプのページで使う）
    //   keys：正解になるキーすべて。preferred：手引きの打ち方で次に押すキー。next：その次のキー（なければ null）。pending：今のかなに打ちかけのキー
    //   打ち方がないかな（かな配列にないかな）は、press と同じく飛ばした先のかなで考える
    function expect() {
      if (locked) {
        // 打ちかけに間違えたキーがある：決めた打ち方の次のキーだけが正解
        const c = locked.seq[pending.length];
        let after = locked.seq[pending.length + 1];
        if (after === undefined) {
          const n = constrain(optionsFn(text, pos + locked.len), null)[0];
          after = n ? n.seq[0] : null;
        }
        return { keys: [c], preferred: c, next: after, pending: pending };
      }
      let p = pos;
      if (!pending) while (p < text.length && optionsFn(text, p).length === 0) p++;
      if (p >= text.length) return { keys: [], preferred: null, next: null, pending: pending };
      const opts = p === pos ? current() : optionsFn(text, p);
      const keys = [];
      let preferred = null;
      let next = null;
      opts.forEach(function (o) {
        if (o.seq.indexOf(pending) !== 0 || o.seq.length <= pending.length) return;
        const c = o.seq[pending.length];
        if (keys.indexOf(c) === -1) keys.push(c);
        if (preferred === null) {
          // 手引きと同じ打ち方（条件に合う最初のもの）
          preferred = c;
          const rest = o.seq.slice(pending.length);
          if (rest.length > 1) next = rest[1];
          else {
            const n = constrain(optionsFn(text, p + o.len), o.doubled)[0];
            next = n ? n.seq[0] : null;
          }
        }
      });
      // 打ちかけだけで完成している打ち方（「ん」の n など）があれば、次のかなの始まりのキーも正解
      const done = pending ? opts.filter(function (o) { return o.seq === pending; })[0] : null;
      if (done) {
        constrain(optionsFn(text, p + done.len), done.doubled).forEach(function (o) {
          if (keys.indexOf(o.seq[0]) === -1) keys.push(o.seq[0]);
        });
      }
      return { keys: keys, preferred: preferred, next: next, pending: pending };
    }

    return {
      press: press,
      backspace: backspace,
      guide: guide,
      plan: plan,
      expect: expect,
      units: units,
      get pos() { return pos; },
      get pending() { return pending; },
      // 打ちかけに間違えたキーがあるか（画面で、打ちかけのかなの上に打ったキーを出すのに使う）
      get pendingWrong() { return locked !== null; },
      done: function () { return pos >= text.length; }
    };
  }

  // 読み text を手引きの打ち方（それぞれのかなの一覧の最初）で打ったときのキーの並び。打てないかながあれば null
  // （他では速い bigram の練習で、bigram を含む単語を探すのに使う。docs/weak-words.md）
  function keysOf(text, optionsFn) {
    let out = "";
    let p = 0;
    let doubled;
    while (p < text.length) {
      const o = constrain(optionsFn(text, p), doubled)[0];
      if (!o) return null;
      out += o.seq;
      p += o.len;
      doubled = o.doubled;
    }
    return out;
  }

  return { create: create, keysOf: keysOf };
})();
