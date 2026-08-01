(() => {
  const choiceKey = "theavgdevs_analytics_consent_v1";
  const consent = document.querySelector("#analytics-consent");
  const endpoint = document.querySelector('meta[name="theavgdevs-analytics-endpoint"]')?.content?.trim() || "";
  const query = new URLSearchParams(location.search);

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
  const source = isInstagramVisit ? "instagram" : "theavgdevs_hub";
  const medium = isInstagramVisit ? "organic_social" : "referral";

  document.querySelectorAll(".product-link").forEach((link) => {
    const product = link.dataset.product;
    const url = new URL(link.href);
    url.searchParams.set("utm_source", source);
    url.searchParams.set("utm_medium", medium);
    url.searchParams.set("utm_campaign", campaign);
    url.searchParams.set("utm_content", incomingContent || `hub-${product}`);
    link.href = url.toString();
  });

  const measure = (product, destination) => {
    if (localStorage.getItem(choiceKey) !== "granted" || !endpoint) return;
    const payload = JSON.stringify({
      consent: "granted",
      event: "portfolio_outbound",
      product_id: product,
      source,
      campaign,
      content: incomingContent || `hub-${product}`,
      destination_host: new URL(destination).host,
      observed_at: new Date().toISOString()
    });
    navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
  };

  document.querySelectorAll(".product-link").forEach((link) => {
    link.addEventListener("click", () => measure(link.dataset.product, link.href));
  });

  if (consent && !localStorage.getItem(choiceKey)) consent.hidden = false;
  document.querySelectorAll("[data-consent]").forEach((button) => {
    button.addEventListener("click", () => {
      localStorage.setItem(choiceKey, button.dataset.consent);
      if (consent) consent.hidden = true;
    });
  });
})();
