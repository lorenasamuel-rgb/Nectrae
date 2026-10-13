# Access manual · Nectrae Spend Control

Guide for anyone who is **not** on Lorena’s computer. Use it to open the panel on a phone, laptop, or another Mac over the internet.

---

## 1. Open the panel

1. In a browser (Chrome, Safari, or Phantom), go to:

   **https://nectrae.vercel.app**

2. You see **Sign in to the panel**.
3. It asks for the **panel token** (`PANEL_TOKEN`). token: 94Z04RpBUcXBFd8rEp1Eba1LSJiZ0W2C
4. Ask the project owner (Lorena) for that value.  
   It is not in this file on purpose — it is a secret.
5. Paste the token, optionally check **Remember on this device**, and tap **Sign in**.

If the token is wrong, the panel says it does not match. If it is right, you see the agents, caps, and the greeting (for example Hello, Lorena).

### Language and appearance

- Top right: **EN** / **PT**.
- **Sun** / **moon** button: day or night mode. The choice stays on this device.

---

## 2. What you can do

With the panel token you see and use the **same** instance (agents, caps, approvals, ledger):

| Area | What it is for |
| --- | --- |
| **Home** | Spend today and this month, alerts, shortcut to approvals |
| **Agents** | Cards, USDC cap, chart, Start / Stop for the live agent |
| **Approvals** | Approve or reject pending payments |
| **Ledger** | Attempts, on-chain validation, filters |
| **More** | Test a payment, Protection, Admin |

This does **not** hand over a private key. The token only opens the panel.

---

## 3. What never to share or paste into the panel

- A private key, a 12- or 24-word phrase, or files from `data/keys/`
- The `AGENT_TOKEN` (that is for the agent SDK, not browser login)
- The `PANEL_TOKEN` on public Wi‑Fi, in public screenshots, or in open chats

Anyone who runs the app **on their own machine** generates their own tokens. Anyone who only **opens the hosted panel** uses the `PANEL_TOKEN` Lorena gives them.

---

## 4. Pay with your wallet (optional, Devnet)

To try a payment from **your** Phantom:

1. In Phantom, switch to **Devnet**. Copy the **public address** only.
2. In the panel → **Protection**: on that agent, choose **Change**, paste the Solana address, and save.
3. On the agent’s allow list (Admin), put the address that **receives** USDC (do not use the seed example destinations).
4. Under Protection, **Pay with Phantom**: open the panel inside the Phantom app if needed, connect the wallet, and pay the test amount (for example 0.01 USDC).

The panel builds the transaction; signing stays in Phantom. Nectrae never stores the key.

---

## 5. Common problems

| Symptom | What to do |
| --- | --- |
| Asked for a token | Expected in production. Use the correct `PANEL_TOKEN`. |
| “That token does not match” | Wrong, outdated, or extra spaces. Ask Lorena for a fresh one. |
| “Could not reach the server” / Failed to fetch | Confirm the URL is **https://nectrae.vercel.app** (not a local IP like `192.168…`). Reload. |
| Page in Portuguese | Tap **EN** in the header. |
| Phone layout on a computer | Turn on device mode in developer tools, or use a narrow window (≤ 700 px). |

---

## 6. Short share block

```
Panel:     https://nectrae.vercel.app
Token:     (ask Lorena — PANEL_TOKEN from Vercel)
Language:  EN / PT in the header
Theme:     sun = day, moon = night
Never:     private key, recovery phrase, key files
```

For the project owner: `PANEL_TOKEN` lives in the **nectrae** project env vars on Vercel (Production / Preview). To revoke someone’s access, set a new token and update the variable; anyone with the old value can no longer sign in.
