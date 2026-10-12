# Nectrae — brag plan

**What it is:** a spend control for AI agents that pay APIs per call in USDC: one cap per API, decided before the money leaves, then checked on Solana devnet and Base Sepolia.
**For:** builders whose agents pay x402 APIs (Nansen, Vybe, TCG) on their own.
**Sets it apart:** decides *before* signing (not a dashboard after the fact), blocks wrong receiving addresses, never holds a private key, and a watcher face whose eyes follow the caps.
**Hook:** the real `npm run demo` round: 8 calls, 6 allowed, 2 blocked.
**Share caption:** "8 API calls from 3 agents. 6 paid, 2 stopped before anyone signed."

**Angle:** replay the demo script (`mvp/scripts/demo.mjs` + `PRESENTATION` in `src/catalog.mjs`), run through the real rules engine, as the spine of the video.
**Tone:** default leaning polished. Clean, confident, a little playful through the watcher face.
**Identity:** navy `#031626`, cards `#06202F` / border `#172C3A`, amber `#EDAE44`, green `#5FDFA6`, orange `#E8803A`, ink `#FAF8F2`. Playfair Display (titles), Inter (UI), JetBrains Mono (terminal). Hexagon faces from `faceSvg()`; logo from `Visual/`.

## Storyboard (1920×1080, 30fps, 22s)

| # | Time | Scene | On screen |
|---|---|---|---|
| 1 | 0.0–4.6 | Hook: the demo runs | Terminal types `npm run demo`; six lines stream `→ allowed` in green; line 7 `nansen 0.2 → blocked` and line 8 `tcg → blocked` hit in orange. Headline: **8 API calls. 2 never got paid.** |
| 2 | 4.6–8.4 | Reveal | Logo assembles (hexagons drop in), "Bee in control", then: **One USDC cap per API. Checked on Solana and Base.** |
| 3 | 8.4–12.6 | Highlight 1: decides first | Real nansen cap card fills $0.01 → $0.04 of $1.00; a $0.20 check arrives → result: *Blocked · Above the per-transaction maximum ($0.05)*. Headline: **Decides before the money leaves.** |
| 4 | 12.6–16.4 | Highlight 2: wrong address | tcg check to `0x9999…9999` → *Destination is not on the allow list.* Headline: **Wrong address? Blocked before anyone signs.** |
| 5 | 16.4–19.2 | Highlight 3: the watcher | The three agent faces; nansen's eyes go open → squint → shut. Watcher pill: "nansen reached the cap." Headline: **Its eyes follow the caps.** |
| 6 | 19.2–22.0 | Outro | Logo, "Never holds your private key.", `github.com/lorenasamuel-rgb/Nectrae` |

Sound: warm minimal pulse in A minor (pad + soft pluck arpeggio + sub), soft ticks on allowed lines pitched to the key, low muted thud on each block, a gentle chime on logo reveals.
