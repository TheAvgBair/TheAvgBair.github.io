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

  document.querySelectorAll(".product-link").forEach((link) => {
    const product = link.dataset.product;
    const url = new URL(link.href);
    url.searchParams.set("utm_source", source);
    url.searchParams.set("utm_medium", medium);
    url.searchParams.set("utm_campaign", campaign);
    url.searchParams.set("utm_content", incomingContent || (isLevelioLanding ? "levelio-app-store" : `hub-${product}`));
    link.href = url.toString();
  });

  const sendEvent = (payload) => {
    if (localStorage.getItem(choiceKey) !== "granted" || !endpoint) return;
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

  const measure = (product, destination) => {
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
      content: incomingContent || `hub-${product}`,
      destination_host: new URL(destination).host,
      observed_at: new Date().toISOString()
    });
  };

  document.querySelectorAll(".product-link").forEach((link) => {
    link.addEventListener("click", () => measure(link.dataset.product, link.href));
  });

  if (localStorage.getItem(choiceKey) === "granted") measureLevelioLanding();
  if (consent && endpoint && !localStorage.getItem(choiceKey)) consent.hidden = false;
  document.querySelectorAll("[data-consent]").forEach((button) => {
    button.addEventListener("click", () => {
      localStorage.setItem(choiceKey, button.dataset.consent);
      if (consent) consent.hidden = true;
      if (button.dataset.consent === "granted") measureLevelioLanding();
    });
  });
})();
