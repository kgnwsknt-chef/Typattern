// キーごとの値を、キー配列のページと同じ形の配列図に色で描く（ミスタイプのページ・IKI のページで使う）
//   各キーの左上に物理キーの番号、右上に QWERTY の文字（文字のないキーは下の段に名前）、右下に値を書く。
//   かな配列 kana を渡すと、キーの真ん中にそのキーだけを押したときのかなを書き、前置・後置シフトのキーを外形線の色で示す
const KeyMap = (function () {
  "use strict";

  const UNIT = 44; // キー1個分の大きさ(px)。キー配列のページと同じ
  const GAP = 4;   // キーどうしの隙間(px)
  const SHIFT_MIN = 5; // かな配列のシフトのキーの求め方（キー配列のページと同じ）
  const shape = KeyboardShapes.layout("us-row-stagger");

  function span(className, text) {
    const s = document.createElement("span");
    s.className = className;
    s.textContent = text;
    return s;
  }

  // 登録したかな配列から、配列図に書くための { get, shifts } を作る（KanaLayout.create の結果を渡す）
  function kanaOf(k) {
    return { get: k.get, shifts: k.shiftKeys(SHIFT_MIN) };
  }

  // el に配列図を描く。cell(number) は { fill, value, title, dark, dim } か null（色を付けないキー）
  //   kana：kanaOf の結果か null（QWERTY だけを書く）
  function draw(el, cell, kana) {
    el.textContent = "";
    el.style.width = shape.width * UNIT + "px";
    el.style.height = shape.height * UNIT + "px";
    el.classList.add("km");
    el.classList.toggle("km-kana", !!kana);
    shape.keys.forEach(function (k) {
      const key = document.createElement("div");
      key.className = "kb-key";
      key.style.left = k.x * UNIT + GAP / 2 + "px";
      key.style.top = k.y * UNIT + GAP / 2 + "px";
      key.style.width = k.w * UNIT - GAP + "px";
      key.style.height = UNIT - GAP + "px";
      const number = Keys.number(k.code);
      const plain = Keys.char(k.code, false);
      const c = number ? cell(number) : null;
      const func = plain === null || plain === " ";
      if (number) key.appendChild(span("kb-num", number));
      key.appendChild(span("km-char", func ? (k.name || "") : plain));
      if (func) key.classList.add("km-func");
      if (kana && !func) {
        const kc = kana.get(plain);
        if (kc) key.appendChild(span("km-kana-char", kc));
        if (kana.shifts.prefix.indexOf(plain) !== -1) key.classList.add("kb-prefix");
        if (kana.shifts.postfix.indexOf(plain) !== -1) key.classList.add("kb-postfix");
      }
      if (c) {
        if (c.fill) key.style.background = c.fill;
        if (c.dark) key.classList.add("km-dark");
        key.appendChild(span("km-val" + (c.dim ? " km-dim" : ""), c.value));
        key.title = c.title;
      } else if (!number) {
        key.classList.add("km-none"); // 記録しないキー（Tab・Ctrl など）
      }
      el.appendChild(key);
    });
  }

  return { draw: draw, kanaOf: kanaOf };
})();
