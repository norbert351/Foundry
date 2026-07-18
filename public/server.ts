import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Lazy initialization of Gemini client to prevent startup failure if API key is missing
let aiInstance: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in the Secrets panel in AI Studio.");
    }
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

// Ensure parsing JSON payloads
app.use(express.json());

// 1. Core Lint Endpoint
app.post("/api/lint", async (req, res) => {
  try {
    const { draft } = req.body;
    if (!draft || typeof draft !== "string") {
      return res.status(400).json({ error: "Draft listing content is required as a string." });
    }

    const ai = getGeminiClient();

    const systemInstruction = `You are "Foundry Linter", a strict, expert listing review engine inspired by x402 principles. 
Evaluate the provided draft listing against 14 strict listing quality rules:
1. Clear, non-generic name.
2. Direct value proposition in the first 100 characters.
3. Absolutely NO empty or pure marketing buzzwords (e.g. game-changing, revolutionary, disruptive, paradigm shift, ultimate). This is considered slop.
4. Explicit definition of the target audience.
5. Explicitly stated monetization/pricing model.
6. Clear team, creator representation, or support/contact channels.
7. Clear description of the technical stack or architecture.
8. Explicit licensing, terms, or usage rules.
9. Data privacy and safety declarations (how user data is used/stored).
10. Explicit current state of development (Beta, Alpha, Production) and roadmap.
11. No typos, spelling errors, or broken layout structures.
12. Appropriate marketplace category selection or tags.
13. Social proof, developer benchmarks, or verification validation details.
14. Explicit setup instructions, installation commands, or dependencies.

Grade the draft strictly out of 100.
Identify passes (checks that met the criteria), warnings (minor improvements), and blocking items (critically missing details).
Generate a complete, highly-polished rewritten markdown listing that incorporates ALL 14 elements beautifully, earning a perfect 100/100 score. Make it read professionally, honestly, and with immense technical clarity.

Return the result STRICTLY matching the requested JSON schema.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Draft listing to analyze:\n\n${draft}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: {
              type: Type.INTEGER,
              description: "Listing score from 0 to 100."
            },
            summary: {
              type: Type.STRING,
              description: "A 2-3 sentence overall evaluation summary."
            },
            checks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  category: { 
                    type: Type.STRING, 
                    description: "One of: 'structure' | 'pricing' | 'trust' | 'clarity' | 'slop'" 
                  },
                  status: { 
                    type: Type.STRING, 
                    description: "Must be 'pass', 'warn', or 'block'" 
                  },
                  rule: { type: Type.STRING, description: "The specific rule tested." },
                  message: { type: Type.STRING, description: "A detailed description or advice on why this status was given." }
                },
                required: ["id", "category", "status", "rule", "message"]
              }
            },
            rewritten: {
              type: Type.STRING,
              description: "The complete fully optimized markdown listing that scores 100/100."
            }
          },
          required: ["score", "summary", "checks", "rewritten"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No response returned from the model.");
    }
    res.json(JSON.parse(text));
  } catch (error: any) {
    console.error("Lint error:", error);
    res.status(500).json({ error: error.message || "An error occurred during linting." });
  }
});

// 2. Validate Idea Microservice (0.005ⓤ)
app.post("/api/service/validate", async (req, res) => {
  try {
    const { draft } = req.body;
    if (!draft || typeof draft !== "string") {
      return res.status(400).json({ error: "Draft listing content is required." });
    }

    const ai = getGeminiClient();

    const systemInstruction = `You are the Foundry Product-Market Fit & Idea Validator. Analyze the listing draft and perform a rigorous assessment of the market opportunity, potential risks, target demographic, and growth vectors. Give honest, developer-focused, objective feedback.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Validate this idea listing:\n\n${draft}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            demandScore: { type: Type.INTEGER, description: "Demand validation score out of 100." },
            riskLevel: { type: Type.STRING, description: "Risk level: Low | Medium | High" },
            marketFitSummary: { type: Type.STRING, description: "Detailed 2-3 sentence PMF evaluation." },
            targetDemographics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Who exactly is this for?"
            },
            keyRisks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  risk: { type: Type.STRING, description: "Identified market/technical risk." },
                  mitigation: { type: Type.STRING, description: "Actionable counter-measure or strategy." }
                },
                required: ["risk", "mitigation"]
              }
            },
            growthOpportunities: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Top vectors for expanding this idea."
            }
          },
          required: ["demandScore", "riskLevel", "marketFitSummary", "targetDemographics", "keyRisks", "growthOpportunities"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response returned from the model.");
    res.json(JSON.parse(text));
  } catch (error: any) {
    console.error("Validate Idea error:", error);
    res.status(500).json({ error: error.message || "An error occurred during idea validation." });
  }
});

// 3. Price Estimator Microservice (0.005ⓤ)
app.post("/api/service/price", async (req, res) => {
  try {
    const { draft } = req.body;
    if (!draft || typeof draft !== "string") {
      return res.status(400).json({ error: "Draft listing content is required." });
    }

    const ai = getGeminiClient();

    const systemInstruction = `You are the Foundry Monetization & Price Estimator. Suggest optimal pricing plans, monetization structures, and customer lifetime value insights based on the utility/value of this listing.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Estimate pricing and model for this listing draft:\n\n${draft}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            modelType: { type: Type.STRING, description: "Model, e.g. SaaS, Freemium, Open-source Utility, Pay-per-use" },
            suggestedPricingTiers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  price: { type: Type.STRING },
                  features: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["name", "price", "features"]
              }
            },
            monetizationStreams: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Sinks and streams of monetization."
            },
            strategicJustification: { type: Type.STRING, description: "Why this pricing fits this specific target audience and niche." }
          },
          required: ["modelType", "suggestedPricingTiers", "monetizationStreams", "strategicJustification"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response returned from the model.");
    res.json(JSON.parse(text));
  } catch (error: any) {
    console.error("Price Estimator error:", error);
    res.status(500).json({ error: error.message || "An error occurred during pricing estimation." });
  }
});

// 4. Bootstrap Trust Microservice (0.001ⓤ)
app.post("/api/service/trust", async (req, res) => {
  try {
    const { draft } = req.body;
    if (!draft || typeof draft !== "string") {
      return res.status(400).json({ error: "Draft listing content is required." });
    }

    const ai = getGeminiClient();

    const systemInstruction = `You are the Foundry Trust & Transparency Architect. Generate elements that build credibility for this project: 3 specialized trust badges, a robust security/privacy manifesto statement, and 3 FAQs targeted at cynical or highly technical users.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Construct trust parameters for this listing draft:\n\n${draft}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            trustBadges: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "e.g., '100% Client-Side Audited'" },
                  description: { type: Type.STRING, description: "Short rationale/description." }
                },
                required: ["title", "description"]
              }
            },
            securityDeclaration: { type: Type.STRING, description: "A detailed, reassuring technical statement on data safety and open-source principles." },
            faqs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  answer: { type: Type.STRING }
                },
                required: ["question", "answer"]
              }
            }
          },
          required: ["trustBadges", "securityDeclaration", "faqs"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response returned from the model.");
    res.json(JSON.parse(text));
  } catch (error: any) {
    console.error("Bootstrap Trust error:", error);
    res.status(500).json({ error: error.message || "An error occurred during trust bootstrapping." });
  }
});

// 5. Setup Vite dev / serve static files
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
