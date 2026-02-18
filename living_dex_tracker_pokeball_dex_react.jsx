const { useEffect, useMemo, useRef, useState } = React;
const { motion, AnimatePresence } = window.FramerMotion;

/**
 * Living Dex Tracker (single-file React app)
 * - Pokéball opening intro
 * - Horizontal “Pokédex” carousel with mouse wheel + drag
 * - Centered selection shows Dex info + game buttons + encounter locations
 * - Bright green Catch button w/ SFX + localStorage persistence
 * - List view with search + missing/caught filters
 *
 * Data sources (no keys needed):
 * - Dex info + sprites + flavor text: https://pokeapi.co
 * - Encounter locations by game version: PokeAPI /pokemon/{id}/encounters
 *
 * Setup (Vite):
 *   npm create vite@latest living-dex -- --template react
 *   cd living-dex
 *   npm i framer-motion
 *   // add Tailwind if you want (optional). This file uses inline classes that work w/ Tailwind.
 *   // If you don't use Tailwind, swap classes for your CSS.
 *   Replace src/App.jsx with this file.
 */

// ---------- Small utils ----------
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const LS_KEY = "livingDex:caught";

function loadCaught() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function saveCaught(set) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

// “Catch” SFX without external files (tiny synthesized blip)
function playCatchSfx() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();

    o1.type = "square";
    o2.type = "sine";
    o1.frequency.setValueAtTime(520, now);
    o1.frequency.exponentialRampToValueAtTime(220, now + 0.12);
    o2.frequency.setValueAtTime(880, now);
    o2.frequency.exponentialRampToValueAtTime(440, now + 0.12);

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    o1.connect(g);
    o2.connect(g);
    g.connect(ctx.destination);

    o1.start(now);
    o2.start(now);
    o1.stop(now + 0.2);
    o2.stop(now + 0.2);

    setTimeout(() => ctx.close(), 350);
  } catch {
    // ignore
  }
}

function titleCase(s) {
  return s
    .split(/[-\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Map PokeAPI version names to “friendly” game titles.
// You can expand this whenever you want; unknown versions just titleCase.
const VERSION_LABELS = {
  "red": "Red",
  "blue": "Blue",
  "yellow": "Yellow",
  "gold": "Gold",
  "silver": "Silver",
  "crystal": "Crystal",
  "ruby": "Ruby",
  "sapphire": "Sapphire",
  "emerald": "Emerald",
  "firered": "FireRed",
  "leafgreen": "LeafGreen",
  "diamond": "Diamond",
  "pearl": "Pearl",
  "platinum": "Platinum",
  "heartgold": "HeartGold",
  "soulsilver": "SoulSilver",
  "black": "Black",
  "white": "White",
  "black-2": "Black 2",
  "white-2": "White 2",
  "x": "X",
  "y": "Y",
  "omega-ruby": "Omega Ruby",
  "alpha-sapphire": "Alpha Sapphire",
  "sun": "Sun",
  "moon": "Moon",
  "ultra-sun": "Ultra Sun",
  "ultra-moon": "Ultra Moon",
  "lets-go-pikachu": "Let’s Go Pikachu",
  "lets-go-eevee": "Let’s Go Eevee",
  "sword": "Sword",
  "shield": "Shield",
  "brilliant-diamond": "Brilliant Diamond",
  "shining-pearl": "Shining Pearl",
  "legends-arceus": "Legends: Arceus",
  "scarlet": "Scarlet",
  "violet": "Violet",
};

const versionLabel = (v) => VERSION_LABELS[v] || titleCase(v);

// ---------- PokeAPI helpers ----------
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchPokemon(id) {
  return fetchJSON(`https://pokeapi.co/api/v2/pokemon/${id}`);
}

async function fetchSpecies(id) {
  return fetchJSON(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
}

async function fetchEncounters(id) {
  // Returns array with location_area + version_details
  return fetchJSON(`https://pokeapi.co/api/v2/pokemon/${id}/encounters`);
}

function bestEnglishFlavor(species) {
  // Grab an English flavor text (prefer newer versions if possible)
  const entries = species?.flavor_text_entries || [];
  const en = entries.filter((e) => e.language?.name === "en");
  if (!en.length) return "";
  // prefer Scarlet/Violet, then Sword/Shield, then most recent encountered
  const preferred = ["scarlet", "violet", "sword", "shield", "legends-arceus", "brilliant-diamond", "shining-pearl"];
  for (const p of preferred) {
    const hit = en.find((e) => e.version?.name === p);
    if (hit) return hit.flavor_text.replace(/\s+/g, " ").trim();
  }
  // fallback: last english entry
  return en[en.length - 1].flavor_text.replace(/\s+/g, " ").trim();
}

function normalizeEncounterData(encArr) {
  // Returns: { versions: [versionName], byVersion: { [versionName]: [locationAreaName...] } }
  const byVersion = {};
  for (const row of encArr || []) {
    const loc = row.location_area?.name;
    for (const vd of row.version_details || []) {
      const v = vd.version?.name;
      if (!v || !loc) continue;
      if (!byVersion[v]) byVersion[v] = new Set();
      byVersion[v].add(loc);
    }
  }
  const versions = Object.keys(byVersion).sort((a, b) => versionLabel(a).localeCompare(versionLabel(b)));
  const normalized = {};
  for (const v of versions) normalized[v] = Array.from(byVersion[v]).sort();
  return { versions, byVersion: normalized };
}

function prettyLocationArea(name) {
  return titleCase(name.replace(/-area$/, "").replace(/-\d+$/, ""));
}

// ---------- UI components ----------
function FuturisticPanel({ children, className = "" }) {
  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl border border-white/15 bg-white/5 backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_60px_rgba(0,0,0,0.45)] " +
        className
      }
    >
      <div className="absolute -left-24 -top-24 h-48 w-48 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="absolute -right-24 -bottom-24 h-48 w-48 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="relative p-4 md:p-5">{children}</div>
    </div>
  );
}

function GlowButton({ children, onClick, disabled }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={
        "group relative inline-flex items-center justify-center rounded-xl px-4 py-2 font-black tracking-wide " +
        "text-black shadow-[0_10px_30px_rgba(16,185,129,0.35)] transition " +
        "bg-emerald-400 hover:bg-emerald-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed " +
        "focus:outline-none focus:ring-2 focus:ring-emerald-300/80"
      }
      style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" }}
    >
      <span className="absolute inset-0 -z-10 rounded-xl bg-emerald-400/40 blur-xl opacity-70 group-hover:opacity-90" />
      {children}
    </button>
  );
}

function Chip({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/90">
      {children}
    </span>
  );
}

function Toggle({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-xl px-3 py-1.5 text-sm font-semibold transition " +
        (active
          ? "bg-white/15 text-white"
          : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")
      }
    >
      {children}
    </button>
  );
}

function PokeballIntro({ done, onDone }) {
  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => onDone?.(), 1850);
    return () => clearTimeout(t);
  }, [done, onDone]);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[#06070c]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
        >
          <motion.div className="relative" initial={{ scale: 0.9, y: 12 }} animate={{ scale: 1, y: 0 }}>
            <div className="absolute -inset-16 rounded-full bg-emerald-500/10 blur-3xl" />
            <motion.div
              className="relative h-40 w-40 rounded-full border border-white/20 shadow-[0_40px_120px_rgba(0,0,0,0.7)]"
              style={{ background: "linear-gradient(#ff3b3b 0%, #ff3b3b 48%, #111827 48%, #111827 52%, #f3f4f6 52%, #f3f4f6 100%)" }}
              animate={{ rotate: [0, 6, -6, 4, -4, 0] }}
              transition={{ duration: 1.25, ease: "easeInOut" }}
            >
              <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 bg-black/80" />
              <motion.div
                className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[inset_0_0_0_8px_rgba(0,0,0,0.8)]"
                animate={{ boxShadow: [
                  "inset 0 0 0 8px rgba(0,0,0,0.8)",
                  "inset 0 0 0 8px rgba(0,0,0,0.8), 0 0 24px rgba(16,185,129,0.65)",
                  "inset 0 0 0 8px rgba(0,0,0,0.8)",
                ] }}
                transition={{ duration: 1.0, repeat: 1, ease: "easeInOut" }}
              />
              <motion.div
                className="absolute inset-0 rounded-full"
                animate={{ opacity: [0.0, 0.25, 0.0] }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                style={{ background: "radial-gradient(circle at 50% 50%, rgba(16,185,129,0.3), transparent 55%)" }}
              />
            </motion.div>
            <motion.div
              className="mt-6 text-center text-white/90"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <div className="text-lg font-extrabold tracking-wide">Living Dex Tracker</div>
              <div className="text-sm text-white/60">Opening Pokéball…</div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Carousel({ items, selectedIndex, onSelect }) {
  const scrollerRef = useRef(null);

  // Keep selected centered
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const child = el.children?.[selectedIndex];
    if (!child) return;
    child.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedIndex]);

  // Wheel horizontal
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // already horizontal
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-0 top-0 h-full w-20 bg-gradient-to-r from-[#06070c] to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 h-full w-20 bg-gradient-to-l from-[#06070c] to-transparent" />

      <div
        ref={scrollerRef}
        className="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth px-6 py-3"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {items.map((p, idx) => {
          const active = idx === selectedIndex;
          return (
            <motion.button
              key={p.id}
              onClick={() => onSelect(idx)}
              className={
                "relative flex h-28 w-24 shrink-0 flex-col items-center justify-center rounded-2xl border " +
                (active
                  ? "border-emerald-300/60 bg-white/10"
                  : "border-white/10 bg-white/5 hover:bg-white/10")
              }
              style={{ scrollSnapAlign: "center" }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              animate={{ scale: active ? 1.04 : 1.0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
            >
              <div className={"absolute inset-0 rounded-2xl " + (active ? "shadow-[0_0_0_1px_rgba(16,185,129,0.25),0_18px_50px_rgba(0,0,0,0.5)]" : "")}></div>
              <img
                src={p.sprite}
                alt={p.name}
                className={"h-14 w-14 select-none " + (active ? "drop-shadow-[0_10px_18px_rgba(16,185,129,0.25)]" : "opacity-90")}
                draggable={false}
              />
              <div className="mt-1 w-full truncate px-2 text-center text-[11px] font-semibold text-white/85">
                {titleCase(p.name)}
              </div>
              <div className="text-[10px] text-white/45">#{String(p.id).padStart(4, "0")}</div>
            </motion.button>
          );
        })}
      </div>

      {/* Center reticle */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-full w-0 -translate-x-1/2">
        <div className="absolute top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-emerald-300/30" />
        <div className="absolute top-1/2 h-1 w-16 -translate-x-1/2 -translate-y-1/2 bg-emerald-400/30" />
      </div>
    </div>
  );
}

function DexSidePanel({ pokemon, caught, onToggleCaught }) {
  const [species, setSpecies] = useState(null);
  const [enc, setEnc] = useState(null);
  const [encLoading, setEncLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setSpecies(null);
    setEnc(null);
    setSelectedVersion(null);
    setError(null);

    (async () => {
      try {
        const sp = await fetchSpecies(pokemon.id);
        if (!alive) return;
        setSpecies(sp);
      } catch (e) {
        if (!alive) return;
        setError("Couldn’t load Dex flavor text.");
      }

      try {
        setEncLoading(true);
        const raw = await fetchEncounters(pokemon.id);
        if (!alive) return;
        const norm = normalizeEncounterData(raw);
        setEnc(norm);
        setSelectedVersion(norm.versions[0] || null);
      } catch {
        if (!alive) return;
        setEnc({ versions: [], byVersion: {} });
      } finally {
        if (alive) setEncLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [pokemon.id]);

  const flavor = useMemo(() => (species ? bestEnglishFlavor(species) : ""), [species]);

  const types = pokemon.types?.map((t) => t.type?.name).filter(Boolean) || [];
  const weightKg = pokemon.weight ? (pokemon.weight / 10).toFixed(1) : "?";
  const heightM = pokemon.height ? (pokemon.height / 10).toFixed(1) : "?";

  const locations = selectedVersion ? enc?.byVersion?.[selectedVersion] || [] : [];

  return (
    <div className="space-y-3">
      <FuturisticPanel>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-extrabold text-white">{titleCase(pokemon.name)}</div>
            <div className="mt-1 flex flex-wrap gap-2">
              <Chip>#{String(pokemon.id).padStart(4, "0")}</Chip>
              <Chip>{heightM} m</Chip>
              <Chip>{weightKg} kg</Chip>
              {types.map((t) => (
                <Chip key={t}>{titleCase(t)}</Chip>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <GlowButton
              onClick={() => {
                playCatchSfx();
                onToggleCaught?.();
              }}
            >
              {caught ? "Release" : "Catch"}
            </GlowButton>
            <div className={"text-xs font-semibold " + (caught ? "text-emerald-300" : "text-white/45")}>
              {caught ? "Caught" : "Missing"}
            </div>
          </div>
        </div>

        <div className="mt-3 text-sm leading-relaxed text-white/80">
          {error ? (
            <span className="text-rose-200">{error}</span>
          ) : flavor ? (
            <span>{flavor}</span>
          ) : (
            <span className="text-white/50">Loading Pokédex entry…</span>
          )}
        </div>
      </FuturisticPanel>

      <FuturisticPanel>
        <div className="flex items-center justify-between">
          <div className="text-sm font-extrabold text-white">Where to catch (by game)</div>
          {encLoading && <div className="text-xs text-white/60">Scanning regions…</div>}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(enc?.versions || []).length ? (
            enc.versions.map((v) => (
              <button
                key={v}
                onClick={() => setSelectedVersion(v)}
                className={
                  "rounded-xl border px-3 py-1.5 text-xs font-bold transition " +
                  (v === selectedVersion
                    ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white")
                }
              >
                {versionLabel(v)}
              </button>
            ))
          ) : (
            <div className="text-sm text-white/60">No encounter data found here (some Pokémon are gift-only, event-only, or not in the wild).</div>
          )}
        </div>

        <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="text-xs font-extrabold text-white/80">{selectedVersion ? versionLabel(selectedVersion) : "Select a game"}</div>
          {selectedVersion ? (
            locations.length ? (
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto pr-1 text-sm text-white/80">
                {locations.map((loc) => (
                  <li key={loc} className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300/70" />
                    <span>{prettyLocationArea(loc)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-sm text-white/60">No wild locations listed for this version.</div>
            )
          ) : (
            <div className="mt-2 text-sm text-white/60">Pick a game button to show locations.</div>
          )}
        </div>

        <div className="mt-3 text-xs text-white/50">
          Tip: encounter data comes from PokeAPI and reflects “location areas” used by the games’ internal data.
        </div>
      </FuturisticPanel>
    </div>
  );
}

function ListView({ items, caughtSet, onJumpToId, onToggleCaught }) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("missing"); // all | missing | caught

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items
      .filter((p) => {
        if (!query) return true;
        return p.name.includes(query) || String(p.id).includes(query);
      })
      .filter((p) => {
        const isCaught = caughtSet.has(p.id);
        if (mode === "all") return true;
        if (mode === "caught") return isCaught;
        return !isCaught;
      });
  }, [items, q, mode, caughtSet]);

  return (
    <FuturisticPanel className="h-[520px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-extrabold text-white">List View</div>
          <div className="flex gap-2">
            <Toggle active={mode === "missing"} onClick={() => setMode("missing")}>Missing</Toggle>
            <Toggle active={mode === "caught"} onClick={() => setMode("caught")}>Caught</Toggle>
            <Toggle active={mode === "all"} onClick={() => setMode("all")}>All</Toggle>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or #…"
            className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white/90 placeholder:text-white/40 outline-none focus:ring-2 focus:ring-emerald-300/40"
          />
        </div>

        <div className="text-xs text-white/55">
          Showing <span className="font-bold text-white/80">{filtered.length}</span> Pokémon
        </div>

        <div className="no-scrollbar -mx-1 flex-1 overflow-auto px-1">
          <div className="grid grid-cols-1 gap-2">
            {filtered.map((p) => {
              const isCaught = caughtSet.has(p.id);
              return (
                <div
                  key={p.id}
                  className={
                    "flex items-center justify-between gap-3 rounded-2xl border p-2 transition " +
                    (isCaught ? "border-emerald-300/20 bg-emerald-400/10" : "border-white/10 bg-white/5 hover:bg-white/10")
                  }
                >
                  <button
                    onClick={() => onJumpToId?.(p.id)}
                    className="flex items-center gap-3 text-left"
                  >
                    <img src={p.sprite} alt={p.name} className="h-10 w-10" draggable={false} />
                    <div>
                      <div className="text-sm font-bold text-white">{titleCase(p.name)}</div>
                      <div className="text-xs text-white/50">#{String(p.id).padStart(4, "0")}</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      playCatchSfx();
                      onToggleCaught?.(p.id);
                    }}
                    className={
                      "rounded-xl px-3 py-2 text-xs font-extrabold transition " +
                      (isCaught
                        ? "bg-white/10 text-emerald-200 hover:bg-white/15"
                        : "bg-emerald-400 text-black hover:bg-emerald-300")
                    }
                  >
                    {isCaught ? "Release" : "Catch"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-xs text-white/45">
          This list is great for checking what you’re missing fast.
        </div>
      </div>
    </FuturisticPanel>
  );
}

// ---------- Main app ----------
export default function App() {
  const [introDone, setIntroDone] = useState(false);

  // Choose your dex range. Gen 1–9 national dex currently goes to 1025+ (updates happen).
  // If PokeAPI adds more later, just bump this.
  const DEX_MAX = 1025;

  const [items, setItems] = useState([]); // {id, name, sprite, types, height, weight}
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState("dex"); // dex | list

  const [caught, setCaught] = useState(() => loadCaught());

  const selected = items[selectedIndex];

  // Lightweight “catalog” loader: fetch sprites + names using PokeAPI list,
  // then lazy-fetch full pokemon data for the selected one.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        // Use the paginated list endpoint, then build ids.
        // We still need sprites; easiest is deterministic sprite URL.
        const list = await fetchJSON(`https://pokeapi.co/api/v2/pokemon?limit=${DEX_MAX}&offset=0`);
        if (!alive) return;

        const base = list.results.map((r, i) => {
          const id = i + 1;
          // Official art (nice) + fallback sprite
          const official = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
          const sprite = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
          return {
            id,
            name: r.name,
            sprite: official,
            spriteFallback: sprite,
          };
        });

        setItems(base);
        setSelectedIndex(0);
      } catch {
        // If list fails, show empty and stop.
        setItems([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Lazy-fetch full details for currently selected pokemon (types/height/weight)
  useEffect(() => {
    let alive = true;
    if (!items.length) return;

    const cur = items[selectedIndex];
    if (!cur || cur.types) return; // already enriched

    (async () => {
      try {
        const full = await fetchPokemon(cur.id);
        if (!alive) return;
        setItems((prev) => {
          const copy = prev.slice();
          const p = { ...copy[selectedIndex], ...full };
          // ensure sprite exists even if official missing
          p.sprite = p.sprite || p.sprites?.other?.["official-artwork"]?.front_default || p.sprites?.front_default || cur.sprite;
          copy[selectedIndex] = p;
          return copy;
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
  }, [items, selectedIndex]);

  const progress = useMemo(() => {
    const total = items.length || DEX_MAX;
    const caughtCount = caught.size;
    const missingCount = Math.max(0, total - caughtCount);
    const pct = total ? Math.round((caughtCount / total) * 100) : 0;
    return { total, caughtCount, missingCount, pct };
  }, [caught, items.length]);

  const toggleCaught = (id = selected?.id) => {
    if (!id) return;
    setCaught((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCaught(next);
      return next;
    });
  };

  const jumpToId = (id) => {
    const idx = items.findIndex((p) => p.id === id);
    if (idx >= 0) {
      setView("dex");
      setSelectedIndex(idx);
    }
  };

  return (
    <div className="min-h-screen bg-[#06070c] text-white">
      <PokeballIntro done={introDone} onDone={() => setIntroDone(true)} />

      <div className="mx-auto max-w-6xl px-4 pb-10 pt-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 rounded-2xl bg-white/5 ring-1 ring-white/10">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/25 to-cyan-500/15" />
                <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300/80 blur-[1px]" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight">Pokéball Dex</div>
                <div className="text-sm text-white/60">A sleek living-dex tracker with real encounter data.</div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip>
                Progress: <span className="ml-1 font-extrabold text-white">{progress.caughtCount}</span> / {progress.total} ({progress.pct}%)
              </Chip>
              <Chip>
                Missing: <span className="ml-1 font-extrabold text-white">{progress.missingCount}</span>
              </Chip>
              <Chip>Local save ✓</Chip>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Toggle active={view === "dex"} onClick={() => setView("dex")}>Dex</Toggle>
            <Toggle active={view === "list"} onClick={() => setView("list")}>List</Toggle>
          </div>
        </div>

        {/* Body */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-7">
            <FuturisticPanel className="overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="text-sm font-extrabold text-white">Pokédex Carousel</div>
                <div className="text-xs text-white/50">Scroll wheel • Drag • Click</div>
              </div>

              <div className="mt-3">
                {loading ? (
                  <div className="flex h-40 items-center justify-center text-white/60">Loading Pokédex…</div>
                ) : items.length ? (
                  <Carousel
                    items={items.map((p) => ({
                      id: p.id,
                      name: p.name,
                      sprite: p.sprite || p.spriteFallback,
                    }))}
                    selectedIndex={selectedIndex}
                    onSelect={(i) => setSelectedIndex(i)}
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center text-rose-200">Couldn’t load Pokédex list. Try refreshing.</div>
                )}
              </div>

              {/* Mini controls */}
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  onClick={() => setSelectedIndex((i) => clamp(i - 1, 0, items.length - 1))}
                  className="rounded-xl bg-white/5 px-3 py-2 text-sm font-bold text-white/80 hover:bg-white/10"
                >
                  ◀ Prev
                </button>
                <div className="text-xs text-white/55">
                  Center selection drives the info panel →
                </div>
                <button
                  onClick={() => setSelectedIndex((i) => clamp(i + 1, 0, items.length - 1))}
                  className="rounded-xl bg-white/5 px-3 py-2 text-sm font-bold text-white/80 hover:bg-white/10"
                >
                  Next ▶
                </button>
              </div>

              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full bg-emerald-400/70"
                  style={{ width: `${items.length ? Math.round(((selectedIndex + 1) / items.length) * 100) : 0}%` }}
                />
              </div>
            </FuturisticPanel>

            <AnimatePresence mode="wait">
              {view === "list" && (
                <motion.div
                  key="list"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.25 }}
                  className="mt-4"
                >
                  <ListView
                    items={items.map((p) => ({
                      id: p.id,
                      name: p.name,
                      sprite: p.sprite || p.spriteFallback,
                    }))}
                    caughtSet={caught}
                    onJumpToId={jumpToId}
                    onToggleCaught={toggleCaught}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="md:col-span-5">
            <AnimatePresence mode="wait">
              {selected && view === "dex" && (
                <motion.div
                  key={selected.id}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.25 }}
                >
                  <DexSidePanel
                    pokemon={selected}
                    caught={caught.has(selected.id)}
                    onToggleCaught={() => toggleCaught(selected.id)}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {view === "dex" && (
              <div className="mt-4 text-xs text-white/40">
                Want it even cooler? Add: generation filters, shiny toggle, form support, import/export (CSV), and your own “targets” list.
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar{display:none}
        .no-scrollbar{scrollbar-width:none}
      `}</style>
    </div>
  );
}
