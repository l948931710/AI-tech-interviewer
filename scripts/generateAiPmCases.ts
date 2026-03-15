import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { analyzeResume } from '../src/agent/resumeParser';
import { SimulationCase, PersonaType } from '../src/testing/metrics';

// Configure dotenv for local runs
const envLocal = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
const match = envLocal.match(/GEMINI_API_KEY=["']?([^"'\r\n]+)["']?/);
if (match) {
    process.env.API_KEY = match[1].trim();
}

const PERSONAS: PersonaType[] = ["strong", "average", "bluffer", "evasive"];
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

async function extractTextFromFile(filePath: string, mimeType: string): Promise<string> {
    const fileBytes = fs.readFileSync(filePath);
    
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
            { inlineData: { data: fileBytes.toString("base64"), mimeType } },
            "Extract all text from this document accurately and cleanly. Do not summarize or add markdown formatting."
        ]
    });
    return response.text || "";
}

async function main() {
  const jdPath = '/Users/laijunchen/Downloads/AI_RAG_Product_Lead_JD.docx';
  const res1Path = '/Users/laijunchen/Downloads/【ai产品经理_台州 15-30K】雷先生 6年 (1).pdf';
  const res2Path = '/Users/laijunchen/Downloads/【ai产品经理_台州 15-30K】李雨航 7年(1).pdf';

  console.log("Analyzing JD DOCX...");
  const jdText = fs.readFileSync('/tmp/extract/jd.txt', 'utf-8');

  console.log("Analyzing 雷先生 Resume...");
  const res1Text = fs.readFileSync('/tmp/extract/res1.txt', 'utf-8');
  const res1Analysis = await analyzeResume(res1Text, jdText);

  console.log("Analyzing 李雨航 Resume...");
  const res2Text = fs.readFileSync('/tmp/extract/res2.txt', 'utf-8');
  const res2Analysis = await analyzeResume(res2Text, jdText);

  // Generate Simulation Cases
  const cases: SimulationCase[] = [];

  const candidates = [
    { name: res1Analysis.candidateInfo.name, claims: res1Analysis.prioritizedClaims, resumeText: res1Text },
    { name: res2Analysis.candidateInfo.name, claims: res2Analysis.prioritizedClaims, resumeText: res2Text }
  ];

  let idCounter = 4; // Start from case-004

  for (const candidate of candidates) {
    for (const persona of PERSONAS) {
        cases.push({
            id: `case-00${idCounter++}`, // case-004 to case-011
            jd: jdText,
            candidateResume: candidate.resumeText,
            targetClaims: candidate.claims.map(c => c.claim),
            persona: persona
        });
    }
  }

  // Write outputs
  const outPath = path.resolve(process.cwd(), "benchmarks/ai_pm_simulation_cases.json");
  fs.writeFileSync(outPath, JSON.stringify(cases, null, 2));
  
  console.log(`\nSuccessfully created ${cases.length} simulation cases at ${outPath}`);
}

main().catch(console.error);
