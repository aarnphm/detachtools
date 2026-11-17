if (
  window === top &&
  document.contentType === "application/pdf" &&
  !/[#&]native\b/.test(location.hash)
) {
  const src = location.href.replace(/#.*/, "");
  const viewer = chrome.runtime.getURL("web/viewer.html");
  location.replace(`${viewer}?src=${encodeURIComponent(src)}${location.hash}`);
}
