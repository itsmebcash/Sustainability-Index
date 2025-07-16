// Fetch certification patterns from Supabase
// Returns an array of { name, pattern, weight, confidence, category }
async function fetchCertificationPatterns() {
  const supabaseUrl = "https://mvxqwljgphuvdtlnrugu.supabase.co";
  const supabaseKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12eHF3bGpncGh1dmR0bG5ydWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNzkzMTEsImV4cCI6MjA2NzY1NTMxMX0.vlMK9ysHzqHpSdaI4LlQcJsF49ZVASeIvWgWbfmwFjA";
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/certification_patterns?enabled=eq.true&select=name,pattern,weight,confidence,category`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );
    if (!response.ok) throw new Error("Failed to fetch certification patterns");
    const data = await response.json();
    // Convert string patterns to RegExp
    return data.map((item) => ({
      ...item,
      pattern: new RegExp(item.pattern, "i"),
    }));
  } catch (error) {
    console.error("Error fetching certification patterns:", error);
    return null;
  }
}
