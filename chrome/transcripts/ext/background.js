const view = chrome.runtime.getURL("view.html")

async function show(hash = "") {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] })
  const open = contexts.find((c) => c.documentUrl?.startsWith(view) && c.tabId >= 0)
  if (!open) {
    await chrome.tabs.create({ url: view + hash })
    return
  }
  await chrome.tabs.update(open.tabId, hash ? { active: true, url: view + hash } : { active: true })
  await chrome.windows.update(open.windowId, { focused: true })
}

const wake = () => chrome.runtime.sendNativeMessage("dev.aarnphm.transcripts", { cmd: "start" }).catch(() => {})

chrome.runtime.onStartup.addListener(wake)
chrome.runtime.onInstalled.addListener(wake)
chrome.action.onClicked.addListener(() => {
  wake()
  show()
})
chrome.omnibox.onInputEntered.addListener((text) => show(`#q=${encodeURIComponent(text.trim())}`))
