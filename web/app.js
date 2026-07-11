// Shared front-end helpers for Tab402 pages.
window.T402 = (() => {
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
