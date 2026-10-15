// Hera Audio - site. Liens (a remplir) + sequenceur a pas jouable (Web Audio, sons synthetises).

const CONFIG = {
  // Derniere version publiee (nom stable ecrit par tools/release.ps1).
  download: "https://github.com/hera-audio/hera-releases/releases/latest/download/HeraAudioSetup.exe",
  releases: "https://github.com/hera-audio/hera-releases/releases",
  // Polar : lien de paiement du produit Hera Audio (Polar > Products > Checkout link).
  buy: "https://buy.polar.sh/polar_cl_UtHCE7aHfcBHkdw6PzpE5EQ6XDcODZchm9j9x2PsjWv",
  // Polar : espace client (achats, cles de licence, ordinateurs actives).
  account: "https://polar.sh/hera-audio/portal",
};

document.querySelectorAll("[data-link]").forEach((a) => {
  const url = CONFIG[a.dataset.link];
  if (url) a.href = url;
  if (a.dataset.link !== "download") { a.target = "_blank"; a.rel = "noopener"; }
});

// ------------------------------------------------------------ sequenceur
const ROWS = [
  { name: "Kick", sound: "kick", steps: [0, 7, 10] },
  { name: "Clap", sound: "clap", steps: [4, 12] },
  { name: "Hi-hat", sound: "hat", steps: [0, 2, 4, 6, 8, 9, 10, 12, 14, 15] },
  { name: "808", sound: "808", steps: [0, 7, 10] },
];
const rowsEl = document.querySelector(".rows");
const pattern = ROWS.map((r) => Array.from({ length: 16 }, (_, i) => r.steps.includes(i)));

ROWS.forEach((r, ri) => {
  const row = document.createElement("div");
  row.className = "row";
  const name = document.createElement("div");
  name.className = "row-name";
  name.textContent = r.name;
  const steps = document.createElement("div");
  steps.className = "steps";
  for (let s = 0; s < 16; s++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "step";
    b.setAttribute("aria-label", `${r.name}, pas ${s + 1}`);
    b.setAttribute("aria-pressed", String(pattern[ri][s]));
    b.addEventListener("click", () => {
      pattern[ri][s] = !pattern[ri][s];
      b.setAttribute("aria-pressed", String(pattern[ri][s]));
      if (pattern[ri][s]) { ensureAudio(); trigger(r.sound, audio.currentTime, s); }
    });
    steps.appendChild(b);
  }
  row.append(name, steps);
  rowsEl.appendChild(row);
});
const stepButtons = [...rowsEl.querySelectorAll(".steps")].map((s) => [...s.children]);

let audio = null, master = null, noise = null;
function ensureAudio() {
  if (audio) { if (audio.state === "suspended") audio.resume(); return; }
  audio = new (window.AudioContext || window.webkitAudioContext)();
  master = audio.createDynamicsCompressor();
  master.threshold.value = -10; master.ratio.value = 4;
  const out = audio.createGain(); out.gain.value = 0.8;
  master.connect(out).connect(audio.destination);
  noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

const env = (g, t, peak, decay) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
};
const noiseSrc = (t, dur) => { const n = audio.createBufferSource(); n.buffer = noise; n.start(t); n.stop(t + dur); return n; };
const NOTES_808 = [43, 43, 43, 43, 43, 43, 43, 46, 46, 46, 41, 41, 41, 41, 41, 41];
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function trigger(sound, t, step) {
  if (sound === "kick") {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    env(g, t, 1, 0.35); o.connect(g).connect(master); o.start(t); o.stop(t + 0.4);
  } else if (sound === "clap") {
    const f = audio.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 0.9;
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, t);
    [0, 0.012, 0.024].forEach((o) => { g.gain.setValueAtTime(0.8, t + o); g.gain.exponentialRampToValueAtTime(0.2, t + o + 0.01); });
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    noiseSrc(t, 0.25).connect(f).connect(g).connect(master);
  } else if (sound === "hat") {
    const f = audio.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500;
    const g = audio.createGain(); env(g, t, step % 4 === 2 ? 0.35 : 0.22, 0.05);
    noiseSrc(t, 0.06).connect(f).connect(g).connect(master);
  } else if (sound === "808") {
    const o = audio.createOscillator(), g = audio.createGain(), sh = audio.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(2.2 * x); }
    sh.curve = curve;
    const hz = midiHz(NOTES_808[step] || 43);
    o.frequency.setValueAtTime(hz * 1.9, t); o.frequency.exponentialRampToValueAtTime(hz, t + 0.06);
    env(g, t, 0.7, 0.9); o.connect(sh).connect(g).connect(master); o.start(t); o.stop(t + 1);
  }
}

// Lecture : planification en avance (Web Audio), affichage de la colonne qui joue.
const playBtn = document.querySelector(".play");
const tempoIn = document.querySelector(".tempo input");
const tempoOut = document.querySelector(".tempo output");
let playing = false, nextTime = 0, current = 0, timer = null;
const shown = [];

tempoIn.addEventListener("input", () => { tempoOut.textContent = tempoIn.value; });

function schedule() {
  const stepDur = 60 / Number(tempoIn.value) / 4;
  while (nextTime < audio.currentTime + 0.12) {
    ROWS.forEach((r, ri) => {
      // 808 : une note coupe la precedente (comme un canal mono).
      if (pattern[ri][current]) trigger(r.sound, nextTime, current);
    });
    shown.push({ step: current, time: nextTime });
    nextTime += stepDur;
    current = (current + 1) % 16;
  }
}

function draw() {
  if (!playing) return;
  let s = -1;
  while (shown.length && shown[0].time <= audio.currentTime) s = shown.shift().step;
  if (s >= 0) stepButtons.forEach((row) => row.forEach((b, i) => b.classList.toggle("now", i === s)));
  requestAnimationFrame(draw);
}

function setPlaying(on) {
  playing = on;
  playBtn.setAttribute("aria-pressed", String(on));
  playBtn.setAttribute("aria-label", on ? "Arreter" : "Lire le pattern");
  if (on) {
    ensureAudio();
    current = 0; nextTime = audio.currentTime + 0.05; shown.length = 0;
    timer = setInterval(schedule, 25);
    requestAnimationFrame(draw);
  } else {
    clearInterval(timer);
    stepButtons.forEach((row) => row.forEach((b) => b.classList.remove("now")));
  }
}

playBtn.addEventListener("click", () => setPlaying(!playing));
document.querySelector(".clear").addEventListener("click", () => {
  pattern.forEach((r, ri) => r.forEach((_, s) => { r[s] = false; stepButtons[ri][s].setAttribute("aria-pressed", "false"); }));
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault(); setPlaying(!playing);   // Espace = lecture, comme dans FL
  }
});

// ------------------------------------------------------------ intro
// Le logo sort du flou, l'onde se dessine, puis l'ecran s'ouvre (une fois par visite).
(function intro() {
  const el = document.querySelector(".intro");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let seen = false;
  try { seen = sessionStorage.getItem("hera-intro") === "1"; } catch (_) {}
  const reveal = () => { document.body.classList.remove("intro-on"); document.body.classList.add("ready"); };
  if (!el || reduce || seen) { if (el) el.remove(); reveal(); return; }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try { sessionStorage.setItem("hera-intro", "1"); } catch (_) {}
    el.classList.add("out");
    setTimeout(reveal, 250);
    setTimeout(() => el.remove(), 1200);
  };
  setTimeout(finish, 2600);
  el.addEventListener("click", finish);
  window.addEventListener("keydown", finish, { once: true });
})();

// ------------------------------------------------------------ apparitions au defilement
(function reveals() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) { items.forEach((i) => i.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
  items.forEach((i) => io.observe(i));
})();

// ------------------------------------------------------------ capture qui se redresse au defilement
(function tilt() {
  const screen = document.querySelector(".screen");
  if (!screen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const r = screen.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.9)));   // 0 en bas de l'ecran -> 1 bien visible
    screen.style.setProperty("--tilt", `${(22 * (1 - p)).toFixed(2)}deg`);
    screen.style.setProperty("--zoom", (0.92 + 0.08 * p).toFixed(3));
  };
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
})();

// ------------------------------------------------------------ onglets "pour qui"
(function tabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (t, focus) => {
    tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute("aria-selected", String(on));
      x.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(x.getAttribute("aria-controls"));
      panel.hidden = !on;
      if (on) { panel.classList.remove("enter"); void panel.offsetWidth; panel.classList.add("enter"); }
    });
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t, false));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") select(tabs[(i + 1) % tabs.length], true);
      if (e.key === "ArrowLeft") select(tabs[(i + tabs.length - 1) % tabs.length], true);
    });
  });
})();
