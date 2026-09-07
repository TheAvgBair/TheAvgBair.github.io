(() => {
  const choiceKey = "theavgdevs_analytics_consent_v1";
  const consent = document.querySelector("#analytics-consent");
  const endpoint = document.querySelector('meta[name="theavgdevs-analytics-endpoint"]')?.content?.trim() || "";
  const query = new URLSearchParams(location.search);
  const isLevelioLanding = /\/levelio\/(?:index\.html)?$/.test(location.pathname);
  let levelioLandingMeasured = false;

  const monthCampaign = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Indiana/Indianapolis",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}`;
  };

  const campaign = query.get("utm_campaign") || monthCampaign();
  const incomingContent = query.get("utm_content");
  const isInstagramVisit = query.get("utm_source") === "instagram" && query.get("utm_medium") === "organic_social";
  const source = isInstagramVisit ? "instagram" : isLevelioLanding ? "levelio_website" : "theavgdevs_hub";
  const medium = isInstagramVisit ? "organic_social" : isLevelioLanding ? "organic_web" : "referral";

  const prepareLink = (link) => {
    const product = link.dataset.product;
    const url = new URL(link.href);
    url.searchParams.set("utm_source", source);
    url.searchParams.set("utm_medium", medium);
    url.searchParams.set("utm_campaign", campaign);
    url.searchParams.set("utm_content", link.dataset.content || incomingContent || (isLevelioLanding ? "levelio-app-store" : `hub-${product}`));
    link.href = url.toString();
  };
  document.querySelectorAll(".product-link").forEach(prepareLink);

  const getConsent = () => {
    try { return localStorage.getItem(choiceKey); } catch { return null; }
  };

  const sendEvent = (payload) => {
    if (getConsent() !== "granted" || !endpoint) return;
    navigator.sendBeacon(endpoint, new Blob([JSON.stringify(payload)], { type: "application/json" }));
  };

  const measureLevelioLanding = () => {
    if (!isLevelioLanding || levelioLandingMeasured) return;
    levelioLandingMeasured = true;
    sendEvent({
      consent: "granted",
      event: "levelio_landing_view",
      product_id: "levelio"
    });
  };

  const measure = (product, destination, content) => {
    if (isLevelioLanding && product === "levelio") {
      sendEvent({
        consent: "granted",
        event: "levelio_app_store_click",
        product_id: "levelio"
      });
      return;
    }
    sendEvent({
      consent: "granted",
      event: "portfolio_outbound",
      product_id: product,
      source,
      campaign,
      content: content || incomingContent || `hub-${product}`,
      destination_host: new URL(destination).host,
      observed_at: new Date().toISOString()
    });
  };

  // Delegation also covers cards loaded after the page has initialized.
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a.product-link");
    if (link) measure(link.dataset.product, link.href, link.dataset.content);
  });

  const productHosts = {
    printsimple: ["printsimple.org", "www.printsimple.org"],
    everydaycalc: ["everydaycalc.org", "www.everydaycalc.org"],
    simpleletters: ["simplelettertemplates.com", "www.simplelettertemplates.com"],
    projectradar: ["getprojectradar.com", "www.getprojectradar.com"],
    theavgstore: ["www.teacherspayteachers.com", "teacherspayteachers.com"],
    stashpin: ["apps.apple.com"],
    levelio: ["apps.apple.com"]
  };
  const validReel = (reel) => {
    if (!reel || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(reel.occurrenceId || "")) return false;
    if (!productHosts[reel.productId] || typeof reel.title !== "string" || !reel.title.trim() || reel.title.length > 160) return false;
    if (typeof reel.productName !== "string" || !reel.productName.trim() || reel.productName.length > 80) return false;
    const published = Date.parse(reel.publishedAt);
    if (!Number.isFinite(published) || published > Date.now()) return false;
    try {
      const destination = new URL(reel.destinationUrl);
      const thumbnail = new URL(reel.thumbnailUrl, location.href);
      const permalink = new URL(reel.permalink);
      if (destination.protocol !== "https:" || destination.username || destination.password || destination.port || !productHosts[reel.productId].includes(destination.hostname)) return false;
      if (reel.productId === "stashpin" && !/\/id6783395764(?:\/|$)/.test(destination.pathname)) return false;
      if (reel.productId === "levelio" && !/\/id6762884895(?:\/|$)/.test(destination.pathname)) return false;
      if (thumbnail.origin !== location.origin || !/^\/instagram\/[a-zA-Z0-9/_-]+\.(?:png|jpe?g|webp)$/.test(thumbnail.pathname) || thumbnail.search || thumbnail.hash) return false;
      if (permalink.protocol !== "https:" || permalink.hostname !== "www.instagram.com" || permalink.username || permalink.password || permalink.port || !/^\/(?:reel|p)\/[A-Za-z0-9_-]+\/?$/.test(permalink.pathname)) return false;
      return true;
    } catch { return false; }
  };
  const loadInstagramReels = async () => {
    const grid = document.querySelector("#instagram-reels");
    const status = document.querySelector("#instagram-status");
    if (!grid || !status) return;
    status.textContent = "Loading the latest Reel links…";
    try {
      const response = await fetch("instagram/reels.json", { cache: "no-cache" });
      if (!response.ok) throw new Error("Reel links unavailable");
      const feed = await response.json();
      if (feed.version !== 1 || !Array.isArray(feed.reels)) throw new Error("Invalid Reel links");
      const seen = new Set();
      const reels = feed.reels.filter(validReel).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).filter((reel) => {
        if (seen.has(reel.occurrenceId)) return false;
        seen.add(reel.occurrenceId);
        return true;
      });
      for (const [index, reel] of reels.entries()) {
        const card = document.createElement("article");
        card.className = "reel-card";
        const link = document.createElement("a");
        link.className = "reel-card-link product-link";
        link.href = reel.destinationUrl;
        link.dataset.product = reel.productId;
        link.dataset.content = `reel-card:${reel.occurrenceId}`;
        prepareLink(link);
        const visual = document.createElement("div");
        visual.className = "reel-image";
        const image = document.createElement("img");
        image.src = reel.thumbnailUrl;
        image.alt = "";
        image.width = 540;
        image.height = 960;
        image.loading = index < 3 ? "eager" : "lazy";
        image.decoding = "async";
        visual.append(image);
        if (index === 0) {
          const badge = document.createElement("span");
          badge.className = "reel-latest";
          badge.textContent = "Latest Reel";
          visual.append(badge);
        }
        const copy = document.createElement("div");
        copy.className = "reel-copy";
        const product = document.createElement("p");
        product.className = "reel-product";
        product.textContent = reel.productName;
        const title = document.createElement("h3");
        title.textContent = reel.title;
        const cta = document.createElement("span");
        cta.className = "reel-cta";
        cta.textContent = ["stashpin", "levelio"].includes(reel.productId) ? "Open in App Store ↗" : "Open this tool ↗";
        copy.append(product, title, cta);
        link.append(visual, copy);
        const original = document.createElement("a");
        original.className = "reel-original";
        original.href = reel.permalink;
        original.textContent = "Watch the Reel";
        original.setAttribute("aria-label", `Watch the Reel: ${reel.title}`);
        card.append(link, original);
        grid.append(card);
      }
      status.hidden = reels.length > 0;
      if (!reels.length) status.textContent = "Looking for a tool from a Reel? All seven products are linked below.";
    } catch {
      status.textContent = "Reel links couldn’t load. You can still browse all seven products below.";
    } finally {
      grid.setAttribute("aria-busy", "false");
    }
  };
  loadInstagramReels();

  if (getConsent() === "granted") measureLevelioLanding();
  if (consent && endpoint && !getConsent()) consent.hidden = false;
  document.querySelectorAll("[data-consent]").forEach((button) => {
    button.addEventListener("click", () => {
      try { localStorage.setItem(choiceKey, button.dataset.consent); } catch { /* Measurement remains off without stored consent. */ }
      if (consent) consent.hidden = true;
      if (button.dataset.consent === "granted") measureLevelioLanding();
    });
  });
})();
