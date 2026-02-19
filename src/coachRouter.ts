export type CoachMode =
  | "breakup"
  | "cheating"
  | "ghosted"
  | "anxious_attachment"
  | "rizz"
  | "confidence"
  | "stress_depression"
  | "jealousy"
  | "unclear_signals"
  | "general";

const rules: Array<{ mode: CoachMode; terms: RegExp[] }> = [
  { mode: "cheating", terms: [/cheat|cheated|unfaithful|lied about|caught/i] },
  { mode: "ghosted", terms: [/ghost|left on read|no response|stopped replying|ignored/i] },
  { mode: "breakup", terms: [/break ?up|broke up|ended it|ex|no contact|closure/i] },
  { mode: "jealousy", terms: [/jealous|insecure|likes his pics|likes her pics|other guys|other girls/i] },
  { mode: "anxious_attachment", terms: [/anxious|attached|overthink|spiral|double text|need reassurance/i] },
  { mode: "stress_depression", terms: [/depress|depression|hopeless|worthless|panic|anxiety|stressed|can't sleep/i] },
  { mode: "confidence", terms: [/confidence|self-esteem|feel ugly|not enough|rejected|insecure about me/i] },
  { mode: "rizz", terms: [/rizz|flirt|dm|slide|pickup|what do i say|how do i text|reply to/i] },
  { mode: "unclear_signals", terms: [/mixed signals|hot and cold|confusing|dry|breadcrumbs|situationship/i] },
];

export function classify(text: string, explicitMode?: string): CoachMode {
  const t = (text || "").trim();

  if (explicitMode) {
    const m = explicitMode.toLowerCase();
    if (m.includes("rizz")) return "rizz";
    if (m.includes("strategy")) return "general";
  }

  for (const r of rules) {
    if (r.terms.some((re) => re.test(t))) return r.mode;
  }
  return "general";
}

export default classify;
