const DEFAULTS = {
  enabled: false,
  conversationUrl: "",
  inactivityMinutes: 12,
  cooldownMinutes: 15,
  autoAlwaysAllow: true,
  continuationMessage:
    "Continue the existing job application pipeline from where you stopped. Do not restart completed applications or create duplicates.",
  lastSentAt: 0,
  lastSentActivityAnchorAt: 0,
  lastActivityLabel: "",
  activityAnchorAt: 0,
};

let checking = false;
let mutationTimer;

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function visible(element) {
  return element instanceof HTMLElement && element.offsetParent !== null;
}

function parseActivityAge(label) {
  const normalized = label.replace(/^[•·]\s*/, "").trim();
  if (/^active\s+(?:now|just now)$/i.test(normalized)) return 0;

  const match = normalized.match(
    /^active\s+(?:about\s+)?(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s+ago$/i,
  );
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("s")) return amount * 1_000;
  if (unit === "m" || unit.startsWith("min")) return amount * 60_000;
  if (unit === "h" || unit.startsWith("hr") || unit.startsWith("hour")) return amount * 3_600_000;
  return amount * 86_400_000;
}

function findActivity() {
  const candidates = [
    ...document.querySelectorAll('[aria-label*="active" i]'),
    ...document.querySelectorAll("time, span, p, div"),
  ];

  for (const element of candidates) {
    if (!visible(element)) continue;
    const labels = [element.getAttribute("aria-label"), element.textContent]
      .filter(Boolean)
      .map((value) => value.trim())
      .filter((value) => value.length <= 80);

    for (const label of labels) {
      const ageMs = parseActivityAge(label);
      if (ageMs !== null) return { label, ageMs };
    }
  }
  return null;
}

function isWorking() {
  return [...document.querySelectorAll("button")].some((button) => {
    if (!visible(button)) return false;
    const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`;
    return /stop (?:generating|working)|interrupt/i.test(label);
  });
}

function findComposer() {
  return document.querySelector(
    "#prompt-textarea, textarea[data-id='root'], textarea[placeholder*='Message'], [contenteditable='true'][data-virtualkeyboard]",
  );
}

function clickAlwaysAllow() {
  const button = [...document.querySelectorAll('button, [role="button"]')].find((candidate) => {
    const label = (candidate.textContent || "").trim().toLowerCase();
    return visible(candidate) && !candidate.disabled && label === "always allow";
  });
  if (!button) return false;
  button.click();
  return true;
}

async function sendMessage(content) {
  const composer = findComposer();
  if (!composer || composer.getAttribute("aria-disabled") === "true") {
    throw new Error("Message box was not found");
  }

  composer.focus();
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value")?.set;
    setter?.call(composer, content);
  } else {
    composer.textContent = content;
  }
  composer.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: content }),
  );

  await new Promise((resolve) => setTimeout(resolve, 250));
  const sendButton = document.querySelector(
    "button[data-testid='send-button'], button[aria-label='Send message'], button[aria-label='Send']",
  );
  if (!(sendButton instanceof HTMLButtonElement) || sendButton.disabled) {
    throw new Error("Send button was not found");
  }
  sendButton.click();
}

async function checkActivity() {
  if (checking) return;
  checking = true;

  try {
    const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    if (!settings.enabled) return;
    if (normalizeUrl(location.href) !== normalizeUrl(settings.conversationUrl)) return;

    if (settings.autoAlwaysAllow && clickAlwaysAllow()) {
      await chrome.storage.local.set({
        lastResult: 'Clicked “Always allow”',
        lastCheckAt: Date.now(),
      });
      return;
    }

    const activity = findActivity();
    if (!activity) {
      await chrome.storage.local.set({
        lastResult: 'Could not find the “Active … ago” text',
        lastCheckAt: Date.now(),
      });
      return;
    }

    const now = Date.now();
    const inactiveFor = Number(settings.inactivityMinutes) * 60_000;
    const cooldown = Number(settings.cooldownMinutes) * 60_000;
    // Inactive tabs can have throttled page timers, leaving “Active 1m ago”
    // visually frozen. Preserve the first timestamp for an unchanged label so
    // inactivity still advances while the user is on another tab.
    const previousAnchor = Number(settings.activityAnchorAt || 0);
    const candidateAnchor = now - activity.ageMs;
    let activityAnchorAt = previousAnchor || candidateAnchor;
    if (settings.lastActivityLabel !== activity.label) {
      // A normally aging label (7m -> 8m) points to roughly the same anchor.
      // A meaningfully newer anchor means Applier became active again.
      if (!previousAnchor || candidateAnchor > previousAnchor + 30_000) {
        activityAnchorAt = candidateAnchor;
      }
    }
    const effectiveActivityAge = Math.max(0, now - activityAnchorAt);
    const status = {
      lastActivityLabel: activity.label,
      activityAnchorAt,
      lastCheckAt: now,
    };

    if (effectiveActivityAge < inactiveFor) {
      await chrome.storage.local.set({ ...status, lastResult: "Applier is active" });
      return;
    }
    if (isWorking()) {
      await chrome.storage.local.set({ ...status, lastResult: "Applier is currently working" });
      return;
    }
    const lastSentAt = Number(settings.lastSentAt || 0);
    const sentForAnchor = Number(settings.lastSentActivityAnchorAt || 0);
    const sameIdlePeriod = sentForAnchor
      ? Math.abs(sentForAnchor - activityAnchorAt) < 30_000
      : activityAnchorAt <= lastSentAt;
    if (sameIdlePeriod && now - lastSentAt < cooldown) {
      await chrome.storage.local.set({ ...status, lastResult: "Waiting for recovery cooldown" });
      return;
    }

    // Reserve the cooldown before touching the page so simultaneous checks cannot double-send.
    await chrome.storage.local.set({
      ...status,
      lastSentAt: now,
      lastSentActivityAnchorAt: activityAnchorAt,
      lastResult: "Sending continuation…",
    });
    try {
      await sendMessage(settings.continuationMessage);
      await chrome.storage.local.set({
        lastResult: "Continuation message sent",
        lastSentAt: now,
        lastSentActivityAnchorAt: activityAnchorAt,
      });
    } catch (error) {
      await chrome.storage.local.set({
        lastResult: `Could not send: ${error.message || error}`,
        lastSentAt: 0,
        lastSentActivityAnchorAt: 0,
      });
    }
  } finally {
    checking = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "checkNow") return;
  void checkActivity().then(() => sendResponse({ ok: true }));
  return true;
});

new MutationObserver(() => {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => void checkActivity(), 1_000);
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

setInterval(() => void checkActivity(), 30_000);
void checkActivity();
