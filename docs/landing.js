const S={marketing:{h:'Marketing',b:'New campaigns and marketing news',chips:[['All',''],['Campaigns','Campaign'],['News','News'],['Case studies','Case study']],cards:[['Campaign','Sample headline about a new brand campaign','Sample Publisher · 2 h ago'],['Campaign','Sample headline about a festive ad film','Sample Publisher · 5 h ago'],['News','Sample headline about marketing budgets','Sample Publisher · Yesterday'],['Case study','Sample headline about a brand growing its community','Sample Publisher · Yesterday']]},product:{h:'Product',b:'Launches, new features and ideas for product managers',chips:[['All',''],['Launches','Launch'],['Features','Feature'],['For PMs','For PMs']],cards:[['Launch','Sample headline about a new app launch','Sample Publisher · 1 h ago'],['Feature','Sample headline about a new feature rolling out','Sample Publisher · 4 h ago'],['For PMs','Sample headline about building a product roadmap','Sample Publisher · Yesterday'],['Launch','Sample headline about a new gadget','Sample Publisher · Yesterday']]},finance:{h:'Finance',b:'Markets, funding, the economy and fintech',chips:[['All',''],['Markets','Markets'],['Funding','Funding'],['Economy','Economy'],['Fintech','Fintech']],cards:[['Markets','Sample headline about the market moving','Sample Publisher · 1 h ago'],['Economy','Sample headline about interest rates','Sample Publisher · 6 h ago'],['Funding','Sample headline about a startup funding round','Sample Publisher · Yesterday'],['Fintech','Sample headline about digital payments','Sample Publisher · Yesterday']]}};
const POSTS=[['Story-led','[A hook that makes people curious]\n\nWhat happened, in one line:\n[the facts from the story]\n\nMost teams would have [the usual route].\n\nThis one [what was different].\n\nEveryone talks about [the headline].\nVery few notice [the lesson].\n\nSource: [Publisher]'],['Lesson-led','[The one lesson, in a sentence]\n\nWhat stood out:\n[detail 1]\n[detail 2]\n\nIf you work on [your area], steal this:\n[the takeaway]\n\nSource: [Publisher]'],['Question-led','[A sharp question about this story?]\n\nMy honest read:\n[what works]\n[what I am not sure about]\n\nWhat do you think?\n\nSource: [Publisher]']];
const $=(i)=>document.getElementById(i);let sec='marketing',open=-1,opt=0,chip=0;
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function draw(){const d=S[sec];$('app').dataset.d=sec;$('dh').textContent=d.h;$('db').textContent=d.b;
 const chips=$('dchips');chips.replaceChildren();d.chips.forEach((t,i)=>{const b=el('button','chip',t[0]);b.type='button';b.setAttribute('aria-pressed',String(i===chip));b.onclick=()=>{chip=i;draw()};chips.append(b)});
 const cards=$('dcards');cards.replaceChildren();d.cards.forEach((c,i)=>{if(chip>0&&c[0]!==d.chips[chip][1])return;const b=el('button','dc');b.type='button';b.setAttribute('aria-expanded',String(open===i));b.append(el('span','dtag',c[0]),el('b','',c[1]),el('small','',c[2]),el('em','','Write a post →'));b.onclick=()=>{open=i;opt=0;draw();$('dp').scrollIntoView({block:'nearest',behavior:'smooth'})};cards.append(b)});
 if(!cards.children.length)cards.append(el('p','muted','No sample stories for this tab.'));
 const p=$('dp');p.hidden=open<0;if(open<0)return;$('dpt').textContent=d.cards[open][1];$('dnote').hidden=sec!=='finance';
 const o=$('dopts');o.replaceChildren();POSTS.forEach((x,i)=>{const b=el('button','chip',(i+1)+'. '+x[0]);b.type='button';b.setAttribute('aria-selected',String(i===opt));b.onclick=()=>{opt=i;draw()};o.append(b)});$('dpost').textContent=POSTS[opt][1]}
document.querySelectorAll('.dside button').forEach(b=>b.onclick=()=>{sec=b.dataset.s;open=-1;chip=0;document.querySelectorAll('.dside button').forEach(x=>x.setAttribute('aria-selected',String(x===b)));draw()});
$('dx').onclick=()=>{open=-1;draw()};
$('dcopy').onclick=async e=>{try{await navigator.clipboard.writeText(POSTS[opt][1]);e.target.textContent='Copied'}catch{e.target.textContent='Select and copy'}setTimeout(()=>e.target.textContent='Copy this post',1800)};
draw();
const root=document.documentElement,tb=$('theme');const dark=()=>root.dataset.theme==='dark'||(!root.dataset.theme&&matchMedia('(prefers-color-scheme: dark)').matches);
const lab=()=>{tb.textContent=dark()?'Light mode':'Dark mode'};tb.onclick=()=>{root.dataset.theme=dark()?'light':'dark';lab()};lab();

// ---- theme: same saved choice as the app ----
try { const t = localStorage.getItem('pw-theme'); if (t === 'light' || t === 'dark') { root.dataset.theme = t; lab(); } } catch { /* storage unavailable */ }
tb.addEventListener('click', () => { try { localStorage.setItem('pw-theme', root.dataset.theme); } catch { /* ignore */ } });

// ---- "Get started" and "Log in" go to the app ----
// When this page is served by the app itself, the links are same-site. When it is hosted somewhere else (GitHub Pages, a preview),
// set APP_URL to the app's address once it is live, for example 'https://postwire.example'. Until then the buttons explain.
const APP_URL = '';
const servedByApp = document.querySelector('meta[name="served-by-app"]')?.content === '1';
const appLive = servedByApp || APP_URL !== '';
let toastTimer;
document.querySelectorAll('[data-app]').forEach((a) => {
  if (appLive) { a.href = APP_URL.replace(/\/$/, '') + a.dataset.app; return; }
  a.href = '#';
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const t = $('toast'); t.textContent = 'Preview only: the app is not hosted yet. To try it, run it on your computer and open http://localhost:3000.';
    t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  });
});
