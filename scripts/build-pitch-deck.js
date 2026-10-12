// Builds Visual/Pitch/Nectrae_Pitch_Deck_EN.pptx.
// Dependencies live in .tools/deck (npm install pptxgenjs sharp react react-dom react-icons).
// Usage: node scripts/build-pitch-deck.js

const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");
// apply_theme.js resolves pptxgenjs through NODE_PATH.
process.env.NODE_PATH = [path.join(ROOT, ".tools/deck/node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
require("module").Module._initPaths();
const depsRequire = createRequire(path.join(ROOT, ".tools/deck/package.json"));
const pptxgen = depsRequire("pptxgenjs");
const sharp = depsRequire("sharp");
const React = depsRequire("react");
const ReactDOMServer = depsRequire("react-dom/server");
const Fa = depsRequire("react-icons/fa6");

const APPLY_THEME =
  process.env.PPTX_APPLY_THEME ||
  path.join(
    process.env.HOME,
    ".claude/skills/synced/b34141b5-3ed2-4afb-97cc-43beda44475a_c82d8d2d-5f23-4220-a2fd-3cb4323cc118/pptx/scripts/apply_theme.js"
  );
const { applyTheme } = require(APPLY_THEME);

const OUT_DIR = path.join(ROOT, "Visual/Pitch");
const OUT_FILE = path.join(OUT_DIR, "Nectrae_Pitch_Deck_EN.pptx");
const LOGO_LIGHT = path.join(ROOT, "Visual/Logo web/logo-nectrae-claro.png");
const PANEL_SHOT = path.join(ROOT, "Claude outputs/nectrae-painel-web.png");

// dk1 = slide background, lt1 = main text, dk2 = cards, lt2 = muted text
const THEME = {
  name: "Nectrae",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "0F1218",
    lt1: "E8EBF2",
    dk2: "1A202B",
    lt2: "9AA2B3",
    accent1: "E6B454",
    accent2: "5CC99A",
    accent3: "F07D72",
    accent4: "8C98FF",
    accent5: "2C3444",
    accent6: "3A2F14",
    hlink: "E6B454",
    folHlink: "D9A857",
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "Nectrae - Agent Spend Control";
pres.author = "Nectrae";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };

const C = pres.SchemeColor;
const BG = C.text1;
const TEXT = C.background1;
const CARD = C.text2;
const MUTED = C.background2;
const GOLD = C.accent1;
const GREEN = C.accent2;
const CORAL = C.accent3;
const LINE = C.accent5;
const GOLD_DIM = C.accent6;
const HEAD = "+mj-lt";

// ---------- layouts ----------

pres.defineSlideMaster({
  title: "NX_TITLE",
  background: { color: BG },
  objects: [],
});

pres.defineSlideMaster({
  title: "NX_CONTENT",
  background: { color: BG },
  margin: [0.4, 0.6, 0.6, 0.6],
  objects: [
    {
      placeholder: {
        options: {
          name: "kicker",
          type: "body",
          x: 0.6,
          y: 0.36,
          w: 8.8,
          h: 0.3,
          fontSize: 11,
          bold: true,
          color: GOLD,
          charSpacing: 3,
          margin: 0,
          valign: "middle",
        },
        text: "",
      },
    },
    {
      placeholder: {
        options: {
          name: "title",
          type: "title",
          x: 0.6,
          y: 0.66,
          w: 8.8,
          h: 0.72,
          fontSize: 32,
          bold: true,
          color: TEXT,
          align: "left",
          margin: 0,
          valign: "top",
        },
        text: "",
      },
    },
    { image: { path: LOGO_LIGHT, x: 0.6, y: 5.12, w: 0.85, h: 0.272 } },
  ],
  slideNumber: { x: 8.9, y: 5.1, w: 0.5, h: 0.3, fontSize: 10, color: MUTED, align: "right" },
});

// ---------- helpers ----------

async function iconData(Comp, hex) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Comp, { color: "#" + hex, size: 256 })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

function text(slide, value, opts) {
  slide.addText(value, { isTextBox: true, margin: 0, color: TEXT, fontSize: 14, valign: "top", ...opts });
}

function card(slide, x, y, w, h, name, fill = CARD) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: fill },
    line: { color: LINE, width: 0.75 },
    rectRadius: 0.08,
    objectName: name,
  });
}

function hexagon(slide, x, y, w, opts = {}) {
  slide.addShape(pres.shapes.HEXAGON, {
    x,
    y,
    w,
    h: w * 0.866,
    fill: { color: opts.fill || GOLD, transparency: opts.transparency || 0 },
    line: opts.line ? { color: opts.line, width: 1 } : { type: "none" },
    objectName: opts.name,
  });
}

// Gold hexagon with a navy icon centered in it.
function iconHex(slide, icon, x, y, w, name) {
  hexagon(slide, x, y, w, { name });
  const s = w * 0.42;
  slide.addImage({ data: icon, x: x + (w - s) / 2, y: y + (w * 0.866 - s) / 2, w: s, h: s, objectName: name + " icon" });
}

function iconRow(slide, icon, x, y, w, title, body, name) {
  iconHex(slide, icon, x, y, 0.56, name);
  text(slide, title, { x: x + 0.78, y: y - 0.02, w: w - 0.78, h: 0.3, fontSize: 16, bold: true, objectName: name + " title" });
  text(slide, body, { x: x + 0.78, y: y + 0.3, w: w - 0.78, h: 0.5, fontSize: 14, color: MUTED, objectName: name + " body" });
}

function content(section, kicker, title) {
  const slide = pres.addSlide({ masterName: "NX_CONTENT", sectionTitle: section });
  slide.addText(kicker, { placeholder: "kicker" });
  slide.addText(title, { placeholder: "title" });
  return slide;
}

// ---------- build ----------

async function build() {
  const I = {};
  const navyIcons = {
    coins: Fa.FaCoins,
    repeat: Fa.FaRepeat,
    eye: Fa.FaEye,
    wallet: Fa.FaWallet,
    gauge: Fa.FaGaugeHigh,
    check: Fa.FaUserCheck,
    robot: Fa.FaRobot,
    list: Fa.FaListCheck,
    sign: Fa.FaSignature,
    link: Fa.FaLink,
    chart: Fa.FaChartColumn,
    sliders: Fa.FaSliders,
    receipt: Fa.FaReceipt,
    key: Fa.FaKey,
    users: Fa.FaUsers,
    github: Fa.FaGithub,
    handshake: Fa.FaHandshake,
    layers: Fa.FaLayerGroup,
  };
  for (const [k, Comp] of Object.entries(navyIcons)) I[k] = await iconData(Comp, HEX.dk1);
  I.shieldGold = await iconData(Fa.FaShieldHalved, HEX.accent1);
  I.userGold = await iconData(Fa.FaUser, HEX.accent1);
  I.arrowGold = await iconData(Fa.FaChevronRight, HEX.accent1);

  const panelCrop = await sharp(PANEL_SHOT).extract({ left: 0, top: 0, width: 1440, height: 880 }).png().toBuffer();
  const panelData = "image/png;base64," + panelCrop.toString("base64");

  // 1. Title
  pres.addSection({ title: "Intro" });
  {
    const s = pres.addSlide({ masterName: "NX_TITLE", sectionTitle: "Intro" });
    s.addImage({ path: LOGO_LIGHT, x: 0.6, y: 1.25, w: 4.4, h: 1.408, objectName: "Logo" });
    text(s, "Agent Spend Control", { x: 0.6, y: 2.95, w: 5.4, h: 0.55, fontSize: 30, bold: true, fontFace: HEAD, objectName: "Product name" });
    text(s, "Clear spending limits for AI agents that pay for APIs in USDC", { x: 0.6, y: 3.55, w: 5.2, h: 0.6, fontSize: 16, color: MUTED, objectName: "Subtitle" });
    text(s, "Let your agents bee autonomous. Bee in control.", { x: 0.6, y: 4.4, w: 5.4, h: 0.4, fontSize: 16, italic: true, color: GOLD, objectName: "Tagline" });

    const w = 1.3, h = w * 0.866, dx = w * 0.75, x0 = 6.2, y0 = 1.25, k = 0.9;
    const cells = [
      [0, 0.5, { fill: CARD, line: LINE }],
      [1, 0, { fill: GOLD_DIM, line: GOLD }],
      [1, 1, { fill: GOLD }],
      [2, 0.5, { fill: CARD, line: LINE }],
      [2, 1.5, { fill: GOLD_DIM, line: GOLD }],
      [0, 1.5, { fill: GOLD_DIM, line: GOLD }],
      [1, 2, { fill: CARD, line: LINE }],
    ];
    cells.forEach(([col, row, o], i) => {
      const cx = x0 + col * dx + w / 2;
      const cy = y0 + row * h + h / 2;
      hexagon(s, cx - (w * k) / 2, cy - (h * k) / 2, w * k, { ...o, name: "Honeycomb " + (i + 1) });
    });
    s.addNotes(
      "Nectrae gives paid agent workflows clear financial boundaries: one budget per API, checked before the agent pays, and verified on-chain afterward."
    );
  }

  // 2. Problem
  pres.addSection({ title: "Problem and market" });
  {
    const s = content("Problem and market", "THE PROBLEM", "Every API call is a spending decision");
    iconRow(s, I.coins, 0.6, 1.7, 4.4, "Agents buy data", "When an AI agent pays for APIs, every call spends money.", "Problem 1");
    iconRow(s, I.repeat, 0.6, 2.75, 4.4, "Loops keep spending", "A stuck loop can keep calls going past the intended budget.", "Problem 2");
    iconRow(s, I.eye, 0.6, 3.8, 4.4, "No clear view", "Developers need limits and visibility into where the money goes.", "Problem 3");

    card(s, 5.4, 1.6, 4.0, 3.3, "Loop ledger card");
    text(s, "Agent stuck in a loop, no limits", { x: 5.65, y: 1.78, w: 3.5, h: 0.3, fontSize: 12, color: MUTED, objectName: "Ledger caption" });
    text(s, "Daily budget: 1.00 USDC", { x: 5.65, y: 2.08, w: 3.5, h: 0.35, fontSize: 16, bold: true, color: GOLD, objectName: "Ledger budget" });
    const rows = [
      ["Call #98", "0.01", "0.98", false],
      ["Call #99", "0.01", "0.99", false],
      ["Call #100", "0.01", "1.00", false],
      ["Call #101", "0.01", "1.01", true],
      ["Call #102", "0.01", "1.02", true],
    ];
    rows.forEach(([label, amt, total, over], i) => {
      const y = 2.6 + i * 0.43;
      const color = over ? CORAL : TEXT;
      text(s, label, { x: 5.65, y, w: 1.2, h: 0.3, fontSize: 14, color, objectName: "Ledger row " + (i + 1) });
      text(s, "+" + amt, { x: 6.85, y, w: 0.8, h: 0.3, fontSize: 14, color: MUTED, objectName: "Ledger amount " + (i + 1) });
      text(s, "total " + total, { x: 7.75, y, w: 1.4, h: 0.3, fontSize: 14, bold: over, color, align: "right", objectName: "Ledger total " + (i + 1) });
    });
    s.addNotes(
      "When an AI agent buys data, every API call becomes a spending decision, and a loop can keep those calls going beyond the intended budget. Nectrae gives developers clear limits and visibility into where the money goes."
    );
  }

  // 3. Why now
  {
    const s = content("Problem and market", "WHY NOW", "Agents are already paying for services");
    const stats = [
      ["57.3%", "of respondents have agents in production", "LangChain, State of Agent Engineering"],
      ["109.6M", "adjusted x402 transactions through Apr 21, 2026", "Visa and Artemis, Agentic Payments from the Ground Up"],
      ["$985B", "agentic AI software spending forecast by 2030", "Gartner, Feb 17, 2026"],
    ];
    stats.forEach(([num, label, src], i) => {
      const x = 0.6 + i * 3.0;
      card(s, x, 1.6, 2.8, 2.85, "Stat card " + (i + 1));
      hexagon(s, x + 0.25, 1.85, 0.36, { name: "Stat marker " + (i + 1) });
      text(s, num, { x: x + 0.25, y: 2.3, w: 2.3, h: 0.8, fontSize: 40, bold: true, color: GOLD, fontFace: HEAD, objectName: "Stat number " + (i + 1) });
      text(s, label, { x: x + 0.25, y: 3.12, w: 2.3, h: 0.6, fontSize: 14, objectName: "Stat label " + (i + 1) });
      text(s, src, { x: x + 0.25, y: 3.85, w: 2.3, h: 0.45, fontSize: 10, color: MUTED, objectName: "Stat source " + (i + 1) });
    });
    text(s, "The Gartner forecast covers the broad agentic AI software market, not the market directly addressable by Nectrae.", {
      x: 0.6, y: 4.62, w: 8.8, h: 0.3, fontSize: 10, italic: true, color: MUTED, objectName: "Market footnote",
    });
    s.addNotes(
      "LangChain found agents in production among 57.3 percent of respondents, while Visa and Artemis counted 109.6 million adjusted x402 transactions through April 21, 2026. Agents are already working, and software is already paying for services. Nectrae brings spending boundaries to those paid workflows. Gartner forecasts 985 billion dollars in agentic AI software spending by 2030.\n\nSources: Gartner, Forecast Analysis: Agentic AI Spending in Software Markets, 17 Feb 2026, gartner.com/en/documents/7455226; LangChain, State of Agent Engineering; Visa and Artemis, Agentic Payments from the Ground Up, data through 21 Apr 2026."
    );
  }

  // 4. Focus
  {
    const s = content("Problem and market", "OUR FOCUS", "Teams paying for APIs in USDC");
    const cx = 2.4, cy = 3.25;
    [
      [3.5, { fill: CARD, line: LINE }],
      [2.4, { fill: GOLD_DIM, line: GOLD }],
      [1.3, { fill: GOLD }],
    ].forEach(([w, o], i) => hexagon(s, cx - w / 2, cy - (w * 0.866) / 2, w, { ...o, name: "Focus ring " + (i + 1) }));
    text(s, "USDC API teams", { x: cx - 0.55, y: cy - 0.25, w: 1.1, h: 0.5, fontSize: 12, bold: true, color: BG, align: "center", valign: "middle", objectName: "Focus core label" });

    const rows = [
      [{ fill: CARD, line: LINE }, "Agentic AI software", "$985B forecast by 2030 (Gartner). The broad market context."],
      [{ fill: GOLD_DIM, line: GOLD }, "Paid agent workflows", "Software already pays for services: 109.6M adjusted x402 transactions."],
      [{ fill: GOLD }, "Our focus", "Teams whose agents pay for APIs in USDC, on Solana and Base."],
    ];
    rows.forEach(([o, title, body], i) => {
      const y = 1.7 + i * 1.05;
      hexagon(s, 4.6, y + 0.02, 0.36, { ...o, name: "Focus bullet " + (i + 1) });
      text(s, title, { x: 5.15, y, w: 4.25, h: 0.3, fontSize: 16, bold: true, color: i === 2 ? GOLD : TEXT, objectName: "Focus title " + (i + 1) });
      text(s, body, { x: 5.15, y: y + 0.32, w: 4.25, h: 0.55, fontSize: 14, color: MUTED, objectName: "Focus body " + (i + 1) });
    });
    s.addNotes(
      "Gartner's forecast is the broad agentic AI software market. Our focus within that broader market is teams paying for APIs in USDC."
    );
  }

  // 5. Solution
  pres.addSection({ title: "Product" });
  {
    const s = content("Product", "THE SOLUTION", "One budget per API, across Solana and Base");
    [["Solana", 1.95], ["Base", 3.55]].forEach(([label, y]) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: 0.6, y, w: 1.6, h: 0.5, fill: { color: CARD }, line: { color: LINE, width: 0.75 }, rectRadius: 0.25, objectName: label + " pill",
      });
      text(s, label, { x: 0.6, y, w: 1.6, h: 0.5, fontSize: 15, bold: true, align: "center", valign: "middle", objectName: label + " label" });
    });
    s.addShape(pres.shapes.LINE, { x: 2.2, y: 2.2, w: 0.7, h: 0.7, line: { color: GOLD, width: 1.5 }, objectName: "Solana connector" });
    s.addShape(pres.shapes.LINE, { x: 2.2, y: 3.3, w: 0.7, h: 0.5, flipV: true, line: { color: GOLD, width: 1.5 }, objectName: "Base connector" });

    card(s, 2.9, 2.35, 2.0, 1.55, "Budget card", GOLD_DIM);
    text(s, "Example API", { x: 3.05, y: 2.48, w: 1.7, h: 0.28, fontSize: 12, color: MUTED, objectName: "Budget caption" });
    text(s, "1 USDC / day", { x: 3.05, y: 2.78, w: 1.75, h: 0.45, fontSize: 20, bold: true, color: GOLD, fontFace: HEAD, objectName: "Budget value" });
    text(s, "max $0.05 per call", { x: 3.05, y: 3.3, w: 1.7, h: 0.3, fontSize: 13, objectName: "Budget per call" });

    iconRow(s, I.wallet, 5.4, 1.7, 4.0, "Daily budget", "Solana and Base requests count toward the same budget.", "Check budget");
    iconRow(s, I.gauge, 5.4, 2.65, 4.0, "Per-call limit", "A 20-cent call is blocked when the limit is 5 cents.", "Check per call");
    iconRow(s, I.check, 5.4, 3.6, 4.0, "Allowed recipients", "Payments to recipients outside the list are blocked.", "Check recipient");

    text(s, "Checked before signing, in SDK-connected workflows.", { x: 0.6, y: 4.55, w: 8.8, h: 0.35, fontSize: 14, italic: true, color: GOLD, objectName: "Solution footnote" });
    s.addNotes(
      "Nectrae brings Solana and Base activity into one budget per API. Within SDK-connected workflows, it checks the budget, per-call limit, and recipient before signing. Example from the demo: a daily budget of one USDC and a five-cent limit per call; a twenty-cent request and a request to a recipient that isn't allowed are both blocked."
    );
  }

  // 6. How it works
  {
    const s = content("Product", "HOW IT WORKS", "Checked before signing, verified on-chain");
    const steps = [
      ["Agent asks to pay", "The agent calls a paid API through the Nectrae SDK."],
      ["Rules are checked", "Budget, per-call limit and recipient, before signing."],
      ["Your wallet signs", "Signing happens outside Nectrae, with your keys."],
      ["Verified on-chain", "Amount, recipient and status are checked on the network."],
    ];
    steps.forEach(([title, body], i) => {
      const x = 0.6 + i * 2.27;
      card(s, x, 1.65, 2.0, 2.6, "Step card " + (i + 1));
      hexagon(s, x + 0.2, 1.85, 0.56, { name: "Step marker " + (i + 1) });
      text(s, String(i + 1), { x: x + 0.2, y: 1.85, w: 0.56, h: 0.485, fontSize: 16, bold: true, color: BG, align: "center", valign: "middle", objectName: "Step number " + (i + 1) });
      text(s, title, { x: x + 0.2, y: 2.6, w: 1.65, h: 0.55, fontSize: 16, bold: true, objectName: "Step title " + (i + 1) });
      text(s, body, { x: x + 0.2, y: 3.18, w: 1.65, h: 1.1, fontSize: 14, color: MUTED, objectName: "Step body " + (i + 1) });
      if (i < steps.length - 1) {
        s.addImage({ data: I.arrowGold, x: x + 2.04, y: 2.9, w: 0.19, h: 0.19, objectName: "Step arrow " + (i + 1) });
      }
    });
    text(s, "Recent wallet outflows that skip the SDK are flagged in the record afterward. They can be flagged, not stopped.", {
      x: 0.6, y: 4.55, w: 8.8, h: 0.35, fontSize: 12, italic: true, color: MUTED, objectName: "Flow footnote",
    });
    s.addNotes(
      "Within SDK-connected workflows, Nectrae checks the budget, per-call limit, and recipient before signing, then verifies the payment against blockchain activity: amount, recipient, and status on the network. It also scans for recent wallet outflows that skipped the SDK. Those can be flagged afterward, but not stopped."
    );
  }

  // 7. Product
  {
    const s = content("Product", "THE PRODUCT", "Activity, rules and evidence in one place");
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.55, y: 1.55, w: 5.5, h: 3.4, fill: { color: CARD }, line: { color: LINE, width: 0.75 }, rectRadius: 0.06, objectName: "Screenshot frame",
    });
    s.addImage({ data: panelData, x: 0.6, y: 1.6, w: 5.4, h: 3.3, objectName: "Nectrae panel screenshot", altText: "Nectrae panel with spend per agent, budgets and payment test" });

    const callouts = [
      [I.chart, "Activity per API", "Spend, limits and blocked calls at a glance."],
      [I.sliders, "Rules", "Budget, per-call limit and allowed recipients."],
      [I.receipt, "Transaction evidence", "Every attempt in one record, checked on-chain."],
    ];
    callouts.forEach(([icon, title, body], i) => {
      iconRow(s, icon, 6.3, 1.6 + i * 0.9, 3.1, title, body, "Callout " + (i + 1));
    });
    text(s, "Local MVP on Solana devnet and Base Sepolia, test USDC. Example data.", {
      x: 6.3, y: 4.5, w: 3.1, h: 0.45, fontSize: 11, color: MUTED, objectName: "MVP note",
    });
    s.addNotes(
      "The payer sees each API's activity, rules, and transaction evidence together. Our local MVP runs on Solana devnet and Base Sepolia with test USDC. The API names shown are examples, not real customers or purchases."
    );
  }

  // 8. Non-custodial
  {
    const s = content("Product", "NON-CUSTODIAL", "Funds and keys stay in your own hive");
    hexagon(s, 0.9, 1.75, 3.2, { fill: GOLD_DIM, line: GOLD, name: "Hive hexagon" });
    s.addImage({ data: I.shieldGold, x: 1.85, y: 2.48, w: 1.3, h: 1.3, objectName: "Shield icon" });

    iconRow(s, I.key, 4.8, 1.75, 4.6, "Your keys, your funds", "Funds and private keys stay with you. Nectrae never holds them.", "Custody 1");
    iconRow(s, I.sign, 4.8, 2.8, 4.6, "Your wallet signs", "Signing happens outside Nectrae.", "Custody 2");
    iconRow(s, I.sliders, 4.8, 3.85, 4.6, "You set the boundaries", "Your agent checks them before paying through the integration.", "Custody 3");
    s.addNotes(
      "Your wallet signs outside Nectrae, and your funds and private keys stay with you. You set the boundaries, and your agent checks them before paying through the integration. Funds and private keys stay in your own hive."
    );
  }

  // 9. GTM + business model
  pres.addSection({ title: "Business" });
  {
    const s = content("Business", "GO-TO-MARKET", "A developer-first route to customers");
    iconRow(s, I.users, 0.6, 1.7, 4.4, "Developer communities", "Reach teams building paid agent workflows.", "GTM 1");
    iconRow(s, I.github, 0.6, 2.75, 4.4, "SDK examples on GitHub", "Ready-to-run integrations developers can copy.", "GTM 2");
    iconRow(s, I.handshake, 0.6, 3.8, 4.4, "Assisted integrations", "Hands-on setup with paid API workflows.", "GTM 3");

    card(s, 5.4, 1.6, 4.0, 3.3, "Business model card");
    text(s, "BUSINESS MODEL", { x: 5.7, y: 1.85, w: 3.4, h: 0.3, fontSize: 11, bold: true, color: GOLD, charSpacing: 3, objectName: "Model kicker" });
    iconHex(s, I.layers, 5.7, 2.3, 0.56, "Model icon");
    text(s, "Team subscriptions", { x: 6.45, y: 2.34, w: 2.8, h: 0.45, fontSize: 22, bold: true, fontFace: HEAD, objectName: "Model title" });
    text(s, "Shared controls and spending records for teams running paid agent workflows.", {
      x: 5.7, y: 3.1, w: 3.45, h: 0.8, fontSize: 14, objectName: "Model body",
    });
    text(s, "Planned commercial strategy, not current revenue.", { x: 5.7, y: 4.35, w: 3.45, h: 0.3, fontSize: 11, italic: true, color: MUTED, objectName: "Model caveat" });
    s.addNotes(
      "Our route to customers combines developer communities, SDK examples on GitHub, and assisted integrations with paid API workflows. Team subscriptions form the basis of our commercial strategy for shared controls and spending records. This is a commercial strategy, not revenue already obtained."
    );
  }

  // 10. Team
  pres.addSection({ title: "Team and next steps" });
  {
    const s = content("Team and next steps", "THE HIVE", "Team");
    for (let i = 0; i < 3; i++) {
      const x = 0.6 + i * 3.0;
      card(s, x, 1.6, 2.8, 3.2, "Team card " + (i + 1));
      hexagon(s, x + 0.9, 1.85, 1.0, { fill: GOLD_DIM, line: GOLD, name: "Team avatar " + (i + 1) });
      s.addImage({ data: I.userGold, x: x + 1.15, y: 2.03, w: 0.5, h: 0.5, objectName: "Team avatar icon " + (i + 1) });
      text(s, "[Name]", { x: x + 0.2, y: 2.95, w: 2.4, h: 0.4, fontSize: 18, bold: true, align: "center", objectName: "Team name " + (i + 1) });
      text(s, "[Role]", { x: x + 0.2, y: 3.38, w: 2.4, h: 0.3, fontSize: 14, color: GOLD, align: "center", objectName: "Team role " + (i + 1) });
      text(s, "[Background and relevant experience]", { x: x + 0.25, y: 3.8, w: 2.3, h: 0.7, fontSize: 12, color: MUTED, align: "center", objectName: "Team background " + (i + 1) });
    }
    s.addNotes("Fill in each team member's name, role, and the background that makes them right for this problem.");
  }

  // 11. Closing
  {
    const s = pres.addSlide({ masterName: "NX_TITLE", sectionTitle: "Team and next steps" });
    s.addImage({ path: LOGO_LIGHT, x: 0.6, y: 0.95, w: 3.6, h: 1.152, objectName: "Closing logo" });
    text(s, "Let your agents bee autonomous.", { x: 0.6, y: 2.4, w: 4.7, h: 0.5, fontSize: 24, bold: true, fontFace: HEAD, objectName: "Closing line 1" });
    text(s, "Bee in control.", { x: 0.6, y: 2.9, w: 4.7, h: 0.5, fontSize: 24, bold: true, color: GOLD, fontFace: HEAD, objectName: "Closing line 2" });
    text(
      s,
      [
        { text: "Demo: ", options: { bold: true, color: TEXT } },
        { text: "[demo video link]", options: { breakLine: true } },
        { text: "GitHub: ", options: { bold: true, color: TEXT } },
        { text: "[repository link]" },
      ],
      { x: 0.6, y: 3.75, w: 4.7, h: 0.7, fontSize: 14, color: MUTED, paraSpaceAfter: 4, objectName: "Closing links" }
    );

    card(s, 5.6, 0.95, 3.8, 3.1, "Next steps card");
    text(s, "Next steps", { x: 5.9, y: 1.2, w: 3.2, h: 0.4, fontSize: 20, bold: true, fontFace: HEAD, objectName: "Next steps title" });
    const items = [
      "[The ask: funding, pilots or partners]",
      "[Milestone 1: e.g. first SDK integrations]",
      "[Milestone 2: e.g. mainnet launch]",
      "[Contact: email or handle]",
    ];
    text(
      s,
      items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })),
      { x: 5.9, y: 1.8, w: 3.25, h: 2.0, fontSize: 14, color: MUTED, paraSpaceAfter: 10, objectName: "Next steps list" }
    );
    s.addNotes("Nectrae gives paid agent workflows clear financial boundaries. Let your agents bee autonomous. Bee in control.");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await pres.writeFile({ fileName: OUT_FILE });
  await applyTheme(OUT_FILE, THEME);
  console.log("Wrote " + OUT_FILE);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
