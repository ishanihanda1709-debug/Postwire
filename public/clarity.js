// Optional visitor analytics (Microsoft Clarity). Does nothing unless CLARITY_ID is set on the server, which puts the id in
// the page's <meta name="clarity-id">. Inside the app, post text and account details are masked (data-clarity-mask in index.html).
(() => {
  const id = document.querySelector('meta[name="clarity-id"]')?.content || '';
  if (!/^[a-z0-9]{6,16}$/i.test(id)) return;                       // empty, or the unfilled {{placeholder}}
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;   // respect "do not track"
  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
  const s = document.createElement('script'); s.async = true; s.src = `https://www.clarity.ms/tag/${id}`;
  document.head.append(s);
})();
