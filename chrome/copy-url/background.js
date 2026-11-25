const MENU = "copy-tabs";

const ensureOffscreen = async () => {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["CLIPBOARD"],
    justification: "Write tab URLs to the clipboard",
  });
};

const flash = async (tabId, text, color) => {
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }), 1200);
};

const escapeLabel = (text) => text.replace(/[\\[\]]/g, "\\$&").replace(/\s+/g, " ").trim();
const escapeTarget = (url) =>
  url.replace(/[()\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

const sourceUrl = (url) => {
  if (!url.startsWith("chrome-extension://")) return url;
  const view = new URL(url);
  if (!view.pathname.endsWith("/web/viewer.html")) return url;
  const src = view.searchParams.get("src") ?? view.searchParams.get("file");
  if (!src) return url;
  const page = new URLSearchParams(view.hash.slice(1)).get("page");
  return page && page !== "1" ? `${src.replace(/#.*/, "")}#page=${page}` : src;
};

const markdownList = (tabs) =>
  tabs.map((tab) => `- [${escapeLabel(tab.title || tab.url)}](${escapeTarget(tab.url)})`).join("\n");

const selectedTabs = async (tab) => {
  const active =
    tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!active) return { active, tabs: [] };
  const highlighted = await chrome.tabs.query({ highlighted: true, windowId: active.windowId });
  const tabs = (highlighted.length > 1 ? highlighted : [active])
    .filter((t) => t.url)
    .map((t) => ({ ...t, url: sourceUrl(t.url) }));
  return { active, tabs: tabs.sort((a, b) => a.index - b.index) };
};

const copyUrls = async (tab, format) => {
  const { active, tabs } = await selectedTabs(tab);
  if (!active || !tabs.length) return;
  const text =
    tabs.length === 1
      ? tabs[0].url
      : format === "plain"
        ? tabs.map((t) => t.url).join(" ")
        : markdownList(tabs);
  await ensureOffscreen();
  const ok = await chrome.runtime.sendMessage({ type: "copy-url", text });
  const mark = tabs.length === 1 ? "✓" : String(tabs.length);
  await flash(active.id, ok ? mark : "!", ok ? "#66800b" : "#af3029");
  return ok ? text : undefined;
};

let menu = { title: "", visible: false };

const syncMenu = async (windowId) => {
  const target = windowId ?? (await chrome.windows.getLastFocused().catch(() => undefined))?.id;
  if (target === undefined || target === chrome.windows.WINDOW_ID_NONE) return menu;
  const count = (await chrome.tabs.query({ highlighted: true, windowId: target })).filter((t) => t.url).length;
  const next = { title: `Copy ${count} tabs`, visible: count > 1 };
  if (next.title !== menu.title || next.visible !== menu.visible) {
    menu = next;
    await chrome.contextMenus.update(MENU, next).catch(() => undefined);
  }
  return menu;
};

const createMenu = async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU, title: "Copy tabs", contexts: ["all"], visible: false });
  menu = { title: "Copy tabs", visible: false };
  await syncMenu();
};

const onMenuClick = (info, tab) => {
  if (info.menuItemId === MENU) return copyUrls(tab, "markdown");
};

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);
chrome.tabs.onHighlighted.addListener(({ windowId }) => syncMenu(windowId));
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.url && tab.highlighted) syncMenu(tab.windowId);
});
chrome.windows.onFocusChanged.addListener((windowId) => syncMenu(windowId));
chrome.contextMenus.onClicked.addListener(onMenuClick);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "copy-url") copyUrls(tab, "markdown");
  else if (command === "copy-url-plain") copyUrls(tab, "plain");
});

chrome.action.onClicked.addListener((tab) => copyUrls(tab, "markdown"));
