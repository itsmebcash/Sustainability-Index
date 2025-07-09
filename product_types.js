// Function to determine product type and customize sustainability criteria
function getProductTypeSpecificGuidelines(title, description) {
  // Convert to lowercase for easier matching
  const lowerTitle = (title || "").toLowerCase();
  const lowerDesc = (description || "").toLowerCase();

  // Check for product type keywords
  const isElectronic = [
    "laptop",
    "phone",
    "smartphone",
    "tablet",
    "computer",
    "headphones",
    "electronics",
    "gadget",
    "device",
    "charger",
    "battery",
    "tv",
    "television",
    "screen",
    "monitor",
    "camera",
  ].some((word) => lowerTitle.includes(word) || lowerDesc.includes(word));

  const isClothing = [
    "shirt",
    "pants",
    "dress",
    "jacket",
    "coat",
    "sweater",
    "sweatshirt",
    "hoodie",
    "jeans",
    "socks",
    "underwear",
    "t-shirt",
    "tshirt",
    "clothing",
    "apparel",
    "fashion",
    "wear",
    "outfit",
    "garment",
    "textile",
  ].some((word) => lowerTitle.includes(word) || lowerDesc.includes(word));

  const isFood = [
    "food",
    "snack",
    "meal",
    "drink",
    "beverage",
    "coffee",
    "tea",
    "milk",
    "meat",
    "vegetable",
    "fruit",
    "organic",
    "chocolate",
    "candy",
    "cookie",
    "bread",
    "cereal",
    "pasta",
    "sauce",
    "oil",
    "dairy",
    "cheese",
  ].some((word) => lowerTitle.includes(word) || lowerDesc.includes(word));

  const isCosmetic = [
    "cosmetic",
    "makeup",
    "skincare",
    "lotion",
    "cream",
    "serum",
    "shampoo",
    "conditioner",
    "soap",
    "beauty",
    "perfume",
    "cologne",
    "fragrance",
    "deodorant",
    "lipstick",
    "mascara",
    "foundation",
    "sunscreen",
  ].some((word) => lowerTitle.includes(word) || lowerDesc.includes(word));

  const isPackagedGood = [
    "package",
    "bottle",
    "container",
    "box",
    "plastic",
    "wrap",
    "packaging",
  ].some((word) => lowerDesc.includes(word));

  // Construct product-specific sustainability criteria
  if (isElectronic) {
    return `
ELECTRONICS-SPECIFIC CRITERIA:
- Energy efficiency ratings (Energy Star, etc.)
- Repairability and modular design
- E-waste recycling programs
- Rare earth mineral sourcing ethics
- Battery longevity and replaceability
- Packaging material sustainability
- Extended producer responsibility
- Presence of harmful chemicals (mercury, lead, etc.)
    `.trim();
  } else if (isClothing) {
    return `
CLOTHING-SPECIFIC CRITERIA:
- Fabric composition (natural vs synthetic fibers)
- Organic certification for natural materials
- Water usage in production
- Textile dyes and chemical treatments
- Labor practices and worker welfare
- Recycled content percentage
- Microplastic shedding for synthetics
- Durability and product longevity
- Certifications (GOTS, Oeko-Tex, Fair Trade, etc.)
    `.trim();
  } else if (isFood) {
    return `
FOOD-SPECIFIC CRITERIA:
- Organic certification
- Fair Trade certification
- Local vs imported sourcing
- Sustainable agriculture practices
- Packaging sustainability
- Animal welfare standards
- Deforestation impact
- Pesticide/chemical use
- Water consumption in production
- GMO transparency
    `.trim();
  } else if (isCosmetic) {
    return `
COSMETICS-SPECIFIC CRITERIA:
- Animal testing policies
- Natural vs synthetic ingredients
- Biodegradability of formulas
- Microplastic/microbeads presence
- Palm oil sourcing
- Packaging recyclability
- Refillable options
- Water usage in formulas
- Certifications (Leaping Bunny, COSMOS, etc.)
- Harmful chemicals (parabens, sulfates, etc.)
    `.trim();
  } else if (isPackagedGood) {
    return `
PACKAGING-SPECIFIC CRITERIA:
- Single-use vs reusable packaging
- Plastic type and recyclability
- Biodegradable/compostable options
- Packaging-to-product ratio
- Recycled content percentage
- Plastic-free alternatives
- Packaging reduction initiatives
    `.trim();
  }

  // Default criteria for any product type
  return `
GENERAL SUSTAINABILITY CRITERIA:
- Material sustainability and renewability
- Energy consumption in production
- Transportation emissions
- End-of-life recyclability/biodegradability
- Third-party certifications
- Company sustainability initiatives
- Transparency in supply chain
- Social responsibility practices
  `.trim();
}
