// ローマ字入力の打ち方の一覧（お題のかなを打てるローマ字の並び）と、ローマ字をかなに直す関数。判定そのものは js/typer.js
//   - 打ち方の一覧は「かな → キーの並び」の表から作る。先に書いた打ち方を手引きに使う
//   - 「ん」は次のかなが母音・ナ行・ヤ行で始まらなければ n 1つでもよい
//   - 「っ」は次のかなの最初の子音を重ねてもよい（kka など）
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

  // ---- ローマ字の文字列をかなに直す（かな配列の割り当て表をローマ字で書いたときに使う） ----

  // ローマ字 → かな。上の表を逆に引く。表にない記号と、割り当て表で使われる書き方（txu = っ）も足す
  // （txu はタイピング画面のローマ字の判定では受け付けない。割り当て表を読むときだけ）
  const TO_KANA = { "n'": "ん", "/": "・", "[": "「", "]": "」", "~": "〜", "txu": "っ" };
  Object.keys(TABLE).forEach(function (kana) {
    TABLE[kana].forEach(function (r) { if (!(r in TO_KANA)) TO_KANA[r] = kana; });
  });
  const TO_KANA_MAX = Object.keys(TO_KANA).reduce(function (m, r) { return Math.max(m, r.length); }, 0);

  // ふつうのローマ字入力と同じ決まりで、ローマ字の文字列 s をかなに直す（例 "xtu" → "っ"、"kya" → "きゃ"）
  //   - 長く一致する書き方を先に使う
  //   - n の次が母音・y・n・' でなければ（最後の n も）「ん」
  //   - 同じ子音が2つ続いたら（n を除く）、前の1つは「っ」
  // 直せないときは null
  function toKana(s) {
    s = s.toLowerCase();
    let out = "";
    let i = 0;
    while (i < s.length) {
      let hit = null;
      for (let len = Math.min(TO_KANA_MAX, s.length - i); len > 0; len--) {
        const part = s.substr(i, len);
        if (part in TO_KANA) { hit = part; break; }
      }
      if (hit) {
        out += TO_KANA[hit];
        i += hit.length;
      } else if (s[i] === "n" && !/[aiueoyn']/.test(s[i + 1] || "")) {
        out += "ん";
        i += 1;
      } else if (/[a-z]/.test(s[i]) && !/[aiueon]/.test(s[i]) && s[i + 1] === s[i]) {
        out += "っ";
        i += 1;
      } else {
        return null;
      }
    }
    return out;
  }

  return { options: options, toKana: toKana };
})();
