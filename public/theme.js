// Applies the saved light/dark choice before the page paints (no flash). Without a saved choice the system setting applies.
try { const t = localStorage.getItem('pw-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch { /* storage unavailable */ }
