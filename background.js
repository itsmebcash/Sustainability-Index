// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  // Set default settings
  chrome.storage.sync.set({
    enabled: true,
    alternatives: true,
    detailed: true,
  })

  // Update the console log message
  console.log("Supply Chain Sustainability Index extension installed")
})

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "reportIssue") {
    // Open report issue page
    chrome.tabs.create({
      url: `https://example.com/report?url=${encodeURIComponent(request.url)}`,
    })
  }
})

// Update the fetchSustainabilityData function to include supply chain specific data
async function fetchSustainabilityData(productInfo) {
  // In a real implementation, this would call an actual API
  // For now, we'll simulate a delay and return mock data
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        score: Math.floor(Math.random() * 5) + 1,
        supplyChain: {
          transparency: ["High", "Medium", "Low"][Math.floor(Math.random() * 3)],
          manufacturingCountry: ["China", "USA", "Germany", "Vietnam", "India"][Math.floor(Math.random() * 5)],
          certifications: Math.random() > 0.5 ? ["ISO 14001", "Fair Trade"] : [],
        },
        factors: {
          materials: Math.floor(Math.random() * 5) + 1,
          manufacturing: Math.floor(Math.random() * 5) + 1,
          shipping: Math.floor(Math.random() * 5) + 1,
          packaging: Math.floor(Math.random() * 5) + 1,
        },
        details: {
          carbonFootprint: ["High", "Medium", "Low"][Math.floor(Math.random() * 3)],
          waterUsage: ["High", "Medium", "Low"][Math.floor(Math.random() * 3)],
          laborPractices: ["Good", "Fair", "Poor"][Math.floor(Math.random() * 3)],
        },
        alternatives: [
          {
            name: "Eco-friendly Alternative 1",
            score: 4,
          },
          {
            name: "Sustainable Option 2",
            score: 5,
          },
        ],
      })
    }, 500)
  })
}

