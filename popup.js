document.addEventListener("DOMContentLoaded", () => {
  // Get UI elements
  const enableExtension = document.getElementById("enable-extension")
  const showAlternatives = document.getElementById("show-alternatives")
  const detailedReports = document.getElementById("detailed-reports")
  const reportIssue = document.getElementById("report-issue")
  const statusMessage = document.getElementById("status-message")

  // Load saved settings
  chrome.storage.sync.get(
    {
      enabled: true,
      alternatives: true,
      detailed: true,
    },
    (items) => {
      enableExtension.checked = items.enabled
      showAlternatives.checked = items.alternatives
      detailedReports.checked = items.detailed
    },
  )

  // Check if we're on a supported page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0].url

    // Improved detection for Amazon product pages
    if (
      (url.includes("amazon.com") && (url.includes("/dp/") || url.includes("/gp/product/"))) ||
      (url.includes("temu.com") && url.includes("/product/")) ||
      (url.includes("walmart.com") && url.includes("/ip/")) ||
      (url.includes("target.com") && url.includes("/p/"))
    ) {
      statusMessage.textContent = "Supply chain analysis available for this page"
      statusMessage.style.color = "#2e7d32"
    } else {
      statusMessage.textContent = "Not an e-commerce product page for supply chain analysis"
      statusMessage.style.color = "#d32f2f"
    }
  })

  // Save settings when changed
  enableExtension.addEventListener("change", function () {
    chrome.storage.sync.set({ enabled: this.checked })
    updateContentScript()
  })

  showAlternatives.addEventListener("change", function () {
    chrome.storage.sync.set({ alternatives: this.checked })
    updateContentScript()
  })

  detailedReports.addEventListener("change", function () {
    chrome.storage.sync.set({ detailed: this.checked })
    updateContentScript()
  })

  reportIssue.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://example.com/report-issue" })
  })

  function updateContentScript() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "updateSettings",
        settings: {
          enabled: enableExtension.checked,
          alternatives: showAlternatives.checked,
          detailed: detailedReports.checked,
        },
      })
    })
  }
})

