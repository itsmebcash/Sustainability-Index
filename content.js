// --- Safe localStorage patch for sandboxed frames ---
(function patchLocalStorage() {
  try {
    if (window.self !== window.top) {
      // In iframe: override localStorage with a dummy object
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
          clear: () => {},
        },
        configurable: true,
      });
    }
  } catch (e) {
    // Ignore if we can't patch (shouldn't throw)
  }
})();

// --- E-commerce domain restriction via Supabase ---
// Replace with your Supabase project URL and anon key
const supabaseUrl = "https://mvxqwljgphuvdtlnrugu.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12eHF3bGpncGh1dmR0bG5ydWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNzkzMTEsImV4cCI6MjA2NzY1NTMxMX0.vlMK9ysHzqHpSdaI4LlQcJsF49ZVASeIvWgWbfmwFjA";
let ecommerceDomains = [];

// Fetch the list of allowed e-commerce domains from Supabase
async function fetchEcommerceDomains() {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/ecommerce_domains?enabled=eq.true&select=domain`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );
    if (!response.ok) throw new Error("Failed to fetch domains");
    const data = await response.json();
    ecommerceDomains = data.map((d) => d.domain.toLowerCase());
  } catch (e) {
    // fallback to a default list if fetch fails
    ecommerceDomains = [
      "amazon.",
      "ebay.",
      "aliexpress.",
      "temu.",
      "walmart.",
      "etsy.",
      "flipkart.",
      "rakuten.",
      "bestbuy.",
      "target.",
    ];
  }
}

// Helper to check if current site is an allowed e-commerce domain
function isEcommerceSite() {
  const host = window.location.hostname.toLowerCase();
  return ecommerceDomains.some((domain) => host.includes(domain));
}
// Fetch and summarize web search results for product/brand sustainability
async function fetchSustainabilityWebSummary(title, brand = "") {
  // Use only the main product name (first part of title) and brand for the query
  let mainTitle = title;
  if (title && title.length > 0) {
    // Split on common separators and take the first part (most relevant)
    mainTitle = title.split(/[|,-]/)[0].trim();
    // If still too long, take first 6 words
    if (mainTitle.split(" ").length > 6) {
      mainTitle = mainTitle.split(" ").slice(0, 6).join(" ");
    }
  }
  const query = `${brand} ${mainTitle} sustainability ethical issues`.trim();
  const endpoint = `https://duckduckgo8.p.rapidapi.com/?q=${encodeURIComponent(
    query
  )}`;
  const rapidApiKey = "5e09ebcf46msh74d86497ba030a4p1105adjsn4f5690631cdd";
  try {
    // Use the same headers and method as the provided curl example
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "X-RapidAPI-Host": "duckduckgo8.p.rapidapi.com",
        "X-RapidAPI-Key": rapidApiKey,
      },
    });
    if (!response.ok) throw new Error("DuckDuckGo API error");
    const data = await response.json();
    // Summarize top results (titles + snippets)
    if (data && data.results && Array.isArray(data.results)) {
      const summary = data.results
        .slice(0, 5)
        .map((r) => `- ${r.title}: ${r.snippet}`)
        .join("\n");
      return summary || "No relevant web results found.";
    }
    return "No relevant web results found.";
  } catch (e) {
    console.error("DuckDuckGo web search error:", e);
    return "Web search unavailable.";
  }
}

// Truncate helper to avoid token limit errors
function truncate(str, maxLen) {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

// Analyze product with Groq AI, including web search summary for verification
// Update these values with the latest Groq API endpoint and model as needed
async function analyzeWithGroq(title, description, webSummary = "") {
  // TODO: Replace with your actual Groq API key and endpoint if changed
  const apiKey = "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"; // <-- Replace with your Groq API key
  const endpoint = "https://api.groq.com/openai/v1/chat/completions"; // <-- Update if Groq docs specify a new endpoint
  // Truncate to avoid token limit errors (adjust as needed)
  const maxDescLen = 1000;
  const maxWebLen = 1500;
  const safeDescription = truncate(description, maxDescLen);
  const safeWebSummary = truncate(webSummary, maxWebLen);
  // Use a model name that is available to your Groq account (check Groq docs)
  // Llama-3-70b is more capable of nuanced sustainability scoring than the 8b model
  const model = "llama3-70b-8192"; // More powerful model for better analysis
  // Get product-specific sustainability criteria
  let productTypeGuidelines = "";
  try {
    // Import from product_types.js file if available, otherwise use default criteria
    productTypeGuidelines = getProductTypeSpecificGuidelines(
      title,
      safeDescription
    );
  } catch (e) {
    console.warn("Could not get product-specific guidelines:", e);
    productTypeGuidelines =
      "Use general sustainability criteria appropriate for this product type.";
  }

  const prompt = `You are a sustainability expert evaluating a product's environmental impact. Analyze the product details and return a JSON object with the following fields:
- verifiedScore (0-100, integer, based on all info including web search)
- score (0-5, integer, based on product info only)
- manufacturingCountry (if found or can be inferred)
- co2Emissions (if you can estimate, else null)
- shippingMethod (guess if possible)
- explanation (detailed rationale for your score)
- productType (your assessment of what type of product this is)

Product Title: ${title}
Description: ${safeDescription}

Web search findings (for verification, ethical issues, brand reputation):
${safeWebSummary}

PRODUCT-SPECIFIC SUSTAINABILITY CRITERIA:
${productTypeGuidelines}

SCORING GUIDELINES - Score products according to these sustainability factors:

5/5 (Excellent): 
- Uses fully sustainable, renewable, or recycled materials
- Carbon-neutral or negative production
- Organic, plastic-free, or biodegradable
- Transparent and ethical supply chain
- Clear eco certifications (Fairtrade, FSC, GOTS, etc.)

4/5 (Good):
- Mostly sustainable materials or production methods
- Some eco-friendly certifications
- Reduced carbon footprint initiatives
- Some recycled or renewable content
- Evidence of ethical manufacturing

3/5 (Average):
- Some sustainable materials
- Standard industry practices
- Limited sustainability information
- Mixed materials (some sustainable, some not)
- Neutral environmental impact

2/5 (Below Average):
- Primarily non-renewable resources
- Energy-intensive manufacturing
- Minimal recycled content
- Limited transparency
- Some concerning materials (moderate plastic usage)

1/5 (Poor):
- Harmful materials (excess plastic, toxic chemicals)
- High carbon footprint
- No sustainability efforts
- No transparency
- Disposable or single-use product

0/5 (Not Assessable):
- Insufficient information to make assessment

IMPORTANT INSTRUCTIONS:
- Be critical and realistic - not all products deserve high scores
- If web search reveals unethical practices or greenwashing, reduce scores accordingly
- Use the full range of scores (1-5) - don't default to middle values
- Products with significant plastic content should generally score lower
- Organic and natural materials should generally score higher
- Be specific about why you assigned the score
- Consider both materials AND manufacturing processes in your assessment`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "system",
            content:
              "You are a critical sustainability expert specialized in evaluating products based on environmental impact, material sustainability, ethical production, and resource usage. Your assessments are accurate, differentiated, and well-researched. You prioritize factual evidence over marketing claims. Score different product types according to appropriate sustainability standards for their category.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 1024,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });
    if (response.status === 404) {
      // Graceful fallback: show message in UI and return null
      console.warn(
        "Groq API endpoint not found (404). Please check your endpoint or API key."
      );
      return null;
    }
    if (!response.ok) return null;
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    // Handle JSON response (should be direct JSON with response_format parameter)
    let ai = null;

    try {
      // First, try direct parsing (assuming we got proper JSON)
      ai = JSON.parse(text);
    } catch (err) {
      console.warn(
        "Direct JSON parse failed, trying to extract JSON from text"
      );

      // Fallback: try to extract JSON object from text
      let match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        console.error("No JSON object found in response:", text);
        return null;
      }

      try {
        ai = JSON.parse(match[0]);
      } catch (err) {
        // Attempt to fix common JSON issues from LLMs
        let fixed = match[0]
          .replace(/([,{\s])(\w+):/g, '$1"$2":') // quote property names
          .replace(/'/g, '"') // single to double quotes
          .replace(/,\s*}/g, "}"); // remove trailing commas

        try {
          ai = JSON.parse(fixed);
        } catch (err2) {
          console.error("JSON parsing failed even after fixes:", err2, fixed);
          return null;
        }
      }
    }

    // Validate the AI response structure
    if (!ai || typeof ai !== "object") {
      console.error("Invalid AI response structure:", ai);
      return null;
    }
    // Validate and normalize scores
    if (ai.score === undefined || ai.score === null) {
      console.warn("Missing score in AI response, defaulting to 0");
      ai.score = 0;
    } else {
      // Ensure score is an integer between 0-5
      ai.score = Math.min(5, Math.max(0, Math.round(Number(ai.score))));
    }

    if (ai.verifiedScore === undefined || ai.verifiedScore === null) {
      console.warn("Missing verifiedScore in AI response");
      ai.verifiedScore = null;
    } else {
      // Ensure verifiedScore is an integer between 0-100
      ai.verifiedScore = Math.min(
        100,
        Math.max(0, Math.round(Number(ai.verifiedScore)))
      );
    }

    // Ensure explanation exists
    if (!ai.explanation) {
      ai.explanation = "No detailed explanation available.";
    }

    // Add icons for badge
    ai.icons = getRatingIcons(ai.score);
    ai.webSummary = webSummary;

    // Log the final score for detailed debugging
    logSustainabilityScoreDebug(
      title,
      ai.score,
      ai.explanation,
      ai.productType
    );

    // Debug logger for sustainability scores - helps identify if scores are differentiated
    function logSustainabilityScoreDebug(
      title,
      score,
      explanation,
      productType
    ) {
      const shortTitle = title?.substring(0, 30) || "Unknown product";
      const formattedScore = score !== null ? score : "N/A";
      const shortExplanation =
        explanation?.substring(0, 100) || "No explanation";

      console.log(
        `%c Sustainability Score Debug %c ${formattedScore}/5 %c ${shortTitle}`,
        "background: #2c3e50; color: white; padding: 2px 0;",
        `background: ${
          score >= 4
            ? "#4caf50"
            : score >= 3
            ? "#ff9800"
            : score >= 1
            ? "#f44336"
            : "#9e9e9e"
        }; color: white; padding: 2px 4px;`,
        "background: #f8f9fa; color: #333; padding: 2px 0;"
      );

      console.log(
        `Product Type: ${
          productType || "Unknown"
        }\nExplanation: ${shortExplanation}...`
      );
    }
    // Call this debug function after getting AI analysis
    logSustainabilityScoreDebug(
      title,
      ai.score,
      ai.explanation,
      ai.productType
    );

    return ai;
  } catch (e) {
    // Show a more user-friendly error in the console
    console.error("Groq AI error (network or parsing):", e);
    return null;
  }
}
// Global settings
let settings = {
  enabled: true,
  alternatives: true,
  detailed: true,
};

// Declare chrome variable if it's not already defined
if (typeof chrome === "undefined") {
  var chrome = chrome || {};
  chrome.runtime = chrome.runtime || {};
  chrome.runtime.sendMessage =
    chrome.runtime.sendMessage ||
    (() => {
      console.warn(
        "chrome.runtime.sendMessage is not available in this context."
      );
    });
}

// Load settings
chrome.storage.sync.get(
  {
    enabled: true,
    alternatives: true,
    detailed: true,
  },
  (items) => {
    settings = items;
    init();
  }
);

// Listen for settings updates
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateSettings") {
    settings = request.settings;
    updateUI();
  }
});

// Initialize the extension
async function init() {
  if (!settings.enabled) return;
  await fetchEcommerceDomains();
  if (!isEcommerceSite()) return; // Only run on e-commerce sites
  detectProductPage();
}

// Update UI based on settings changes
function updateUI() {
  const badge = document.getElementById("supply-chain-badge");
  const details = document.getElementById("supply-chain-details");

  if (!settings.enabled && badge) {
    badge.style.display = "none";
    if (details) details.style.display = "none";
    return;
  }

  if (badge) badge.style.display = "flex";

  if (details) {
    const alternatives = details.querySelector(".supply-chain-alternatives");
    if (alternatives) {
      alternatives.style.display = settings.alternatives ? "block" : "none";
    }

    const report = details.querySelector(".supply-chain-report");
    if (report) {
      report.style.display = settings.detailed ? "block" : "none";
    }
  }
}

// Update the detectProductPage function to better handle Amazon product pages
function detectProductPage() {
  // More comprehensive selectors for product pages
  const priceSelectors = [
    // Common price selectors
    ".price",
    ".a-price",
    ".a-price-whole",
    ".a-price-fraction",
    '[data-testid="price-wrap"]',
    '[data-test="product-price"]',
    ".product-price",
    ".price-current",
    ".current-price",
    ".product__price",
    ".product-meta__price",
    ".money",
    // Amazon specific
    "#priceblock_ourprice",
    "#price_inside_buybox",
    "#corePrice_feature_div",
    ".priceToPay",
    // Temu specific
    ".price-tag",
    ".price-tag-text",
    ".price-tag-num",
    // Generic price patterns
    'span:contains("$")',
    'div:contains("$")',
    // Currency symbols for different regions
    'span:contains("€")',
    'span:contains("£")',
    'span:contains("¥")',
  ];

  // Product title selectors
  const titleSelectors = [
    "h1.product-title",
    "#productTitle",
    ".product-name",
    '[data-test="product-title"]',
    ".product__title",
    ".product-single__title",
    ".product-meta__title",
    // Amazon specific
    "#title",
    ".product-title-word-break",
    // Generic - any h1 is likely a product title on a product page
    "h1",
  ];

  // Add to cart button selectors
  const cartButtonSelectors = [
    ".add-to-cart",
    "#add-to-cart-button",
    ".btn-add-to-cart",
    '[data-action="add-to-cart"]',
    '[data-testid="add-to-cart"]',
    'button:contains("Add to Cart")',
    'button:contains("Add to Bag")',
    'button:contains("Buy Now")',
    'button:contains("Purchase")',
    // Amazon specific
    "#add-to-cart-button",
    "#buy-now-button",
    // Temu specific
    ".add-to-cart-btn",
    ".buy-now-btn",
  ];

  // Product image selectors
  const imageSelectors = [
    ".product-image",
    ".product__image",
    ".product-single__photo",
    "#product-image",
    ".product-gallery__image",
    // Amazon specific
    "#landingImage",
    "#imgTagWrapperId img",
    ".imgTagWrapper img",
    // Temu specific
    ".product-image-container",
    ".product-image-wrapper",
  ];

  // Check for product page indicators
  let isProductPage = false;
  let priceElement = null;
  let titleElement = null;

  // First check URL patterns common for product pages
  const url = window.location.href;
  if (
    url.includes("/product/") ||
    url.includes("/products/") ||
    url.includes("/item/") ||
    url.includes("/dp/") ||
    url.includes("/gp/product/") ||
    url.includes("/p/") ||
    url.includes("/B0") // Amazon product IDs often start with B0
  ) {
    isProductPage = true;
  }

  // Then check for price elements
  for (const selector of priceSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        // Use the first visible price element
        for (const element of elements) {
          if (
            isElementVisible(element) &&
            element.textContent.trim().match(/[$€£¥]/)
          ) {
            priceElement = element;
            isProductPage = true;
            break;
          }
        }
        if (priceElement) break;
      }
    } catch (e) {
      // Ignore errors from invalid selectors
      console.debug("Error with selector:", selector, e);
    }
  }

  // Check for title elements
  for (const selector of titleSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element && isElementVisible(element)) {
        titleElement = element;
        isProductPage = true;
        break;
      }
    } catch (e) {
      console.debug("Error with selector:", selector, e);
    }
  }

  // Check for add to cart buttons as a strong indicator
  for (const selector of cartButtonSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element && isElementVisible(element)) {
        isProductPage = true;
        break;
      }
    } catch (e) {
      console.debug("Error with selector:", selector, e);
    }
  }

  // Check for product images
  for (const selector of imageSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element && isElementVisible(element)) {
        isProductPage = true;
        break;
      }
    } catch (e) {
      console.debug("Error with selector:", selector, e);
    }
  }

  // Amazon-specific checks
  if (window.location.hostname.includes("amazon")) {
    // Check for Amazon product page specific elements
    if (
      document.querySelector("#productTitle, #title, .product-title-word-break")
    ) {
      isProductPage = true;
    }

    // If we're on Amazon and it's a product page, make sure we have a price element
    if (isProductPage && !priceElement) {
      priceElement = document.querySelector(
        ".a-price, #priceblock_ourprice, #price_inside_buybox, .priceToPay"
      );
    }

    // If we're on Amazon and it's a product page, make sure we have a title element
    if (isProductPage && !titleElement) {
      titleElement = document.querySelector(
        "#productTitle, #title, .product-title-word-break"
      );
    }
  }

  // If we've determined this is a product page, proceed
  if (isProductPage) {
    try {
      // If we don't have a price element yet, try to find any element with a price pattern
      if (!priceElement) {
        const priceRegex = /\$\d+(\.\d{2})?/;
        const allElements = document.querySelectorAll("*");
        for (const element of allElements) {
          if (
            element.textContent &&
            priceRegex.test(element.textContent) &&
            isElementVisible(element)
          ) {
            priceElement = element;
            break;
          }
        }
      }

      // If we still don't have a price element, use the title element or body as fallback
      if (!priceElement) {
        priceElement = titleElement || document.body;
      }

      // Extract product title
      const productTitle =
        (titleElement ? titleElement.textContent.trim() : "") ||
        document.title ||
        "Product";

      // Try to extract brand name from common selectors or meta tags
      let productBrand = "";
      const brandSelectors = [
        ".brand",
        ".product-brand",
        '[itemprop="brand"]',
        "[data-brand]",
        ".a-brand",
        "#bylineInfo",
        ".brand-name",
        ".productMeta-brand",
        ".product-meta__vendor",
        ".product-vendor",
        ".manufacturer",
        '[data-testid="brand-name"]',
        '[data-test="brand-name"]',
      ];
      for (const selector of brandSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim().length > 0) {
          productBrand = el.textContent.trim();
          break;
        }
      }
      // Fallback: try meta tag
      if (!productBrand) {
        const metaBrand = document.querySelector(
          'meta[name="brand"], meta[property="og:brand"]'
        );
        if (metaBrand && metaBrand.content) {
          productBrand = metaBrand.content.trim();
        }
      }

      // Extract comprehensive product description and details - more thorough product info gathering
      let productDescription = "";

      // Try meta description first
      const metaDesc =
        document.querySelector('meta[name="description"]')?.content || "";
      if (metaDesc) productDescription += metaDesc + "\n\n";

      // Common product description selectors - combine them all for better data
      const descriptionSelectors = [
        ".product-description",
        "#productDescription",
        "#feature-bullets",
        ".a-expander-content",
        ".product-overview",
        ".product-info",
        "[data-testid='product-description']",
        ".product__description",
        ".details-panel",
        ".product-details-wrapper",
        ".prod-detail",
        ".prod-info",
        ".product-features",
        "#description",
        ".description",
        "#item-description",
        ".item-description",
        ".summary",
        ".specs",
        ".specifications",
      ];

      // Extract from all selectors and combine
      descriptionSelectors.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        if (elements && elements.length > 0) {
          elements.forEach((element) => {
            const text = element.textContent.trim();
            if (text && text.length > 10) {
              productDescription += text + "\n\n";
            }
          });
        }
      });

      // If still empty, try to find any paragraph that might contain product info
      if (!productDescription) {
        const paragraphs = document.querySelectorAll("p");
        if (paragraphs && paragraphs.length > 0) {
          paragraphs.forEach((p) => {
            const text = p.textContent.trim();
            if (text && text.length > 40 && text.length < 1000) {
              productDescription += text + "\n\n";
            }
          });
        }
      }

      productDescription =
        productDescription.trim() || "No product description found.";

      // Extract product details (materials, specifications, etc.)
      const productDetails = extractProductDetails();

      // Extract sustainability claims or eco labels if available
      const sustainabilityClaims = extractSustainabilityClaims();

      // Construct comprehensive product info
      const enhancedDescription = `
PRODUCT DESCRIPTION:
${productDescription}

PRODUCT DETAILS:
${productDetails}

SUSTAINABILITY CLAIMS:
${sustainabilityClaims}
      `.trim();

      // Fetch web search summary using both brand and title, then analyze with Groq AI
      fetchSustainabilityWebSummary(productTitle, productBrand)
        .then((webSummary) =>
          analyzeWithGroq(productTitle, enhancedDescription, webSummary)
        )
        .then((aiScore) => {
          if (aiScore) {
            insertSupplyChainBadge(priceElement, aiScore);
          } else {
            // fallback: show N/A if AI fails
            insertSupplyChainBadge(priceElement, {
              score: null,
              verifiedScore: null,
              manufacturingCountry: null,
              co2Emissions: null,
              shippingMethod: null,
              icons: "",
              explanation: "No sustainability data available.",
            });
          }
        })
        .catch(() => {
          // fallback: show N/A if AI fails
          insertSupplyChainBadge(priceElement, {
            score: null,
            verifiedScore: null,
            manufacturingCountry: null,
            co2Emissions: null,
            shippingMethod: null,
            icons: "",
            explanation: "No sustainability data available.",
          });
        });
    } catch (error) {
      console.error("Error processing product page:", error);
      // Fallback to body if there's an error
      try {
        analyzeWithGroq(document.title, "")
          .then((aiScore) => {
            if (aiScore) {
              insertSupplyChainBadge(document.body, aiScore);
            } else {
              insertSupplyChainBadge(document.body, {
                score: null,
                verifiedScore: null,
                manufacturingCountry: null,
                co2Emissions: null,
                shippingMethod: null,
                icons: "",
                explanation: "No sustainability data available.",
              });
            }
          })
          .catch(() => {
            insertSupplyChainBadge(document.body, {
              score: null,
              verifiedScore: null,
              manufacturingCountry: null,
              co2Emissions: null,
              shippingMethod: null,
              icons: "",
              explanation: "No sustainability data available.",
            });
          });
      } catch (fallbackError) {
        console.error("Fallback error:", fallbackError);
      }
    }
  }
}

function isElementVisible(element) {
  if (!element) return false;

  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  // Check if element has size and is in viewport
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

// Country CO2 emission factors (simplified for demonstration)
const countryEmissionFactors = {
  china: 0.8,
  india: 0.7,
  bangladesh: 0.6,
  vietnam: 0.65,
  usa: 0.5,
  germany: 0.4,
  france: 0.3,
  italy: 0.35,
  spain: 0.4,
  uk: 0.45,
  japan: 0.5,
  "south korea": 0.55,
  taiwan: 0.6,
  malaysia: 0.65,
  indonesia: 0.7,
  thailand: 0.65,
  turkey: 0.55,
  mexico: 0.6,
  brazil: 0.55,
  canada: 0.5,
  australia: 0.6,
  sweden: 0.25,
  finland: 0.3,
  norway: 0.2,
  denmark: 0.3,
  netherlands: 0.4,
  belgium: 0.45,
  switzerland: 0.3,
  austria: 0.35,
  poland: 0.6,
  "czech republic": 0.55,
  hungary: 0.5,
  romania: 0.6,
  bulgaria: 0.65,
  greece: 0.5,
  portugal: 0.45,
  ireland: 0.4,
  singapore: 0.5,
  "hong kong": 0.55,
  uae: 0.7,
  "saudi arabia": 0.75,
  "south africa": 0.7,
  egypt: 0.65,
  morocco: 0.6,
  kenya: 0.55,
  nigeria: 0.7,
  ethiopia: 0.5,
  pakistan: 0.65,
  "sri lanka": 0.6,
  cambodia: 0.65,
  myanmar: 0.7,
  philippines: 0.6,
  "new zealand": 0.4,
};

// Approximate distances to Finland from major manufacturing countries (in km)
const distanceToFinland = {
  china: 7000,
  india: 6000,
  bangladesh: 6500,
  vietnam: 8000,
  usa: 7500,
  germany: 1500,
  france: 2000,
  italy: 2500,
  spain: 3000,
  uk: 1800,
  japan: 8500,
  "south korea": 7800,
  taiwan: 8200,
  malaysia: 9000,
  indonesia: 10000,
  thailand: 8500,
  turkey: 3000,
  mexico: 9500,
  brazil: 10500,
  canada: 6500,
  australia: 15000,
  sweden: 400,
  finland: 0,
  norway: 800,
  denmark: 1000,
  netherlands: 1600,
  belgium: 1800,
  switzerland: 2200,
  austria: 1800,
  poland: 1000,
  "czech republic": 1500,
  hungary: 1800,
  romania: 2000,
  bulgaria: 2300,
  greece: 2800,
  portugal: 3500,
  ireland: 2200,
  singapore: 9500,
  "hong kong": 8000,
  uae: 5000,
  "saudi arabia": 4800,
  "south africa": 9500,
  egypt: 4000,
  morocco: 4500,
  kenya: 7000,
  nigeria: 6500,
  ethiopia: 6000,
  pakistan: 5500,
  "sri lanka": 7500,
  cambodia: 8300,
  myanmar: 7800,
  philippines: 9000,
  "new zealand": 17000,
};

// Calculate CO2 emissions based on manufacturing country and shipping to Finland
function calculateCO2Emissions(manufacturingCountry) {
  // Default values if country not found
  let emissionFactor = 0.6; // Average emission factor
  let distance = 5000; // Average distance

  // Normalize country name
  const normalizedCountry = manufacturingCountry.toLowerCase();

  // Look up emission factor and distance
  if (countryEmissionFactors[normalizedCountry]) {
    emissionFactor = countryEmissionFactors[normalizedCountry];
  }

  if (distanceToFinland[normalizedCountry]) {
    distance = distanceToFinland[normalizedCountry];
  }

  // Simple calculation: manufacturing emissions + shipping emissions
  // Manufacturing: emission factor * base value
  // Shipping: distance * shipping emission factor
  const manufacturingEmissions = emissionFactor * 10; // Base manufacturing CO2 of 10kg
  const shippingEmissionFactor = 0.0002; // kg CO2 per km (simplified)
  const shippingEmissions = distance * shippingEmissionFactor;

  return {
    total: Math.round((manufacturingEmissions + shippingEmissions) * 10) / 10,
    manufacturing: Math.round(manufacturingEmissions * 10) / 10,
    shipping: Math.round(shippingEmissions * 10) / 10,
    distance: distance,
  };
}

// Update the calculateSupplyChainScore function to better detect eco-friendly products

// (Removed) calculateSupplyChainScore: All scoring is now handled by AI in analyzeWithGroq.

// Get rating icons based on score (0-5)
function getRatingIcons(score) {
  let icons = "";
  // Filled green leaf SVG for positive ratings
  const filledLeaf = `<svg width='18' height='18' viewBox='0 0 24 24' fill='#4caf50' stroke='#388e3c' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round' style='vertical-align:middle;'><path d='M2 22s16-4 20-20C6 2 2 22 2 22z'></path></svg>`;
  // Light gray filled leaf SVG for negative ratings
  const grayLeaf = `<svg width='18' height='18' viewBox='0 0 24 24' fill='#e0e0e0' stroke='#bdbdbd' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round' style='vertical-align:middle;'><path d='M2 22s16-4 20-20C6 2 2 22 2 22z'></path></svg>`;
  for (let i = 0; i < score; i++) {
    icons += filledLeaf;
  }
  for (let i = score; i < 5; i++) {
    icons += grayLeaf;
  }
  return icons;
}

// Generate detailed explanation of score
function generateSupplyChainDetails(score) {
  const details = {
    summary: "",
    transparency: "Low",
    transparencyExplanation:
      "Limited information available about how this product was made and sourced.",
    riskLevel: "High",
    riskExplanation:
      "Higher chance of unsustainable practices in manufacturing and shipping.",
    recommendations: [],
  };

  // Generate summary based on score
  if (score >= 4) {
    details.summary =
      "Great transparency! Clear information about manufacturing and sourcing.";
    details.transparency = "High";
    details.transparencyExplanation =
      "Detailed information available about materials, manufacturing, and supply chain.";
    details.riskLevel = "Low";
    details.riskExplanation =
      "Lower chance of hidden environmental or social issues.";
    details.recommendations = [
      "Verify claims through third-party sources",
      "Check for certification updates",
    ];
  } else if (score >= 3) {
    details.summary =
      "Good transparency. Basic information about origins and manufacturing.";
    details.transparency = "Good";
    details.transparencyExplanation =
      "Some information available, but could be more detailed.";
    details.riskLevel = "Medium-Low";
    details.riskExplanation =
      "Some potential for hidden issues, but generally trustworthy.";
    details.recommendations = [
      "Ask for supplier details",
      "Look for certifications",
    ];
  } else if (score >= 2) {
    details.summary =
      "Average transparency. Basic manufacturing info, limited details.";
    details.transparency = "Medium";
    details.transparencyExplanation =
      "Only basic information provided, many details missing.";
    details.riskLevel = "Medium";
    details.riskExplanation =
      "Moderate chance of unsustainable practices not being disclosed.";
    details.recommendations = [
      "Request material sourcing information",
      "Consider more transparent alternatives",
    ];
  } else if (score >= 1) {
    details.summary =
      "Below average transparency. Limited information about production.";
    details.transparency = "Low";
    details.transparencyExplanation =
      "Very little information about how or where this was made.";
    details.riskLevel = "Medium-High";
    details.riskExplanation =
      "Higher chance of unsustainable or unethical practices.";
    details.recommendations = [
      "Contact seller for manufacturing details",
      "Look for more transparent options",
    ];
  } else {
    details.summary =
      "Poor transparency. No information about origins or production.";
    details.transparency = "None";
    details.transparencyExplanation =
      "No information provided about how or where this was made.";
    details.riskLevel = "High";
    details.riskExplanation =
      "Unable to assess sustainability due to lack of information.";
    details.recommendations = [
      "Avoid products with no supply chain information",
      "Choose brands that share production details",
    ];
  }

  return details;
}

// Insert supply chain badge next to price
function insertSupplyChainBadge(priceElement, scoreData) {
  // Always recalculate the score here to guarantee badge and modal match
  // Calculate score based on five criteria only (removed web verification)
  let badgeOriginPoints =
    scoreData.manufacturingCountry &&
    scoreData.manufacturingCountry !== "Unknown"
      ? 1
      : 0;

  // Use the same transparency logic for consistency
  let badgeTransparencyPoints = 0;
  const badgeSupplyChainDetails = generateSupplyChainDetails(scoreData.score);
  if (badgeSupplyChainDetails.transparency === "High")
    badgeTransparencyPoints = 1;
  else if (badgeSupplyChainDetails.transparency === "Good")
    badgeTransparencyPoints = 0.5; // Changed to 0.5 max for partial transparency
  else if (badgeSupplyChainDetails.transparency === "Medium")
    badgeTransparencyPoints = 0.5;
  else if (badgeSupplyChainDetails.transparency === "Low")
    badgeTransparencyPoints = 0.5; // Even low transparency gets partial credit
  else badgeTransparencyPoints = 0;

  // Each criterion is worth exactly 1 point max
  let badgeCertPoints =
    scoreData.explanation && /certificat/i.test(scoreData.explanation) ? 1 : 0;

  let badgeMaterialPoints =
    scoreData.explanation &&
    /organic|recycled|sustainable|cotton|bamboo|hemp|linen|wool|biodegradable/i.test(
      scoreData.explanation
    )
      ? 1
      : 0;

  let badgeEnvPoints =
    scoreData.explanation &&
    /carbon|neutral|offset|water|zero waste|renewable|energy|eco/i.test(
      scoreData.explanation
    )
      ? 1
      : 0;

  // Calculate score without web verification - only 5 criteria count
  let badgeCalculatedScore =
    badgeOriginPoints +
    badgeTransparencyPoints +
    badgeCertPoints +
    badgeMaterialPoints +
    badgeEnvPoints;

  // Ensure score is within range 0-5
  badgeCalculatedScore = Math.max(0, badgeCalculatedScore);
  badgeCalculatedScore = Math.min(5, badgeCalculatedScore);

  // Round to nearest half-point for cleaner display
  badgeCalculatedScore = Math.round(badgeCalculatedScore * 2) / 2;

  // Log detailed score calculation for badge
  console.log(`Badge sustainability score calculation:
    - Origin Information: ${badgeOriginPoints} point(s)
    - Supply Chain Transparency: ${badgeTransparencyPoints} point(s)
    - Certifications: ${badgeCertPoints} point(s)
    - Material Sourcing: ${badgeMaterialPoints} point(s)
    - Environmental Practices: ${badgeEnvPoints} point(s)
    = Total: ${badgeCalculatedScore}/5
  `);

  // Update the scoreData object with our calculated score
  scoreData.calculatedScore = badgeCalculatedScore;
  scoreData.score = badgeCalculatedScore;
  scoreData.icons = getRatingIcons(Math.round(scoreData.score));

  // Create badge element
  const badge = document.createElement("div");
  badge.id = "supply-chain-badge";
  badge.className = "supply-chain-badge";
  badge.style.display = settings.enabled ? "flex" : "none";

  // Determine badge color based on score
  const badgeColor = scoreData.score > 0 ? "#4caf50" : "#e53935"; // Green if > 0, red if 0

  // Badge revision: add title, keep score and leaf in one line, remove label text
  badge.innerHTML = `
    <div class="supply-chain-badge-content sleek-badge" style="background: #fff; border-radius: 18px; box-shadow: 0 2px 12px 0 rgba(60,60,60,0.10); padding: 8px 18px 8px 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 120px;">
      <span class="supply-chain-badge-title" style="font-size: 0.95em; font-weight: 600; color: #222; letter-spacing: 0.01em; margin-bottom: 2px;">Sustainability Score</span>
      <span style="display: flex; align-items: center; gap: 8px;">
        <span class="supply-chain-score" style="color: ${badgeColor}; font-size: 1.15em; font-weight: 700;">
          ${
            scoreData.score !== null && scoreData.score !== undefined
              ? `${scoreData.score}/5`
              : "N/A"
          }
        </span>
        <span class="supply-chain-icons" style="font-size: 1.2em; display: flex; align-items: center;">${
          scoreData.icons
        }</span>
      </span>
    </div>
  `;

  // Try to insert badge after price element
  try {
    if (priceElement.parentNode) {
      priceElement.parentNode.insertBefore(badge, priceElement.nextSibling);
    } else {
      // Fallback: Create a fixed position badge if we can't insert it normally
      badge.style.position = "fixed";
      badge.style.top = "10px";
      badge.style.right = "10px";
      badge.style.zIndex = "9999";
      document.body.appendChild(badge);
    }
  } catch (e) {
    // Fallback: Create a fixed position badge
    badge.style.position = "fixed";
    badge.style.top = "10px";
    badge.style.right = "10px";
    badge.style.zIndex = "9999";
    document.body.appendChild(badge);
  }

  // Create details popup
  const details = document.createElement("div");
  details.id = "supply-chain-details";
  details.className = "supply-chain-details";
  details.style.display = "none";

  // Generate details - use AI explanation if available, otherwise use generated details
  const supplyChainDetails = generateSupplyChainDetails(scoreData.score);

  // Get CO2 comparisons for context
  const co2Comparisons = getEmissionComparisons(
    scoreData.co2Emissions?.total || 0
  );

  // Determine if emissions are high
  const isHighEmission = scoreData.co2Emissions?.total > 15;

  // Limit explanation to 2-3 lines (about 220 characters, break at sentence end if possible)
  function truncateExplanation(text, maxLen = 220) {
    if (!text) return "";
    if (text.length <= maxLen) return text;
    // Try to break at the end of the last sentence within maxLen
    const truncated = text.slice(0, maxLen);
    const lastPeriod = truncated.lastIndexOf(".");
    if (lastPeriod > 50) return truncated.slice(0, lastPeriod + 1);
    return truncated + "...";
  }

  // --- NEW: Improved origin detection logic ---
  if (
    !scoreData.manufacturingCountry ||
    scoreData.manufacturingCountry === "Unknown" ||
    scoreData.manufacturingCountry === null
  ) {
    // Try to extract "Made in <Country>" from product description
    let madeInMatch = null;
    if (scoreData.explanation) {
      madeInMatch = scoreData.explanation.match(/made in ([A-Za-z ]+)/i);
    }
    if (madeInMatch && madeInMatch[1]) {
      // Found made in country in product description
      scoreData.manufacturingCountry = madeInMatch[1].trim();
      // Try to get user's country from website (shipping location)
      let userCountry = null;
      // Try to get from common selectors or fallback to browser language
      const countrySelectors = [
        "[data-shipping-country]",
        "#shippingCountry",
        ".shipping-country",
        'select[name="country"]',
        'input[name="country"]',
        ".locale-country",
      ];
      for (const selector of countrySelectors) {
        const el = document.querySelector(selector);
        if (el) {
          if (el.value) userCountry = el.value;
          else if (el.textContent) userCountry = el.textContent.trim();
          if (userCountry) break;
        }
      }
      if (!userCountry && navigator.language) {
        // Fallback: use browser language country
        const lang = navigator.language.split("-");
        if (lang.length > 1) userCountry = lang[1];
      }
      // Calculate CO2 emissions based on made in country and user country (if available)
      scoreData.co2Emissions = calculateCO2Emissions(
        scoreData.manufacturingCountry
      );
      scoreData.userCountry = userCountry || null;
    } else {
      // No made in info in description, try to get brand origin from web search
      let productBrand = scoreData.productBrand;
      if (!productBrand) {
        const brandSelectors = [
          ".brand",
          ".product-brand",
          '[itemprop="brand"]',
          "[data-brand]",
          ".a-brand",
          "#bylineInfo",
          ".brand-name",
          ".productMeta-brand",
          ".product-meta__vendor",
          ".product-vendor",
          ".manufacturer",
          '[data-testid="brand-name"]',
          '[data-test="brand-name"]',
        ];
        for (const selector of brandSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent.trim().length > 0) {
            productBrand = el.textContent.trim();
            break;
          }
        }
        // Fallback: try meta tag
        if (!productBrand) {
          const metaBrand = document.querySelector(
            'meta[name="brand"], meta[property="og:brand"]'
          );
          if (metaBrand && metaBrand.content) {
            productBrand = metaBrand.content.trim();
          }
        }
      }
      let productTitle =
        document.querySelector(".supply-chain-badge-title")?.textContent ||
        document.title;
      let searchQuery = productBrand
        ? `in which country ${productBrand} is made?`
        : `in which country ${productTitle} is made?`;
      console.log(
        "[DEBUG] Brand origin fallback: productBrand=",
        productBrand,
        "productTitle=",
        productTitle,
        "searchQuery=",
        searchQuery
      );
      fetchSustainabilityWebSummary(searchQuery, "").then((webSummary) => {
        console.log("[DEBUG] Web summary for brand origin search:", webSummary);
        // Use Groq AI to analyze the web search results for the most likely country
        analyzeWithGroq(searchQuery, webSummary, "").then((aiResult) => {
          console.log("[DEBUG] Groq AI result for brand origin:", aiResult);
          if (aiResult && aiResult.manufacturingCountry) {
            console.log(
              "[DEBUG] Groq AI extracted manufacturingCountry:",
              aiResult.manufacturingCountry
            );
            scoreData.brandOriginCountry = aiResult.manufacturingCountry;
          } else {
            // fallback: try to extract a likely country from the web summary using a simple regex for country names
            const countryList = [
              "China",
              "India",
              "Bangladesh",
              "Vietnam",
              "USA",
              "United States",
              "Germany",
              "France",
              "Italy",
              "Spain",
              "UK",
              "United Kingdom",
              "Japan",
              "South Korea",
              "Taiwan",
              "Malaysia",
              "Indonesia",
              "Thailand",
              "Turkey",
              "Mexico",
              "Brazil",
              "Canada",
              "Australia",
              "Sweden",
              "Finland",
              "Norway",
              "Denmark",
              "Netherlands",
              "Belgium",
              "Switzerland",
              "Austria",
              "Poland",
              "Czech Republic",
              "Hungary",
              "Romania",
              "Bulgaria",
              "Greece",
              "Portugal",
              "Ireland",
              "Singapore",
              "Hong Kong",
              "UAE",
              "Saudi Arabia",
              "South Africa",
              "Egypt",
              "Morocco",
              "Kenya",
              "Nigeria",
              "Ethiopia",
              "Pakistan",
              "Sri Lanka",
              "Cambodia",
              "Myanmar",
              "Philippines",
              "New Zealand",
            ];
            let foundCountry = null;
            for (const country of countryList) {
              const regex = new RegExp(`\\b${country}\\b`, "i");
              if (webSummary && regex.test(webSummary)) {
                foundCountry = country;
                break;
              }
            }
            console.log("[DEBUG] Regex fallback found country:", foundCountry);
            if (foundCountry) {
              scoreData.brandOriginCountry = foundCountry;
            }
          }
        });
      });
    }
  }

  // Show how the score is being calculated instead of a text summary
  // --- Calculate points for each section - EXACTLY the same logic as in badge ---
  let originPoints =
    scoreData.manufacturingCountry &&
    scoreData.manufacturingCountry !== "Unknown"
      ? 1
      : 0;

  // Transparency is worth max 1 point, but can be 0.5 for partial transparency
  let transparencyPoints = 0;
  if (supplyChainDetails.transparency === "High") transparencyPoints = 1;
  else if (supplyChainDetails.transparency === "Good")
    transparencyPoints = 0.5; // Changed to 0.5 for partial transparency
  else if (supplyChainDetails.transparency === "Medium")
    transparencyPoints = 0.5;
  else if (supplyChainDetails.transparency === "Low") transparencyPoints = 0.5;
  else transparencyPoints = 0;

  // Each criterion is worth exactly 1 point max
  let certPoints =
    scoreData.explanation && /certificat/i.test(scoreData.explanation) ? 1 : 0;

  let materialPoints =
    scoreData.explanation &&
    /organic|recycled|sustainable|cotton|bamboo|hemp|linen|wool|biodegradable/i.test(
      scoreData.explanation
    )
      ? 1
      : 0;

  let envPoints =
    scoreData.explanation &&
    /carbon|neutral|offset|water|zero waste|renewable|energy|eco/i.test(
      scoreData.explanation
    )
      ? 1
      : 0;

  // Web verification is tracked but NOT included in score calculation
  // It's only used to verify the claims in the product description
  let webPoints = 0;
  if (
    scoreData.verifiedScore !== null &&
    scoreData.verifiedScore !== undefined
  ) {
    // Calculate web points for display purposes only (no impact on score)
    webPoints = Math.min(1, scoreData.verifiedScore / 100);
    webPoints = Math.round(webPoints * 100) / 100;
  }

  // ROBUSTLY RECALCULATE TOTAL SCORE based only on the 5 criteria
  // Sum all points from each category (excluding web verification)
  let calculatedScore =
    originPoints + transparencyPoints + certPoints + materialPoints + envPoints;

  // Ensure score is within range 0-5
  calculatedScore = Math.max(0, calculatedScore);
  calculatedScore = Math.min(5, calculatedScore);

  // Round to nearest half-point for cleaner display
  calculatedScore = Math.round(calculatedScore * 2) / 2;

  // Log detailed score calculation
  console.log(`Modal sustainability score calculation:
    - Origin Information: ${originPoints} point(s)
    - Supply Chain Transparency: ${transparencyPoints} point(s)
    - Certifications: ${certPoints} point(s)
    - Material Sourcing: ${materialPoints} point(s)
    - Environmental Practices: ${envPoints} point(s)
    = Total: ${calculatedScore}/5 (Web verification excluded from score)
  `);

  // Store original score for logging
  const originalScore = scoreData.score;

  // Update the scoreData object with our calculated score for reference
  scoreData.calculatedScore = calculatedScore;

  // Update the display score to use our calculated value
  // This ensures both the badge and modal use the same calculated score
  scoreData.score = calculatedScore;

  // Update icons to match new score (using rounded value for icons)
  scoreData.icons = getRatingIcons(Math.round(scoreData.score));

  console.log(
    `Score updated: ${originalScore} → ${scoreData.score} (5 criteria only, no web verification)`
  );

  // Compose the breakdown UI ("How This Rating Is Calculated" section removed as requested)
  details.innerHTML = `
    <div class="supply-chain-header">
      <h3>Sustainability Index: <br> <br> <span style="color: ${badgeColor}">${
    scoreData.score
  }/5 ${scoreData.icons}</span></h3>
      <button class="supply-chain-close">×</button>
    </div>
    <div class="supply-chain-summary-box">
      <div class="score-breakdown">
        <h4 style="margin-bottom: 8px;">How this score is calculated:</h4>
        
        <ul style="list-style: disc inside; margin:0; padding-left: 18px;">
          <li><b>Origin Information</b> (${originPoints} point${
    originPoints !== 1 ? "s" : ""
  }):
            <span>${
              scoreData.manufacturingCountry &&
              scoreData.manufacturingCountry !== "Unknown"
                ? `Manufactured in <b>${scoreData.manufacturingCountry}</b>`
                : scoreData.brandOriginCountry
                ? `⚠️ The brand seems to be originated from <b>${scoreData.brandOriginCountry}</b>`
                : "⚠️ No manufacturing origin information available"
            }</span>
          </li>
          <li><b>Supply Chain Transparency</b> (${transparencyPoints} point${
    transparencyPoints !== 1 ? "s" : ""
  }):
            <span>${supplyChainDetails.transparencyExplanation}</span>
          </li>
          <li><b>Certifications</b> (${certPoints} point${
    certPoints !== 1 ? "s" : ""
  }):
            <span>${
              scoreData.explanation && /certificat/i.test(scoreData.explanation)
                ? "Certifications mentioned"
                : "No certifications found"
            }</span>
          </li>
          <li><b>Material Sourcing</b> (${materialPoints} point${
    materialPoints !== 1 ? "s" : ""
  }):
            <span>${
              scoreData.explanation &&
              /organic|recycled|sustainable|cotton|bamboo|hemp|linen|wool|biodegradable/i.test(
                scoreData.explanation
              )
                ? "Sustainable/organic/recycled materials detected"
                : "No clear sustainable materials"
            }</span>
          </li>
          <li><b>Environmental Practices</b> (${envPoints} point${
    envPoints !== 1 ? "s" : ""
  }):
            <span>${
              scoreData.explanation &&
              /carbon|neutral|offset|water|zero waste|renewable|energy|eco/i.test(
                scoreData.explanation
              )
                ? "Environmental practices mentioned"
                : "No environmental practices found"
            }</span>
          </li>

        </ul>
      </div>
      ${
        isHighEmission
          ? `<div class="warning-banner">⚠️ High carbon footprint detected</div>`
          : ""
      }
      ${
        scoreData.score <= 2
          ? `<div class="warning-banner" style="background-color:#f44336;color:#fff;font-weight:bold;">⚠️ Low sustainability score</div>`
          : ""
      }
    </div>
    <div class="supply-chain-verified-score">
      <h4 style="font-size:1.2em;font-weight:bold; margin:0;">Web Verified Score${
        scoreData.productBrand ? ` (${scoreData.productBrand})` : ""
      }: ${
    scoreData.verifiedScore !== undefined && scoreData.verifiedScore !== null
      ? scoreData.verifiedScore + "%"
      : "N/A"
  }</h4><br/>
    </div>
    <div class="supply-chain-metrics">
      <div class="supply-chain-metric">
        <h4>Transparency Level</h4>
        <div class="metric-bar-container">
          <div class="metric-bar" style="width: ${
            scoreData.score * 20
          }%; background-color: ${getColorForScore(scoreData.score)}"></div>
        </div>
        <p class="metric-value">${supplyChainDetails.transparency}</p>
        <p class="metric-explanation">${
          supplyChainDetails.transparencyExplanation
        }</p>
      </div>
      <div class="supply-chain-metric">
        <h4>Supply Chain Risk</h4>
        <div class="metric-bar-container">
          <div class="metric-bar" style="width: ${
            (5 - scoreData.score) * 20
          }%; background-color: ${getColorForRisk(5 - scoreData.score)}"></div>
        </div>
        <p class="metric-value">${supplyChainDetails.riskLevel}</p>
        <p class="metric-explanation">${supplyChainDetails.riskExplanation}</p>
      </div>
    </div>
    ${
      scoreData.manufacturingCountry
        ? `
      <div class="supply-chain-origin">
        <h4>Manufacturing Origin</h4>
        <p style="font-weight: bold; text-transform: uppercase;">${
          scoreData.manufacturingCountry
        }</p>
        <p class="origin-explanation">Manufacturing location affects carbon emissions, labor practices, and resource use.</p>
        ${
          scoreData.co2Emissions
            ? `
          <div class="co2-emissions">
            <h5>Estimated CO2 Emissions (to Finland)</h5>
            <div class="emissions-visual">
              <div class="emissions-bar" style="width: ${Math.min(
                scoreData.co2Emissions.total * 3,
                100
              )}%"></div>
              <span class="emissions-value">${
                scoreData.co2Emissions.total
              } kg CO2</span>
            </div>
            <div class="emissions-comparison">
              <p>This is equivalent to:</p>
              <ul>
                <li>${co2Comparisons.drivingDistance} km of driving</li>
                <li>${
                  co2Comparisons.phoneCycles
                } smartphone charging cycles</li>
                <li>${co2Comparisons.meatMeals} beef meals</li>
              </ul>
            </div>
            <div class="emissions-breakdown">
              <div class="emissions-item">
                <span>Manufacturing:</span>
                <span>${scoreData.co2Emissions.manufacturing} kg</span>
              </div>
              <div class="emissions-item">
                <span>Shipping (${scoreData.co2Emissions.distance} km):</span>
                <span>${scoreData.co2Emissions.shipping} kg</span>
              </div>
              <div class="emissions-item shipping-method">
                <span>Shipping method:</span>
                <span>${
                  scoreData.shippingMethod || "Unknown"
                } ${getShippingIcon(scoreData.shippingMethod)}</span>
              </div>
            </div>
            <div class="shipping-impact">
              <h6>How shipping choices impact emissions:</h6>
              <div class="shipping-options">
                <div class="shipping-option ${
                  scoreData.shippingMethod === "air" ? "active" : ""
                }">
                  <span>✈️ Air</span>
                  <span class="impact high">High impact</span>
                </div>
                <div class="shipping-option ${
                  scoreData.shippingMethod === "sea" ? "active" : ""
                }">
                  <span>🚢 Sea</span>
                  <span class="impact medium">Medium impact</span>
                </div>
                <div class="shipping-option ${
                  scoreData.shippingMethod === "truck" ? "active" : ""
                }">
                  <span>🚚 Truck</span>
                  <span class="impact medium-high">Medium-high impact</span>
                </div>
                <div class="shipping-option ${
                  scoreData.shippingMethod === "rail" ? "active" : ""
                }">
                  <span>🚂 Rail</span>
                  <span class="impact low">Low impact</span>
                </div>
              </div>
            </div>
          </div>
        `
            : `<div class="missing-data-warning">⚠️ No CO2 emissions data available</div>`
        }
      </div>
    `
        : `<div class="missing-data-warning">⚠️ No manufacturing origin information available</div>`
    }

<div class="product-sustainability">
  <h4>Product Sustainability</h4>
  <p>Based on available supply chain information:</p>
  <div class="sustainability-aspects">
    <div class="sustainability-aspect">
      <h5>Materials</h5>
      <div class="aspect-rating ${
        scoreData.score >= 3 ? "good" : scoreData.score >= 1 ? "medium" : "poor"
      }">
        ${scoreData.score >= 3 ? "✅" : scoreData.score >= 1 ? "⚠️" : "❓"}
      </div>
      <p>${
        scoreData.score >= 3
          ? "Likely sustainable materials"
          : scoreData.score >= 1
          ? "Mixed sustainability"
          : "Unknown material sustainability"
      }</p>
    </div>
    <div class="sustainability-aspect">
      <h5>Production</h5>
      <div class="aspect-rating ${
        scoreData.score >= 3 ? "good" : scoreData.score >= 1 ? "medium" : "poor"
      }">
        ${scoreData.score >= 3 ? "✅" : scoreData.score >= 1 ? "⚠️" : "❓"}
      </div>
      <p>${
        scoreData.score >= 3
          ? "Likely ethical production"
          : scoreData.score >= 1
          ? "Some production transparency"
          : "Unknown production conditions"
      }</p>
    </div>
    <div class="sustainability-aspect">
      <h5>Packaging</h5>
      <div class="aspect-rating ${scoreData.score >= 3 ? "good" : "poor"}">
        ${scoreData.score >= 3 ? "✅" : "❓"}
      </div>
      <p>${
        scoreData.score >= 3
          ? "Likely sustainable packaging"
          : "Unknown packaging sustainability"
      }</p>
    </div>
  </div>
  <div class="sustainability-scope">
    <h5>What we analyze:</h5>
    <ul class="scope-list">
      <li>Origin information (manufacturing country)</li>
      <li>Supply chain transparency</li>
      <li>Certifications</li>
      <li>Material sourcing</li>
      <li>Environmental practices</li>
      <li>Packaging and end-of-life options</li>
    </ul>
  </div>
</div>

<div class="environmental-impact">
  <h4>Environmental Impact</h4>
  <p>Based on available information about this product:</p>
  <div class="impact-metrics">
    <div class="impact-metric">
      <h5>Carbon Footprint</h5>
      <div class="metric-value ${
        scoreData.score >= 3 ? "good" : scoreData.score >= 1 ? "medium" : "poor"
      }">
        ${
          scoreData.score >= 4
            ? "Low"
            : scoreData.score >= 3
            ? "Medium-Low"
            : scoreData.score >= 2
            ? "Medium"
            : scoreData.score >= 1
            ? "Medium-High"
            : "High/Unknown"
        }
      </div>
      <p>${
        scoreData.score >= 3
          ? "Lower than average emissions"
          : scoreData.score >= 1
          ? "Average emissions"
          : "Higher than average or unknown emissions"
      }</p>
    </div>
    <div class="impact-metric">
      <h5>Water Usage</h5>
      <div class="metric-value ${
        scoreData.score >= 3 ? "good" : scoreData.score >= 1 ? "medium" : "poor"
      }">
        ${
          scoreData.score >= 4
            ? "Low"
            : scoreData.score >= 3
            ? "Medium-Low"
            : scoreData.score >= 2
            ? "Medium"
            : scoreData.score >= 1
            ? "Medium-High"
            : "High/Unknown"
        }
      </div>
      <p>${
        scoreData.score >= 3
          ? "Water-efficient production"
          : scoreData.score >= 1
          ? "Standard water usage"
          : "High water usage or unknown"
      }</p>
    </div>
    <div class="impact-metric">
      <h5>Chemical Usage</h5>
      <div class="metric-value ${
        scoreData.score >= 3 ? "good" : scoreData.score >= 1 ? "medium" : "poor"
      }">
        ${
          scoreData.score >= 4
            ? "Minimal"
            : scoreData.score >= 3
            ? "Reduced"
            : scoreData.score >= 2
            ? "Standard"
            : scoreData.score >= 1
            ? "High"
            : "Unknown"
        }
      </div>
      <p>${
        scoreData.score >= 3
          ? "Minimal harmful chemicals"
          : scoreData.score >= 1
          ? "Some chemical usage"
          : "Heavy chemical usage or unknown"
      }</p>
    </div>
  </div>
</div>

<div class="end-of-life">
  <h4>End of Life</h4>
  <div class="eol-options">
    <div class="eol-option ${
      scoreData.score >= 3 ? "available" : "unavailable"
    }">
      <h5>Recyclability</h5>
      <div class="eol-icon">${scoreData.score >= 3 ? "♻️" : "❌"}</div>
      <p>${
        scoreData.score >= 3
          ? "Recyclable materials"
          : "Limited recyclability or unknown"
      }</p>
    </div>
    <div class="eol-option ${
      scoreData.score >= 4 ? "available" : "unavailable"
    }">
      <h5>Biodegradability</h5>
      <div class="eol-icon">${scoreData.score >= 4 ? "🌱" : "❌"}</div>
      <p>${
        scoreData.score >= 4
          ? "Biodegradable materials"
          : "Non-biodegradable or unknown"
      }</p>
    </div>
    <div class="eol-option ${
      scoreData.score >= 3 ? "available" : "unavailable"
    }">
      <h5>Take-back Program</h5>
      <div class="eol-icon">${scoreData.score >= 3 ? "🔄" : "❌"}</div>
      <p>${
        scoreData.score >= 3
          ? "Manufacturer offers take-back"
          : "No take-back program or unknown"
      }</p>
    </div>
  </div>
  <p class="eol-note">${
    scoreData.score >= 3
      ? "This product has good end-of-life options"
      : "Limited information about end-of-life options for this product"
  }</p>
</div>





${
  scoreData.score <= 3
    ? `
  <div class="donate-tree-section">
    <h4>Offset Environmental Impact</h4>
    <p>This product has a lower sustainability rating. Consider offsetting its impact:</p>
    
    <div class="offset-options">
      <div class="offset-option">
        <button class="donate-tree-button">Plant a Tree ($1-3)</button>
        <div class="offset-details">
          <p>Trees planted through OneTreePlanted in sustainable reforestation projects</p>
          <p>Takes ~10 years to fully offset this product's emissions</p>
          <p>Planted on dedicated reforestation land, not agricultural land</p>
        </div>
      </div>
      
      <div class="offset-alternatives">
        <h5>Alternative Ways to Offset:</h5>
        <ul>
          <li>Bike instead of drive for 3 days</li>
          <li>Reduce meat consumption by 1 meal</li>
          <li>Lower home heating by 1°C for a week</li>
          <li>Use cold water for laundry for 5 loads</li>
        </ul>
      </div>
    </div>
  </div>
  `
    : ""
}



    
    <div class="supply-chain-recommendations">
      <h4>What You Can Do</h4>
      <ul>
        ${supplyChainDetails.recommendations
          .map((rec) => `<li>${rec}</li>`)
          .join("")}
      </ul>
      <div class="request-info">
        <p>Want more information? Contact the seller directly or check the manufacturer's website.</p>
      </div>
    </div>
    
    
    
    <div class="user-feedback">
      <h4>Your Feedback</h4>
      <p>Did this information change your perception of this product?</p>
      <div class="feedback-buttons">
        <button class="feedback-button" data-value="yes">Yes</button>
        <button class="feedback-button" data-value="no">No</button>
      </div>
      <div class="feedback-form" style="display: none;">
        <p>Why?</p>
        <textarea class="feedback-reason" placeholder="Please share your thoughts..."></textarea>
        <button class="submit-feedback">Submit</button>
      </div>
      <div class="feedback-thanks" style="display: none;">
        <p>Thank you for your feedback!</p>
      </div>
    </div>

    <button class="supply-chain-report-issue" style="margin-bottom: 16px;">Report incorrect information</button>

  `;

  // Add details to page
  document.body.appendChild(details);

  // Add event listeners for delivery option radio buttons
  const deliveryOptions = badge.querySelectorAll(
    'input[name="delivery-option"]'
  );
  deliveryOptions.forEach((option) => {
    option.addEventListener("change", function () {
      // Update selected option styling
      const labels = badge.querySelectorAll(".delivery-option-item");
      labels.forEach((label) => {
        label.classList.remove("selected");
      });
      this.closest(".delivery-option-item").classList.add("selected");

      // Here you would typically update the delivery option in the cart or send to backend
      console.log(`Selected delivery option: ${this.value}`);
    });
  });

  // Add event listeners
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    details.style.display = "block";

    // Position the details popup near the badge
    const badgeRect = badge.getBoundingClientRect();
    details.style.top = window.scrollY + badgeRect.bottom + 10 + "px";
    details.style.left = window.scrollX + badgeRect.left + "px";
  });

  details.querySelector(".supply-chain-close").addEventListener("click", () => {
    details.style.display = "none";
  });

  details
    .querySelector(".supply-chain-report-issue")
    .addEventListener("click", () => {
      // Ensure chrome is defined
      if (typeof chrome !== "undefined" && chrome.runtime) {
        chrome.runtime.sendMessage({
          action: "reportIssue",
          url: window.location.href,
        });
      } else {
        console.error("Chrome runtime is not available.");
      }
    });

  // Add donate tree button event listener if it exists
  const donateButton = details.querySelector(".donate-tree-button");
  if (donateButton) {
    donateButton.addEventListener("click", () => {
      // Open donation page in a new tab
      window.open("https://onetreeplanted.org/products/plant-trees", "_blank");
    });
  }

  // Add feedback button event listeners
  const feedbackButtons = details.querySelectorAll(".feedback-button");
  feedbackButtons.forEach((button) => {
    button.addEventListener("click", () => {
      details.querySelector(".feedback-form").style.display = "block";

      // Store the selected value
      details.querySelector(".feedback-form").dataset.value =
        button.dataset.value;

      // Highlight the selected button
      feedbackButtons.forEach((btn) => btn.classList.remove("selected"));
      button.classList.add("selected");
    });
  });

  // Add submit feedback button event listener
  const submitFeedback = details.querySelector(".submit-feedback");
  if (submitFeedback) {
    submitFeedback.addEventListener("click", () => {
      const feedbackValue =
        details.querySelector(".feedback-form").dataset.value;
      const feedbackReason = details.querySelector(".feedback-reason").value;

      // In a real implementation, this would send the feedback to a server
      console.log("Feedback:", feedbackValue, feedbackReason);

      // Show thank you message
      details.querySelector(".feedback-form").style.display = "none";
      details.querySelector(".feedback-thanks").style.display = "block";
    });
  }

  // Close details when clicking outside
  document.addEventListener("click", (e) => {
    if (!details.contains(e.target) && e.target !== badge) {
      details.style.display = "none";
    }
  });
}

// Safe localStorage wrapper to handle sandboxed environments
let localStorageUsable = true;
try {
  const testKey = "__safestorage_test__";
  window.localStorage.setItem(testKey, "1");
  window.localStorage.removeItem(testKey);
} catch (e) {
  localStorageUsable = false;
}

// Safe storage implementation with fallback to in-memory storage
const safeStorage = {
  _storageData: {}, // In-memory fallback storage

  getItem(key) {
    if (localStorageUsable) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        localStorageUsable = false;
      }
    }
    return this._storageData[key] || null;
  },

  setItem(key, value) {
    if (localStorageUsable) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        localStorageUsable = false;
        this._storageData[key] = value;
      }
    } else {
      this._storageData[key] = value;
    }
  },

  removeItem(key) {
    if (localStorageUsable) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        localStorageUsable = false;
      }
    }
    delete this._storageData[key];
  },

  clear() {
    if (localStorageUsable) {
      try {
        localStorage.clear();
      } catch (e) {
        localStorageUsable = false;
      }
    }
    this._storageData = {};
  },
};

// Patch any potential localStorage references in this script
function patchLocalStorageReferences() {
  try {
    // This won't affect page scripts, only our extension content script
    if (typeof localStorage !== "undefined") {
      // We don't actually replace localStorage as that would be problematic
      // But this will help if we ever directly reference it in our code
      console.log("localStorage is available, no need to patch");
    }
  } catch (e) {
    console.warn("localStorage patching failed:", e);
  }
}

// Call the patch function immediately
patchLocalStorageReferences();

// Helper function to get color based on score
function getColorForScore(score) {
  if (score >= 4) return "#4caf50"; // Green
  if (score >= 3) return "#8bc34a"; // Light green
  if (score >= 2) return "#ffc107"; // Amber
  if (score >= 1) return "#ff9800"; // Orange
  return "#f44336"; // Red
}

// Helper function to get color for risk level
function getColorForRisk(risk) {
  if (risk <= 1) return "#4caf50"; // Green
  if (risk <= 2) return "#8bc34a"; // Light green
  if (risk <= 3) return "#ffc107"; // Amber
  if (risk <= 4) return "#ff9800"; // Orange
  return "#f44336"; // Red
}

// Helper function to get shipping icon
function getShippingIcon(method) {
  switch (method) {
    case "air":
      return "✈️";
    case "sea":
      return "🚢";
    case "truck":
      return "🚚";
    case "rail":
      return "🚂";
    default:
      return "📦";
  }
}

// Helper function to get emission comparisons
function getEmissionComparisons(kgCO2) {
  return {
    drivingDistance: Math.round(kgCO2 * 6), // km in average car
    phoneCycles: Math.round(kgCO2 * 500), // full phone charges
    meatMeals: Math.round(kgCO2 / 7), // beef meals
  };
}

// Add styles for the new sections
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  /* Sleek modal improvements */
  .supply-chain-details {
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 4px 32px 0 rgba(76,175,80,0.13), 0 2px 8px 0 rgba(60,60,60,0.08);
    padding: 18px 22px 18px 22px;
    max-width: 420px;
    min-width: 240px;
    font-size: 0.97em;
    color: #2e7d32;
    border: 1.5px solid #c8e6c9;
    position: absolute;
    z-index: 10000;
    margin-top: 8px;
    margin-left: 0;
    transition: box-shadow 0.2s;
  }
  .supply-chain-details h3, .supply-chain-details h4, .supply-chain-details h5, .supply-chain-details h6 {
    color: #388e3c;
    margin-top: 0.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .supply-chain-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .supply-chain-header h3 {
    font-size: 1.1em;
    font-weight: 700;
    margin: 0;
    color: #388e3c;
  }
  .supply-chain-close {
    background: none;
    border: none;
    font-size: 1.3em;
    color: #81c784;
    cursor: pointer;
    margin-left: 8px;
    margin-top: -2px;
    transition: color 0.2s;
  }
  .supply-chain-close:hover {
    color: #388e3c;
  }
  .supply-chain-summary-box {
    background: #e8f5e9;
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 10px;
    color: #2e7d32;
    font-size: 0.98em;
  }
  .supply-chain-metrics {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .supply-chain-metric {
    flex: 1 1 120px;
    background: #f9fbe7;
    border-radius: 8px;
    padding: 8px 10px 6px 10px;
    margin-bottom: 0;
    min-width: 120px;
    color: #33691e;
    font-size: 0.97em;
    box-shadow: 0 1px 4px 0 rgba(76,175,80,0.04);
  }
  .metric-bar-container {
    background: #e0f2f1;
    border-radius: 4px;
    height: 7px;
    margin: 6px 0 4px 0;
    width: 100%;
    overflow: hidden;
  }
  .metric-bar {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s;
  }
  .metric-value {
    font-size: 0.97em;
    font-weight: 600;
    margin: 2px 0 0 0;
  }
  .metric-explanation {
    font-size: 0.93em;
    color: #558b2f;
    margin-bottom: 0;
  }
  .warning-banner {
    background: #fffde7;
    color: #e65100;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 0.97em;
    margin-top: 8px;
    margin-bottom: 0;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Sleek badge improvements */
  .sleek-badge {
    background: linear-gradient(90deg, #e8f5e9 0%, #f1f8e9 100%);
    border-radius: 14px;
    box-shadow: 0 2px 12px 0 rgba(76,175,80,0.08), 0 1.5px 4px 0 rgba(60,60,60,0.04);
    padding: 10px 14px 8px 14px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 150px;
    max-width: 220px;
    border: 1.2px solid #c8e6c9;
    margin: 0 0 8px 0;
    transition: box-shadow 0.2s;
  }
  .sleek-badge:hover {
    box-shadow: 0 4px 18px 0 rgba(76,175,80,0.18), 0 2px 8px 0 rgba(60,60,60,0.08);
  }
  .sleek-title {
    display: flex;
    align-items: center;
    font-size: 0.98em;
    font-weight: 600;
    color: #388e3c;
    margin-bottom: 4px;
    letter-spacing: 0.01em;
    gap: 5px;
  }
  .sleek-rating {
    display: flex;
    align-items: center;
    margin-top: 1px;
    margin-bottom: 1px;
  }
  .supply-chain-badge {
    background: none;
    border: none;
    box-shadow: none;
    padding: 0;
    margin: 0;
  }

  /* Universal box-sizing for layout consistency */
*,
*::before,
*::after {
  box-sizing: border-box;
}

/* Common Section Styling */
.environmental-impact, 
.end-of-life, 
.labor-practices, 
.green-delivery-options {
  margin: 16px 0;
  padding: 16px;
  background-color: #f9f9f9;
  border-radius: 6px;
  overflow-wrap: break-word;
}

/* Section Titles */
.environmental-impact h4, 
.end-of-life h4, 
.labor-practices h4, 
.green-delivery-options h4 {
  margin-bottom: 12px;
  color: #2e7d32;
}

/* Responsive Grid Layouts */
.impact-metrics, 
.labor-metrics, 
.eol-options, 
.methodology-factors, 
.delivery-options {
  display: grid;
  gap: 12px;
  margin-top: 12px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

/* Metric Boxes */
.impact-metric, 
.labor-metric, 
.eol-option, 
.methodology-factor, 
.delivery-option {
  background-color: #f0f0f0;
  padding: 12px;
  border-radius: 4px;
  overflow-wrap: break-word;
}

.impact-metric h5, 
.labor-metric h5, 
.delivery-option h5, 
.methodology-factor h5 {
  margin-bottom: 8px;
  font-size: 14px;
  color: #2e7d32;
}

.methodology-factor h5 {
  margin-bottom: 4px;
}

.metric-value {
  font-weight: 600;
  margin: 8px 0;
  padding: 4px 8px;
  border-radius: 4px;
  display: inline-block;
  word-break: break-word;
}

.metric-value.good {
  background-color: #e8f5e9;
  color: #2e7d32;
}

.metric-value.medium {
  background-color: #fff8e1;
  color: #ff8f00;
}

.metric-value.poor {
  background-color: #ffebee;
  color: #c62828;
}

/* End-of-Life Options */
.eol-option {
  text-align: center;
}

.eol-option.available {
  background-color: #e8f5e9;
  border: 1px solid #a5d6a7;
}

.eol-option.unavailable {
  background-color: #f5f5f5;
  color: #757575;
}

.eol-icon {
  font-size: 24px;
  margin: 8px 0;
}

.eol-note,
.delivery-note {
  margin-top: 12px;
  font-style: italic;
  color: #666;
}

/* Delivery Options */
.delivery-option {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-wrap: wrap;
}

.delivery-option-item {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
  flex-wrap: wrap;
  word-break: break-word;
}

.delivery-option-item:hover {
  background-color: #f5f5f5;
}

.delivery-option-item input {
  margin-right: 8px;
  cursor: pointer;
}

.delivery-option-item.selected {
  background-color: #f0f0f0;
  font-weight: 600;
}

.delivery-option-item.eco .option-label {
  color: #2e7d32;
}

.delivery-option-item.balanced .option-label {
  color: #ff8f00;
}

.delivery-option-item.express .option-label {
  color: #c62828;
}

.option-time {
  margin-left: auto;
  font-size: 11px;
  color: #757575;
}

/* Flexible badge */
.supply-chain-badge {
  width: 100%;
  max-width: 240px;
  min-width: 160px;
}

/* Optional: Add horizontal padding to prevent edge overflow */
body {
  padding: 0 12px;
}

/* New styles for product details and sustainability claims */
.product-details, .sustainability-claims {
  margin-top: 12px;
  padding: 12px;
  background-color: #f9f9f9;
  border-radius: 6px;
  overflow-wrap: break-word;
}

.product-details h4, .sustainability-claims h4 {
  margin-bottom: 10px;
  color: #2e7d32;
  font-weight: 600;
}

.product-details p, .sustainability-claims p {
  margin: 4px 0;
  line-height: 1.4;
}

.sustainability-claims ul {
  padding-left: 20px;
  margin: 4px 0;
}

.sustainability-claims li {
  margin-bottom: 4px;
  position: relative;
  padding-left: 10px;
}

.sustainability-claims li:before {
  content: "✔️";
  position: absolute;
  left: 0;
  top: 0;
  color: #4caf50;
  font-size: 1.1em;
  line-height: 1;
}
`;
document.head.appendChild(styleSheet);

// Function to extract detailed product information from the page
function extractProductDetails() {
  // Common selectors for product details across e-commerce sites
  const detailsSelectors = [
    // Amazon selectors
    "#detailBullets_feature_div",
    "#productDetails_feature_div",
    "#technicalSpecifications_feature_div",
    "#feature-bullets",
    ".product-facts",
    "table.a-keyvalue",
    // Generic selectors
    ".product-specs",
    ".product-details",
    ".product-information",
    ".specifications",
    "[class*='specification']",
    "[class*='detail']",
    "[id*='specification']",
    "[id*='detail']",
  ];

  // Material keywords to specifically look for
  const materialKeywords = [
    "material",
    "fabric",
    "composition",
    "made of",
    "made from",
    "ingredients",
    "components",
    "cotton",
    "polyester",
    "plastic",
    "wood",
    "metal",
    "glass",
    "recycled",
    "organic",
    "synthetic",
  ];

  let details = "";

  // Try to find product details sections
  for (const selector of detailsSelectors) {
    const elements = document.querySelectorAll(selector);
    if (elements && elements.length > 0) {
      for (const element of elements) {
        details += element.textContent.trim() + "\n\n";
      }
    }
  }

  // Look for material information specifically
  let materialInfo = "";
  const allElements = document.querySelectorAll("*");
  for (const element of allElements) {
    if (!element.textContent) continue;

    const text = element.textContent.toLowerCase();
    for (const keyword of materialKeywords) {
      if (
        text.includes(keyword) &&
        text.length < 300 &&
        !materialInfo.includes(text)
      ) {
        materialInfo += element.textContent.trim() + "\n";
        break;
      }
    }
  }

  if (materialInfo) {
    details += "\nMATERIAL INFORMATION:\n" + materialInfo;
  }

  return details.trim() || "No detailed product specifications found.";
}

// Function to extract sustainability claims and eco certifications
function extractSustainabilityClaims() {
  // Sustainability-related keywords to look for
  const sustainabilityKeywords = [
    "sustainable",
    "eco",
    "green",
    "environment",
    "friendly",
    "recycled",
    "organic",
    "natural",
    "biodegradable",
    "compostable",
    "fair trade",
    "fairtrade",
    "ethical",
    "responsible",
    "renewable",
    "carbon",
    "footprint",
    "offset",
    "neutral",
    "negative",
    "certification",
    "certified",
    "eco-friendly",
    "FSC",
    "GOTS",
    "sustainably sourced",
    "cruelty-free",
    "vegan",
    "plant-based",
    "zero waste",
    "plastic-free",
    "water saving",
    "energy efficient",
  ];

  let claims = "";
  const allElements = document.querySelectorAll("*");

  for (const element of allElements) {
    if (!element.textContent) continue;

    const text = element.textContent.toLowerCase();
    for (const keyword of sustainabilityKeywords) {
      if (
        text.includes(keyword) &&
        text.length < 500 &&
        !claims.includes(text)
      ) {
        // Check if this looks like a claim rather than just containing the word
        if (text.length > 10) {
          claims += "• " + element.textContent.trim() + "\n";
          break;
        }
      }
    }
  }

  // Look for eco certification images
  const imgElements = document.querySelectorAll("img");
  for (const img of imgElements) {
    const imgSrc = img.src?.toLowerCase() || "";
    const imgAlt = img.alt?.toLowerCase() || "";
    const hasEcoCert = sustainabilityKeywords.some(
      (keyword) => imgSrc.includes(keyword) || imgAlt.includes(keyword)
    );

    if (hasEcoCert) {
      claims += `• Image with possible eco certification: ${
        imgAlt || "Unnamed certification"
      }\n`;
    }
  }

  return claims.trim() || "No explicit sustainability claims found.";
}
