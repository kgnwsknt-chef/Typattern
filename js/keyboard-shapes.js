// キーボードの物理的な形（配列図の外形）。配列のページで選ぶ
// 各キーは e.code（押したキーの物理的な位置）と幅（1 = ふつうのキー1個分）で表す。
// 物理キーの番号と文字は js/keys.js から求める。番号のないキー（Tab・Ctrl など）は name を書く
const KeyboardShapes = (function () {
  "use strict";

  // [e.code, 幅, 番号のないキーの名前]
  const US_ROW_STAGGER = [
    [["Backquote", 1], ["Digit1", 1], ["Digit2", 1], ["Digit3", 1], ["Digit4", 1], ["Digit5", 1], ["Digit6", 1],
      ["Digit7", 1], ["Digit8", 1], ["Digit9", 1], ["Digit0", 1], ["Minus", 1], ["Equal", 1], ["Backspace", 2, "Back"]],
    [["Tab", 1.5, "Tab"], ["KeyQ", 1], ["KeyW", 1], ["KeyE", 1], ["KeyR", 1], ["KeyT", 1], ["KeyY", 1], ["KeyU", 1],
      ["KeyI", 1], ["KeyO", 1], ["KeyP", 1], ["BracketLeft", 1], ["BracketRight", 1], ["Backslash", 1.5]],
    [["CapsLock", 1.75, "Caps"], ["KeyA", 1], ["KeyS", 1], ["KeyD", 1], ["KeyF", 1], ["KeyG", 1], ["KeyH", 1], ["KeyJ", 1],
      ["KeyK", 1], ["KeyL", 1], ["Semicolon", 1], ["Quote", 1], ["Enter", 2.25, "Enter"]],
    [["ShiftLeft", 2.25, "Shift"], ["KeyZ", 1], ["KeyX", 1], ["KeyC", 1], ["KeyV", 1], ["KeyB", 1], ["KeyN", 1], ["KeyM", 1],
      ["Comma", 1], ["Period", 1], ["Slash", 1], ["ShiftRight", 2.75, "Shift"]],
    [["ControlLeft", 1.25, "Ctrl"], ["MetaLeft", 1.25, "Win"], ["AltLeft", 1.25, "Alt"], ["Space", 6.25, "Space"],
      ["AltRight", 1.25, "Alt"], ["MetaRight", 1.25, "Win"], ["ContextMenu", 1.25, "Menu"], ["ControlRight", 1.25, "Ctrl"]]
  ];

  // 形の一覧。今はロースタッガード（行ごとに横にずれた、ふつうのキーボード）の US 配列だけ
  const SHAPES = [
    { id: "us-row-stagger", name: "ロースタッガード（US）", rows: US_ROW_STAGGER }
  ];

  // 形を、配列図に描くためのキーの一覧 { code, x, y, w, name } と全体の大きさ { width, height } にする
  function layout(id) {
    const shape = SHAPES.filter(function (s) { return s.id === id; })[0] || SHAPES[0];
    const keys = [];
    let width = 0;
    shape.rows.forEach(function (row, y) {
      let x = 0;
      row.forEach(function (k) {
        keys.push({ code: k[0], x: x, y: y, w: k[1], name: k[2] || null });
        x += k[1];
      });
      width = Math.max(width, x);
    });
    return { id: shape.id, keys: keys, width: width, height: shape.rows.length };
  }

  return { SHAPES: SHAPES, layout: layout };
})();
