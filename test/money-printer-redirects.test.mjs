import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const legacyPages = [
  ["money-printer/index.html", "https://theavgdev-money-printer.pages.dev/"],
  ["money-printer/privacy/index.html", "https://theavgdev-money-printer.pages.dev/privacy/"],
  ["money-printer/support/index.html", "https://theavgdev-money-printer.pages.dev/support/"],
  ["money-printer/third-party-notices/index.html", "https://theavgdev-money-printer.pages.dev/third-party-notices/"]
];

test("legacy Money Printer routes point to the canonical site with a fallback link", async () => {
  for (const [path, target] of legacyPages) {
    const page = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(page, new RegExp(`http-equiv="refresh" content="0; url=${target.replaceAll("/", "\\/")}"`));
    assert.match(page, new RegExp(`<link rel="canonical" href="${target.replaceAll("/", "\\/")}">`));
    assert.match(page, new RegExp(`<a href="${target.replaceAll("/", "\\/")}">`));
    assert.match(page, /<meta name="robots" content="noindex,follow">/);
  }
});

test("the portfolio sitemap does not advertise legacy Money Printer routes", async () => {
  const sitemap = await readFile(new URL("../sitemap.xml", import.meta.url), "utf8");
  assert.doesNotMatch(sitemap, /money-printer/);
});
