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

const markdownList = (tabs) =>
  tabs.map((tab) => `- [${escapeLabel(tab.title || tab.url)}](${escapeTarget(tab.url)})`).join("\n");

const selectedTabs = async (tab) => {
  const active =
    tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!active) return { active, tabs: [] };
  const highlighted = await chrome.tabs.query({ highlighted: true, windowId: active.windowId });
  const tabs = (highlighted.length > 1 ? highlighted : [active]).filter((t) => t.url);
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

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "copy-url") copyUrls(tab, "markdown");
  else if (command === "copy-url-plain") copyUrls(tab, "plain");
});

chrome.action.onClicked.addListener((tab) => copyUrls(tab, "markdown"));
