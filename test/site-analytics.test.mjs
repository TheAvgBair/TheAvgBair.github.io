import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const siteScript = await readFile(new URL("../site.js", import.meta.url), "utf8");
const privacyPage = await readFile(new URL("../site-privacy.html", import.meta.url), "utf8");
const portfolioPage = await readFile(new URL("../index.html", import.meta.url), "utf8");
const levelioPage = await readFile(new URL("../levelio/index.html", import.meta.url), "utf8");
const consentKey = "theavgdevs_analytics_consent_v2";
const consentTtlMs = 180 * 24 * 60 * 60 * 1000;

function node(dataset = {}) {
  const listeners = new Map();
  return {
    dataset,
    disabled: false,
    hidden: true,
    textContent: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    fire(type, event = { preventDefault() {} }) { listeners.get(type)?.(event); },
    focus() { this.focused = true; }
  };
}

function preference(choice, now = Date.now()) {
  return JSON.stringify({
    version: 2,
    choice,
    savedAt: now,
    expiresAt: now + consentTtlMs
  });
}

function runClient({
  storedPreference,
  legacyPreference,
  setFails = false,
  removeFails = false,
  sessionFails = false,
  values: existingValues,
  sessionValues: existingSessionValues,
  locationUrl = "https://theavgbair.github.io/"
} = {}) {
  const values = existingValues ?? new Map();
  if (storedPreference) values.set(consentKey, storedPreference);
  if (legacyPreference) values.set("theavgdevs_analytics_consent_v1", legacyPreference);
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (setFails) throw new Error("storage write blocked");
      values.set(key, value);
    },
    removeItem(key) {
      if (removeFails) throw new Error("storage removal blocked");
      values.delete(key);
    }
  };
  const sessionValues = existingSessionValues ?? new Map();
  const sessionStorage = {
    getItem(key) {
      if (sessionFails) throw new Error("session storage blocked");
      return sessionValues.get(key) ?? null;
    },
    setItem(key, value) {
      if (sessionFails) throw new Error("session storage blocked");
      sessionValues.set(key, value);
    },
    removeItem(key) {
      if (sessionFails) throw new Error("session storage blocked");
      sessionValues.delete(key);
    }
  };
  const allow = node({ consent: "granted" });
  const reject = node({ consent: "denied" });
  const settings = node();
  const consent = node();
  consent.querySelector = (selector) => selector.includes('"granted"') ? allow : selector.includes('"denied"') ? reject : null;
  const status = node();
  const productLink = {
    dataset: { product: "stashpin", content: "hub-stashpin" },
    href: "https://apps.apple.com/us/app/stashpin/id6783395764"
  };
  const internalLink = { href: "https://theavgbair.github.io/site-privacy.html" };
  let currentUrl = new URL(locationUrl);
  const location = {
    get href() { return currentUrl.href; },
    get origin() { return currentUrl.origin; },
    get pathname() { return currentUrl.pathname; },
    get search() { return currentUrl.search; }
  };
  const documentListeners = new Map();
  const windowListeners = new Map();
  const beacons = [];
  const document = {
    querySelector(selector) {
      if (selector === "#analytics-consent") return consent;
      if (selector === "#analytics-consent-status") return status;
      if (selector === 'meta[name="theavgdevs-analytics-endpoint"]') return { content: "https://events.example/events" };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-consent]") return [allow, reject];
      if (selector === "[data-analytics-settings]") return [settings];
      if (selector === ".product-link") return [productLink];
      if (selector === "a[href]") return [productLink, internalLink];
      return [];
    },
    addEventListener(type, listener) { documentListeners.set(type, listener); }
  };
  vm.runInNewContext(siteScript, {
    Blob,
    Date,
    Intl,
    URL,
    URLSearchParams,
    document,
    localStorage: storage,
    location,
    navigator: { sendBeacon: (...args) => { beacons.push(args); return true; } },
    sessionStorage,
    history: {
      replaceState(_state, _title, url) { currentUrl = new URL(url, currentUrl.origin); }
    },
    window: { addEventListener(type, listener) { windowListeners.set(type, listener); } }
  }, { filename: "site.js" });
  return {
    allow,
    beacons,
    consent,
    reject,
    settings,
    status,
    values,
    sessionValues,
    internalLink,
    get locationHref() { return currentUrl.href; },
    storageEvent: (key) => windowListeners.get("storage")?.({ key }),
    trackClick: () => documentListeners.get("click")?.({ target: { closest: () => productLink } })
  };
}

test("portfolio analytics does not forward free-form inbound UTM values", () => {
  assert.doesNotMatch(siteScript, /query\.get\("utm_campaign"\)/);
  assert.doesNotMatch(siteScript, /query\.get\("utm_content"\)/);
  assert.doesNotMatch(siteScript, /observed_at/);
  assert.match(siteScript, /const campaign = monthCampaign\(\);/);
  assert.match(siteScript, /`hub-\$\{product\}`/);
  assert.match(siteScript, /`reel-card:\$\{reel\.productId\}`/);
});

test("portfolio privacy copy names the controlled fields and retention rule", () => {
  assert.match(privacyPage, /website-generated calendar month/);
  assert.match(privacyPage, /The site ignores campaign and content values supplied in an incoming link/);
  assert.match(privacyPage, /Levelio page event requests contain only/);
  assert.match(privacyPage, /The service adds fixed source and destination values plus a coarse UTC day/);
  assert.match(privacyPage, /deletes event rows after 31 days/);
  assert.match(privacyPage, /session replay/);
});

test("measurement controls are visible from the portfolio, Levelio, and privacy page", () => {
  for (const page of [portfolioPage, levelioPage, privacyPage]) {
    assert.match(page, /data-analytics-settings/);
    assert.match(page, /Reject measurement/);
  }
  assert.match(privacyPage, /for 180 days/);
  assert.match(privacyPage, /current session or same-site pages/);
});

test("measurement settings save a strict 180-day versioned choice and reject an expired or legacy choice", () => {
  const client = runClient();
  assert.equal(client.consent.hidden, false);
  client.allow.fire("click");
  const saved = JSON.parse(client.values.get(consentKey));
  assert.deepEqual(Object.keys(saved).sort(), ["choice", "expiresAt", "savedAt", "version"]);
  assert.equal(saved.version, 2);
  assert.equal(saved.choice, "granted");
  assert.equal(saved.expiresAt - saved.savedAt, consentTtlMs);
  assert.equal(client.consent.hidden, true);

  const expired = JSON.stringify({ version: 2, choice: "granted", savedAt: 1, expiresAt: 1 + consentTtlMs });
  const expiredClient = runClient({ storedPreference: expired });
  assert.equal(expiredClient.consent.hidden, false);
  assert.equal(expiredClient.values.has(consentKey), false);

  const legacyClient = runClient({ legacyPreference: "granted" });
  assert.equal(legacyClient.consent.hidden, false);
  assert.equal(legacyClient.values.has("theavgdevs_analytics_consent_v1"), false);
});

test("rejecting in another tab stops later events", () => {
  const crossTabClient = runClient({ storedPreference: preference("granted") });
  assert.equal(crossTabClient.consent.hidden, true);
  crossTabClient.values.set(consentKey, preference("denied"));
  crossTabClient.storageEvent(consentKey);
  crossTabClient.trackClick();
  assert.equal(crossTabClient.beacons.length, 0);
  crossTabClient.settings.fire("click");
  assert.equal(crossTabClient.consent.hidden, false);
});

test("a failed rejection survives navigation and reload without reviving a stale grant", () => {
  const blockedClient = runClient({ storedPreference: preference("granted"), setFails: true, removeFails: true });
  blockedClient.settings.fire("click");
  blockedClient.reject.fire("click");
  blockedClient.trackClick();
  assert.equal(blockedClient.consent.hidden, false);
  assert.equal(blockedClient.allow.disabled, true);
  assert.match(blockedClient.status.textContent, /Measurement is off/);
  assert.equal(blockedClient.beacons.length, 0);

  const nextPage = runClient({
    values: blockedClient.values,
    sessionValues: blockedClient.sessionValues,
    locationUrl: "https://theavgbair.github.io/levelio/"
  });
  assert.equal(nextPage.beacons.length, 0);
  assert.equal(nextPage.consent.hidden, false);

  const reload = runClient({
    values: nextPage.values,
    sessionValues: nextPage.sessionValues,
    locationUrl: nextPage.locationHref
  });
  assert.equal(reload.beacons.length, 0);
  assert.equal(reload.consent.hidden, false);
});

test("a URL denial marker carries a failed rejection to same-site links when session storage is unavailable", () => {
  const blockedClient = runClient({
    storedPreference: preference("granted"),
    setFails: true,
    removeFails: true,
    sessionFails: true
  });
  blockedClient.settings.fire("click");
  blockedClient.reject.fire("click");
  assert.match(blockedClient.locationHref, /theavgdevs_measurement=off/);
  assert.match(blockedClient.internalLink.href, /theavgdevs_measurement=off/);

  const nextPage = runClient({
    values: blockedClient.values,
    sessionFails: true,
    locationUrl: blockedClient.internalLink.href
  });
  assert.equal(nextPage.beacons.length, 0);
  assert.equal(nextPage.consent.hidden, false);
});
