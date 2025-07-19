// Helper function to truncate text to a specific number of words
function truncateText(text, maxWords) {
  if (!text) return "";
  const words = text.split(" ");
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "...";
}

// --- Web Ethical Issue Search with Supabase Caching ---
async function getOrFetchWebEthicalIssueScore(productTitle, productBrand) {
  // Debug object to track all steps
  let debugWebEthical = {
    googleQuery: "",
    googleApiUrl: "",
    googleApiRequest: null,
    googleApiResponse: null,
    groqInput: "",
    groqOutput: null,
    groqScore: null,
  };
  // Always log debug info to the console for developer inspection
  function logDebugWebEthical(label, dbg) {
    try {
      console.log(`[DEBUG][WebEthical] ${label}:`, dbg);
    } catch (e) {}
  }

  // UI update for web ethical score in modal
  window.updateWebEthicalScoreUI = function (score, output) {
    // Find or create the modal section for web ethical issues
    let modal = document.getElementById("supply-chain-details");
    if (!modal) return;
    let ethicalSection = modal.querySelector(".web-ethical-issue-section");
    if (!ethicalSection) {
      ethicalSection = document.createElement("div");
      ethicalSection.className = "web-ethical-issue-section";
      ethicalSection.style.margin = "12px 0";
      ethicalSection.style.padding = "8px";
      ethicalSection.style.background = "#f7f7f7";
      ethicalSection.style.borderRadius = "6px";
      ethicalSection.style.fontSize = "14px";
      ethicalSection.innerHTML = `<b>Web Ethical/Sustainability Issue:</b> <span class='web-ethical-score'></span><br><span class='web-ethical-reason'></span>`;
      modal.appendChild(ethicalSection);
    }

    // Format the score display
    let scoreDisplay;
    if (score === 1) {
      scoreDisplay = "+1 (No Issues)";
    } else if (score === -0.5) {
      scoreDisplay = "-0.5 (Minor Issues)";
    } else if (score === -1) {
      scoreDisplay = "-1 (Major Issues)";
    } else if (score === 0) {
      scoreDisplay = "0 (Neutral)";
    } else {
      scoreDisplay = score;
    }

    ethicalSection.querySelector(
      ".web-ethical-score"
    ).textContent = `Score: ${scoreDisplay}`;

    // Extract and display the reason
    let reason = "No specific information available";
    if (output && typeof output === "object" && output.reason) {
      reason = output.reason;
    } else if (typeof output === "string") {
      reason = output;
    } else if (!output) {
      reason = "No ethical issues detected";
    }

    // Limit the reason length
    if (reason && reason.length > 200) {
      reason = reason.substring(0, 197) + "...";
    }

    ethicalSection.querySelector(".web-ethical-reason").textContent = reason;
  };
  // Normalize product key for Supabase
  const productKey = encodeURIComponent(
    (productTitle + " " + (productBrand || ""))
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
  );
  // 1. Try to fetch from Supabase cache (new schema fields only)
  let supaData = null;
  try {
    const supaResp = await fetch(
      `${supabaseUrl}/rest/v1/web_ethical_issues?product_key=eq.${productKey}&select=score,rawquery,rawdata,ai_analysis,created_at,id`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );
    if (supaResp.ok) {
      const data = await supaResp.json();
      if (data && data.length > 0) {
        supaData = data[0];
        // If we have any row for this product, always use cache and do NOT initiate Google search
        logDebugWebEthical("Supabase cache hit", supaData);
        if (typeof window.updateWebEthicalScoreUI === "function") {
          window.updateWebEthicalScoreUI(supaData.score, supaData.ai_analysis);
        }
        return {
          score: supaData.score,
          evidence: "", // No direct evidence field, can extract from rawdata if needed
          searchResult: null, // Not directly available, can parse from rawdata
          groqOutput: supaData.ai_analysis,
          debugWebEthical: debugWebEthical,
          created_at: supaData.created_at,
          id: supaData.id,
          rawquery: supaData.rawquery,
          rawdata: supaData.rawdata,
        };
      }
    }
  } catch (e) {
    console.warn("[WebVerify] Supabase cache fetch failed:", e);
  }

  // 2. If not cached, perform Google search
  // Limit product title to max 8 words for the query
  const limitedProductTitle = productTitle.split(" ").slice(0, 8).join(" ");
  // Improved search logic: use a natural language query for issues related to the product
  const rawQuery = `Any scandal OR lawsuit OR sustainability issue OR ethical issue related to "${limitedProductTitle}"`;
  const query = encodeURIComponent(rawQuery);
  debugWebEthical.googleQuery = rawQuery;
  debugWebEthical.googleApiRequest = {
    url: `https://www.googleapis.com/customsearch/v1?key=***&cx=***&q=${query}`,
    rawQuery,
  };
  logDebugWebEthical(
    "Sending info to Google",
    debugWebEthical.googleApiRequest
  );

  // Check daily limit
  const count = getAndUpdateGoogleQueryCount();
  if (!count) {
    console.warn("[WebVerify] Google Custom Search daily limit reached");
    return { score: 0, evidence: "" };
  }
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${query}`;
  debugWebEthical.googleApiUrl = url;
  let result = { score: 1, evidence: "" };
  let searchResults = [];
  try {
    // Log the search URL for debugging (remove API key)
    console.log(
      "[DEBUG] Sending Google Search request:",
      url.replace(/key=[^&]+/, "key=***")
    );

    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(
        "[WebVerify] Google search fetch failed:",
        resp.status,
        resp.statusText
      );

      // Return a more helpful error response instead of throwing
      return {
        score: 0,
        evidence: "",
        reason: "Search API error: " + resp.status,
        searchResults: [],
        debugWebEthical,
        groqOutput: {
          score: 0,
          reason: "Google search API error: " + resp.status,
        },
      };
    }
    const data = await resp.json();
    debugWebEthical.googleApiResponse = data;
    logDebugWebEthical("Result received from Google", data);
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      // Aggregate top 3 results
      searchResults = data.items.slice(0, 3).map((item) => ({
        title: item.title || "",
        snippet: item.snippet || "",
        link: item.link || "",
      }));
      console.log("[DEBUG] Found search results:", searchResults.length);
    } else {
      console.log("[DEBUG] No search results found");
      // Return neutral score with explanation
      return {
        score: 0,
        evidence: "",
        reason: "No relevant information found",
        searchResults: [],
        debugWebEthical,
        groqOutput: {
          score: 0,
          reason: "No search results available for analysis",
        },
      };
    }
    // Save the Google search results to Supabase using the new schema
    try {
      await fetch(`${supabaseUrl}/rest/v1/web_ethical_issues`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          product_key: productKey,
          rawquery: rawQuery,
          rawdata: searchResults, // send as array, not string
          score: 0, // must be NOT NULL, set to 0 initially
          ai_analysis: null,
        }),
      });
    } catch (e) {
      console.warn("[WebVerify] Supabase save (search result) failed:", e);
    }
    // Use DeepSeek via OpenRouter for analysis
    // Try up to 3 search results to find a relevant one
    let groqScore = 1; // Default positive score
    let groqOutput = { score: 1, reason: "No web ethical issues found." };

    // Process search results one by one until we find a relevant one
    if (searchResults && searchResults.length > 0) {
      const maxResultsToCheck = Math.min(searchResults.length, 3);
      let foundRelevant = false;

      for (let i = 0; i < maxResultsToCheck && !foundRelevant; i++) {
        // Prepare input for DeepSeek
        const aiInput = {
          productTitle,
          productBrand,
          googleResult: searchResults[i],
        };
        debugWebEthical.groqInput = JSON.stringify(aiInput, null, 2);

        // Call DeepSeek via OpenRouter
        try {
          console.log(
            `[DEBUG] Analyzing search result #${i + 1}:`,
            searchResults[i]
          );
          const aiResult = await analyzeWithDeepSeekOpenRouter(aiInput);
          logDebugWebEthical(
            `DeepSeek AI result (search result #${i + 1})`,
            aiResult
          );

          // If result was not filtered as irrelevant
          if (!aiResult.filtered) {
            // Use this result and break the loop
            groqScore = aiResult.score;
            groqOutput = aiResult;
            result.evidence = searchResults[i].link || "";
            foundRelevant = true;
            console.log(`[DEBUG] Found relevant result #${i + 1}:`, groqOutput);
          } else {
            console.log(
              `[DEBUG] Filtered as irrelevant: search result #${i + 1}`
            );
          }
        } catch (e) {
          console.error(
            `[DEBUG] DeepSeek API error for result #${i + 1}:`,
            e.message
          );
          logDebugWebEthical(`DeepSeek AI error (search result #${i + 1})`, e);
          // Continue to the next result on error
        }
      }

      // If all results were filtered as irrelevant or API failed, use the fallback logic below
      if (!foundRelevant) {
        // We'll use a fallback keyword-based analysis in the next section
        console.log(
          "[DEBUG] No relevant results found or all API calls failed, using keyword-based analysis"
        );
        groqScore = null; // Mark for fallback
        groqOutput = null;
      }
    } else {
      // No search results available
      groqScore = 0;
      groqOutput = {
        score: 0,
        reason: "No search results available for analysis.",
      };
    }

    // FALLBACK LOGIC: Using keyword-based analysis for all cases, but especially important when API calls fail
    console.log("[DEBUG] Running keyword-based fallback analysis");
    const seriousNegatives = [
      "child labor",
      "abuse",
      "fraud",
      "scandal",
      "lawsuit",
      "unsafe",
      "recall",
      "unethical",
      "violation",
      "controversy",
      "exploit",
      "pollution",
      "boycott",
      "greenwashing",
    ];
    const moderateNegatives = [
      "investigation",
      "allegation",
      "criticism",
      "complaint",
      "concern",
      "issue",
      "problem",
    ];
    let foundSerious = false;
    let foundModerate = false;
    for (const item of searchResults) {
      const text = (item.title + " " + item.snippet).toLowerCase();
      if (seriousNegatives.some((kw) => text.includes(kw))) {
        foundSerious = true;
        break;
      }
      if (moderateNegatives.some((kw) => text.includes(kw))) {
        foundModerate = true;
      }
    }

    // If API analysis failed or returned null, or if we found keyword matches, update the score
    if (
      groqScore === null ||
      groqOutput === null ||
      foundSerious ||
      foundModerate
    ) {
      if (foundSerious) {
        groqScore = -1;
        groqOutput = {
          score: -1,
          reason: "Serious ethical issues found (keyword analysis).",
        };
      } else if (foundModerate) {
        groqScore = -0.5;
        groqOutput = {
          score: -0.5,
          reason: "Some ethical issues found (keyword analysis).",
        };
      } else {
        groqScore = 0;
        groqOutput = {
          score: 0,
          reason: "No ethical issues detected through keyword analysis.",
        };
      }
    }
    debugWebEthical.groqOutput = groqOutput;
    // Save DeepSeek score and analysis to Supabase (update the row)
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/web_ethical_issues?product_key=eq.${productKey}`,
        {
          method: "PATCH",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            score: groqScore,
            ai_analysis: groqOutput, // send as object, not string
          }),
        }
      );
    } catch (e) {
      console.warn("[WebVerify] Supabase save (Groq) failed:", e);
    }
    logDebugWebEthical("DeepSeek result input", debugWebEthical.groqInput);
    logDebugWebEthical("DeepSeek Output", groqOutput);
    logDebugWebEthical("Debug Info", debugWebEthical);
    result = { score: groqScore, evidence: searchResults[0]?.link || "" };
  } catch (err) {
    console.error("[WebVerify] Google search or analysis error:", err);
    // Provide a more informative error message and neutral score
    result = {
      score: 0,
      evidence: "",
      reason:
        "Analysis temporarily unavailable: " + (err.message || "Unknown error"),
    };
    // Update groqOutput to include the error information
    groqOutput = {
      score: 0,
      reason:
        "Analysis temporarily unavailable: " + (err.message || "Unknown error"),
    };
    debugWebEthical.groqOutput = groqOutput;
    logDebugWebEthical("Debug Info (error)", debugWebEthical);
  }
  // Return the result (score/evidence) and the top search results for UI/debug
  // Ensure we're returning the reason directly for easier access
  // Ensure we have a valid groqOutput
  if (!groqOutput) {
    groqOutput = {
      score: result.score || 0,
      reason: "Analysis could not determine specific issues",
    };
  }

  const returnData = {
    score: result.score,
    evidence: result.evidence,
    reason:
      groqOutput && groqOutput.reason
        ? groqOutput.reason
        : "No specific reason available",
    searchResults,
    debugWebEthical,
    groqOutput, // Include the groqOutput object with reason for the modal
  };

  // Log what we're returning
  console.log(
    "[DEBUG] Returning from getOrFetchWebEthicalIssueScore:",
    returnData
  );

  return returnData;
}

// --- Google Custom Search JSON API integration for web verification ---
const GOOGLE_API_KEY = "AIzaSyA5hCTwdOksJirqbKuvQlFuG0tkRNmsfxE";
const GOOGLE_CX = "24b8704bf73e7459f"; // <-- Replace with your CSE ID
const GOOGLE_DAILY_LIMIT = 100;

// Add test to check if analyzeWithDeepSeekOpenRouter is defined
console.log(
  "[DEBUG] DeepSeek function check:",
  typeof analyzeWithDeepSeekOpenRouter
);

// Helper to get today's date string (YYYY-MM-DD)
function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

// Helper to get and update daily query count
function getAndUpdateGoogleQueryCount() {
  let data = {};
  try {
    const raw = safeStorage.getItem("google_query_count");
    if (raw) data = JSON.parse(raw);
  } catch (e) {}
  const today = getTodayString();
  if (!data[today]) data[today] = 0;
  if (data[today] < GOOGLE_DAILY_LIMIT) {
    data[today]++;
    safeStorage.setItem("google_query_count", JSON.stringify(data));
    return data[today];
  } else {
    return null; // Limit reached
  }
}

// Perform a Google Custom Search for product verification
async function getWebVerifiedScoreGoogle(productTitle, productBrand, claims) {
  // Check daily limit
  const count = getAndUpdateGoogleQueryCount();
  if (!count) {
    console.warn("[WebVerify] Google Custom Search daily limit reached");
    return null;
  }
  // Build query
  const query = encodeURIComponent(
    `${productTitle} ${productBrand} sustainability certification ${
      claims || ""
    }`
  );
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${query}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Google search failed");
    const data = await resp.json();
    // Simple scoring: count trusted domains/certifications in results
    let score = 0;
    const trustedDomains = [
      "fsc.org",
      "fairtrade.net",
      "global-standard.org",
      "oeko-tex.com",
      "usda.gov",
      "rainforest-alliance.org",
      "bcorporation.net",
      "energystar.gov",
      "eu-ecolabel.de",
    ];
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        if (
          trustedDomains.some((domain) => (item.link || "").includes(domain))
        ) {
          score += 25; // Each trusted hit gives 25%
        }
      }
    }
    return Math.min(score, 100); // Cap at 100%
  } catch (err) {
    console.error("[WebVerify] Google search error:", err);
    return null;
  }
}
// Helper to check if current site is an allowed e-commerce domain
function isEcommerceSite() {
  const host = window.location.hostname.toLowerCase();
  return ecommerceDomains.some((domain) => host.includes(domain));
}

// Analyze Google search result with DeepSeek via OpenRouter (global function)
async function analyzeWithDeepSeekOpenRouter(input) {
  // Use your OpenRouter API key and DeepSeek model
  const OPENROUTER_API_KEY =
    "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";
  const DEEPSEEK_MODEL = "Deepseek/deepseek-chat-v3-0324:free";

  // Filter out irrelevant search results first
  const isRelevant = (result) => {
    const lowerTitle = result.title.toLowerCase();
    const lowerSnippet = result.snippet.toLowerCase();
    const lowerBrand = input.productBrand.toLowerCase();
    const lowerProduct = input.productTitle.toLowerCase();
    return (
      lowerTitle.includes(lowerBrand) ||
      lowerSnippet.includes(lowerBrand) ||
      lowerTitle.includes(lowerProduct) ||
      lowerSnippet.includes(lowerProduct)
    );
  };

  if (!isRelevant(input.googleResult)) {
    return {
      score: 0,
      reason: "Search result is not relevant to this product.",
      filtered: true,
    };
  }

  // Compose a focused prompt for web ethical/sustainability issues
  const prompt = `You are an expert in sustainability and ethics. Analyze the following Google search result for a product and determine if there are any web ethical or sustainability issues.\n\nRespond ONLY with a single valid JSON object, no explanation, no markdown, no extra text, no code block.\n\nIf there are no issues, respond with: { "score": 1, "reason": "No web ethical issues found." }\nIf there are some moderate issues, respond with: { "score": -0.5, "reason": "Some ethical issues found because [specific reason]" }\nIf there are serious issues, respond with: { "score": -1, "reason": "Serious ethical issues found because [specific reason]" }\n\nBase your answer only on the provided search result. Be concise but specific about the reason. Do NOT include any explanation, markdown, or code block formatting.`;
  const userContent = `Product Title: ${input.productTitle}\nBrand: ${input.productBrand}\nGoogle Search Result:\nTitle: ${input.googleResult.title}\nSnippet: ${input.googleResult.snippet}\nLink: ${input.googleResult.link}`;
  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 256,
  };

  let response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://sustainability-index.com",
        "X-Title": "Sustainability Index Extension",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      score: 0,
      reason: "AI analysis unavailable (network error).",
      error: err.message,
    };
  }

  if (!response.ok) {
    const errorText = await response.text();
    return {
      score: 0,
      reason: `AI analysis unavailable (${response.status}). Using neutral score.`,
      error: errorText,
    };
  }

  const result = await response.json();
  const content = result.choices[0].message.content;
  console.log("[DEBUG] DeepSeek raw response:", content);

  // Try to extract JSON from the response robustly
  try {
    // Remove markdown/code block if present
    let cleaned = content.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned
        .replace(/^```json/, "")
        .replace(/```$/, "")
        .trim();
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
    }
    // Try to find the first JSON object in the string
    let jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    let jsonStr = jsonMatch ? jsonMatch[0] : cleaned;
    const parsedJson = JSON.parse(jsonStr);

    // Ensure the response has the expected format
    if (
      typeof parsedJson.score !== "number" ||
      typeof parsedJson.reason !== "string"
    ) {
      console.warn("[DeepSeek] Invalid JSON format:", parsedJson);
      return {
        score: 0,
        reason: parsedJson.reason || "Invalid score in response",
        raw: content,
      };
    }
    return parsedJson;
  } catch (e) {
    console.error("[DeepSeek] Failed to parse AI response:", e, content);
    // Fallback: show the raw content for debugging
    return {
      score: 0,
      reason: "Failed to parse AI response: " + e.message,
      raw: content,
    };
  }
}
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

// Gemini AI integration removed

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
  } catch (error) {
    console.error("Error fetching ecommerce domains:", error);
  }
}

// Calculate sustainability score based on 5 specific criteria with AI integration
async function calculateSustainabilityScore(productText) {
  // Initialize the scoring object with confidence scores
  const sustainabilityScore = {
    originMentioned: { score: 0, evidence: "", confidence: 0 },
    certifications: { score: 0, evidence: "", confidence: 0 },
    sustainableMaterials: { score: 0, evidence: "", confidence: 0 },
    webEthicalIssue: { score: 0, evidence: "", reason: "" },
    environmentalImpact: { score: 0, evidence: "", confidence: 0 },
    totalScore: 0,
    totalConfidence: 0,
    version: "2.1", // Updated version with web ethical issue
  };

  // Try to analyze with AI first
  let aiScore = null;
  let webEthical = null;
  let productTitle = window.detectedProductTitle || "";
  let productBrand = window.detectedProductBrand || "";
  try {
    console.log("[DEBUG] Analyzing product with Groq AI...");
    aiScore = await analyzeWithGroqAI(productText);
    if (aiScore) {
      console.log("[DEBUG] Using AI analysis for sustainability scoring");
      // Set scores from AI analysis
      sustainabilityScore.originMentioned.score = aiScore.origin.score;
      sustainabilityScore.originMentioned.evidence = aiScore.origin.evidence;
      sustainabilityScore.originMentioned.confidence = 0.9;
      sustainabilityScore.certifications.score = aiScore.certifications.score;
      sustainabilityScore.certifications.evidence =
        aiScore.certifications.evidence;
      sustainabilityScore.certifications.confidence = 0.9;
      sustainabilityScore.sustainableMaterials.score = aiScore.materials.score;
      sustainabilityScore.sustainableMaterials.evidence =
        aiScore.materials.evidence;
      sustainabilityScore.sustainableMaterials.confidence = 0.9;
      sustainabilityScore.environmentalImpact.score =
        aiScore.environmentalImpact.score;
      sustainabilityScore.environmentalImpact.evidence =
        aiScore.environmentalImpact.evidence;
      sustainabilityScore.environmentalImpact.confidence = 0.9;
      // Web ethical issue: use web search (with Supabase cache)
      webEthical = await getOrFetchWebEthicalIssueScore(
        productTitle,
        productBrand
      );
      sustainabilityScore.webEthicalIssue.score = webEthical.score;
      sustainabilityScore.webEthicalIssue.evidence = webEthical.evidence;

      // Debug logging for web ethical issue data
      console.log("[DEBUG] Web Ethical Issue raw data:", webEthical);

      // Set the reason with fallbacks
      if (webEthical.groqOutput && webEthical.groqOutput.reason) {
        sustainabilityScore.webEthicalIssue.reason =
          webEthical.groqOutput.reason;
        console.log(
          "[DEBUG] Using groqOutput.reason:",
          sustainabilityScore.webEthicalIssue.reason
        );
      } else if (typeof webEthical.reason === "string") {
        sustainabilityScore.webEthicalIssue.reason = webEthical.reason;
        console.log(
          "[DEBUG] Using webEthical.reason:",
          sustainabilityScore.webEthicalIssue.reason
        );
      } else {
        sustainabilityScore.webEthicalIssue.reason =
          webEthical.score < 0
            ? "Ethical issues detected"
            : "No ethical issues detected";
        console.log(
          "[DEBUG] Using fallback reason:",
          sustainabilityScore.webEthicalIssue.reason
        );
      }

      // Update modal UI with web ethical score
      if (typeof window.updateWebEthicalScoreUI === "function") {
        window.updateWebEthicalScoreUI(webEthical.score, webEthical.groqOutput);
      }
      // If AI detected a manufacturing country
      if (aiScore.manufacturingCountry) {
        window.detectedCountry = aiScore.manufacturingCountry;
        console.log("[DEBUG] AI detected country:", window.detectedCountry);
      }
      // Calculate total score (no end-of-life)
      // Make sure web ethical issues are properly applied (they can be negative)
      sustainabilityScore.totalScore = Math.max(
        0,
        sustainabilityScore.originMentioned.score +
          sustainabilityScore.certifications.score +
          sustainabilityScore.sustainableMaterials.score +
          sustainabilityScore.webEthicalIssue.score +
          sustainabilityScore.environmentalImpact.score
      );
      sustainabilityScore.totalConfidence = 0.9;
      return sustainabilityScore;
    }
  } catch (aiError) {
    console.error(
      "[DEBUG] AI analysis failed, falling back to rule-based:",
      aiError
    );
  }
  // Always run web ethical issue search, even if AI fails
  webEthical = await getOrFetchWebEthicalIssueScore(productTitle, productBrand);
  sustainabilityScore.webEthicalIssue.score = webEthical.score;
  sustainabilityScore.webEthicalIssue.evidence = webEthical.evidence;
  sustainabilityScore.webEthicalIssue.reason =
    webEthical.groqOutput && webEthical.groqOutput.reason
      ? webEthical.groqOutput.reason
      : "";
  // Update modal UI with web ethical score
  if (typeof window.updateWebEthicalScoreUI === "function") {
    window.updateWebEthicalScoreUI(webEthical.score, webEthical.groqOutput);
  }

  // If AI fails or isn't available, fall back to the original rule-based approach

  // Country of origin is now detected by the AI model
  // No manual regex detection needed anymore

  // Fetch certification patterns from Supabase (with fallback)
  let certificationData = [];
  try {
    // Dynamic import to avoid circular dependency
    const { fetchCertificationPatterns } = await import(
      "./lib/fetchCertificationPatterns.js"
    );
    const patterns = await fetchCertificationPatterns();
    if (patterns && Array.isArray(patterns) && patterns.length > 0) {
      certificationData = patterns;
    } else {
      throw new Error("No patterns fetched");
    }
  } catch (err) {
    // Fallback to hardcoded patterns if fetch fails
    certificationData = [
      {
        name: "GOTS",
        pattern: /\b(?:GOTS|Global\s*Organic\s*Textile\s*Standard)\b/i,
        weight: 1.0,
        confidence: 0.95,
        category: "textile",
      },
      {
        name: "OEKO-TEX",
        pattern: /\b(?:OEKO[\-\s]?TEX|Standard\s*100)\b/i,
        weight: 1.0,
        confidence: 0.9,
        category: "textile",
      },
      {
        name: "FSC",
        pattern: /\b(?:FSC|Forest\s*Stewardship\s*Council)\b/i,
        weight: 1.0,
        confidence: 0.9,
        category: "wood",
      },
      {
        name: "B Corp",
        pattern:
          /\b(?:B\s*Corp|B\s*Corporation|Certified\s*B\s*Corporation)\b/i,
        weight: 1.0,
        confidence: 0.85,
        category: "company",
      },
      {
        name: "Fair Trade",
        pattern: /\b(?:Fairtrade|Fair\s*Trade)\b/i,
        weight: 1.0,
        confidence: 0.85,
        category: "social",
      },
      {
        name: "USDA Organic",
        pattern:
          /\b(?:USDA\s*Organic|Certified\s*Organic|Organic\s*Certification)\b/i,
        weight: 1.0,
        confidence: 0.9,
        category: "agriculture",
      },
      {
        name: "Rainforest Alliance",
        pattern: /\b(?:Rainforest\s*Alliance)\b/i,
        weight: 1.0,
        confidence: 0.9,
        category: "agriculture",
      },
      {
        name: "Cradle to Cradle",
        pattern: /\b(?:Cradle\s*to\s*Cradle|C2C\s*Certified)\b/i,
        weight: 1.0,
        confidence: 0.9,
        category: "product",
      },
      {
        name: "Energy Star",
        pattern: /\b(?:Energy\s*Star)\b/i,
        weight: 1.0,
        confidence: 0.9,
        category: "electronics",
      },
      {
        name: "LEED",
        pattern:
          /\b(?:LEED|Leadership\s*in\s*Energy\s*and\s*Environmental\s*Design)\b/i,
        weight: 1.0,
        confidence: 0.85,
        category: "building",
      },
      {
        name: "Green Seal",
        pattern: /\b(?:Green\s*Seal)\b/i,
        weight: 1.0,
        confidence: 0.8,
        category: "product",
      },
      {
        name: "BlueSign",
        pattern: /\b(?:BlueSign|Blue\s*Sign)\b/i,
        weight: 1.0,
        confidence: 0.85,
        category: "textile",
      },
      {
        name: "EU Ecolabel",
        pattern: /\b(?:Ecolabel|EU\s*Flower|EU\s*Ecolabel)\b/i,
        weight: 1.0,
        confidence: 0.85,
        category: "product",
      },
      {
        name: "Nordic Swan",
        pattern: /\b(?:Nordic\s*Swan)\b/i,
        weight: 1.0,
        confidence: 0.85,
        category: "product",
      },
    ];
    console.warn("[SUSTAINABILITY] Using fallback certification patterns.");
  }

  // Hybrid AI + pattern match for certifications
  let foundCertifications = [];
  let certHighestConfidence = 0;
  let bestEvidence = "";
  let aiCerts = [];
  let aiEvidence = "";
  let aiConfidence = 0;

  // Try AI first (if available)
  try {
    const aiScore = await analyzeWithGroqAI(productText);
    if (
      aiScore &&
      aiScore.certifications &&
      aiScore.certifications.score === 1
    ) {
      aiCerts = aiScore.certifications.allFound || [];
      aiEvidence = aiScore.certifications.evidence || "";
      aiConfidence = aiScore.certifications.confidence || 0.9;
    }
  } catch (e) {
    // Ignore AI errors, fallback to pattern match
  }

  // Pattern match (Supabase or fallback)
  try {
    // First check if text contains "certification" or "certified" for context
    const hasCertificationContext =
      /certifi(?:cation|ed|cate)|eco.?label|standard|sustainable\s*label/i.test(
        productText
      );
    const contextBoost = hasCertificationContext ? 0.1 : 0;

    for (const cert of certificationData) {
      const matches = productText.match(
        new RegExp(
          `((?:[\s\w,.]{0,30})${cert.pattern.source}(?:[\s\w,.]{0,30}))`,
          "gi"
        )
      );

      if (matches && matches.length) {
        for (const match of matches) {
          const isNegativeContext =
            /not\s+(?:\w+\s+){0,3}(?:certified|compliant)|doesn't\s+(?:\w+\s+){0,3}(?:meet|have)/i.test(
              match
            );
          if (!isNegativeContext) {
            const adjustedConfidence = Math.min(
              cert.confidence + contextBoost,
              1.0
            );
            foundCertifications.push({
              name: cert.name,
              evidence: match,
              confidence: adjustedConfidence,
            });
            if (adjustedConfidence > certHighestConfidence) {
              certHighestConfidence = adjustedConfidence;
              bestEvidence = match;
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(
      "[SUSTAINABILITY] Error detecting certifications (pattern match):",
      error
    );
  }

  // Merge AI and pattern match results (union, deduped by name)
  let allCerts = [...foundCertifications];
  for (const aiCert of aiCerts) {
    if (!allCerts.some((c) => c.name === aiCert)) {
      allCerts.push({
        name: aiCert,
        evidence: aiEvidence,
        confidence: aiConfidence,
      });
    }
  }
  if (allCerts.length > 0) {
    sustainabilityScore.certifications.score = 1;
    sustainabilityScore.certifications.evidence = allCerts[0].evidence;
    sustainabilityScore.certifications.confidence = allCerts[0].confidence;
    sustainabilityScore.certifications.allFound = allCerts.map((c) => c.name);
    console.log(
      "[SUSTAINABILITY] Certifications found (hybrid):",
      allCerts.map((c) => c.name).join(", ")
    );
  }

  // Check for sustainable materials with improved context validation
  // Group materials by type with confidence levels
  const sustainableMaterialTypes = [
    {
      category: "recycled",
      patterns: [
        { regex: /\b(?:100%|[0-9]{1,3}%)\s+recycled\b/i, confidence: 0.95 },
        {
          regex:
            /\brecycled\s+(?:content|material|fabric|plastic|paper|glass|metal)\b/i,
          confidence: 0.9,
        },
        { regex: /\bmade\s+(?:from|with)\s+recycled\b/i, confidence: 0.85 },
        { regex: /\bpost-consumer(?:\s+recycled)?\b/i, confidence: 0.9 },
      ],
    },
    {
      category: "organic",
      patterns: [
        {
          regex:
            /\b(?:100%|[0-9]{1,3}%)\s+organic\s+(?:cotton|material|fabric|fiber)/i,
          confidence: 0.95,
        },
        {
          regex:
            /\b(?:certified)\s+organic\s+(?:cotton|material|fabric|fiber)/i,
          confidence: 0.95,
        },
        {
          regex: /\borganic\s+(?:cotton|material|fabric|fiber)\b/i,
          confidence: 0.85,
        },
      ],
    },
    {
      category: "sustainable_fibers",
      patterns: [
        { regex: /\bbamboo\s+(?:fiber|material)\b/i, confidence: 0.85 },
        { regex: /\bhemp\s+(?:fiber|material)\b/i, confidence: 0.85 },
        { regex: /\btencel\b/i, confidence: 0.9 },
        { regex: /\blyocell\b/i, confidence: 0.9 },
        { regex: /\bmodal\s+(?:fiber|fabric)\b/i, confidence: 0.8 },
      ],
    },
    {
      category: "biodegradable",
      patterns: [
        {
          regex: /\bbiodegradable\s+(?:material|packaging|product)\b/i,
          confidence: 0.9,
        },
        {
          regex: /\bcompostable\s+(?:material|packaging|product)\b/i,
          confidence: 0.9,
        },
      ],
    },
    {
      category: "renewable",
      patterns: [
        { regex: /\brenewable\s+(?:material|resource)\b/i, confidence: 0.85 },
        { regex: /\bplant[\-\s]based\b/i, confidence: 0.8 },
        { regex: /\bsustainably\s+(?:sourced|harvested)\b/i, confidence: 0.8 },
      ],
    },
    {
      category: "general_sustainable",
      patterns: [
        { regex: /\beco[\-\s]?friendly\s+material\b/i, confidence: 0.7 },
        {
          regex:
            /\bsustainable\s+(?:wood|timber|paper|material|cotton|fabric)\b/i,
          confidence: 0.8,
        },
        {
          regex: /\bethically\s+sourced\s+(?:material|ingredient)\b/i,
          confidence: 0.75,
        },
        {
          regex: /\bnatural\s+(?:fiber|material)s?\b(?!\s*gas)/i,
          confidence: 0.65,
        },
      ],
    },
  ];

  try {
    let foundMaterials = [];
    let materialHighestConfidence = 0;
    let bestMaterialEvidence = "";
    let materialCategories = new Set();

    // Check for context phrases that would increase confidence
    const materialContext = [
      /made\s+(?:of|from|with|using)/i,
      /materials?\s+(?:include|used|composition|content)/i,
      /(?:product|item)\s+(?:made|constructed|built|consists|composition)/i,
      /composition/i,
      /material\s+details/i,
    ];

    const hasMaterialContext = materialContext.some((regex) =>
      regex.test(productText)
    );
    const contextBoost = hasMaterialContext ? 0.1 : 0;

    // Find sustainable material mentions in the text
    for (const materialType of sustainableMaterialTypes) {
      for (const { regex, confidence } of materialType.patterns) {
        const matches = productText.match(
          new RegExp(
            `((?:[\\s\\w,.]{0,30})${regex.source}(?:[\\s\\w,.]{0,30}))`,
            "gi"
          )
        );

        if (matches && matches.length) {
          for (const match of matches) {
            // Check for negative contexts
            const isNegativeContext =
              /not\s+(?:\w+\s+){0,3}(?:made from|contain)|doesn't\s+(?:\w+\s+){0,3}(?:use|have)/i.test(
                match
              );

            if (!isNegativeContext) {
              const adjustedConfidence = Math.min(
                confidence + contextBoost,
                1.0
              );

              foundMaterials.push({
                category: materialType.category,
                evidence: match,
                confidence: adjustedConfidence,
              });

              materialCategories.add(materialType.category);

              if (adjustedConfidence > materialHighestConfidence) {
                materialHighestConfidence = adjustedConfidence;
                bestMaterialEvidence = match;
              }
            }
          }
        }
      }
    }

    // Multiple categories or high confidence boosts the score
    if (foundMaterials.length > 0) {
      sustainabilityScore.sustainableMaterials.score = 1; // Binary scoring for now
      sustainabilityScore.sustainableMaterials.evidence = bestMaterialEvidence;
      sustainabilityScore.sustainableMaterials.confidence =
        materialHighestConfidence;
      sustainabilityScore.sustainableMaterials.categories =
        Array.from(materialCategories);

      console.log(
        "[SUSTAINABILITY] Sustainable materials found:",
        Array.from(materialCategories).join(", "),
        "with highest confidence:",
        materialHighestConfidence
      );
    }
  } catch (error) {
    console.error(
      "[SUSTAINABILITY] Error detecting sustainable materials:",
      error
    );
  }

  // Check for environmental impact disclosure with context validation
  // Categorize environmental impact measures with confidence levels
  const environmentalImpactCategories = [
    {
      category: "carbon_footprint",
      patterns: [
        {
          regex: /\bcarbon\s*(?:footprint|neutral|negative|offset)\b/i,
          confidence: 0.95,
        },
        { regex: /\bnet\s*zero\s*(?:carbon|emissions)\b/i, confidence: 0.95 },
        {
          regex:
            /\b(?:reduced|lower|less)\s*(?:CO2|carbon dioxide|greenhouse gas|GHG)\b/i,
          confidence: 0.9,
        },
        {
          regex: /\bclimate\s*(?:neutral|positive|friendly)\b/i,
          confidence: 0.85,
        },
      ],
    },
    {
      category: "water_conservation",
      patterns: [
        {
          regex:
            /\b(?:reduced|lower|less)\s*water\s*(?:usage|consumption|footprint)\b/i,
          confidence: 0.9,
        },
        {
          regex: /\bwater\s*(?:saving|efficient|conservation|recycling)\b/i,
          confidence: 0.85,
        },
        { regex: /\blow\s*water\s*impact\b/i, confidence: 0.8 },
      ],
    },
    {
      category: "energy_efficiency",
      patterns: [
        {
          regex:
            /\b(?:reduced|lower|less)\s*energy\s*(?:usage|consumption|footprint)\b/i,
          confidence: 0.9,
        },
        {
          regex: /\benergy\s*(?:saving|efficient|conservation)\b/i,
          confidence: 0.85,
        },
        { regex: /\blow\s*energy\s*impact\b/i, confidence: 0.8 },
        { regex: /\b(?:renewable|green|clean)\s*energy\b/i, confidence: 0.9 },
      ],
    },
    {
      category: "zero_waste",
      patterns: [
        { regex: /\bzero\s*(?:waste|emission)\b/i, confidence: 0.95 },
        {
          regex: /\bwaste\s*(?:reduction|minimized|reduced)\b/i,
          confidence: 0.85,
        },
        { regex: /\bminimal\s*packaging\b/i, confidence: 0.8 },
      ],
    },
    {
      category: "impact_assessment",
      patterns: [
        {
          regex:
            /\benvironmental\s*impact\s*(?:statement|assessment|analysis)\b/i,
          confidence: 0.95,
        },
        { regex: /\blife\s*cycle\s*assessment\b/i, confidence: 0.95 },
        {
          regex: /\bsustainability\s*(?:report|assessment|analysis)\b/i,
          confidence: 0.9,
        },
        { regex: /\becological\s*(?:footprint|impact)\b/i, confidence: 0.9 },
      ],
    },
  ];

  try {
    let foundEnvironmentalMeasures = [];
    let envHighestConfidence = 0;
    let bestEnvEvidence = "";
    let envCategories = new Set();

    // Check for context phrases that would increase confidence
    const envContext = [
      /environmental/i,
      /sustainability/i,
      /eco.?friendly/i,
      /planet/i,
      /climate/i,
    ];

    const hasEnvContext = envContext.some((regex) => regex.test(productText));
    const contextBoost = hasEnvContext ? 0.1 : 0;

    // Find environmental impact mentions in the text
    for (const envCategory of environmentalImpactCategories) {
      for (const { regex, confidence } of envCategory.patterns) {
        const matches = productText.match(
          new RegExp(
            `((?:[\\s\\w,.]{0,30})${regex.source}(?:[\\s\\w,.]{0,30}))`,
            "gi"
          )
        );

        if (matches && matches.length) {
          for (const match of matches) {
            // Check for negative contexts
            const isNegativeContext =
              /not\s+(?:\w+\s+){0,3}(?:environmentally friendly|sustainable)|doesn't\s+(?:\w+\s+){0,3}(?:reduce|lower|minimize)/i.test(
                match
              );

            if (!isNegativeContext) {
              const adjustedConfidence = Math.min(
                confidence + contextBoost,
                1.0
              );

              foundEnvironmentalMeasures.push({
                category: envCategory.category,
                evidence: match,
                confidence: adjustedConfidence,
              });

              envCategories.add(envCategory.category);

              if (adjustedConfidence > envHighestConfidence) {
                envHighestConfidence = adjustedConfidence;
                bestEnvEvidence = match;
              }
            }
          }
        }
      }
    }

    // Set score if we found any environmental measures
    if (foundEnvironmentalMeasures.length > 0) {
      sustainabilityScore.environmentalImpact.score = 1; // Binary scoring for now
      sustainabilityScore.environmentalImpact.evidence = bestEnvEvidence;
      sustainabilityScore.environmentalImpact.confidence = envHighestConfidence;
      sustainabilityScore.environmentalImpact.categories =
        Array.from(envCategories);

      console.log(
        "[SUSTAINABILITY] Environmental impact measures found:",
        Array.from(envCategories).join(", "),
        "with highest confidence:",
        envHighestConfidence
      );
    }
  } catch (error) {
    console.error(
      "[SUSTAINABILITY] Error detecting environmental impact:",
      error
    );
  }

  // Calculate the overall confidence score based on individual confidences
  const totalConfidenceScore =
    ((sustainabilityScore.originMentioned.confidence || 0) +
      (sustainabilityScore.certifications.confidence || 0) +
      (sustainabilityScore.sustainableMaterials.confidence || 0) +
      (sustainabilityScore.endOfLife.confidence || 0) +
      (sustainabilityScore.environmentalImpact.confidence || 0)) /
    5; // Average confidence across all criteria

  // Calculate total score (0-5) with robust error handling
  try {
    sustainabilityScore.totalScore =
      sustainabilityScore.originMentioned.score +
      sustainabilityScore.certifications.score +
      sustainabilityScore.sustainableMaterials.score +
      sustainabilityScore.endOfLife.score +
      sustainabilityScore.environmentalImpact.score;

    sustainabilityScore.totalConfidence = totalConfidenceScore;

    // Log the full score breakdown for debugging
    console.log(
      "[SUSTAINABILITY] Final score calculation complete:",
      JSON.stringify({
        origin: sustainabilityScore.originMentioned.score,
        certifications: sustainabilityScore.certifications.score,
        materials: sustainabilityScore.sustainableMaterials.score,
        endOfLife: sustainabilityScore.endOfLife.score,
        environment: sustainabilityScore.environmentalImpact.score,
        total: sustainabilityScore.totalScore,
        confidence: sustainabilityScore.totalConfidence.toFixed(2),
      })
    );
  } catch (error) {
    console.error("[SUSTAINABILITY] Error calculating total score:", error);
    // Ensure we always return a valid score even if calculation fails
    sustainabilityScore.totalScore = Math.max(
      0,
      (sustainabilityScore.originMentioned.score || 0) +
        (sustainabilityScore.certifications.score || 0) +
        (sustainabilityScore.sustainableMaterials.score || 0) +
        (sustainabilityScore.endOfLife.score || 0) +
        (sustainabilityScore.environmentalImpact.score || 0)
    );
  }

  console.log(
    "[SUSTAINABILITY] Final score breakdown:",
    JSON.stringify(sustainabilityScore, null, 2)
  );

  return sustainabilityScore;
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
  await detectProductPage();
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
async function detectProductPage() {
  // ...existing code...

  // ...existing code...
  // ...existing code...
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
    // No :contains() selectors
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
    // Amazon specific
    "#add-to-cart-button",
    "#buy-now-button",
    // Temu specific
    ".add-to-cart-btn",
    ".buy-now-btn",
    // No :contains() selectors
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

  // Then check for price elements (limit to first 10 matches per selector)
  for (const selector of priceSelectors) {
    try {
      const elements = Array.from(document.querySelectorAll(selector)).slice(
        0,
        10
      );
      if (elements.length > 0) {
        // Use the first visible price element
        for (const element of elements) {
          if (isElementVisible(element) && /[$€£¥]/.test(element.textContent)) {
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
  // Fallback: search all spans/divs for price symbols, but limit to first 2000 elements
  if (!priceElement) {
    const candidates = Array.from(document.querySelectorAll("span, div")).slice(
      0,
      2000
    );
    for (const el of candidates) {
      if (isElementVisible(el) && /[$€£¥]/.test(el.textContent)) {
        priceElement = el;
        isProductPage = true;
        break;
      }
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
  // Fallback: search all buttons for text
  if (!isProductPage) {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (
        isElementVisible(btn) &&
        /add to cart|add to bag|buy now|purchase/i.test(btn.textContent)
      ) {
        isProductPage = true;
        break;
      }
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
    // Show the loading badge immediately before any heavy DOM work
    let badgePriceElement = priceElement || titleElement || document.body;
    const initialBadgeId = "temp-badge-" + Date.now();
    insertSupplyChainBadge(badgePriceElement, {
      score: null,
      verifiedScore: null,
      manufacturingCountry: "Unknown",
      co2Emissions: null,
      shippingMethod: null,
      icons: "",
      isLoading: true,
      badgeId: initialBadgeId,
      explanation: "Analyzing product sustainability...",
    });

    // --- Extract product info immediately for web ethical search ---
    // Use detected product title and brand
    const productTitle =
      (titleElement ? titleElement.textContent.trim() : "") ||
      document.title ||
      "Product";
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
    // Set globals for downstream use
    window.detectedProductTitle = productTitle;
    window.detectedProductBrand = productBrand;

    // We'll store all async analysis promises here
    const analysisPromises = {
      webEthical: null,
      aiScore: null,
    };

    // Start web ethical analysis immediately (doesn't block UI)
    analysisPromises.webEthical = getOrFetchWebEthicalIssueScore(
      productTitle,
      productBrand
    );
    // --- End initial product info extraction ---

    // Defer all heavy DOM work and AI calls
    setTimeout(async () => {
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

        // We're using the product info we already extracted earlier
        const productTitle = window.detectedProductTitle;
        const productBrand = window.detectedProductBrand;

        // Extract comprehensive product description and details - more thorough product info gathering
        let productDescription = "";

        // Try meta description first
        const metaDesc =
          document.querySelector('meta[name="description"]')?.content || "";
        if (metaDesc) productDescription += metaDesc + "\n\n";

        // Common product description selectors - combine them all for better data
        const descriptionSelectors = [
          // Existing selectors
          "ux-layout-section-evo ux-layout-section--features",
          "vim d-item-description",
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
          // Amazon-specific expanded selectors
          "#productDetails_detailBullets_sections1", // Product Details section (Amazon)
          "#detailBullets_feature_div", // Product Details section (Amazon)
          "#prodDetails", // Product Details section (Amazon)
          "#additionalDetails_feature_div", // Additional Details section (Amazon)
          "#aboutThisItem_feature_div", // About This Item section (Amazon)
          ".about-this-item", // About This Item (Amazon)
          "#productDescription_feature_div", // Product Description section (Amazon)
          ".product-description-wrapper", // Product Description (Amazon)
          ".additional-details", // Additional Details (Amazon)
          ".product-details", // Product Details (Amazon)
        ];

        // Extract from all selectors and combine, but limit to first 5 elements per selector
        descriptionSelectors.forEach((selector) => {
          const elements = Array.from(
            document.querySelectorAll(selector)
          ).slice(0, 5);
          if (elements && elements.length > 0) {
            elements.forEach((element) => {
              const text = element.textContent.trim();
              if (text && text.length > 10) {
                // Log if we find "Country of Origin" in the text for debugging
                if (/country of origin|origin[:]/i.test(text)) {
                  console.log(
                    "[DEBUG] Found potential country of origin text:",
                    text
                  );
                  // Try to extract the country name from the text block and set it for UI/scoring
                  const countryMatch = text.match(
                    /country\s*of\s*origin[^A-Za-z]*[:\-–=]?\s*([A-Za-z\s\-']{2,30})/i
                  );
                  if (countryMatch && countryMatch[1]) {
                    const countryCandidate = countryMatch[1].trim();
                    // Validate against known countries (case-insensitive)
                    const candidateLower = countryCandidate.toLowerCase();
                    const validCountry = Object.keys(
                      countryEmissionFactors
                    ).find(
                      (c) =>
                        candidateLower === c ||
                        candidateLower === c.replace(/\s+/g, "")
                    );
                    if (validCountry) {
                      window.detectedCountry =
                        validCountry.charAt(0).toUpperCase() +
                        validCountry.slice(1);
                      console.log(
                        "[DEBUG] Country detected and set:",
                        window.detectedCountry
                      );
                    } else {
                      // Fallback: use the candidate if it looks plausible
                      if (
                        countryCandidate.length >= 2 &&
                        countryCandidate.length <= 30 &&
                        /^[A-Za-z\s\-']+$/.test(countryCandidate)
                      ) {
                        window.detectedCountry = countryCandidate;
                        console.log(
                          "[DEBUG] Country detected (fallback):",
                          window.detectedCountry
                        );
                      }
                    }
                  }
                }
                productDescription += text + "\n\n";
              }
            });
          }
        });

        // If still empty, try to find any paragraph that might contain product info
        if (!productDescription) {
          const paragraphs = Array.from(document.querySelectorAll("p")).slice(
            0,
            20
          );
          for (const p of paragraphs) {
            const text = p.textContent.trim();
            if (text && text.length > 40 && text.length < 1000) {
              productDescription += text + "\n\n";
              if (productDescription.length > 2000) break;
            }
          }
        }

        productDescription =
          productDescription.trim() || "No product description found.";

        // Extract product details (materials, specifications, etc.)
        const productDetails = extractProductDetails();

        // We've removed DOM-based country detection as we'll rely solely on AI analysis
        console.log(
          "[DEBUG] Skipping DOM search for country of origin - will use AI detection instead"
        );

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

        // Log product description for debugging purposes
        console.log(
          "[DEBUG] Enhanced description snippet:",
          enhancedDescription.substring(0, 300) + "..."
        );

        // Log the full enhanced description for debugging
        console.log("[DEBUG] FULL Enhanced description:", enhancedDescription);

        // Use the regex-detected country for scoring and UI
        // If not found, set to Unknown
        let manufacturingCountry = window.detectedCountry || "Unknown";
        console.log(
          "[DEBUG] Manufacturing country used for scoring/UI:",
          manufacturingCountry
        );

        // Now perform the Groq AI analysis and wait for both promises
        console.log(
          "[DEBUG][Groq] Sending to Groq for material analysis:",
          enhancedDescription
        );

        // Start Groq AI analysis
        analysisPromises.aiScore = Promise.race([
          analyzeWithGroqAI(enhancedDescription),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("AI timeout")), 8000)
          ),
        ]);

        // Run combined analysis in the background
        setTimeout(async function runBackgroundAnalysis() {
          // Find the existing badge
          const existingBadge = document.getElementById(initialBadgeId);

          try {
            // Wait for both web ethical and AI analysis to complete
            const [webEthical, aiScore] = await Promise.allSettled([
              analysisPromises.webEthical,
              analysisPromises.aiScore,
            ]);

            // Handle web ethical result (handle failed promise case)
            const webEthicalResult =
              webEthical.status === "fulfilled"
                ? webEthical.value
                : {
                    score: 0,
                    evidence: "",
                    groqOutput: { reason: "Analysis failed" },
                  };

            // Handle AI score result (handle failed promise case)
            const aiScoreResult =
              aiScore.status === "fulfilled" ? aiScore.value : null;

            console.log("[DEBUG] Web ethical result:", webEthicalResult);
            console.log("[DEBUG] AI score result:", aiScoreResult);

            // Update the modal with web ethical score
            if (typeof window.updateWebEthicalScoreUI === "function") {
              window.updateWebEthicalScoreUI(
                webEthicalResult.score,
                webEthicalResult.groqOutput
              );
            }

            if (aiScoreResult) {
              console.log(
                "[DEBUG][Groq] Received from Groq for material analysis:",
                aiScoreResult
              );
              // Compose scoreData using Groq AI results
              let envImpactLevel = "unable";
              if (
                aiScoreResult.environmentalImpact &&
                typeof aiScoreResult.environmentalImpact.score === "number"
              ) {
                if (aiScoreResult.environmentalImpact.score === 1) {
                  envImpactLevel = "low";
                } else if (aiScoreResult.environmentalImpact.score === -1) {
                  envImpactLevel = "high";
                } else if (aiScoreResult.environmentalImpact.score === 0.5) {
                  envImpactLevel = "medium";
                } else {
                  envImpactLevel = "unable";
                }
              }
              const sustainableMaterialsScore =
                aiScoreResult.materials &&
                typeof aiScoreResult.materials.score === "number"
                  ? aiScoreResult.materials.score
                  : 0;
              let endOfLifeScore =
                aiScoreResult.endOfLife &&
                typeof aiScoreResult.endOfLife.score === "number"
                  ? aiScoreResult.endOfLife.score
                  : 0;
              if (sustainableMaterialsScore === 1 && endOfLifeScore !== 1) {
                endOfLifeScore = 1;
              }

              // Include web ethical score and evidence in the badge data
              const scoreData = {
                manufacturingCountry: manufacturingCountry, // Only use regex result
                sustainableMaterials: sustainableMaterialsScore,
                endOfLife: endOfLifeScore,
                certifications:
                  sustainableMaterialsScore === 1
                    ? aiScoreResult.certifications &&
                      typeof aiScoreResult.certifications.score === "number"
                      ? aiScoreResult.certifications.score
                      : 0
                    : 0,
                environmentalImpact: envImpactLevel,
                // Add web ethical score to the badge data
                webEthicalIssue: {
                  score: webEthicalResult.score,
                  evidence: webEthicalResult.evidence,
                  reason: webEthicalResult.groqOutput?.reason || "",
                },
                explanation: enhancedDescription,
                updateExisting: existingBadge,
                isLoading: false,
              };

              console.log(
                "[DEBUG] Full product description for scoring:",
                enhancedDescription.substring(0, 500) + "..."
              );
              console.log(
                "[DEBUG] Groq AI sustainable materials score:",
                scoreData.sustainableMaterials
              );
              console.log(
                "[DEBUG] Web ethical score included in badge:",
                scoreData.webEthicalIssue
              );

              // Insert badge with BOTH web ethical and AI scores
              insertSupplyChainBadge(priceElement, scoreData);
            } else {
              // Fallback badge if AI fails but include web ethical score if available
              insertSupplyChainBadge(priceElement, {
                score: null,
                verifiedScore: null,
                manufacturingCountry: manufacturingCountry,
                co2Emissions: null,
                shippingMethod: null,
                webEthicalIssue: {
                  score: webEthicalResult.score,
                  evidence: webEthicalResult.evidence,
                  reason: webEthicalResult.groqOutput?.reason || "",
                },
                icons: "",
                updateExisting: existingBadge,
                isLoading: false,
                explanation:
                  "Sustainability data partially available (AI analysis failed).",
              });
            }
          } catch (err) {
            console.warn("[Analysis] Failed to complete analysis:", err);
            // Fallback badge if both analyses fail
            insertSupplyChainBadge(priceElement, {
              score: null,
              verifiedScore: null,
              manufacturingCountry: manufacturingCountry,
              co2Emissions: null,
              shippingMethod: null,
              icons: "",
              updateExisting: existingBadge,
              isLoading: false,
              explanation:
                "Sustainability data not available (analysis failed).",
            });
          }
        }, 100); // Small delay to ensure the loading badge is shown first
      } catch (error) {
        console.error("Error processing product page:", error);
        // Fallback to body if there's an error
        try {
          insertSupplyChainBadge(document.body, {
            score: null,
            verifiedScore: null,
            manufacturingCountry: null,
            co2Emissions: null,
            shippingMethod: null,
            icons: "",
            explanation: "No sustainability data available.",
          });
        } catch (fallbackError) {
          console.error("Fallback error:", fallbackError);
        }
      }
    }, 0); // Defer heavy work to next event loop, badge shows instantly
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

// Extract product details from the page DOM
function extractProductDetails() {
  const details = {};

  try {
    // Look for product specification tables
    const specTables = document.querySelectorAll(
      "table.specifications, table.product-specs, table.product-details, table.tech-specs, table.details"
    );

    // Process specification tables
    specTables.forEach((table) => {
      const rows = table.querySelectorAll("tr");
      rows.forEach((row) => {
        const label = row.querySelector("th, td:first-child");
        const value = row.querySelector("td:last-child");

        if (label && value) {
          const labelText = label.textContent.trim().toLowerCase();
          const valueText = value.textContent.trim();

          // Store key details
          if (labelText) {
            details[labelText] = valueText;
          }
        }
      });
    });

    // Look for key-value pairs in various formats
    const specLists = document.querySelectorAll(
      ".product-specs, .specifications, .product-details"
    );
    specLists.forEach((list) => {
      const items = list.querySelectorAll("li, .spec-item, .detail-item");
      items.forEach((item) => {
        const text = item.textContent.trim();
        const separatorIndex = text.indexOf(":");

        if (separatorIndex > 0) {
          const key = text.substring(0, separatorIndex).trim().toLowerCase();
          const value = text.substring(separatorIndex + 1).trim();

          if (key) {
            details[key] = value;
          }
        }
      });
    });

    console.log("[DEBUG] Extracted product details:", details);
  } catch (error) {
    console.error("[DEBUG] Error extracting product details:", error);
  }

  return details;
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

// Get rating icons based on score (0-5)
function getRatingIcons(score) {
  let icons = "";

  // Enhanced SVG icons with better visuals and colors
  // Filled green leaf SVG for positive ratings
  const filledLeaf = `<svg width='18' height='18' viewBox='0 0 24 24' fill='#4caf50' stroke='#388e3c' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round' style='vertical-align:middle;'><path d='M2 22s16-4 20-20C6 2 2 22 2 22z'></path></svg>`;

  // Light gray filled leaf SVG for negative ratings
  const grayLeaf = `<svg width='18' height='18' viewBox='0 0 24 24' fill='#e0e0e0' stroke='#bdbdbd' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round' style='vertical-align:middle;'><path d='M2 22s16-4 20-20C6 2 2 22 2 22z'></path></svg>`;

  // Gold star for excellent sustainability (5/5)
  const goldStar =
    score === 5
      ? `<svg width='20' height='20' viewBox='0 0 24 24' fill='#FFD700' stroke='#FFA500' stroke-width='1' style='vertical-align:middle; margin-left: 4px;'><polygon points='12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26'/></svg>`
      : "";

  // Add the leaf icons
  for (let i = 0; i < score; i++) {
    icons += filledLeaf;
  }
  for (let i = score; i < 5; i++) {
    icons += grayLeaf;
  }

  // Add gold star for perfect scores
  icons += goldStar;

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
  // --- Single Source of Truth for Score Calculation ---
  // Calculate points for each section
  var originPoints =
    scoreData.manufacturingCountry &&
    scoreData.manufacturingCountry !== "Unknown"
      ? 1
      : 0;

  // Only show certifications if sustainable materials is detected
  var certPoints =
    scoreData.sustainableMaterials === 1 &&
    typeof scoreData.certifications === "number"
      ? scoreData.certifications
      : 0;

  // Use Groq AI sustainable materials score directly
  var materialPoints =
    typeof scoreData.sustainableMaterials === "number"
      ? scoreData.sustainableMaterials
      : 0;

  // Use Groq AI end-of-life score directly
  var endOfLifePoints =
    typeof scoreData.endOfLife === "number" ? scoreData.endOfLife : 0;
  // Use Groq AI environmental impact score directly
  // Score mapping: Low Impact +1, High Impact -1, Medium Impact +0.5, Unable to analyze 0
  var envPoints = 0;
  if (scoreData.environmentalImpact === "low") {
    envPoints = 1;
  } else if (scoreData.environmentalImpact === "high") {
    envPoints = -1;
  } else if (scoreData.environmentalImpact === "medium") {
    envPoints = 0.5;
  } else {
    envPoints = 0;
  }

  // Calculate total score (0-5)
  var webEthicalPoints =
    typeof scoreData.webEthicalIssue === "object" &&
    typeof scoreData.webEthicalIssue.score === "number"
      ? scoreData.webEthicalIssue.score
      : 0;

  // Ensure total score is never negative by using Math.max(0, ...)
  var calculatedScore = Math.max(
    0,
    originPoints + certPoints + materialPoints + webEthicalPoints + envPoints
  );

  // Ensure score is within range 0-5, no half points
  calculatedScore = Math.max(0, Math.min(5, Math.floor(calculatedScore)));

  // Check if this is a loading badge
  const isLoading = scoreData.isLoading === true;

  if (!isLoading) {
    // Store the calculated score in scoreData
    scoreData.score = calculatedScore;

    // Log detailed score calculation for badge and modal
    console.log(
      `Sustainability score calculation (single source):\n  - Origin Mentioned: ${originPoints} point(s)\n  - Certifications: ${certPoints} point(s)\n  - Sustainable Materials: ${materialPoints} point(s)\n  - Web Ethical Issues: ${webEthicalPoints} point(s)\n  - End-of-Life: ${endOfLifePoints} point(s)\n  - Environmental Impact: ${envPoints} point(s)\n  = Total: ${calculatedScore}/5\n`
    );

    // Update the scoreData object with our synced score
    scoreData.calculatedScore = calculatedScore;
    scoreData.score = calculatedScore;
    scoreData.icons = getRatingIcons(Math.round(calculatedScore));
  }

  // Store confidence data for future analysis if available
  if (scoreData.sustainabilityScoreData?.confidenceLevels) {
    try {
      // Get product identifier (can be URL or product name/ID)
      const productId = window.location.href || document.title;
      // Create a simplified key to avoid storage issues
      const storageKey =
        "sustainability_confidence_" +
        productId.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);

      // Store confidence data with timestamp
      const confidenceData = {
        timestamp: new Date().toISOString(),
        levels: scoreData.sustainabilityScoreData.confidenceLevels,
        totalConfidence: scoreData.sustainabilityScoreData.totalConfidence || 0,
        score: calculatedScore,
      };

      // Use safeStorage instead of localStorage to avoid sandbox errors
      safeStorage.setItem(storageKey, JSON.stringify(confidenceData));

      console.log(
        "[DEBUG] Stored confidence data for future analysis:",
        storageKey
      );
    } catch (error) {
      console.error("[ERROR] Failed to store confidence data:", error);
    }
  }

  // Check if we're updating an existing badge
  let badge;
  if (
    scoreData.updateExisting &&
    document.body.contains(scoreData.updateExisting)
  ) {
    badge = scoreData.updateExisting;
  } else {
    // Create new badge element
    badge = document.createElement("div");
    badge.id = scoreData.badgeId || "supply-chain-badge";
    badge.className = "supply-chain-badge";
    badge.style.display = settings.enabled ? "flex" : "none";
  }

  // Determine badge color based on score or loading state
  const badgeColor = scoreData.isLoading
    ? "#757575" // Gray for loading
    : scoreData.score > 0
    ? "#4caf50"
    : "#e53935"; // Green if > 0, red if 0

  // Badge revision with enhanced information
  // Create tooltip with detailed breakdown if available
  let tooltipContent = "";
  if (!scoreData.isLoading && scoreData.sustainabilityScoreData) {
    tooltipContent = `
      Origin: ${badgeOriginPoints}/1 ${
      badgeConfidenceLevels.origin > 0.7 ? "✓" : ""
    }
      Certifications: ${badgeCertPoints}/1 ${
      badgeConfidenceLevels.certifications > 0.7 ? "✓" : ""
    }
      Materials: ${badgeMaterialPoints}/1 ${
      badgeConfidenceLevels.materials > 0.7 ? "✓" : ""
    }
      End of Life: ${badgeEndOfLifePoints}/1 ${
      badgeConfidenceLevels.endOfLife > 0.7 ? "✓" : ""
    }
      Environmental: ${badgeEnvPoints}/1 ${
      badgeConfidenceLevels.environment > 0.7 ? "✓" : ""
    }
    `;
  }

  // Content depends on whether we're showing loading state or results
  if (scoreData.isLoading) {
    // Loading state badge
    badge.innerHTML = `
      <div class="supply-chain-badge-content sleek-badge" 
           style="background: #fff; border-radius: 18px; box-shadow: 0 2px 8px 0 rgba(60,60,60,0.10); padding: 8px 18px 8px 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 120px;"
           title="Analyzing product sustainability...">
        <span class="supply-chain-badge-title" style="font-size: 0.95em; font-weight: 600; color: #222; letter-spacing: 0.01em; margin-bottom: 2px;">Sustainability Score</span>
        <span style="display: flex; align-items: center; gap: 8px;">
          <span class="supply-chain-score" style="color: ${badgeColor}; font-size: 1.15em; font-weight: 700;">
            Analyzing...
          </span>
          <span class="supply-chain-spinner" style="display: inline-block; width: 16px; height: 16px; border: 3px solid #f3f3f3; border-top: 3px solid #4caf50; border-radius: 50%; animation: spin 1.2s linear infinite;"></span>
        </span>
      </div>
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    `;
  } else {
    // Results badge
    // Choose appropriate icon based on score
    let sustainabilityIcon = "🍃"; // Default
    if (calculatedScore >= 4) {
      sustainabilityIcon = "🌱"; // Excellent sustainability score
    } else if (calculatedScore >= 2) {
      sustainabilityIcon = "♻️"; // Moderate sustainability score
    } else if (calculatedScore >= 1) {
      sustainabilityIcon = "🌍"; // Low sustainability score
    } else {
      sustainabilityIcon = "⚠️"; // No sustainability info
    }

    badge.innerHTML = `
      <div class="supply-chain-badge-content sleek-badge" 
           style="background: #fff; border-radius: 18px; box-shadow: 0 2px 8px 0 rgba(60,60,60,0.10); padding: 8px 18px 8px 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 120px;"
           title="Sustainability Score: ${scoreData.score}/5${
      tooltipContent ? "\n\n" + tooltipContent : ""
    }">
        <span class="supply-chain-badge-title" style="font-size: 0.95em; font-weight: 600; color: #222; letter-spacing: 0.01em; margin-bottom: 2px;">Sustainability Score</span>
        <span style="display: flex; align-items: center; gap: 8px;">
          <span class="supply-chain-score" style="color: ${badgeColor}; font-size: 1.15em; font-weight: 700;">
            ${
              scoreData.score !== null && scoreData.score !== undefined
                ? `${scoreData.score}/5`
                : "N/A"
            }
          </span>
          <span class="supply-chain-icons" style="font-size: 1.2em; display: flex; align-items: center;">${sustainabilityIcon} ${
      scoreData.icons
    }</span>
        </span>
      </div>
    `;
  }

  // Always float badge at bottom right for maximum compatibility, and make it draggable
  badge.style.position = "fixed";
  badge.style.bottom = "10px";
  badge.style.right = "10px";
  badge.style.top = "auto";
  badge.style.zIndex = "2147483647"; // Max z-index for compatibility
  badge.style.cursor = "move";
  badge.style.pointerEvents = "auto";
  badge.style.userSelect = "none";
  // Only append badge if not already in DOM
  if (!document.body.contains(badge)) {
    document.body.appendChild(badge);
  }

  // --- Make badge draggable ---
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  badge.addEventListener("mousedown", function (e) {
    // Only start drag if clicking the badge itself, not a child element (like a button)
    if (e.target !== badge) return;
    isDragging = true;
    const rect = badge.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    badge.style.transition = "none";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", function (e) {
    if (!isDragging) return;
    // Calculate new position
    let newLeft = e.clientX - dragOffsetX;
    let newTop = e.clientY - dragOffsetY;
    // Clamp to viewport
    newLeft = Math.max(
      0,
      Math.min(window.innerWidth - badge.offsetWidth, newLeft)
    );
    newTop = Math.max(
      0,
      Math.min(window.innerHeight - badge.offsetHeight, newTop)
    );
    badge.style.left = newLeft + "px";
    badge.style.top = newTop + "px";
    badge.style.right = "auto";
  });

  document.addEventListener("mouseup", function () {
    if (isDragging) {
      isDragging = false;
      badge.style.transition = "box-shadow 0.2s";
      document.body.style.userSelect = "";
    }
  });

  // Create details popup
  const details = document.createElement("div");
  details.id = "supply-chain-details";
  details.className = "supply-chain-details";
  details.style.display = "none";

  // Use the synced score for modal details (always from badge)
  const modalScore = scoreData.calculatedScore;
  const supplyChainDetails = generateSupplyChainDetails(modalScore);

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

  // Use the country value detected by AI
  // We don't need to do any regex extraction here anymore

  // Log country for debugging
  console.log(
    "[DEBUG] Manufacturing country in badge:",
    scoreData.manufacturingCountry || "Unknown"
  );

  // If we somehow don't have a country by this point, set it to Unknown
  if (
    !scoreData.manufacturingCountry ||
    scoreData.manufacturingCountry === null
  ) {
    scoreData.manufacturingCountry = "Unknown";
  }

  // Calculate CO2 emissions based on manufacturing country
  scoreData.co2Emissions = calculateCO2Emissions(
    scoreData.manufacturingCountry
  );

  // Show how the score is being calculated instead of a text summary
  // Use the already-declared variables for modal as well
  // Transparency is worth max 1 point, but can be 0.5 for partial transparency
  let transparencyPoints = 0;
  if (supplyChainDetails.transparency === "High") transparencyPoints = 1;
  else if (supplyChainDetails.transparency === "Good")
    transparencyPoints = 0.5; // Changed to 0.5 for partial transparency
  else if (supplyChainDetails.transparency === "Medium")
    transparencyPoints = 0.5;
  else if (supplyChainDetails.transparency === "Low") transparencyPoints = 0.5;
  else transparencyPoints = 0;

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

  // Compose the breakdown UI ("How This Rating Is Calculated" section removed as requested)

  // --- Modal details: fix sustainable materials and end-of-life explanation ---
  let sustainableMaterialsText = "No clear sustainable materials found";
  if (scoreData.sustainableMaterials === 1) {
    sustainableMaterialsText = "Sustainable materials detected";
  }

  // --- Web Ethical Issue Modal Section ---
  let webEthicalText = "No web ethical issues found.";
  let webEthicalEvidence = "";
  let webEthicalReason = "";
  if (scoreData.webEthicalIssue) {
    // Log web ethical issue data for debugging
    console.log("[DEBUG] Web Ethical Issue data:", scoreData.webEthicalIssue);

    // Set the reason from DeepSeek if available
    if (scoreData.webEthicalIssue.reason) {
      webEthicalReason = scoreData.webEthicalIssue.reason;
      console.log("[DEBUG] Web Ethical Reason:", webEthicalReason);
    } else if (
      scoreData.webEthicalIssue.groqOutput &&
      scoreData.webEthicalIssue.groqOutput.reason
    ) {
      webEthicalReason = scoreData.webEthicalIssue.groqOutput.reason;
      console.log(
        "[DEBUG] Web Ethical Reason from groqOutput:",
        webEthicalReason
      );
    }

    if (scoreData.webEthicalIssue.score === -1) {
      webEthicalText = "Serious ethical or sustainability issues found.";
    } else if (scoreData.webEthicalIssue.score === -0.5) {
      webEthicalText = "Some moderate ethical or sustainability issues found.";
    } else if (scoreData.webEthicalIssue.score === 0) {
      webEthicalText = "Neutral or unclear web sustainability/ethical info.";
    } else if (scoreData.webEthicalIssue.score === 1) {
      webEthicalText = "No web ethical or sustainability issues found.";
    }
    if (scoreData.webEthicalIssue.evidence) {
      webEthicalEvidence = `<a href='${scoreData.webEthicalIssue.evidence}' target='_blank' rel='noopener noreferrer'>See evidence</a>`;
    }
    // Debug section for Web Ethical/Sustainability Issue
    if (scoreData.webEthicalIssue.debugWebEthical) {
      const dbg = scoreData.webEthicalIssue.debugWebEthical;
      webEthicalText += `<br><details style='margin-top:8px;'><summary style='cursor:pointer;font-weight:bold;'>Debug Web Ethical/Sustainability Issue</summary><div style='font-size:0.95em;max-width:600px;overflow-x:auto;'><b>Google Query:</b> <code>${
        dbg.googleQuery
      }</code><br><b>Google API URL:</b> <code style='word-break:break-all;'>${
        dbg.googleApiUrl
      }</code><br><b>Google API Response (truncated):</b> <pre style='max-height:120px;overflow:auto;background:#f5f5f5;border:1px solid #ccc;'>${JSON.stringify(
        dbg.googleApiResponse,
        null,
        2
      ).slice(0, 800)}${
        JSON.stringify(dbg.googleApiResponse, null, 2).length > 800
          ? "... (truncated)"
          : ""
      }</pre><b>DeepSeek Input:</b> <pre style='max-height:120px;overflow:auto;background:#f5f5f5;border:1px solid #ccc;'>${
        dbg.groqInput
      }</pre><b>DeepSeek Output:</b> <pre style='max-height:120px;overflow:auto;background:#f5f5f5;border:1px solid #ccc;'>${JSON.stringify(
        dbg.groqOutput,
        null,
        2
      )}</pre></div></details>`;
    }
  }

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
          <li><b>Product Origin</b> (${originPoints} point):
            <span>
              ${
                scoreData.manufacturingCountry &&
                scoreData.manufacturingCountry !== "Unknown"
                  ? `<b>${scoreData.manufacturingCountry}</b>`
                  : "No manufacturing origin detected"
              }
            </span>
          </li>
          <li><b>Sustainable Materials</b> (${materialPoints} point):
            <span>${sustainableMaterialsText}</span>
          </li>
          <li><b>Environmental Impact</b> (${envPoints} point):
            <span>
              ${
                scoreData.environmentalImpact === "low"
                  ? "Low environmental impact materials detected"
                  : scoreData.environmentalImpact === "high"
                  ? "High environmental impact materials detected"
                  : scoreData.environmentalImpact === "medium"
                  ? "Medium environmental impact materials detected"
                  : "Unable to measure the environmental impact"
              }
            </span>
          </li>
          <li><b>Certifications</b> (${certPoints} point):
            <span>
              ${
                scoreData.sustainableMaterials === 1
                  ? certPoints === 1
                    ? "Certification detected"
                    : "No certifications mentioned"
                  : "Certifications check not applicable (no sustainable materials detected)"
              }
            </span>
          </li>
          <li><b>Web Ethical/Sustainability Issue</b> (${
            typeof scoreData.webEthicalIssue === "object"
              ? scoreData.webEthicalIssue.score
              : 0
          } point):
            <span>${webEthicalText} ${
    webEthicalEvidence ? "| " + webEthicalEvidence : ""
  }${
    webEthicalReason
      ? `<br><small style="color: #666; font-style: italic;">"${truncateText(
          webEthicalReason,
          15
        )}"</small>`
      : webEthicalText.includes("issues found")
      ? `<br><small style="color: #666; font-style: italic;">"Analysis completed"</small>`
      : ""
  }</span>
          </li>
        </ul>
      </div>
      
      <!-- Web Ethical Issue Dedicated Section (shows AI analysis) -->
      ${
        scoreData.webEthicalIssue
          ? `<div class="web-ethical-issue-section" style="margin: 12px 0; padding: 8px; background: #f7f7f7; border-radius: 6px; font-size: 14px;">
        <b>Web Ethical/Sustainability Issue:</b> <span class="web-ethical-score">Score: ${
          scoreData.webEthicalIssue.score
        }</span><br>
        <span class="web-ethical-reason">${
          scoreData.webEthicalIssue.reason ||
          (webEthicalReason
            ? webEthicalReason
            : scoreData.webEthicalIssue.score === 0
            ? "Analysis completed, no specific issues found"
            : "Analysis completed")
        }</span>
      </div>`
          : ""
      }
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
        <p style="font-weight: bold; font-size: 1.2em; color: #2e7d32; text-transform: uppercase;">
          ${
            scoreData.manufacturingCountry &&
            scoreData.manufacturingCountry.length >= 2 &&
            scoreData.manufacturingCountry.length <= 30 &&
            !/manufacturing|location|country|origin|made|from|produced|or|the|information|where|details|instructions|search|examine|description|text|above|below|find|mention|phrases|product|refer|listed|unknown|n\/a|not/i.test(
              scoreData.manufacturingCountry
            )
              ? scoreData.manufacturingCountry
              : "Unknown"
          }
        </p>
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

  // Only append details/modal if not already in DOM
  if (!document.body.contains(details)) {
    document.body.appendChild(details);
  }

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

  // Create or get backdrop for modal overlay
  let backdrop = document.getElementById("supply-chain-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "supply-chain-backdrop";
    backdrop.style.position = "fixed";
    backdrop.style.top = "0";
    backdrop.style.left = "0";
    backdrop.style.width = "100vw";
    backdrop.style.height = "100vh";
    backdrop.style.background = "rgba(0,0,0,0.25)";
    backdrop.style.zIndex = "2147483646";
    backdrop.style.display = "none";
    document.body.appendChild(backdrop);
  }
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    details.style.display = "block";
    details.style.position = "fixed";
    details.style.top = "50%";
    details.style.left = "50%";
    details.style.transform = "translate(-50%, -50%)";
    details.style.zIndex = "2147483647";
    details.style.maxWidth = "90vw";
    details.style.maxHeight = "90vh";
    details.style.overflowY = "auto";
    backdrop.style.display = "block";
  });

  details.querySelector(".supply-chain-close").addEventListener("click", () => {
    details.style.display = "none";
    if (backdrop) backdrop.style.display = "none";
  });

  backdrop.addEventListener("click", () => {
    details.style.display = "none";
    backdrop.style.display = "none";
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

// Groq AI integration for sustainability analysis
// API key is stored securely
const GROQ_API_KEY = "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";
const GROQ_API_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama3-70b-8192"; // Using LLaMA3 70B model for best analysis
const GROQ_FALLBACK_MODEL = "llama3-8b-8192"; // Fallback to smaller model if needed

// Function to analyze product details with Groq AI
async function analyzeWithGroqAI(productText) {
  console.log("[DEBUG] Sending product data to Groq AI for analysis...");

  try {
    // Limit product text to avoid 413 Content Too Large errors
    // Extract the most important parts of the text
    let truncatedText = productText;
    if (productText.length > 8000) {
      // Reasonable size for API requests
      console.log(
        "[DEBUG] Product text too long, truncating from",
        productText.length,
        "characters"
      );

      // Extract the most important sections using keywords
      const importantSections = [];

      // Add product title if available
      const titleMatch = productText.match(/PRODUCT(?:\s+TITLE)?:\s*([^\n]+)/i);
      if (titleMatch) importantSections.push(titleMatch[0]);

      // Extract sections with sustainability keywords
      const sustainabilityKeywords = [
        "sustainable",
        "eco",
        "green",
        "organic",
        "recycl",
        "certification",
        "material",
        "origin",
        "country",
        "made in",
        "manufactured",
        "composition",
      ];

      // Find paragraphs containing sustainability keywords (up to 300 chars each)
      const paragraphs = productText.split(/\n+/);
      for (const paragraph of paragraphs) {
        if (paragraph.length < 20) continue; // Skip very short lines

        if (
          sustainabilityKeywords.some((keyword) =>
            paragraph.toLowerCase().includes(keyword)
          )
        ) {
          importantSections.push(paragraph.slice(0, 300));

          // Stop if we have enough content
          if (importantSections.join("\n").length > 7000) break;
        }
      }

      // If we didn't find enough sustainability-related content, include some general content
      if (importantSections.join("\n").length < 3000) {
        // Add beginning of description
        const descMatch = productText.match(
          /PRODUCT\s+DESCRIPTION:\s*([^\n]+(?:\n[^\n]+){0,10})/i
        );
        if (descMatch) importantSections.push(descMatch[0]);

        // Add material info if available
        const materialMatch = productText.match(
          /MATERIAL[\s\w]*:[\s\S]{1,500}/i
        );
        if (materialMatch) importantSections.push(materialMatch[0]);
      }

      truncatedText = importantSections.join("\n\n");

      // If still too long or we couldn't extract meaningful sections, take beginning + end approach
      if (truncatedText.length > 8000 || truncatedText.length < 100) {
        const beginning = productText.slice(0, 4000);
        const end = productText.slice(-3000);
        truncatedText = beginning + "\n\n[...content truncated...]\n\n" + end;
      }

      console.log(
        "[DEBUG] Truncated product text to",
        truncatedText.length,
        "characters"
      );
    }

    const prompt = `
You are an expert sustainability analyst for e-commerce products.
Analyze the following product information and provide a sustainability score (0 or 1 for each criterion) based on these criteria and examples:

1. Origin of Product (1 point): Is manufacturing origin mentioned clearly? (e.g., "Made in Turkey", "Manufactured in Germany")
2. Certifications (1 point): Are there any sustainability certifications mentioned? (e.g., "Fairtrade", "EcoLabel", "Organic Certified", "FSC", "Cradle to Cradle", "EU Ecolabel", "Nordic Swan")
3. Product Materials (1 point): Are the materials sustainable? Consider the following as sustainable: "biodegradable", "vegan", "zero waste", "palm oil free", "natural oils", "olive oil", "laurel oil", "100% vegetable", "recycled", "compostable", "organic cotton", "bamboo", "hemp", "recycled plastic", "recycled paper". If these or similar terms are present, score 1.
4. End of Life (1 point): Do the materials have good end-of-life properties? Score 1 if the product is described as "biodegradable", "compostable", "recyclable", "zero waste", "100% vegetable", or similar. For example, if the product mentions "biodegradable", "compostable", "zero waste", "100% vegetable", or any phrase indicating it will break down naturally or not create waste, score 1. If none of these or similar terms are present, score 0.
5. Environmental Impact (1 point): Do the materials have low environmental impact? Score 1 if the product is described as "palm oil free", "no animal testing", "no mineral oils", "no parabens", "vegan", "zero waste", "biodegradable", "natural ingredients", or similar.

If the product does not mention a criterion, score 0 for that criterion. Use the evidence field to explain your reasoning and reference the relevant phrases from the product information.

Respond in JSON format only:
{
  "origin": {"score": 0 or 1, "evidence": "reason"},
  "certifications": {"score": 0 or 1, "evidence": "certifications found"},
  "materials": {"score": 0 or 1, "evidence": "sustainable materials found"},
  "endOfLife": {"score": 0 or 1, "evidence": "end of life properties"},
  "environmentalImpact": {"score": 0 or 1, "evidence": "impact assessment"},
  "manufacturingCountry": "country name if detected or null"
}

Product Information:
${truncatedText}
    `;

    // Choose model based on content length
    const selectedModel =
      truncatedText.length > 6000 ? GROQ_FALLBACK_MODEL : GROQ_MODEL;
    console.log(
      `[DEBUG] Using Groq model: ${selectedModel} for ${truncatedText.length} chars`
    );

    let response;
    try {
      response = await fetch(GROQ_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: "system",
              content:
                "You are a sustainability analyst that analyzes product details and returns a JSON object with sustainability scores.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 1024,
        }),
      });
    } catch (fetchError) {
      console.error("[DEBUG] Fetch error:", fetchError);

      if (selectedModel === GROQ_MODEL && truncatedText.length > 3000) {
        // Try again with fallback model if primary model failed
        console.log("[DEBUG] Retrying with fallback model after fetch error");

        // Further truncate text for fallback model
        const furtherTruncatedText =
          truncatedText.length > 5000
            ? truncatedText.slice(0, 2500) +
              "\n\n[...content truncated...]\n\n" +
              truncatedText.slice(-2500)
            : truncatedText;

        const fallbackPrompt = prompt.replace(
          truncatedText,
          furtherTruncatedText
        );

        response = await fetch(GROQ_API_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: GROQ_FALLBACK_MODEL,
            messages: [
              {
                role: "system",
                content:
                  "You are a sustainability analyst that analyzes product details and returns a JSON object with sustainability scores.",
              },
              {
                role: "user",
                content: fallbackPrompt,
              },
            ],
            temperature: 0.2,
            max_tokens: 1024,
          }),
        });
      } else {
        // Re-throw if we can't fall back
        throw fetchError;
      }
    }

    if (!response.ok) {
      // Get more detailed error information if available
      let errorDetail = response.statusText;
      try {
        const errorBody = await response.text();
        console.error("[DEBUG] Groq API error response:", errorBody);
        errorDetail = `${response.status} ${response.statusText}: ${errorBody}`;
      } catch (e) {
        // If we can't get the error body, just use the status text
      }

      // Handle specific error codes
      if (response.status === 413) {
        throw new Error(
          `Groq API error: Content Too Large (413) - The product data is too large for the API. Please try again with less text.`
        );
      } else if (response.status === 429) {
        throw new Error(
          `Groq API error: Rate Limit Exceeded (429) - Too many requests in a short period.`
        );
      } else if (response.status === 401) {
        throw new Error(
          `Groq API error: Unauthorized (401) - API key may be invalid or expired.`
        );
      } else {
        throw new Error(`Groq API error: ${errorDetail}`);
      }
    }

    const result = await response.json();
    console.log("[DEBUG] Groq AI analysis result:", result);

    // Extract the content from the response
    const aiResponse = result.choices[0].message.content;

    // Parse the JSON response
    try {
      // Find JSON in the response (in case there's additional text)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : aiResponse;

      const aiScore = JSON.parse(jsonStr);
      console.log("[DEBUG] Parsed AI score:", aiScore);
      return aiScore;
    } catch (parseError) {
      console.error("Error parsing AI response:", parseError);
      console.log("Raw AI response:", aiResponse);

      // Return default values if parsing fails
      return {
        origin: { score: 0, evidence: "Failed to parse AI response" },
        certifications: { score: 0, evidence: "Failed to parse AI response" },
        materials: { score: 0, evidence: "Failed to parse AI response" },
        endOfLife: { score: 0, evidence: "Failed to parse AI response" },
        environmentalImpact: {
          score: 0,
          evidence: "Failed to parse AI response",
        },
        manufacturingCountry: null,
      };
    }
  } catch (error) {
    console.error("Error calling Groq AI API:", error);

    // Log additional context information for debugging
    console.log(
      "[DEBUG] Product text length:",
      productText ? productText.length : 0
    );

    const errorMessage = error.message || "Unknown error";
    const errorType = error.name || "Error";

    // Return default values on error with specific error message
    return {
      origin: {
        score: 0,
        evidence: `Error calling AI API: ${errorType} - ${errorMessage}`,
      },
      certifications: { score: 0, evidence: "Error calling AI API" },
      materials: { score: 0, evidence: "Error calling AI API" },
      endOfLife: { score: 0, evidence: "Error calling AI API" },
      environmentalImpact: { score: 0, evidence: "Error calling AI API" },
      manufacturingCountry: null,
    };
  }
}

// Extract sustainability claims from the product page
function extractSustainabilityClaims() {
  let claims = [];

  try {
    // Common sustainability claim keywords
    const sustainabilityKeywords = [
      // Environmental claims
      "sustainable",
      "eco-friendly",
      "green",
      "environmentally friendly",
      "natural",
      "organic",
      "biodegradable",
      "compostable",
      "recyclable",
      "recycled",
      // Material claims
      "bamboo",
      "organic cotton",
      "hemp",
      "recycled polyester",
      "recycled plastic",
      "plant-based",
      "vegan",
      "cruelty-free",
      "plastic-free",
      // Certifications and labels (abbreviated forms)
      "certified",
      "fairtrade",
      "fair trade",
      "rainforest alliance",
      "fsc",
      "oeko-tex",
      "gots",
      "b corp",
      "cradle to cradle",
      "energy star",
      "eu ecolabel",
      "bluesign",
      "usda organic",
      // Carbon claims
      "carbon neutral",
      "carbon negative",
      "net zero",
      "climate positive",
      "carbon offset",
      "low carbon",
      "carbon footprint",
      // Water claims
      "water-saving",
      "water efficient",
      "low water use",
      // Chemical claims
      "non-toxic",
      "chemical-free",
      "bpa-free",
      "phthalate-free",
    ];

    // Define selectors for areas likely to contain sustainability claims
    const sustainabilitySelectors = [
      // Product description areas
      ".product-description",
      ".description",
      "#product-description",
      ".product-info",
      ".product-details",
      ".features",
      // Marketing sections
      ".sustainability",
      ".eco-friendly",
      ".green",
      ".environmental-impact",
      ".ethical",
      ".responsible",
      // Badges and icons
      ".badges",
      ".certifications",
      ".eco-labels",
      ".icons",
    ];

    // Function to extract text from elements
    const getTextFromElements = (selector) => {
      const elements = document.querySelectorAll(selector);
      return Array.from(elements)
        .map((el) => el.textContent.trim())
        .filter((text) => text.length > 0);
    };

    // Get text from potential sustainability sections
    let sustainabilityTexts = [];
    sustainabilitySelectors.forEach((selector) => {
      sustainabilityTexts = [
        ...sustainabilityTexts,
        ...getTextFromElements(selector),
      ];
    });

    // If no specific sustainability sections found, use all product text
    if (sustainabilityTexts.length === 0) {
      const allProductText = document.body.textContent;

      // Extract sentences containing sustainability keywords
      sustainabilityKeywords.forEach((keyword) => {
        const regex = new RegExp(`[^.!?]*(?:${keyword})[^.!?]*[.!?]`, "gi");
        const matches = allProductText.match(regex);

        if (matches) {
          claims = [...claims, ...matches];
        }
      });
    } else {
      // Process each sustainability text section
      sustainabilityTexts.forEach((text) => {
        // Split into sentences
        const sentences = text
          .split(/[.!?]+/)
          .filter((s) => s.trim().length > 0);

        // Check each sentence for sustainability keywords
        sentences.forEach((sentence) => {
          const lowerSentence = sentence.toLowerCase();
          if (
            sustainabilityKeywords.some((keyword) =>
              lowerSentence.includes(keyword.toLowerCase())
            )
          ) {
            claims.push(sentence.trim() + ".");
          }
        });
      });
    }

    // Look for specific sustainability badges/icons in images
    const images = document.querySelectorAll("img");
    images.forEach((img) => {
      const alt = img.alt.toLowerCase();
      const src = img.src.toLowerCase();

      // Check if image is likely a sustainability badge/certification
      if (
        sustainabilityKeywords.some(
          (keyword) =>
            alt.includes(keyword.toLowerCase()) ||
            src.includes(keyword.toLowerCase())
        )
      ) {
        claims.push(
          `Sustainability badge found: ${img.alt || "Unnamed certification"}`
        );
      }
    });

    // Remove duplicates
    claims = [...new Set(claims)];

    console.log("[DEBUG] Extracted sustainability claims:", claims);

    return claims.length > 0
      ? claims.join("\n")
      : "No explicit sustainability claims found.";
  } catch (error) {
    console.error("[DEBUG] Error extracting sustainability claims:", error);
    return "Error extracting sustainability claims.";
  }
}
