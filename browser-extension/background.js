const DEFAULTS = {
  enabled: false,
  conversationUrl: "",
};

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

async function checkApplierTab() {
  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  if (!settings.enabled || !settings.conversationUrl) return;

  const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  const expected = normalizeUrl(settings.conversationUrl);
  let tab = tabs.find((candidate) => normalizeUrl(candidate.url || "") === expected);

  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: settings.conversationUrl, active: false });
    await chrome.storage.local.set({
      lastResult: "Opened Applier in a background tab",
      lastCheckAt: Date.now(),
    });
    return;
  }

  if (tab.discarded) {
    await chrome.tabs.reload(tab.id);
    await chrome.storage.local.set({
      lastResult: "Waking the Applier background tab",
      lastCheckAt: Date.now(),
    });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "checkNow" });
  } catch {
    await chrome.storage.local.set({
      lastResult: "Reload the Applier tab to activate the extension",
      lastCheckAt: Date.now(),
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("check-applier", { periodInMinutes: 1 });
  void checkApplierTab();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("check-applier", { periodInMinutes: 1 });
  void checkApplierTab();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "check-applier") void checkApplierTab();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "settingsChanged" || message.type === "checkNow") {
    void checkApplierTab();
  }
});

chrome.alarms.create("check-applier", { periodInMinutes: 1 });
