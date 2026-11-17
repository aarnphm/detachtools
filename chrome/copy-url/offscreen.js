chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "copy-url") return;
  const buffer = document.getElementById("buffer");
  buffer.value = message.text;
  buffer.select();
  sendResponse(document.execCommand("copy"));
});
