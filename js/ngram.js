// n-gram（連続する n 文字。2=bigram、3=trigram）ごとの打鍵間隔(IKI)を集計して一覧表にする
const NGram = (function () {
  "use strict";

  // n 文字ごとの一覧表を1つ作る。並び順は表ごとに持ち、やり直しても維持する
  function create(n, label) {
    let rows = [];     // 集計結果 { gram, avg, count }
    let order = "asc"; // 平均 IKI の並び順
    let baseAvg = 0;   // 色の基準にする全体の平均間隔
    let containerEl = null;

    // container に一覧表を描く。avg は色の基準にする全体の平均間隔(ms)
    function render(container, target, intervals, missed, avg) {
      containerEl = container;
      rows = collect(n, target, intervals, missed);
      baseAvg = avg;
      draw();
      return rows.length;
    }

    function draw() {
      containerEl.textContent = "";
      if (rows.length === 0) {
        const p = document.createElement("p");
        p.className = "bg-empty";
        p.textContent = "対象になる " + label + " がありません。";
        containerEl.appendChild(p);
        return;
      }

      const sign = order === "asc" ? 1 : -1;
      rows.sort(function (x, y) {
        return sign * (x.avg - y.avg) || y.count - x.count || (x.gram < y.gram ? -1 : 1);
      });

      const table = document.createElement("table");
      table.className = "bg-table";

      const head = document.createElement("thead");
      const hr = document.createElement("tr");
      hr.appendChild(th(label));
      const sortTh = th("");
      const sortBtn = document.createElement("button");
      sortBtn.type = "button";
      sortBtn.className = "bg-sort";
      sortBtn.textContent = "平均 IKI (ms) " + (order === "asc" ? "▲" : "▼");
      sortBtn.title = order === "asc" ? "速い順（クリックで遅い順）" : "遅い順（クリックで速い順）";
      sortBtn.addEventListener("click", function () {
        order = order === "asc" ? "desc" : "asc";
        draw();
      });
      sortTh.setAttribute("aria-sort", order === "asc" ? "ascending" : "descending");
      sortTh.appendChild(sortBtn);
      hr.appendChild(sortTh);
      hr.appendChild(th("回数"));
      head.appendChild(hr);
      table.appendChild(head);

      const body = document.createElement("tbody");
      rows.forEach(function (r) {
        const tr = document.createElement("tr");
        tr.appendChild(td("bg-name", r.gram));
        const avgTd = td("bg-avg", Math.round(r.avg));
        avgTd.style.color = Rhythm.color(r.avg, baseAvg);
        tr.appendChild(avgTd);
        tr.appendChild(td("bg-count", r.count));
        body.appendChild(tr);
      });
      table.appendChild(body);
      containerEl.appendChild(table);
    }

    return { render: render };
  }

  // お題と位置ごとの間隔・ミスから、n-gram ごとの平均 IKI と回数を求める
  // n-gram の IKI = 中の (n-1) 個の打鍵間隔の平均。ルールは docs/scoring.md を参照
  function collect(n, target, intervals, missed) {
    const map = new Map();
    for (let end = n - 1; end < target.length; end++) {
      const start = end - n + 1;
      let ok = true;
      let sum = 0;
      for (let i = start; i <= end; i++) {
        if (target[i] === " " || missed[i]) { ok = false; break; } // 単語の中だけ・ミスが絡んだものは除く
        if (i > start) {
          if (intervals[i] === null) { ok = false; break; }
          sum += intervals[i];
        }
      }
      if (!ok) continue;
      const key = target.slice(start, end + 1); // 大文字・小文字は区別する
      const e = map.get(key) || { sum: 0, count: 0 };
      e.sum += sum / (n - 1);
      e.count++;
      map.set(key, e);
    }
    return Array.from(map, function (entry) {
      return { gram: entry[0], avg: entry[1].sum / entry[1].count, count: entry[1].count };
    });
  }

  function th(text) {
    const el = document.createElement("th");
    el.textContent = text;
    return el;
  }

  function td(className, text) {
    const el = document.createElement("td");
    el.className = className;
    el.textContent = text;
    return el;
  }

  return { create: create };
})();
