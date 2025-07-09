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
