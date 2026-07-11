// Shared front-end helpers for Gnome pages.
window.GNOME = (() => {
  const short = (a) => (a && a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || "");
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s | 0}s ago`;
    if (s < 3600) return `${(s / 60) | 0}m ago`;
    if (s < 86400) return `${(s / 3600) | 0}h ago`;
    return `${(s / 86400) | 0}d ago`;
  };
  const fmtUnits = (v, dec) =>
    (Number(v) / 10 ** dec).toLocaleString(undefined, { maximumFractionDigits: dec });
  async function getConfig() {
    if (window.__cfg) return window.__cfg;
    window.__cfg = await fetch("/api/config").then((r) => r.json());
    return window.__cfg;
  }
  return { short, ago, fmtUnits, getConfig };
})();

// Scroll reveal via IntersectionObserver (no scroll listeners; reduced-motion safe).
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function run() {
    const els = document.querySelectorAll(".reveal");
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const el = e.target;
            const delay = Number(el.dataset.delay || 0);
            setTimeout(() => el.classList.add("in"), delay);
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
  }
  if (document.readyState !== "loading") run();
  else document.addEventListener("DOMContentLoaded", run);
})();
