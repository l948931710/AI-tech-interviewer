import fs from "fs";
import path from "path";
import { runSimulation } from "../src/testing/runSimulation";
import { SimulationCase } from "../src/testing/metrics";

// Ensure API key is present for the backend script
if (!process.env.GEMINI_API_KEY && !process.env.API_KEY) {
    if (fs.existsSync(path.resolve(process.cwd(), '.env.local'))) {
      const envLocal = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
      const match = envLocal.match(/GEMINI_API_KEY=["']?([^"'\r\n]+)["']?/);
      if (match) {
          process.env.API_KEY = match[1].trim();
          process.env.GEMINI_API_KEY = process.env.API_KEY;
      }
    }
}

async function main() {
  const casesPath = path.resolve(process.cwd(), "benchmarks/ai_pm_simulation_cases.json");
  const cases: SimulationCase[] = JSON.parse(fs.readFileSync(casesPath, "utf-8"));
  
  // Test case-004 (strong PM candidate)
  const tc = cases.find(c => c.id === "case-004" && c.persona === "strong");
  if (!tc) throw new Error("Could not find case-004");
  
  console.log(`Starting Simulation Case: ${tc.id} [Persona: ${tc.persona}]\n`);
  const metrics = await runSimulation(tc);
  console.log("\nFinal Metrics:", JSON.stringify(metrics, null, 2));
}

main().catch(console.error);
