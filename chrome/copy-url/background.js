const ensureOffscreen = async () => {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["CLIPBOARD"],
    justification: "Write the active tab's URL to the clipboard",
  });
};

const flash = async (tabId, text, color) => {
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }), 1200);
};

const copyUrl = async (tab) => {
  const active =
    tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!active?.url) return;
  await ensureOffscreen();
  const ok = await chrome.runtime.sendMessage({ type: "copy-url", text: active.url });
  await flash(active.id, ok ? "✓" : "!", ok ? "#66800b" : "#af3029");
};

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "copy-url") copyUrl(tab);
});

chrome.action.onClicked.addListener((tab) => copyUrl(tab));
