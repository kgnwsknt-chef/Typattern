// 物理キーの番号と、US キーボードの文字。e.code（押したキーの物理的な位置）から求める
// 番号は「行＋列」の2桁。行は数字の行 0・Q の行 1・A の行 2・Z の行 3・スペースの行 4。
// 列は16進数で、「1」= 01、Q = 11、A = 21、Z = 31。決まりは docs/japanese-input.md
const Keys = (function () {
  "use strict";

  // [e.code, 番号, US の文字, Shift を押したときの US の文字]。文字のないキーは null
  const TABLE = [
    ["Backquote", "00", "`", "~"],
    ["Digit1", "01", "1", "!"], ["Digit2", "02", "2", "@"], ["Digit3", "03", "3", "#"],
    ["Digit4", "04", "4", "$"], ["Digit5", "05", "5", "%"], ["Digit6", "06", "6", "^"],
    ["Digit7", "07", "7", "&"], ["Digit8", "08", "8", "*"], ["Digit9", "09", "9", "("],
    ["Digit0", "0a", "0", ")"], ["Minus", "0b", "-", "_"], ["Equal", "0c", "=", "+"],
    ["Backspace", "0d", null, null],
    ["KeyQ", "11", "q", "Q"], ["KeyW", "12", "w", "W"], ["KeyE", "13", "e", "E"],
    ["KeyR", "14", "r", "R"], ["KeyT", "15", "t", "T"], ["KeyY", "16", "y", "Y"],
    ["KeyU", "17", "u", "U"], ["KeyI", "18", "i", "I"], ["KeyO", "19", "o", "O"],
    ["KeyP", "1a", "p", "P"], ["BracketLeft", "1b", "[", "{"], ["BracketRight", "1c", "]", "}"],
    ["Backslash", "1d", "\\", "|"],
    // JIS の ¥ キーは、US の \ のキー（1d）として読む
    ["IntlYen", "1d", "\\", "|"],
    ["KeyA", "21", "a", "A"], ["KeyS", "22", "s", "S"], ["KeyD", "23", "d", "D"],
    ["KeyF", "24", "f", "F"], ["KeyG", "25", "g", "G"], ["KeyH", "26", "h", "H"],
    ["KeyJ", "27", "j", "J"], ["KeyK", "28", "k", "K"], ["KeyL", "29", "l", "L"],
    ["Semicolon", "2a", ";", ":"], ["Quote", "2b", "'", "\""],
    ["ShiftLeft", "30", null, null],
    ["KeyZ", "31", "z", "Z"], ["KeyX", "32", "x", "X"], ["KeyC", "33", "c", "C"],
    ["KeyV", "34", "v", "V"], ["KeyB", "35", "b", "B"], ["KeyN", "36", "n", "N"],
    ["KeyM", "37", "m", "M"], ["Comma", "38", ",", "<"], ["Period", "39", ".", ">"],
    ["Slash", "3a", "/", "?"],
    // JIS の「ろ」キーは / の右なので 3b
    ["IntlRo", "3b", null, null],
    ["ShiftRight", "3c", null, null],
    // スペースの行は JIS の並び（Ctrl 41・Win 42・Alt 43・無変換 44・スペース 45）で数える（仮）
    ["Space", "45", " ", " "]
  ];

  const byCode = {};
  TABLE.forEach(function (row) {
    byCode[row[0]] = { number: row[1], plain: row[2], shifted: row[3] };
  });

  // 物理キーの番号（"11" など）。表にないキー（Ctrl・矢印など）は null
  function number(code) {
    return byCode[code] ? byCode[code].number : null;
  }

  // そのキーで入力される US キーボードの文字。文字のないキーは null
  function char(code, shift) {
    const k = byCode[code];
    if (!k) return null;
    return shift ? k.shifted : k.plain;
  }

  function isShift(code) {
    return code === "ShiftLeft" || code === "ShiftRight";
  }

  return { number: number, char: char, isShift: isShift, BACKSPACE: "0d" };
})();
