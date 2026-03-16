import { callAiBackend, withRetry, MODELS, parseJsonResponse } from "./core";
import { ResumeAnalysis } from "./types";

export async function analyzeResume(resumeContent: string | { inlineData: { data: string, mimeType: string } }, jdText: string): Promise<ResumeAnalysis> {
  const prompt = `
    You are an expert technical recruiter and hiring manager.
    Analyze the following resume and job description.
    
    1. Extract structured candidate information. For workExperience, extract the company name, title, start/end dates, location, and a MAXIMUM of 2-3 most impactful bullet points per role to save processing time.
    2. Convert resume bullets into a MAXIMUM of 5 highly verifiable claims that can be probed during the interview. Focus on ownership, implementation, system design, experimentation, impact metrics, and production deployment.
    3. For each claim, explicitly include the exact 'sourceBullet' from the resume it was derived from, and categorize its 'claimType'.
    4. Rank the extracted claims based on relevance to the target role, technical importance, ambiguity/exaggeration risk, business impact, and interview value. Output a 'rankingSignals' object with 1-10 scores for each of these dimensions.
    5. Generate a 'jobRoleContext' which is a single, concise 1-sentence summary of the core technical requirements from the Job Description. This will guide the rest of the interview implicitly.
    
    CRITICAL OPTIMIZATION: Keep 'mustVerify', 'niceToHave', and 'evidenceHints' extremely concise (1-2 short bullet points each) to ensure fast processing. Do not extract more than 5 claims.
    
    Job Description:
    ${jdText}
    
    Resume:
    ${typeof resumeContent === 'string' ? resumeContent : 'See attached document.'}
  `;

  const contents = typeof resumeContent === 'string' 
    ? prompt 
    : { parts: [resumeContent, { text: prompt }] };

  const response = await withRetry(() => callAiBackend(
    MODELS.INTERVIEW,
    contents,
    {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          jobRoleContext: { type: "STRING", description: "A single, concise 1-sentence summary of the core technical requirements from the Job Description." },
          candidateInfo: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              email: { type: "STRING", description: "Extract the candidate's email address if present." },
              jobRole: { type: "STRING", description: "A short 1-3 word title summarizing their current or primary job role." },
              education: { type: "ARRAY", items: { type: "STRING" } },
              workExperience: { 
                type: "ARRAY", 
                items: { 
                  type: "OBJECT",
                  properties: {
                    company: { type: "STRING" },
                    title: { type: "STRING" },
                    startDate: { type: "STRING" },
                    endDate: { type: "STRING" },
                    location: { type: "STRING" },
                    bullets: { type: "ARRAY", items: { type: "STRING" } }
                  },
                  required: ["company", "title"]
                } 
              },
              technicalSkills: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["name", "education", "workExperience", "technicalSkills"]
          },
          prioritizedClaims: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                topic: { type: "STRING" },
                claim: { type: "STRING" },
                experienceName: { type: "STRING", description: "The name of the company, project, or experience this claim belongs to." },
                sourceBullet: { type: "STRING", description: "The exact bullet point from the resume that this claim was derived from." },
                claimType: { type: "STRING", description: "ownership, implementation, system_design, experimentation, impact, deployment, leadership, or domain_knowledge" },
                mustVerify: { type: "ARRAY", items: { type: "STRING" }, description: "List of critical points that MUST be verified for this claim to be considered true (e.g., specific technical implementation details, ownership, metrics)." },
                niceToHave: { type: "ARRAY", items: { type: "STRING" }, description: "List of bonus points that would be nice to verify but are not strictly required." },
                evidenceHints: { type: "ARRAY", items: { type: "STRING" }, description: "Hints on what kind of evidence to look for (e.g., 'Look for specific tools used', 'Look for concrete numbers')." },
                rankingSignals: {
                  type: "OBJECT",
                  properties: {
                    relevanceToRole: { type: "NUMBER", description: "Score 1-10" },
                    technicalImportance: { type: "NUMBER", description: "Score 1-10" },
                    ambiguityRisk: { type: "NUMBER", description: "Score 1-10" },
                    businessImpact: { type: "NUMBER", description: "Score 1-10" },
                    interviewValue: { type: "NUMBER", description: "Score 1-10" }
                  },
                  required: ["relevanceToRole", "technicalImportance", "ambiguityRisk", "businessImpact", "interviewValue"]
                },
                rationale: { type: "STRING" }
              },
              required: ["id", "topic", "claim", "sourceBullet", "claimType", "mustVerify", "rankingSignals", "rationale"]
            }
          }
        },
        required: ["jobRoleContext", "candidateInfo", "prioritizedClaims"]
      }
    }
  ));

  const rawData = parseJsonResponse<ResumeAnalysis>(response.text);

  // Normalize candidateInfo
  const candidateInfo = rawData.candidateInfo || {} as any;
  candidateInfo.name = candidateInfo.name || "Unknown Candidate";
  candidateInfo.education = Array.isArray(candidateInfo.education) ? candidateInfo.education : [];
  candidateInfo.technicalSkills = Array.isArray(candidateInfo.technicalSkills) ? candidateInfo.technicalSkills : [];
  
  candidateInfo.workExperience = Array.isArray(candidateInfo.workExperience) ? candidateInfo.workExperience.map(exp => ({
    ...exp,
    company: exp.company || "Unknown Company",
    title: exp.title || "Unknown Title",
    bullets: Array.isArray(exp.bullets) ? exp.bullets.slice(0, 3) : []
  })) : [];

  // Normalize prioritizedClaims
  const validClaimTypes = ['ownership', 'implementation', 'system_design', 'experimentation', 'impact', 'deployment', 'leadership', 'domain_knowledge'];
  
  const clamp = (val: any, min: number, max: number) => {
    const num = Number(val);
    if (isNaN(num)) return min;
    return Math.max(min, Math.min(max, num));
  };

  const prioritizedClaims = Array.isArray(rawData.prioritizedClaims) 
    ? rawData.prioritizedClaims.slice(0, 5).map((claim, index) => {
        const claimType = validClaimTypes.includes(claim.claimType as string) 
          ? claim.claimType 
          : "implementation";
          
        const rankingSignals = claim.rankingSignals || {} as any;
        
        return {
          ...claim,
          id: claim.id || `claim-${index}`,
          topic: claim.topic || "Unknown Topic",
          claim: claim.claim || "Unknown Claim",
          sourceBullet: claim.sourceBullet || "",
          claimType: claimType as any,
          mustVerify: Array.isArray(claim.mustVerify) ? claim.mustVerify : [],
          niceToHave: Array.isArray(claim.niceToHave) ? claim.niceToHave : [],
          evidenceHints: Array.isArray(claim.evidenceHints) ? claim.evidenceHints : [],
          rationale: claim.rationale || "",
          rankingSignals: {
            relevanceToRole: clamp(rankingSignals.relevanceToRole, 1, 10),
            technicalImportance: clamp(rankingSignals.technicalImportance, 1, 10),
            ambiguityRisk: clamp(rankingSignals.ambiguityRisk, 1, 10),
            businessImpact: clamp(rankingSignals.businessImpact, 1, 10),
            interviewValue: clamp(rankingSignals.interviewValue, 1, 10),
          }
        };
      })
    : [];

  return {
    candidateInfo,
    prioritizedClaims,
    jobRoleContext: rawData.jobRoleContext || "Software Engineering Role"
  };
}
