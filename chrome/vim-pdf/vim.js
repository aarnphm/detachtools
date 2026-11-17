const app = window.PDFViewerApplication;
const src = new URLSearchParams(location.search).get("src");
const container = document.getElementById("viewerContainer");
const findInput = document.getElementById("findInput");

const STEP = 64;
const HINT_KEYS = "asdfghjkl";
const HELP = [
  ["j k h l", "scroll down / up / left / right"],
  ["d u", "half page down / up (also ctrl-d ctrl-u)"],
  ["ctrl-f ctrl-b", "full page down / up"],
  ["gg  G", "top / bottom, with a count: go to page N"],
  ["J  K", "next / previous page"],
  ["H  L", "history back / forward"],
  ["/  n  N", "find, next match, previous match"],
  ["f", "follow a link by hint"],
  ["+ -  0", "zoom in / out / reset"],
  ["zw zf za", "fit width / fit page / actual size"],
  ["r  R", "rotate clockwise / counterclockwise"],
  ["t", "toggle sidebar"],
  ["m{a-z}  '{a-z}  ''", "set mark, jump to mark, jump back"],
  ["yy", "copy the PDF's URL"],
  ["gN", "open in Chrome's native viewer"],
  ["?  esc", "toggle help, cancel"],
];

const el = (tag, id, text) => {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (text) node.textContent = text;
  return node;
};

const statusBar = el("div", "vimStatus");
const statusLeft = el("span", "vimStatusLeft");
const statusRight = el("span", "vimStatusRight");
statusBar.append(statusLeft, statusRight);
const help = el("div", "vimHelp");
help.hidden = true;
for (const [keys, text] of HELP) {
  const row = el("div");
  row.append(el("kbd", null, keys), el("span", null, text));
  help.append(row);
}
const hintLayer = el("div", "vimHints");
document.body.append(statusBar, help, hintLayer);

let count = "";
let pending = "";
const marks = new Map();
const hints = { active: false, typed: "", items: [] };

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const total = () => app.pagesCount || 1;
const scrollBy = (left, top) => container.scrollBy({ left, top, behavior: "instant" });
const position = () => ({ top: container.scrollTop, left: container.scrollLeft });
const remember = () => marks.set("'", position());
const goTo = (page) => {
  remember();
  app.page = clamp(page, 1, total());
};
const jumpTo = ({ top, left }) => container.scrollTo({ top, left, behavior: "instant" });

const render = () => {
  const typed = hints.active ? `-- HINT -- ${hints.typed}` : `${count}${pending}`;
  statusLeft.textContent = typed || "NORMAL";
  const scale = app.pdfViewer?.currentScale;
  statusRight.textContent = app.pdfDocument
    ? `${app.page}/${total()}${scale ? `  ${Math.round(scale * 100)}%` : ""}`
    : "";
};

const labels = (n) => {
  const len = Math.max(1, Math.ceil(Math.log(n) / Math.log(HINT_KEYS.length)));
  return Array.from({ length: n }, (_, i) => {
    let label = "";
    for (let k = 0, v = i; k < len; k++, v = Math.floor(v / HINT_KEYS.length)) {
      label = HINT_KEYS[v % HINT_KEYS.length] + label;
    }
    return label;
  });
};

const endHints = () => {
  hints.active = false;
  hints.typed = "";
  hints.items = [];
  hintLayer.replaceChildren();
  render();
};

const startHints = () => {
  const view = container.getBoundingClientRect();
  const links = [...document.querySelectorAll(".annotationLayer a")].filter((a) => {
    const r = a.getBoundingClientRect();
    return (
      r.width > 0 && r.height > 0 && r.bottom > view.top && r.top < view.bottom &&
      r.right > view.left && r.left < view.right
    );
  });
  if (!links.length) return;
  const names = labels(links.length);
  hints.active = true;
  hints.items = links.map((a, i) => {
    const r = a.getBoundingClientRect();
    const tag = el("span", null, names[i]);
    tag.style.left = `${Math.max(r.left, view.left)}px`;
    tag.style.top = `${Math.max(r.top, view.top)}px`;
    hintLayer.append(tag);
    return { a, tag, label: names[i] };
  });
  render();
};

const hintKey = (key) => {
  if (key === "Escape") return endHints();
  if (key === "Backspace") hints.typed = hints.typed.slice(0, -1);
  else if (HINT_KEYS.includes(key)) hints.typed += key;
  else return;
  const live = hints.items.filter((h) => h.label.startsWith(hints.typed));
  for (const h of hints.items) h.tag.hidden = !live.includes(h);
  if (live.length === 1 && live[0].label === hints.typed) {
    const { a } = live[0];
    endHints();
    a.click();
  } else if (!live.length) endHints();
  else render();
};

const find = (backwards) => {
  if (findInput.value) app.findBar.dispatchEvent("again", backwards);
};

const openFind = () => {
  app.findBar.open();
  findInput.select();
};

const copySource = () => src && navigator.clipboard.writeText(src);

const sequences = {
  j: (n) => scrollBy(0, STEP * n),
  k: (n) => scrollBy(0, -STEP * n),
  h: (n) => scrollBy(-STEP * n, 0),
  l: (n) => scrollBy(STEP * n, 0),
  d: (n) => scrollBy(0, (container.clientHeight / 2) * n),
  u: (n) => scrollBy(0, (-container.clientHeight / 2) * n),
  "C-d": (n) => scrollBy(0, (container.clientHeight / 2) * n),
  "C-u": (n) => scrollBy(0, (-container.clientHeight / 2) * n),
  "C-f": (n) => scrollBy(0, container.clientHeight * n),
  "C-b": (n) => scrollBy(0, -container.clientHeight * n),
  gg: (n, given) => (given ? goTo(n) : (remember(), jumpTo({ top: 0, left: container.scrollLeft }))),
  G: (n, given) =>
    given ? goTo(n) : (remember(), jumpTo({ top: container.scrollHeight, left: container.scrollLeft })),
  J: (n) => (app.page = clamp(app.page + n, 1, total())),
  K: (n) => (app.page = clamp(app.page - n, 1, total())),
  H: () => app.pdfHistory?.back(),
  L: () => app.pdfHistory?.forward(),
  "/": openFind,
  n: () => find(false),
  N: () => find(true),
  f: startHints,
  "+": (n) => app.updateZoom(n),
  "=": (n) => app.updateZoom(n),
  "-": (n) => app.updateZoom(-n),
  0: () => app.zoomReset(),
  zw: () => (app.pdfViewer.currentScaleValue = "page-width"),
  zf: () => (app.pdfViewer.currentScaleValue = "page-fit"),
  za: () => (app.pdfViewer.currentScaleValue = "page-actual"),
  r: () => app.rotatePages(90),
  R: () => app.rotatePages(-90),
  t: () => app.viewsManager.toggle(),
  yy: copySource,
  gN: () => src && location.replace(`${src}#native`),
  "?": () => (help.hidden = !help.hidden),
};

const isPrefix = (s) => Object.keys(sequences).some((k) => k.length > s.length && k.startsWith(s));
const typing = (t) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const reset = () => {
  count = "";
  pending = "";
  render();
};

const mark = (key, kind) => {
  if (kind === "m" && /^[a-zA-Z]$/.test(key)) marks.set(key, position());
  else if (kind !== "m") {
    const target = marks.get(key === "`" ? "'" : key);
    if (target) {
      const back = position();
      jumpTo(target);
      marks.set("'", back);
    }
  }
};

window.addEventListener(
  "keydown",
  (e) => {
    if (typing(e.target)) {
      if (e.key === "Escape" && e.target === findInput) setTimeout(() => container.focus());
      if (e.key === "Enter" && e.target === findInput) setTimeout(() => (findInput.blur(), container.focus()));
      return;
    }
    if (e.metaKey || e.altKey || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
    const consume = () => (e.preventDefault(), e.stopImmediatePropagation());

    if (hints.active) {
      consume();
      return hintKey(e.key);
    }
    if (e.key === "Escape") {
      const wasActive = count || pending || !help.hidden;
      help.hidden = true;
      reset();
      if (wasActive) consume();
      return;
    }

    const key = e.ctrlKey ? `C-${e.key}` : e.key;
    if (pending === "m" || pending === "'" || pending === "`") {
      consume();
      mark(e.key, pending);
      return reset();
    }
    if (/^[1-9]$/.test(key) || (key === "0" && count)) {
      consume();
      count += key;
      return render();
    }

    const seq = pending + key;
    if (seq in sequences) {
      consume();
      const given = count !== "";
      const n = given ? Number(count) : 1;
      reset();
      sequences[seq](n, given);
      return render();
    }
    if (!pending && ["m", "'", "`"].includes(key)) {
      consume();
      pending = key;
      return render();
    }
    if (isPrefix(seq)) {
      consume();
      pending = seq;
      return render();
    }
    if (pending) {
      consume();
      reset();
    }
  },
  true,
);

(async () => {
  await app.initializedPromise;
  for (const name of ["pagechanging", "scalechanging", "pagesloaded", "documentloaded"]) {
    app.eventBus.on(name, render);
  }
  render();
  if (!src) return;
  await app.open({ url: src, originalUrl: src, withCredentials: true });
  container.focus();
})();
