const english = {
  skip: "Skip to content", navHow: "How it works", navFaq: "FAQ", eyebrow: "A little freedom for your desktop agents.",
  hero: "Step away.<br>Stay in the <span class='accent'>conversation.</span>", intro: "Your computer keeps working.<br>Your phone keeps you in the loop.",
  cta: "Take Pokite with you", see: "See how it works ↓", heroNote: "Open source · Self-hosted · No mobile app",
  artAlt: "A desk computer and a handheld phone connected by a green kite string", artNote: "same session. a little more freedom.",
  agentsLead: "Your familiar agents. One pocket-sized entry point.", boundaries: "Capabilities vary by agent. See the integration guide ↗",
  screenAlt: "Actual Pokite mobile interface with a fictional conversation about a checkout page", phoneNote: "Let your computer work.<br>Take a little walk.", demoNote: "Actual interface · Fictional demo content",
  oneSession: "The same session", storyTitle: "Right where<br>you left off.", storyBody: "No copying context or explaining the task all over again. Open your phone’s browser, find the conversation you started on your computer, and add a thought.",
  bubble1: "The mobile layout is ready for a look.", bubble2: "I’m out. Change the button to ‘Confirm order’, too.", bubble3: "On it. Continuing in this session.",
  scope: "Codex and Hermes Desktop share their original backends. See docs for other integrations.", light: "Just enough", featuresTitle: "One more way in.<br>A little less friction.",
  f1t: "Keep the original conversation", f1b: "Read progress and add a follow-up on your phone. Pick it up again in Desktop.",
  f2t: "Many agents. One place.", f2b: "Projects and conversations from supported agents and multiple instances, in one web interface.",
  f3t: "Your workflow stays yours", f3b: "Keep your desktop clients, projects and environment. Your phone is simply another entry point.",
  f4t: "No mobile app to install", f4b: "Open a browser on your phone or tablet. No Pokite account required.",
  f5t: "At home. Or over Tailscale.", f5b: "Use your local network at home, or your own Tailscale network when you’re away.",
  f6t: "Self-hosted on your computer", f6b: "You run your own Pokite service. No Pokite-hosted relay needed.",
  localTitle: "A little thread back to your computer.", computer: "Your Desktop client", keepsRunning: "Same backend · Same session", yourMac: "On your computer", phone: "Phone browser",
  privacy: "Model calls use your configured providers. Cowork relies on Anthropic services. Tailscale may use encrypted relays when direct connections aren’t available.",
  faqTitle: "A few things to know.", q1: "Does the agent run on my phone?", a1: "Tasks still execute on your computer. Pokite provides a mobile browser entry point to supported sessions. Your computer, agent and Pokite service need to stay running.",
  q2: "How do I get started?", a2: "Follow the GitHub README to install Pokite on your Mac and connect your agents. Then scan the QR code from the connection dialog. Some integrations require a plugin, sharing setup or system authorization.",
  q3: "Does it support every Desktop agent?", a3: "Not yet. Codex and Hermes Desktop share their backends; DSH and Penguin reuse local services. Claude CLI and Cowork have different boundaries. Claude Desktop Code and Chat are not supported. Check the repository’s support table.",
  q4: "Can I use it away from home?", a4: "Yes, through your own Tailscale network. LAN HTTP, Tailscale HTTP and optional HTTPS entry points are available. The Tailscale HTTPS domain requires working Tailscale DNS on your device.",
  q5: "Will I get task completion notifications?", a5: "Not yet. Background push is planned. HTTPS is a prerequisite, not a guarantee that notifications have been implemented.",
  closing: "Your computer keeps going.<br>So can you.", start: "Get started on GitHub", preview: "MIT licensed · macOS developer preview", feedback: "Feedback", footer: "A little more freedom."
};
const originals = new Map();
document.querySelectorAll("[data-i18n]").forEach(el => originals.set(el, el.innerHTML));
const altOriginals = new Map();
document.querySelectorAll("[data-alt]").forEach(el => altOriginals.set(el, el.alt));
const button = document.getElementById("language");
let language = "zh";
function setLanguage(next) {
  language = next;
  document.documentElement.lang = next === "en" ? "en" : "zh-CN";
  for (const [el, original] of originals) el.innerHTML = next === "en" ? english[el.dataset.i18n] || original : original;
  for (const [el, original] of altOriginals) el.alt = next === "en" ? english[el.dataset.alt] || original : original;
  button.textContent = next === "en" ? "中文" : "EN";
  button.setAttribute("aria-label", next === "en" ? "切换为中文" : "Switch to English");
  document.title = next === "en" ? "Pokite — Your desktop agent sessions, on your phone" : "Pokite · 口袋风筝 — 电脑上的 Agent，手机接着聊";
  try { localStorage.setItem("pokite-site-language", next); } catch {}
}
button.addEventListener("click", () => setLanguage(language === "zh" ? "en" : "zh"));
try { if (localStorage.getItem("pokite-site-language") === "en") setLanguage("en"); } catch {}
