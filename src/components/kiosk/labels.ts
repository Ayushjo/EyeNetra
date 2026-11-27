import type { KioskProfile, KioskStage } from "@/store/voiceStore";

/** Display text for the kiosk and the staff dashboard (Hindi, as customers speak it). */

export const rupee = (n?: number | null) => (n == null ? "" : `₹${n.toLocaleString("en-IN")}`);

export const NEED_HI: Record<string, string> = {
  power: "पावर का चश्मा",
  sunglasses: "धूप का चश्मा",
  both: "पावर + धूप का चश्मा",
  child: "बच्चे का चश्मा",
  eye_test: "आँखों की जाँच",
  browsing: "बस देख रहे हैं",
  service: "रिपेयर / सर्विस",
  contact_lens: "कॉन्टैक्ट लेंस",
};

export const RX_HI: Record<string, string> = {
  recent: "हाल का नंबर है",
  old: "नंबर पुराना है",
  none: "नंबर नहीं है",
  unsure: "याद नहीं",
};

export const SHAPE_HI: Record<string, string> = {
  round: "गोल",
  rectangular: "चौकोर-लंबा",
  square: "चौकोर",
  aviator: "Aviator",
  "cat-eye": "Cat-eye",
  oval: "अंडाकार",
};

export const MATERIAL_HI: Record<string, string> = {
  acetate: "Acetate",
  metal: "Metal",
  titanium: "Titanium · हल्का",
  TR90: "TR90 · हल्का",
};

export const TIER_HI: Record<string, string> = { good: "अच्छा", better: "बेहतर", best: "सबसे बढ़िया" };

export const HANDOFF_HI: Record<string, string> = {
  billing: "नाप और बिलिंग",
  customer_request: "ग्राहक ने स्टाफ़ को बुलाया",
  customer_button: "ग्राहक ने स्टाफ़ बटन दबाया",
  medical: "आँखों की तकलीफ़",
  service: "रिपेयर / सर्विस",
  contact_lens: "कॉन्टैक्ट लेंस",
  complaint: "शिकायत",
  bulk: "बल्क / कॉर्पोरेट",
  staff_takeover: "स्टाफ़ ने संभाला",
  ai_unavailable: "AI सहायक में दिक़्क़त — स्टाफ़ को बुलाया",
  staff_initiated: "स्टाफ़ ने संभाला",
  other: "अन्य",
};

/** Journey steps shown on the kiosk (SOP stages, customer-facing names). */
export const STEPS = [
  { key: "need", label: "ज़रूरत", stages: ["greet"] },
  { key: "rx", label: "पावर", stages: ["rx"] },
  { key: "life", label: "इस्तेमाल", stages: ["lifestyle"] },
  { key: "frame", label: "फ्रेम", stages: ["style", "tryon", "compare"] },
  { key: "lens", label: "लेंस", stages: ["lens"] },
  { key: "final", label: "फ़ाइनल", stages: ["close", "handoff", "done"] },
] as const;

export function stepIndex(stage?: KioskStage | null) {
  if (!stage) return 0;
  const i = STEPS.findIndex((s) => (s.stages as readonly string[]).includes(stage));
  return i < 0 ? 0 : i;
}

/** "Your consultation" rows, filled as the customer answers. */
export function profileRows(p: KioskProfile | undefined) {
  const rows: { key: string; label: string; value: string | null }[] = [];
  const need = p?.need;
  rows.push({ key: "need", label: "ज़रूरत", value: need ? NEED_HI[need] ?? need : null });
  if (!need || ["power", "both", "child", "eye_test"].includes(need)) {
    let rx: string | null = p?.rx ? RX_HI[p.rx] : null;
    if (p?.eye_test === "accepted" || p?.eye_test === "requested") rx = `${rx ? rx + " · " : ""}मुफ़्त जाँच होगी`;
    rows.push({ key: "rx", label: "पावर / जाँच", value: rx });
  }
  const use: string[] = [];
  if (p?.screen_hours != null) use.push(`स्क्रीन ${p.screen_hours} घंटे`);
  if (p?.driving) use.push("ड्राइविंग");
  if (p?.outdoor) use.push("धूप में बाहर");
  if (p?.sports) use.push("खेल-कूद");
  if (p?.child_age != null) use.push(`उम्र ${p.child_age}`);
  if (p?.near_difficulty) use.push("पास का पढ़ने में दिक़्क़त");
  const askedUse = p && ("screen_hours" in p || "outdoor" in p || "driving" in p || "near_difficulty" in p || "child_age" in p);
  rows.push({ key: "use", label: "रोज़ का इस्तेमाल", value: use.length ? use.join(" · ") : askedUse ? "सामान्य" : null });
  const pr = p?.prefs;
  const style: string[] = [];
  if (pr?.max_price) style.push(`${rupee(pr.max_price)} तक`);
  if (pr?.shape) style.push(SHAPE_HI[pr.shape] ?? pr.shape);
  if (pr?.material) style.push(pr.material);
  if (pr?.light) style.push("हल्का फ्रेम");
  rows.push({ key: "style", label: "बजट / स्टाइल", value: pr ? (style.length ? style.join(" · ") : "कोई भी") : null });
  return rows;
}

/** What the customer can say at each stage (shown as gentle hints). */
export const SAY_HINTS: Partial<Record<KioskStage, string[]>> = {
  greet: ["पावर का चश्मा", "Sunglasses", "दोनों"],
  rx: ["हाल ही में जाँच हुई", "बहुत पुराना है", "याद नहीं"],
  lifestyle: ["8 घंटे laptop", "रात में ड्राइविंग", "धूप में बाहर"],
  style: ["2000 तक, गोल", "हल्का फ्रेम", "आप ही दिखाइए"],
  tryon: ["अगला", "पसंद है", "यही लूँगा"],
  compare: ["आपकी सलाह वाला", "दूसरा वाला"],
  lens: ["आपकी सलाह वाला", "सबसे सस्ता", "सबसे बढ़िया"],
  close: ["नाम और नंबर", "बिना नंबर"],
};
