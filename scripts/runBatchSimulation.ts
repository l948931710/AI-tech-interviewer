import fs from "fs";
import path from "path";
import { runSimulation } from "../src/testing/runSimulation";
import { SimulationCase } from "../src/testing/metrics";
import { GoogleGenAI } from "@google/genai";

// Ensure API key is present for the backend script
if (!process.env.GEMINI_API_KEY && !process.env.API_KEY) {
    if (fs.existsSync(path.resolve(process.cwd(), '.env.local'))) {
      const envLocal = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
      const match = envLocal.match(/GEMINI_API_KEY=["']?([^"'\r\n]+)["']?/);
      if (match) {
          process.env.GEMINI_API_KEY = match[1].trim();
      }
    }
}

async function main() {
  const casesPath = path.resolve(process.cwd(), "benchmarks/simulation_cases.json");
  const cases: SimulationCase[] = JSON.parse(fs.readFileSync(casesPath, "utf-8"));

  const results = [];
  
  console.log(`Starting Batch Simulation for ${cases.length} cases...\n`);

  for (const tc of cases) {
    try {
      const metrics = await runSimulation(tc);
      results.push(metrics);
    } catch (e: any) {
      console.error(`Case ${tc.id} crashed:`, e);
      results.push({
        caseId: tc.id,
        persona: tc.persona,
        crashed: true,
        error: e.message
      });
    }
  }

  // Output JSON
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(outputDir, "simulation_results.json"), 
    JSON.stringify(results, null, 2)
  );

  // Output CSV Summary
  const csvHeaders = "CaseID,Persona,Turns,FollowUpQ_Score,Detection_Score,NonAnswerCaught,Loop?,Status\n";
  const csvRows = results.map((r: any) => {
    return `${r.caseId},${r.persona},${r.turns || 0},${(r.followUpQualityScore || 0).toFixed(2)},${r.claimDetectionScore || 0},${r.nonAnswerCaught || false},${r.loopDetected || false},${r.finalRecommendation || 'ERROR'}`;
  }).join("\n");

  fs.writeFileSync(path.join(outputDir, "simulation_summary.csv"), csvHeaders + csvRows);

  console.log("\n✅ Batch Simulation Complete!");
  console.log(`Saved output to /output/simulation_results.json and /output/simulation_summary.csv`);
}

main().catch(console.error);
