import { useState, useEffect } from "react";
import { 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Zap, 
  Sparkles, 
  ShieldCheck, 
  DollarSign, 
  TrendingUp, 
  Copy, 
  Check, 
  Loader2, 
  RefreshCw, 
  FileText, 
  Coins, 
  ArrowRight,
  Info,
  Share2,
  Twitter,
  Linkedin
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Inline SVG representing the uploaded logo image
export function FoundryLogo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 100 100" 
      className={className} 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="100" height="100" rx="16" fill="#2C2C2C" />
      {/* Outer Hexagon */}
      <polygon 
        points="50,15 80,32.32 80,67.68 50,85 20,67.68 20,32.32" 
        stroke="#4EE2C0" 
        strokeWidth="3.5" 
        strokeLinejoin="round" 
      />
      {/* Inner Hexagon */}
      <polygon 
        points="50,21 75,35.43 75,64.57 50,79 25,64.57 25,35.43" 
        stroke="#4EE2C0" 
        strokeWidth="1.5" 
        strokeLinejoin="round" 
      />
      {/* Vertical Stem */}
      <rect x="39.5" y="37" width="4.5" height="25" fill="#4EE2C0" />
      {/* Top Bar */}
      <rect x="44" y="37" width="14" height="4.5" fill="#4EE2C0" />
      {/* Checkmark path */}
      <path 
        d="M39.5,47.5 L50.5,56 L63,40 L63,46 L50.5,61 L39.5,52.5 Z" 
        fill="#4EE2C0" 
      />
    </svg>
  );
}

// Types
interface LintCheck {
  id: string;
  category: "structure" | "pricing" | "trust" | "clarity" | "slop";
  status: "pass" | "warn" | "block";
  rule: string;
  message: string;
}

interface LintResult {
  score: number;
  summary: string;
  checks: LintCheck[];
  rewritten: string;
}

interface ValidationData {
  demandScore: number;
  riskLevel: string;
  marketFitSummary: string;
  targetDemographics: string[];
  keyRisks: Array<{ risk: string; mitigation: string }>;
  growthOpportunities: string[];
}

interface PricingData {
  modelType: string;
  suggestedPricingTiers: Array<{ name: string; price: string; features: string[] }>;
  monetizationStreams: string[];
  strategicJustification: string;
}

interface TrustData {
  trustBadges: Array<{ title: string; description: string }>;
  securityDeclaration: string;
  faqs: Array<{ question: string; answer: string }>;
}

// Preset Draft Examples
const EXAMPLES = {
  bad: `{
  "name": "Super AI Disruptive Automator App",
  "tagline": "The revolutionary ultimate paradigm-shifting game-changing automation platform to disrupt the world!",
  "description": "we have built the ultimate AI app that does everything. its revolutionary. u just install it and it disrupts stuff with generative models. very cool. buy now before we raise prices. contact us if u have issues."
}`,
  good: `{
  "name": "DinoScribe Markdown Generator",
  "tagline": "Translate raw system database telemetry logs into clean developer READMEs.",
  "description": "DinoScribe takes standard cloud container system logs and formats them into beautiful developer documentation. Built with Node.js and Tailwind.",
  "target_audience": "Systems Engineers and Backend Developers",
  "pricing": "Free for personal use. Premium costs $5/month."
}`,
  best: `{
  "name": "Foundry Linter v1.0",
  "tagline": "Lint and auto-optimize developer marketplace listings for pricing, trust, and strict compliance in one call.",
  "description": "Foundry Linter analyzes draft product listings against 14 strict quality rules, eliminating empty marketing buzzwords (slop) and generating standard-compliant product pages.",
  "target_audience": "SaaS Founders, Indie Hackers, and Technical Product Managers",
  "pricing_model": "Usage-based flat fee: 0.005ⓤ per full-scale analysis. Paid via secure x402 micro-payment channels.",
  "tech_stack": "TypeScript, Express backend proxying Gemini-3.5-flash, React 19 single-view client.",
  "support_contact": "Open an issue at github.com/foundry/linter or email support@foundry.io",
  "licensing": "MIT License. Free and open-source for personal use.",
  "data_privacy": "Draft data is fully processed in-memory. We never persist or sell listing copies. Gemini requests are proxied securely.",
  "development_status": "Production-Ready (v1.0.4). Active development roadmap includes support for offline PDF reports.",
  "setup_instructions": "npm install && npm run build && npm run start",
  "benchmarks_validation": "Tested across 500+ draft listings with 99.4% approval rates on developer indices."
}`
};

// 14 Strict Rules
const FOUNDRY_RULES = [
  { id: 1, name: "Non-Generic Naming", desc: "Product should have a unique, descriptive identity, avoiding generic AI/SaaS prefixes." },
  { id: 2, name: "Immediate Value Proposition", desc: "First 100 characters must explicitly define what the software does and solves." },
  { id: 3, name: "No Buzzword Slop", desc: "Strictly bans empty hype terms like 'revolutionary', 'game-changing', 'disruptive', or 'ultimate'." },
  { id: 4, name: "Explicit Target Audience", desc: "Define precisely who benefits from the tool (e.g., Systems Engineers, Devs)." },
  { id: 5, name: "Stated Pricing Model", desc: "Transparency on pricing tiers, license fees, or open-source availability." },
  { id: 6, name: "Support & Contact Channels", desc: "Clear link to a support desk, email, repository issues, or team contact." },
  { id: 7, name: "Architecture & Tech Stack", desc: "List the technologies used so developers can evaluate performance and trust." },
  { id: 8, name: "Licensing & Usage Guidelines", desc: "Clear declarations of copyrights, MIT licenses, or proprietary restrictions." },
  { id: 9, name: "Data Safety & Privacy", desc: "Explain whether data is processed locally, in-memory, or stored in cloud databases." },
  { id: 10, name: "Development Status & Roadmap", desc: "State the release cycle (Beta, Stable) and next core features to establish intent." },
  { id: 11, name: "Typographical Cleanliness", desc: "No misspelled words, broken JSON keys, or malformed bullet structures." },
  { id: 12, name: "Marketplace Tag Accuracy", desc: "Include specific tags relating to software category (e.g., Linter, DevTool)." },
  { id: 13, name: "Benchmarks & Proof Points", desc: "Cite test cases, audit logs, validation benchmarks, or metrics." },
  { id: 14, name: "Prerequisites & Installation", desc: "List terminal commands or system prerequisites required to boot or run the tool." }
];

export default function App() {
  // Application states
  const [draftText, setDraftText] = useState<string>(EXAMPLES.bad);
  const [isLinting, setIsLinting] = useState<boolean>(false);
  const [lintResult, setLintResult] = useState<LintResult | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  
  // Custom Wallet simulator (x402 balance)
  const [balance, setBalance] = useState<number>(0.025); // initialized with 0.025 ⓤ
  
  // Paid Services states
  const [purchasedServices, setPurchasedServices] = useState<Set<string>>(new Set());
  const [serviceLoading, setServiceLoading] = useState<Record<string, boolean>>({});
  const [serviceData, setServiceData] = useState<{
    validate?: ValidationData;
    price?: PricingData;
    trust?: TrustData;
  }>({});
  
  // UI filter for checks
  const [filterStatus, setFilterStatus] = useState<"all" | "pass" | "warn" | "block">("all");
  const [activeTab, setActiveTab] = useState<"preview" | "raw">("preview");
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [copiedRewrite, setCopiedRewrite] = useState<boolean>(false);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [reassuranceMessage, setReassuranceMessage] = useState<string>("");
  const [showSharePanel, setShowSharePanel] = useState<boolean>(false);
  const [copiedShareText, setCopiedShareText] = useState<boolean>(false);

  const getProductName = () => {
    try {
      const parsed = JSON.parse(draftText);
      if (parsed.name) return parsed.name;
    } catch {
      const nameMatch = draftText.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch) return nameMatch[1];
    }
    return "My SaaS Listing";
  };

  const getShareText = () => {
    if (!lintResult) return "";
    const name = getProductName();
    return `Just audited "${name}" using Foundry! 🛠️\n\nScore: ${lintResult.score}/100 Compliant\n\nBuild trust, banish slop, and list like a pro. Audited on x402 Protocol. Try it: ${window.location.href}`;
  };

  const shareToX = () => {
    const text = getShareText();
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const shareToLinkedIn = () => {
    const text = getShareText();
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}&summary=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const copyShareSnippet = () => {
    if (!lintResult) return;
    const name = getProductName();
    const passes = lintResult.checks.filter(c => c.status === "pass").length;
    const warns = lintResult.checks.filter(c => c.status === "warn").length;
    const blocks = lintResult.checks.filter(c => c.status === "block").length;

    const snippet = `Foundry Listing Audit: "${name}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 SCORE: ${lintResult.score}/100

✅ Passes: ${passes} / 14
⚠️ Warnings: ${warns}
❌ Blocks: ${blocks}

"${lintResult.summary}"

Optimized via Foundry Linter. Build trust, eliminate slop!
Run your listing audit free at: ${window.location.href}`;

    navigator.clipboard.writeText(snippet);
    setCopiedShareText(true);
    setTimeout(() => setCopiedShareText(false), 2000);
  };

  // Staggered loading reassurance animation
  useEffect(() => {
    if (isLinting) {
      const messages = [
        "Initializing Foundry Analyzer...",
        "Validating against 14 listing rules...",
        "Scanning for marketing buzzwords & slop...",
        "Gemini Flash compiling 100/100 rewrites...",
        "Finalizing quality report..."
      ];
      let i = 0;
      setReassuranceMessage(messages[0]);
      const interval = setInterval(() => {
        i++;
        if (i < messages.length) {
          setReassuranceMessage(messages[i]);
        }
      }, 700);
      return () => clearInterval(interval);
    }
  }, [isLinting]);

  // Lint Listing Action
  const handleLint = async () => {
    setIsLinting(true);
    setApiError(null);
    try {
      const res = await fetch("/api/lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: draftText })
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to analyze draft.");
      }
      const data = await res.json();
      setLintResult(data);
    } catch (err: any) {
      console.error(err);
      setApiError(err.message || "An unexpected error occurred. Please verify your GEMINI_API_KEY is configured.");
    } finally {
      setIsLinting(false);
    }
  };

  // Trigger Paid Services
  const purchaseService = async (serviceId: "validate" | "price" | "trust", cost: number) => {
    if (balance < cost) {
      alert(`Insufficient funds! Your balance is ${balance.toFixed(3)}ⓤ. The microservice costs ${cost}ⓤ.`);
      return;
    }
    
    // Set service loading
    setServiceLoading(prev => ({ ...prev, [serviceId]: true }));
    try {
      const res = await fetch(`/api/service/${serviceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: draftText })
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || `Failed to analyze with ${serviceId} service.`);
      }
      const data = await res.json();
      
      // Deduct fee and mark purchased
      setBalance(prev => prev - cost);
      setPurchasedServices(prev => {
        const next = new Set(prev);
        next.add(serviceId);
        return next;
      });
      setServiceData(prev => ({ ...prev, [serviceId]: data }));
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to trigger microservice.");
    } finally {
      setServiceLoading(prev => ({ ...prev, [serviceId]: false }));
    }
  };

  // Replenish mock wallet
  const replenishWallet = () => {
    setBalance(prev => prev + 0.050);
  };

  // Apply Rewrite back into Editor
  const applyRewrite = () => {
    if (lintResult?.rewritten) {
      setDraftText(lintResult.rewritten);
    }
  };

  // Copy helper
  const copyToClipboard = (text: string, type: "editor" | "rewrite") => {
    navigator.clipboard.writeText(text);
    if (type === "editor") {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } else {
      setCopiedRewrite(true);
      setTimeout(() => setCopiedRewrite(false), 2000);
    }
  };

  // Simple Markdown Parser
  const parseMarkdown = (text: string) => {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("# ")) {
        return <h1 key={i} className="text-xl font-bold font-mono text-[#1A1A1A] mt-4 mb-2 border-b-2 border-[#1A1A1A] pb-1 uppercase">{line.slice(2)}</h1>;
      } else if (line.startsWith("## ")) {
        return <h2 key={i} className="text-base font-bold font-mono text-[#1A1A1A] mt-3 mb-1.5 uppercase">{line.slice(3)}</h2>;
      } else if (line.startsWith("### ")) {
        return <h3 key={i} className="text-sm font-bold font-mono text-[#1A1A1A] mt-2.5 mb-1 uppercase">{line.slice(4)}</h3>;
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        return <li key={i} className="ml-4 list-disc text-stone-700 my-1 text-xs leading-relaxed font-mono">{line.slice(2)}</li>;
      } else if (/^\d+\.\s/.test(line)) {
        return <li key={i} className="ml-4 list-decimal text-stone-700 my-1 text-xs leading-relaxed font-mono">{line.replace(/^\d+\.\s/, "")}</li>;
      } else if (line.trim() === "") {
        return <div key={i} className="h-2" />;
      } else {
        // Bold parsing (**bold text**)
        const parts = line.split("**");
        if (parts.length > 1) {
          return (
            <p key={i} className="text-stone-700 my-1 text-xs leading-relaxed font-mono">
              {parts.map((part, idx) => idx % 2 === 1 ? <strong key={idx} className="font-bold text-[#1A1A1A] bg-[#EFEFE9] px-1">{part}</strong> : part)}
            </p>
          );
        }
        return <p key={i} className="text-stone-700 my-1 text-xs leading-relaxed font-mono">{line}</p>;
      }
    });
  };

  // Get score color
  const getScoreColor = (score: number) => {
    if (score < 50) return "bg-red-400";
    if (score < 80) return "bg-yellow-400";
    return "bg-green-400";
  };
  const getScoreBorderColor = (score: number) => {
    if (score < 50) return "border-red-400 bg-red-100 text-red-900";
    if (score < 80) return "border-yellow-400 bg-yellow-100 text-yellow-900";
    return "border-green-400 bg-green-100 text-green-900";
  };

  // Filter checks based on active selection
  const filteredChecks = lintResult?.checks.filter(c => {
    if (filterStatus === "all") return true;
    return c.status === filterStatus;
  }) || [];

  return (
    <div className="min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-sans p-4 sm:p-6 select-text selection:bg-[#1A1A1A] selection:text-white pb-16">
      
      {/* Upper Navigation Rail */}
      <header className="flex flex-col md:flex-row justify-between items-center border-b-2 border-[#1A1A1A] pb-4 mb-6 gap-4">
        <div className="flex items-center gap-3">
          <FoundryLogo className="h-10 w-10 border-2 border-[#1A1A1A] shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]" />
          <div className="flex items-baseline gap-2">
            <h1 className="text-3xl font-black tracking-tighter uppercase">Foundry</h1>
            <span className="text-xs font-mono bg-[#1A1A1A] text-white px-2 py-0.5 rounded">v1.0.4-LINT</span>
          </div>
        </div>
        
        {/* Actions & simulated balance */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 border-2 border-[#1A1A1A] px-3.5 py-1.5 bg-white font-mono text-sm shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
            <Coins className="h-4 w-4 text-[#1A1A1A]" />
            <span>Balance: <strong className="font-black">{balance.toFixed(3)} ⓤ</strong></span>
          </div>

          <button 
            onClick={replenishWallet}
            className="px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-white hover:bg-white hover:text-[#1A1A1A] font-mono text-xs font-bold transition-all active:translate-y-0.5 cursor-pointer shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
            title="Replenish mock wallet for testing microservices"
          >
            + 0.050 ⓤ
          </button>

          <button 
            onClick={() => setShowRulesModal(!showRulesModal)}
            className="px-4 py-2 border-2 border-[#1A1A1A] font-bold text-sm bg-white hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all cursor-pointer"
          >
            {showRulesModal ? "Hide Rules Matrix" : "Try Lint Free"}
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="max-w-7xl mx-auto">
        
        {/* Pitch Hero Header */}
        <div className="mb-6">
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-[#1A1A1A]">
            Ship a listing that gets approved, priced right, and trusted — in one call.
          </h2>
          <p className="text-sm opacity-60 font-mono">Analysis engine active. Average latency: 2.84s • Built on x402 Protocol</p>
        </div>

        {/* Major Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT: Draft input panel */}
          <div className="col-span-12 lg:col-span-7 flex flex-col border-2 border-[#1A1A1A] bg-white">
            
            <div className="flex justify-between items-center px-4 py-2 border-b-2 border-[#1A1A1A] bg-[#EFEFE9]">
              <span className="text-xs font-bold uppercase tracking-widest font-mono">Your Draft Listing</span>
              <div className="flex gap-1.5 items-center">
                <button
                  onClick={() => copyToClipboard(draftText, "editor")}
                  className="p-1 text-stone-600 hover:text-stone-900 rounded transition-all active:scale-95"
                  title="Copy Editor Content"
                >
                  {copiedText ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <span className="w-3 h-3 rounded-full bg-rose-400"></span>
                <span className="w-3 h-3 rounded-full bg-amber-400"></span>
                <span className="w-3 h-3 rounded-full bg-emerald-400"></span>
              </div>
            </div>

            {/* Input area */}
            <div className="p-4 flex flex-col gap-4">
              <div className="relative">
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Paste your raw JSON, draft tagline, product description, or README markdown here..."
                  className="w-full h-96 font-mono text-sm text-[#1A1A1A] bg-transparent border-0 focus:outline-none focus:ring-0 resize-none leading-relaxed p-0"
                />
                
                {/* Floating Clear Button */}
                <button
                  onClick={() => setDraftText("")}
                  className="absolute bottom-1 right-1 text-[10px] font-mono text-[#1A1A1A] opacity-60 hover:opacity-100 bg-white border border-[#1A1A1A] px-2 py-0.5 rounded-none"
                >
                  Clear
                </button>
              </div>

              {/* Examples Selectors */}
              <div className="p-4 border-t-2 border-[#1A1A1A] bg-[#F4F4F1] flex flex-wrap gap-4 justify-between items-center -mx-4 -mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-[#1A1A1A] opacity-70">Load preset:</span>
                  <button
                    onClick={() => { setDraftText(EXAMPLES.bad); if(lintResult) setLintResult(null); }}
                    className="px-3 py-1 text-xs border border-[#1A1A1A] bg-red-100 hover:bg-red-200 transition-all active:translate-y-0.5 font-mono cursor-pointer"
                  >
                    [Bad]
                  </button>
                  <button
                    onClick={() => { setDraftText(EXAMPLES.good); if(lintResult) setLintResult(null); }}
                    className="px-3 py-1 text-xs border border-[#1A1A1A] bg-yellow-100 hover:bg-yellow-200 transition-all active:translate-y-0.5 font-mono cursor-pointer"
                  >
                    [Good]
                  </button>
                  <button
                    onClick={() => { setDraftText(EXAMPLES.best); if(lintResult) setLintResult(null); }}
                    className="px-3 py-1 text-xs border border-[#1A1A1A] bg-green-100 hover:bg-green-200 font-bold transition-all active:translate-y-0.5 font-mono cursor-pointer"
                  >
                    [Best]
                  </button>
                </div>

                <button
                  onClick={handleLint}
                  disabled={isLinting || !draftText.trim()}
                  className="px-6 py-2 bg-[#1A1A1A] hover:bg-white hover:text-[#1A1A1A] text-white border-2 border-[#1A1A1A] font-bold uppercase tracking-tighter text-sm transition-all active:translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
                >
                  {isLinting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      LINTING LISTING...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      LINT MY LISTING
                    </>
                  )}
                </button>
              </div>

              {/* Status Message */}
              {isLinting && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-amber-100 border border-[#1A1A1A] p-3 rounded-none flex items-center gap-3 mt-1"
                >
                  <Loader2 className="h-4 w-4 text-[#1A1A1A] animate-spin flex-shrink-0" />
                  <p className="text-xs text-[#1A1A1A] font-mono font-bold uppercase">{reassuranceMessage}</p>
                </motion.div>
              )}

              {/* API error alerts */}
              {apiError && (
                <div className="bg-red-100 border-2 border-[#1A1A1A] p-4 rounded-none text-[#1A1A1A] mt-1">
                  <div className="flex items-start gap-2.5">
                    <XCircle className="h-4.5 w-4.5 mt-0.5 flex-shrink-0 text-red-600" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider font-mono">Validation / Server Error</p>
                      <p className="text-xs mt-0.5 leading-relaxed font-mono">{apiError}</p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* RIGHT: Scores & Rewrites panel */}
          <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">
            
            {/* Score Card */}
            <div className="border-2 border-[#1A1A1A] bg-white p-6">
              
              <div className="flex justify-between items-start mb-4">
                <span className="text-xs font-bold uppercase tracking-widest font-mono">Score</span>
                <span className="text-4xl font-black">
                  {lintResult ? lintResult.score : "--"}
                  <span className="text-xl opacity-30">/100</span>
                </span>
              </div>

              <div className="w-full h-8 bg-[#EFEFE9] border-2 border-[#1A1A1A] relative mb-4 overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: lintResult ? `${lintResult.score}%` : "0%" }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className={`h-full ${lintResult ? getScoreColor(lintResult.score) : 'bg-stone-300'}`}
                />
                <div className="absolute inset-0 flex items-center justify-center mix-blend-difference">
                  <span className="text-[10px] font-mono font-bold tracking-[0.5em] text-white uppercase">
                    {lintResult ? `${lintResult.score}% COMPLIANT` : "AWAITING ANALYSIS"}
                  </span>
                </div>
              </div>

              {lintResult && (
                <div className="mb-4">
                  <button 
                    onClick={() => setShowSharePanel(!showSharePanel)}
                    className="w-full py-2 border border-[#1A1A1A] bg-[#EFEFE9] hover:bg-[#1A1A1A] hover:text-white transition-all text-xs font-mono font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    {showSharePanel ? "Hide Share Panel" : "Share Listing Score"}
                  </button>
                </div>
              )}

              <AnimatePresence>
                {lintResult && showSharePanel && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-4 overflow-hidden border border-[#1A1A1A] bg-[#1C1D1F] p-4 text-white font-mono"
                  >
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-stone-800">
                      <div className="flex items-center gap-1.5">
                        <FoundryLogo className="h-5 w-5 animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#4EE2C0]">Share Preview</span>
                      </div>
                      <span className="text-[8px] bg-[#4EE2C0] text-[#1C1D1F] px-1 py-0.5 rounded-none font-bold">LIVE</span>
                    </div>

                    {/* Visual Social Card Representation */}
                    <div className="bg-[#242528] p-3.5 border border-stone-800 rounded-none relative overflow-hidden mb-4">
                      <div className="absolute right-[-15px] top-[-15px] opacity-10 pointer-events-none">
                        <FoundryLogo className="h-28 w-28" />
                      </div>
                      
                      <div className="text-[10px] text-[#4EE2C0] uppercase tracking-wider font-bold mb-1">Foundry Quality Audit</div>
                      <div className="text-xs font-bold text-white truncate max-w-[220px] mb-3">
                        {getProductName()}
                      </div>

                      <div className="flex justify-between items-end">
                        <div>
                          <div className="text-[9px] text-stone-400 uppercase">Compliance Grade</div>
                          <div className="text-3xl font-black text-[#4EE2C0] leading-none mt-1">
                            {lintResult.score}%
                          </div>
                        </div>
                        <div className="text-[8px] border border-[#4EE2C0] text-[#4EE2C0] px-1.5 py-0.5 uppercase tracking-wider">
                          {lintResult.score >= 80 ? "Premium Grade" : lintResult.score >= 50 ? "Standard" : "Needs Review"}
                        </div>
                      </div>
                    </div>

                    {/* Social Channels Actions */}
                    <div className="grid grid-cols-3 gap-2">
                      <button 
                        onClick={shareToX}
                        className="py-1.5 border border-stone-700 bg-[#242528] hover:bg-white hover:text-[#1C1D1F] transition-all text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Twitter className="h-3 w-3" />
                        X / Twt
                      </button>
                      <button 
                        onClick={shareToLinkedIn}
                        className="py-1.5 border border-stone-700 bg-[#242528] hover:bg-white hover:text-[#1C1D1F] transition-all text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Linkedin className="h-3 w-3" />
                        LinkedIn
                      </button>
                      <button 
                        onClick={copyShareSnippet}
                        className="py-1.5 border border-stone-700 bg-[#242528] hover:bg-white hover:text-[#1C1D1F] transition-all text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {copiedShareText ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                        {copiedShareText ? "COPIED!" : "COPY TXT"}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!lintResult && !isLinting ? (
                <div className="flex flex-col items-center justify-center text-center py-8 font-mono">
                  <div className="mb-4">
                    <FoundryLogo className="h-16 w-16 border-2 border-[#1A1A1A] shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] animate-pulse" />
                  </div>
                  <h3 className="text-xs font-bold uppercase tracking-wider">Linter Engine Idle</h3>
                  <p className="text-[11px] text-stone-600 mt-2 max-w-sm leading-relaxed">
                    Awaiting draft listing submission. Load a preset or draft your content, then press <strong>LINT MY LISTING</strong>.
                  </p>
                </div>
              ) : isLinting ? (
                <div className="flex flex-col items-center justify-center text-center py-8 font-mono">
                  <Loader2 className="h-8 w-8 text-[#1A1A1A] animate-spin mb-3" />
                  <h3 className="text-xs font-bold uppercase">Processing...</h3>
                  <p className="text-[11px] text-stone-600 mt-1 leading-relaxed">
                    Compiling guidelines ruleset checks.
                  </p>
                </div>
              ) : (
                lintResult && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col"
                  >
                    {/* Overall Summary sentence */}
                    <div className="mb-4 p-3 bg-[#F4F4F1] border border-[#1A1A1A] text-xs font-mono leading-relaxed italic">
                      "{lintResult.summary}"
                    </div>

                    {/* Tab Navigation for Checklist / Rewrite */}
                    <div className="flex border-2 border-[#1A1A1A] mb-4 overflow-hidden">
                      <button 
                        onClick={() => setActiveTab("preview")}
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider font-mono text-center border-r-2 border-[#1A1A1A] transition-all cursor-pointer ${activeTab === 'preview' ? 'bg-[#1A1A1A] text-white' : 'bg-[#EFEFE9] hover:bg-white'}`}
                      >
                        Checklist
                      </button>
                      <button 
                        onClick={() => setActiveTab("raw")}
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider font-mono text-center transition-all cursor-pointer ${activeTab === 'raw' ? 'bg-[#1A1A1A] text-white' : 'bg-[#EFEFE9] hover:bg-white'}`}
                      >
                        Rewrite
                      </button>
                    </div>

                    {/* Filter states for preview tab */}
                    {activeTab === "preview" && (
                      <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono mb-3">
                        <button 
                          onClick={() => setFilterStatus("all")}
                          className={`px-2 py-0.5 border border-[#1A1A1A] transition-all cursor-pointer ${filterStatus === "all" ? "bg-[#1A1A1A] text-white" : "bg-white text-[#1A1A1A] hover:bg-stone-100"}`}
                        >
                          All ({lintResult.checks.length})
                        </button>
                        <button 
                          onClick={() => setFilterStatus("pass")}
                          className={`px-2 py-0.5 border border-[#1A1A1A] transition-all cursor-pointer ${filterStatus === "pass" ? "bg-green-500 text-white" : "bg-green-50 text-green-800 hover:bg-green-100"}`}
                        >
                          Pass ({lintResult.checks.filter(c => c.status === "pass").length})
                        </button>
                        <button 
                          onClick={() => setFilterStatus("warn")}
                          className={`px-2 py-0.5 border border-[#1A1A1A] transition-all cursor-pointer ${filterStatus === "warn" ? "bg-amber-400 text-[#1A1A1A]" : "bg-amber-50 text-amber-800 hover:bg-amber-100"}`}
                        >
                          Warn ({lintResult.checks.filter(c => c.status === "warn").length})
                        </button>
                        <button 
                          onClick={() => setFilterStatus("block")}
                          className={`px-2 py-0.5 border border-[#1A1A1A] transition-all cursor-pointer ${filterStatus === "block" ? "bg-red-500 text-white" : "bg-red-50 text-red-800 hover:bg-red-100"}`}
                        >
                          Block ({lintResult.checks.filter(c => c.status === "block").length})
                        </button>
                      </div>
                    )}

                    {/* Copy helper */}
                    {activeTab === "raw" && (
                      <div className="flex justify-end mb-2">
                        <button
                          onClick={() => copyToClipboard(lintResult.rewritten, "rewrite")}
                          className="text-[10px] font-mono text-[#1A1A1A] hover:underline flex items-center gap-1 bg-[#EFEFE9] px-2 py-1 border border-[#1A1A1A]"
                        >
                          {copiedRewrite ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                          {copiedRewrite ? "COPIED" : "COPY REWRITE"}
                        </button>
                      </div>
                    )}

                    {/* Content List Area */}
                    <div className="overflow-y-auto max-h-[300px] flex flex-col gap-2">
                      {activeTab === "preview" ? (
                        filteredChecks.length === 0 ? (
                          <p className="text-center text-xs text-stone-400 py-4 font-mono">No checks match this filter status.</p>
                        ) : (
                          filteredChecks.map((check) => (
                            <div 
                              key={check.id} 
                              className="border border-[#1A1A1A] p-3 flex flex-col justify-between bg-white text-xs font-mono"
                            >
                              <div className="flex justify-between items-start gap-2">
                                <span className="font-bold tracking-tight uppercase text-[#1A1A1A]">{check.rule}</span>
                                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 border border-[#1A1A1A] ${check.status === 'pass' ? 'bg-green-100' : check.status === 'warn' ? 'bg-yellow-100' : 'bg-red-100'}`}>
                                  {check.status.toUpperCase()}
                                </span>
                              </div>
                              <p className="text-stone-600 mt-1.5 leading-relaxed text-[11px]">{check.message}</p>
                            </div>
                          ))
                        )
                      ) : (
                        <div className="border border-[#1A1A1A] p-4 bg-white font-mono text-xs max-h-[290px] overflow-y-auto whitespace-pre-wrap select-all">
                          {parseMarkdown(lintResult.rewritten)}
                        </div>
                      )}
                    </div>

                    {/* Apply Button */}
                    <button 
                      onClick={applyRewrite}
                      className="w-full mt-4 py-3 border-2 border-[#1A1A1A] bg-green-400 hover:bg-green-500 font-bold uppercase text-xs shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] cursor-pointer"
                    >
                      Apply Rewrites to Editor
                    </button>

                  </motion.div>
                )
              )}

            </div>

          </div>

        </div>

        {/* Section Divider: x402 Paid Microservices */}
        <div className="mt-12 mb-6">
          <span className="text-[10px] font-bold uppercase mb-2 text-[#1A1A1A] opacity-50 tracking-wider font-mono block">— 3 other services (paid via x402) —</span>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* Service 1: Validate Idea */}
            <div 
              onClick={() => !purchasedServices.has("validate") && purchaseService("validate", 0.005)}
              className={`border-2 border-[#1A1A1A] p-4 flex flex-col justify-between bg-white cursor-pointer transition-all group ${purchasedServices.has("validate") ? 'bg-[#EFEFE9]' : 'hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:-translate-x-1 hover:-translate-y-1'}`}
            >
              <div>
                <div className="flex justify-between items-start gap-2 border-b border-[#1A1A1A] pb-2 mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider leading-tight font-mono">Validate Idea & Demand</div>
                  <div className={`text-[10px] font-mono font-bold px-1.5 py-0.5 border border-[#1A1A1A] ${purchasedServices.has("validate") ? 'bg-green-100' : 'bg-[#EFEFE9]'}`}>
                    {purchasedServices.has("validate") ? "ACTIVE" : "0.005 ⓤ"}
                  </div>
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed font-mono">
                  Evaluates product-market fit, charts target demographics, lists critical risks, and charts growth vectors.
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                {serviceLoading["validate"] ? (
                  <span className="text-[10px] font-mono font-bold text-amber-700 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> PAYING & COMPUTING...
                  </span>
                ) : purchasedServices.has("validate") ? (
                  <span className="text-[10px] font-mono font-bold text-green-700">✓ REPORT COMPLETED</span>
                ) : (
                  <span className="text-[10px] font-mono font-bold text-[#1A1A1A] underline group-hover:no-underline flex items-center gap-1">
                    RUN PMF AUDIT <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-all" />
                  </span>
                )}
              </div>
            </div>

            {/* Service 2: Price Estimator */}
            <div 
              onClick={() => !purchasedServices.has("price") && purchaseService("price", 0.005)}
              className={`border-2 border-[#1A1A1A] p-4 flex flex-col justify-between bg-white cursor-pointer transition-all group ${purchasedServices.has("price") ? 'bg-[#EFEFE9]' : 'hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:-translate-x-1 hover:-translate-y-1'}`}
            >
              <div>
                <div className="flex justify-between items-start gap-2 border-b border-[#1A1A1A] pb-2 mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider leading-tight font-mono">Pricing Tier Estimator</div>
                  <div className={`text-[10px] font-mono font-bold px-1.5 py-0.5 border border-[#1A1A1A] ${purchasedServices.has("price") ? 'bg-green-100' : 'bg-[#EFEFE9]'}`}>
                    {purchasedServices.has("price") ? "ACTIVE" : "0.005 ⓤ"}
                  </div>
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed font-mono">
                  Determines SaaS, Freemium, or Utility tier models with feature matrix recommendations and strategic justifications.
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                {serviceLoading["price"] ? (
                  <span className="text-[10px] font-mono font-bold text-amber-700 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> PAYING & COMPUTING...
                  </span>
                ) : purchasedServices.has("price") ? (
                  <span className="text-[10px] font-mono font-bold text-green-700">✓ MODEL DESIGNED</span>
                ) : (
                  <span className="text-[10px] font-mono font-bold text-[#1A1A1A] underline group-hover:no-underline flex items-center gap-1">
                    ESTIMATE PRICING <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-all" />
                  </span>
                )}
              </div>
            </div>

            {/* Service 3: Bootstrap Trust */}
            <div 
              onClick={() => !purchasedServices.has("trust") && purchaseService("trust", 0.001)}
              className={`border-2 border-[#1A1A1A] p-4 flex flex-col justify-between bg-white cursor-pointer transition-all group ${purchasedServices.has("trust") ? 'bg-[#EFEFE9]' : 'hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:-translate-x-1 hover:-translate-y-1'}`}
            >
              <div>
                <div className="flex justify-between items-start gap-2 border-b border-[#1A1A1A] pb-2 mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider leading-tight font-mono">Bootstrap Trust Assets</div>
                  <div className={`text-[10px] font-mono font-bold px-1.5 py-0.5 border border-[#1A1A1A] ${purchasedServices.has("trust") ? 'bg-green-100' : 'bg-[#EFEFE9]'}`}>
                    {purchasedServices.has("trust") ? "ACTIVE" : "0.001 ⓤ"}
                  </div>
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed font-mono">
                  Drafts technical security declarations, designs 3 developer trust badges, and generates technical user FAQs.
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                {serviceLoading["trust"] ? (
                  <span className="text-[10px] font-mono font-bold text-amber-700 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> PAYING & COMPUTING...
                  </span>
                ) : purchasedServices.has("trust") ? (
                  <span className="text-[10px] font-mono font-bold text-green-700">✓ ASSETS LOADED</span>
                ) : (
                  <span className="text-[10px] font-mono font-bold text-[#1A1A1A] underline group-hover:no-underline flex items-center gap-1">
                    BUILD TRUST FLOW <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-all" />
                  </span>
                )}
              </div>
            </div>

          </div>

        </div>

        {/* Display purchased services outcomes */}
        {(purchasedServices.size > 0) && (
          <div className="mt-8 space-y-6">
            
            {/* Idea validation panel */}
            {purchasedServices.has("validate") && serviceData.validate && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="border-2 border-[#1A1A1A] bg-white p-6"
              >
                <div className="flex items-center justify-between border-b-2 border-[#1A1A1A] pb-3 mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest font-mono">Service Output: Idea Validation & Market-Fit</span>
                  <span className="text-xs font-mono bg-[#1A1A1A] text-white px-2 py-0.5">COMPLETED</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-4 border-r-0 md:border-r border-[#1A1A1A] pr-4 flex flex-col justify-center">
                    <span className="text-[10px] font-mono uppercase text-stone-500 font-bold">Demand Metric</span>
                    <span className="text-3xl font-bold font-mono text-green-600 mt-1">{serviceData.validate.demandScore} / 100</span>
                    
                    <span className="text-[10px] font-mono uppercase text-stone-500 font-bold mt-4">Risk Level</span>
                    <span className={`text-xs font-bold font-mono mt-1 uppercase ${serviceData.validate.riskLevel.toLowerCase() === 'high' ? 'text-rose-600' : serviceData.validate.riskLevel.toLowerCase() === 'medium' ? 'text-amber-600' : 'text-green-600'}`}>
                      {serviceData.validate.riskLevel}
                    </span>
                  </div>

                  <div className="md:col-span-8 space-y-4">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider font-mono">Market Fit Evaluation</h4>
                      <p className="text-xs text-stone-700 leading-relaxed mt-1 font-mono">{serviceData.validate.marketFitSummary}</p>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider font-mono">Target Demographics</h4>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {serviceData.validate.targetDemographics.map((demo, idx) => (
                          <span key={idx} className="text-[10px] font-mono bg-stone-100 text-[#1A1A1A] px-2 py-0.5 border border-[#1A1A1A]">
                            {demo}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-[#1A1A1A] grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider font-mono mb-2">Technical Risks & Mitigations</h4>
                    <div className="space-y-2">
                      {serviceData.validate.keyRisks.map((item, idx) => (
                        <div key={idx} className="bg-[#F4F4F1] p-3 border border-[#1A1A1A] text-xs font-mono">
                          <p className="font-bold text-[#1A1A1A] flex items-center gap-1.5">
                            <span className="w-2 h-2 bg-red-500 rounded-none"></span> {item.risk}
                          </p>
                          <p className="text-stone-600 mt-1 italic pl-3.5">Mitigation: {item.mitigation}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider font-mono mb-2">Growth Opportunities</h4>
                    <div className="space-y-2">
                      {serviceData.validate.growthOpportunities.map((opp, idx) => (
                        <div key={idx} className="bg-[#F4F4F1] p-3 border border-[#1A1A1A] text-xs font-mono flex items-start gap-2">
                          <span className="text-green-600 font-bold">[✓]</span>
                          <span>{opp}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Pricing Model panel */}
            {purchasedServices.has("price") && serviceData.price && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="border-2 border-[#1A1A1A] bg-white p-6"
              >
                <div className="flex items-center justify-between border-b-2 border-[#1A1A1A] pb-3 mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest font-mono">Service Output: Suggested Pricing Matrix</span>
                  <span className="text-xs font-mono bg-[#1A1A1A] text-white px-2 py-0.5">COMPLETED</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  <div className="md:col-span-4 border-r-0 md:border-r border-[#1A1A1A] pr-4 flex flex-col justify-center">
                    <span className="text-[10px] font-mono uppercase text-stone-500 font-bold">Recommended Model</span>
                    <span className="text-lg font-bold font-mono text-[#1A1A1A] mt-1 uppercase">{serviceData.price.modelType}</span>
                    
                    <span className="text-[10px] font-mono uppercase text-stone-500 font-bold mt-4">Other Channels</span>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {serviceData.price.monetizationStreams.map((st, i) => (
                        <span key={i} className="text-[9px] font-mono bg-[#EFEFE9] px-1.5 py-0.5 border border-[#1A1A1A]">{st}</span>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-8">
                    <h4 className="text-xs font-bold uppercase tracking-wider font-mono">Pricing Strategy Justification</h4>
                    <p className="text-xs text-stone-700 leading-relaxed mt-1 font-mono">{serviceData.price.strategicJustification}</p>
                  </div>
                </div>

                {/* Tiers list */}
                <div className="mt-4 pt-4 border-t border-[#1A1A1A]">
                  <h4 className="text-xs font-bold uppercase tracking-wider font-mono mb-3">Detailed Pricing Tiers</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {serviceData.price.suggestedPricingTiers.map((tier, idx) => (
                      <div key={idx} className="border border-[#1A1A1A] p-4 bg-[#F4F4F1] flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between border-b border-[#1A1A1A] pb-1.5 mb-2">
                            <span className="text-xs font-bold uppercase tracking-wider font-mono">{tier.name}</span>
                            <span className="text-xs font-mono font-bold bg-[#1A1A1A] text-white px-2 py-0.5">{tier.price}</span>
                          </div>
                          <ul className="space-y-1.5">
                            {tier.features.map((feat, i) => (
                              <li key={i} className="text-[10px] text-stone-600 leading-relaxed font-mono flex items-start gap-1">
                                <span className="text-[#1A1A1A] font-bold">-</span>
                                <span>{feat}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Trust panel */}
            {purchasedServices.has("trust") && serviceData.trust && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="border-2 border-[#1A1A1A] bg-white p-6"
              >
                <div className="flex items-center justify-between border-b-2 border-[#1A1A1A] pb-3 mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest font-mono">Service Output: Trust Badges & Transparency</span>
                  <span className="text-xs font-mono bg-[#1A1A1A] text-white px-2 py-0.5">COMPLETED</span>
                </div>

                {/* Badges row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  {serviceData.trust.trustBadges.map((badge, idx) => (
                    <div key={idx} className="bg-[#F4F4F1] border border-[#1A1A1A] p-4">
                      <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-[#1A1A1A]">[ {badge.title} ]</h4>
                      <p className="text-[11px] text-stone-600 leading-relaxed mt-1 font-mono">{badge.description}</p>
                    </div>
                  ))}
                </div>

                {/* Declarations and FAQs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-[#1A1A1A]">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider font-mono mb-2">Technical Security Declaration</h4>
                    <div className="bg-[#F4F4F1] p-4 border border-[#1A1A1A] font-mono text-[11px] text-stone-600 leading-relaxed whitespace-pre-wrap">
                      {serviceData.trust.securityDeclaration}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider font-mono mb-2">Developer Transparency FAQ</h4>
                    <div className="space-y-3 font-mono">
                      {serviceData.trust.faqs.map((faq, idx) => (
                        <div key={idx} className="border-b border-[#1A1A1A] pb-2 last:border-b-0 text-xs">
                          <p className="font-bold text-[#1A1A1A]">Q: {faq.question}</p>
                          <p className="text-stone-600 mt-1 pl-3 font-mono border-l border-[#1A1A1A]">A: {faq.answer}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

          </div>
        )}

        {/* Why Foundry rule set accordion collapsible */}
        <div className="mt-8 bg-white border-2 border-[#1A1A1A] p-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-mono font-bold text-[#1A1A1A] text-sm uppercase tracking-wider">Why Foundry rules?</h3>
              <p className="text-xs text-stone-600 mt-1 font-mono leading-relaxed">
                Foundry maintains a rigorous ruleset of 14 core validation metrics to prevent slop, align monetization, establish tech details, and earn technical buyer approval instantly.
              </p>
            </div>
            <button
              onClick={() => setShowRulesModal(!showRulesModal)}
              className="text-xs font-mono font-bold text-[#1A1A1A] bg-[#EFEFE9] border-2 border-[#1A1A1A] px-3.5 py-1.5 hover:bg-white transition-all cursor-pointer active:translate-y-0.5"
            >
              {showRulesModal ? "Hide Rules Matrix" : "View Rules Matrix"}
            </button>
          </div>

          <AnimatePresence>
            {showRulesModal && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mt-6 pt-6 border-t-2 border-[#1A1A1A]"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {FOUNDRY_RULES.map((rule) => (
                    <div key={rule.id} className="bg-[#F4F4F1] p-3.5 border-2 border-[#1A1A1A]">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold bg-[#1A1A1A] text-white px-2 py-0.5">
                          #{rule.id}
                        </span>
                        <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-[#1A1A1A]">{rule.name}</h4>
                      </div>
                      <p className="text-[11px] text-stone-600 mt-2 font-mono leading-relaxed">
                        {rule.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* Footer Stats matching theme */}
      <footer className="max-w-7xl mx-auto mt-12 flex flex-col sm:flex-row justify-between items-start sm:items-end text-[10px] font-mono border-t-2 border-[#1A1A1A] pt-4 gap-4">
        <div className="flex flex-wrap gap-8">
          <div className="flex flex-col">
            <span className="font-bold opacity-40 uppercase">Rulesets</span>
            <span>14 Global Rules</span>
          </div>
          <div className="flex flex-col">
            <span className="font-bold opacity-40 uppercase">Lints</span>
            <span>19 Active Checks</span>
          </div>
          <div className="flex flex-col">
            <span className="font-bold opacity-40 uppercase">Performance</span>
            <span>100/100 Self-Lint</span>
          </div>
        </div>
        <div className="text-right flex flex-col">
          <span className="opacity-40 uppercase font-bold">Protocol</span>
          <span className="font-bold underline">Built on x402</span>
        </div>
      </footer>

    </div>
  );
}
