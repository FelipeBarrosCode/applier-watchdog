const DEFAULTS = {
  enabled: false,
  conversationUrl: "",
  inactivityMinutes: 12,
  cooldownMinutes: 15,
  continuationMessage:
    "Continue the existing job application pipeline from where you stopped. Do not restart completed applications or create duplicates.",
  lastResult: "Not checked yet",
  lastActivityLabel: "",
  activityAnchorAt: 0,
  lastCheckAt: 0,
  lastSentAt: 0,
};

const ids = ["enabled", "conversationUrl", "inactivityMinutes", "cooldownMinutes", "continuationMessage"];

async function load() {
  const values = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element.type === "checkbox") element.checked = values[id];
    else element.value = values[id];
  }
  renderStatus(values);
}

function renderStatus(values) {
  const lines = [values.lastResult || "Not checked yet"];
  if (values.lastActivityLabel) lines.push(`Found: ${values.lastActivityLabel}`);
  if (values.lastCheckAt) lines.push(`Checked: ${new Date(values.lastCheckAt).toLocaleTimeString()}`);
  if (values.lastSentAt) lines.push(`Last sent: ${new Date(values.lastSentAt).toLocaleTimeString()}`);
  document.getElementById("status").textContent = lines.join("\n");
}

async function save() {
  const values = {
    enabled: document.getElementById("enabled").checked,
    conversationUrl: document.getElementById("conversationUrl").value,
    inactivityMinutes: Math.max(1, Number(document.getElementById("inactivityMinutes").value) || 12),
    cooldownMinutes: Math.max(1, Number(document.getElementById("cooldownMinutes").value) || 15),
    continuationMessage: document.getElementById("continuationMessage").value.trim(),
  };
  if (!values.conversationUrl) throw new Error("Choose the Applier tab first");
  if (!values.continuationMessage) throw new Error("Enter a message to send");
  await chrome.storage.local.set(values);
  await chrome.runtime.sendMessage({ type: "settingsChanged" });
}

document.getElementById("useCurrent").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://chatgpt.com/")) {
    document.getElementById("status").textContent = "Open the Applier ChatGPT tab first";
    return;
  }
  const url = new URL(tab.url);
  document.getElementById("conversationUrl").value = `${url.origin}${url.pathname}`.replace(/\/$/, "");
});

document.getElementById("save").addEventListener("click", async () => {
  try {
    await save();
    document.getElementById("status").textContent = "Saved";
  } catch (error) {
    document.getElementById("status").textContent = error.message || String(error);
  }
});

document.getElementById("check").addEventListener("click", async () => {
  try {
    await save();
    await chrome.runtime.sendMessage({ type: "checkNow" });
    setTimeout(load, 500);
  } catch (error) {
    document.getElementById("status").textContent = error.message || String(error);
  }
});

chrome.storage.onChanged.addListener(() => void load());
void load();
