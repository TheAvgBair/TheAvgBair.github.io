import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stashpinRoot = path.join(repoRoot, "stashpin");
const expectedProviderToken = "128803022";
const expectedAppId = "6783395764";
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function collectHtmlFiles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectHtmlFiles(absolute, result);
    else if (entry.name.endsWith(".html")) result.push(absolute);
  }
  return result;
}

function decodeAttribute(value) {
  return value.replaceAll("&amp;", "&");
}

function resolveLocalUrl(value) {
  const pathname = value.split(/[?#]/, 1)[0];
  if (!pathname.startsWith("/stashpin/")) return null;
  const relative = pathname.replace(/^\//, "");
  return pathname.endsWith("/")
    ? path.join(repoRoot, relative, "index.html")
    : path.join(repoRoot, relative);
}

const htmlFiles = collectHtmlFiles(stashpinRoot).sort();
const canonicals = new Set();
const pageCampaigns = new Map();
const bannerCampaigns = new Set();

assert(htmlFiles.length === 10, `expected 10 HTML pages, found ${htmlFiles.length}`);

for (const file of htmlFiles) {
  const relativeFile = path.relative(repoRoot, file);
  const source = fs.readFileSync(file, "utf8");
  assert(/<h1(?:\s|>)/.test(source), `${relativeFile}: missing H1`);
  assert(/<meta name="description" content="[^"]+">/.test(source), `${relativeFile}: missing description`);

  const canonical = source.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  assert(Boolean(canonical), `${relativeFile}: missing canonical`);
  if (canonical) {
    assert(!canonicals.has(canonical), `${relativeFile}: duplicate canonical ${canonical}`);
    canonicals.add(canonical);
  }

  for (const match of source.matchAll(/<(?:a|link|script|img)[^>]+(?:href|src)="([^"]+)"/g)) {
    const localPath = resolveLocalUrl(decodeAttribute(match[1]));
    if (localPath) assert(fs.existsSync(localPath), `${relativeFile}: missing local target ${match[1]}`);
  }

  for (const match of source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      errors.push(`${relativeFile}: invalid JSON-LD: ${error.message}`);
    }
  }

  const appStoreHrefs = [...source.matchAll(/<a[^>]+href="(https:\/\/apps\.apple\.com\/us\/app\/stashpin\/id6783395764\?[^"]+)"/g)]
    .map((match) => new URL(decodeAttribute(match[1])));
  assert(appStoreHrefs.length > 0, `${relativeFile}: missing App Store campaign link`);
  const campaigns = new Set();
  for (const url of appStoreHrefs) {
    assert(url.searchParams.get("pt") === expectedProviderToken, `${relativeFile}: incorrect or missing pt`);
    assert(url.searchParams.get("mt") === "8", `${relativeFile}: incorrect or missing mt`);
    const campaign = url.searchParams.get("ct");
    assert(/^sp_[A-Za-z0-9_]+$/.test(campaign ?? ""), `${relativeFile}: invalid ct`);
    assert((campaign?.length ?? Infinity) <= 30, `${relativeFile}: ct exceeds 30 characters`);
    if (campaign) campaigns.add(campaign);
  }
  assert(campaigns.size === 1, `${relativeFile}: expected one page campaign, found ${[...campaigns].join(", ")}`);
  const [pageCampaign] = campaigns;
  if (pageCampaign) {
    assert(!pageCampaigns.has(pageCampaign), `${relativeFile}: duplicate page campaign ${pageCampaign}`);
    pageCampaigns.set(pageCampaign, relativeFile);
  }

  const bannerContent = source.match(/<meta name="apple-itunes-app" content="([^"]+)">/)?.[1];
  assert(Boolean(bannerContent), `${relativeFile}: missing Smart App Banner`);
  if (bannerContent) {
    const decodedBannerContent = decodeAttribute(bannerContent);
    assert(decodedBannerContent.includes(`app-id=${expectedAppId}`), `${relativeFile}: incorrect Smart App Banner app id`);
    assert(!decodedBannerContent.includes("app-argument="), `${relativeFile}: Smart App Banner must not pass an unsupported app-argument`);
    const affiliateValue = decodedBannerContent.match(/affiliate-data=([^,]+)$/)?.[1];
    assert(Boolean(affiliateValue), `${relativeFile}: missing Smart App Banner affiliate-data`);
    if (affiliateValue) {
      const affiliateData = new URLSearchParams(affiliateValue);
      assert(affiliateData.get("pt") === expectedProviderToken, `${relativeFile}: incorrect Smart App Banner pt`);
      assert(affiliateData.get("mt") === "8", `${relativeFile}: incorrect Smart App Banner mt`);
      const bannerCampaign = affiliateData.get("ct");
      assert(/^sp_[A-Za-z0-9_]+_banner$/.test(bannerCampaign ?? ""), `${relativeFile}: invalid Smart App Banner ct`);
      assert((bannerCampaign?.length ?? Infinity) <= 30, `${relativeFile}: Smart App Banner ct exceeds 30 characters`);
      if (bannerCampaign) {
        assert(!bannerCampaigns.has(bannerCampaign), `${relativeFile}: duplicate Smart App Banner ct`);
        bannerCampaigns.add(bannerCampaign);
      }
    }
  }

  assert(!/(?:design\/concepts|stashpin\/qa|\.playwright-cli)/.test(source), `${relativeFile}: references an internal artifact`);
  assert(!source.includes("$0.99"), `${relativeFile}: contains a hard-coded subscription price`);
}

const expectedRobots = "User-agent: *\nAllow: /\n\nSitemap: https://theavgbair.github.io/stashpin/sitemap.xml\n";
assert(fs.readFileSync(path.join(repoRoot, "robots.txt"), "utf8") === expectedRobots, "root robots.txt does not match the safe allow-all StashPin sitemap policy");
assert(!fs.existsSync(path.join(stashpinRoot, "robots.txt")), "ineffective stashpin/robots.txt should not exist");

const sitemap = fs.readFileSync(path.join(stashpinRoot, "sitemap.xml"), "utf8");
const sitemapUrls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
assert(sitemapUrls.size === 10, `expected 10 sitemap URLs, found ${sitemapUrls.size}`);
for (const canonical of canonicals) assert(sitemapUrls.has(canonical), `sitemap missing ${canonical}`);

const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
for (const rule of ["/.playwright-cli/", "/stashpin/design/", "/stashpin/qa/"]) {
  assert(gitignore.split("\n").includes(rule), `.gitignore missing ${rule}`);
}

const toggleAttributes = new Map([
  ["aria-expanded", "false"],
  ["aria-label", "Open navigation"],
]);
const toggleListeners = {};
const navListeners = {};
const documentListeners = {};
let toggleFocused = false;
const toggle = {
  addEventListener(type, handler) { toggleListeners[type] = handler; },
  getAttribute(name) { return toggleAttributes.get(name) ?? null; },
  setAttribute(name, value) { toggleAttributes.set(name, value); },
  focus() { toggleFocused = true; },
};
const nav = {
  dataset: { open: "false" },
  addEventListener(type, handler) { navListeners[type] = handler; },
};
const mockDocument = {
  querySelector(selector) {
    if (selector === "[data-nav-toggle]") return toggle;
    if (selector === "[data-nav]") return nav;
    return null;
  },
  querySelectorAll() { return []; },
  addEventListener(type, handler) { documentListeners[type] = handler; },
};
vm.runInNewContext(fs.readFileSync(path.join(stashpinRoot, "site.js"), "utf8"), {
  document: mockDocument,
  window: {},
});

toggleListeners.click();
assert(toggle.getAttribute("aria-label") === "Close navigation", "nav toggle does not announce Close navigation when open");
assert(toggle.getAttribute("aria-expanded") === "true" && nav.dataset.open === "true", "nav toggle open state is inconsistent");
navListeners.click({ target: { closest: (selector) => selector === "a" ? {} : null } });
assert(toggle.getAttribute("aria-label") === "Open navigation", "nav link click does not restore Open navigation label");
assert(toggle.getAttribute("aria-expanded") === "false" && nav.dataset.open === "false", "nav link click does not close navigation");
toggleListeners.click();
documentListeners.keydown({ key: "Escape" });
assert(toggle.getAttribute("aria-label") === "Open navigation" && toggleFocused, "Escape does not close navigation and restore focus");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

const maxCampaignLength = Math.max(...[...pageCampaigns.keys(), ...bannerCampaigns].map((campaign) => campaign.length));
console.log(`PASS: ${htmlFiles.length} StashPin pages, ${canonicals.size} canonicals, ${pageCampaigns.size} page campaigns, ${bannerCampaigns.size} Smart App Banner campaigns, max ct length ${maxCampaignLength}/30, provider token ${expectedProviderToken}, root robots, sitemap, artifacts, JSON-LD, local links, and mobile navigation state.`);
