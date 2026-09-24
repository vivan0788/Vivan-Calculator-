'use strict';
/* =========================================================
   Glass Calculator — script.js
   1 Expression engine (tokenizer + parser, NO eval)
   2 State & display   2b Sound   3 Input rules   4 History
   5 Events (buttons, keyboard)
   ========================================================= */

/* ---------- 1. Expression engine ---------- */
class CalcError extends Error {}
const INVALID = () => new CalcError('Invalid expression');

/** Splits "2+3*5" into [{n:2},{op:'+'},{n:3},...]. Anything unexpected throws. */
function tokenize(src) {
  const re = /(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([+\-*/%()])/y; // sticky: must match at lastIndex
  const out = [];
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw INVALID();
    out.push(m[1] !== undefined ? { n: parseFloat(m[1]) } : { op: m[2] });
    i = re.lastIndex;
  }
  return out;
}

/**
 * Recursive-descent parser. Each level handles one precedence tier,
 * so 2+3*5/4-8 is evaluated as 2 + ((3*5)/4) - 8 = -2.25:
 *   expr    := term   (('+'|'-') term)*
 *   term    := unary  (('*'|'/'|implicit '(') unary)*
 *   unary   := ('-'|'+') unary | postfix
 *   postfix := primary '%'*            (n% = n/100)
 *   primary := number | '(' expr ')'
 */
function evaluate(src) {
  // Auto-close any unclosed "(" so "(2+3" still works
  const open = (src.match(/\(/g) || []).length - (src.match(/\)/g) || []).length;
  const t = tokenize(src + ')'.repeat(Math.max(0, open)));
  let p = 0;

  const expr = () => {
    let v = term();
    while (t[p] && (t[p].op === '+' || t[p].op === '-')) {
      const o = t[p++].op, r = term();
      v = o === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = () => {
    let v = unary();
    for (;;) {
      const k = t[p];
      if (k && (k.op === '*' || k.op === '/')) {
        p++;
        const r = unary();
        if (k.op === '/') { if (r === 0) throw new CalcError('Cannot divide by zero'); v /= r; }
        else v *= r;
      } else if (k && k.op === '(') v *= unary();   // implicit multiplication: 2(3+4)
      else return v;
    }
  };
  const unary = () => {
    const k = t[p];
    if (k && (k.op === '-' || k.op === '+')) { p++; const v = unary(); return k.op === '-' ? -v : v; }
    return postfix();
  };
  const postfix = () => {
    let v = primary();
    while (t[p] && t[p].op === '%') { p++; v /= 100; }
    return v;
  };
  const primary = () => {
    const k = t[p++];
    if (!k) throw INVALID();
    if (k.n !== undefined) return k.n;
    if (k.op === '(') {
      const v = expr();
      if (!t[p] || t[p++].op !== ')') throw INVALID();
      return v;
    }
    throw INVALID();
  };

  const v = expr();
  if (p < t.length || !Number.isFinite(v)) throw INVALID();  // never leak NaN / Infinity
  return v;
}

/** Rounds away binary float noise (0.1+0.2 → 0.3) and returns a string. */
const fmt = n => { const r = parseFloat(n.toPrecision(12)); return String(Object.is(r, -0) ? 0 : r); };
/** Internal operators → pretty UI symbols. */
const pretty = s => s.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
/** Live preview: ignore trailing operators, return null if not (yet) valid. */
const preview = s => { try { return fmt(evaluate(s.replace(/[+\-*/(]+$/, ''))); } catch { return null; } };

/* ---------- 2. State & display ---------- */
const $ = id => document.getElementById(id);
const el = { calc: $('calc'), expr: $('expr'), exprText: $('exprText'), result: $('result'), keys: $('keys') };
let expr = '';      // expression using internal operators + - * /
let prev = '';      // expression shown above the result after "="
let done = false;   // true right after "=" (expr then holds the result)
let err = '';       // friendly error message, '' when fine

function render() {
  const live = !err && !done ? preview(expr) : null;
  const text = err ? err : done ? expr : live !== null ? live : (expr ? '' : '0');
  const shown = pretty(text);

  el.exprText.textContent = pretty(done ? prev + ' =' : expr);
  el.expr.scrollLeft = el.expr.scrollWidth;                 // keep newest input visible
  if (el.result.textContent !== shown) {
    el.result.textContent = shown;
    el.result.classList.remove('tick'); void el.result.offsetWidth; el.result.classList.add('tick');
  }
  el.result.dataset.size = shown.length > 16 ? 'xs' : shown.length > 11 ? 's' : shown.length > 8 ? 'm' : 'l';
  el.result.classList.toggle('error', !!err);
}

/* ---------- 2b. Sound (Web Audio API — generated in code, no audio files) ---------- */
const SOUND_KEY = 'glass-calc-sound';
let soundOn = true;
try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch { /* storage blocked: default on */ }
let audio = null;                                            // created lazily on the first key press (browsers require a user gesture)

/** Plays one short tone. slideTo = optional end frequency, delay = seconds to wait. */
function beep(freq, dur = 0.06, type = 'sine', vol = 0.12, slideTo = 0, delay = 0) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime + delay;
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);                     // quick fade in/out avoids clicking artifacts
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch { /* audio not available: fail silently */ }
}

/** Each key type has its own tone; digits rise in pitch so typing feels musical. */
function playKey(k) {
  if (/^\d$/.test(k)) beep(420 + Number(k) * 28);
  else if ('+-*/'.includes(k)) beep(640, 0.07, 'triangle');
  else if (k === 'AC') beep(520, 0.14, 'sine', 0.12, 240);
  else if (k !== '=') beep(360, 0.06);                       // DEL, %, ".", ( )
}
const chime = () => { beep(660, 0.08); beep(990, 0.16, 'sine', 0.1, 0, 0.08); };   // "=" success
const buzz  = () => beep(180, 0.2, 'sawtooth', 0.07, 120);                        // error

const soundBtn = $('soundToggle');
function setSound(on) {
  soundOn = on;
  soundBtn.setAttribute('aria-checked', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
soundBtn.addEventListener('click', () => { setSound(!soundOn); beep(560); });
setSound(soundOn);

/* ---------- 3. Input rules ---------- */
const OPS = '+-*/';

function press(k) {
  playKey(k);                                                // buttons AND physical keyboard both go through here
  err = '';                                                  // any key recovers from an error
  if (k === 'AC')  { expr = prev = ''; done = false; return render(); }
  if (k === 'DEL') { expr = expr.slice(0, -1); done = false; return render(); }
  if (k === '=')   return equals();
  if (expr.length >= 100) return render();                   // sane length limit

  if (done && /^[\d.(]$|^paren$/.test(k)) expr = '';         // digit after "=" starts fresh
  done = false;

  const last = expr.slice(-1);
  const endsValue = /[\d)%]/.test(last);
  const seg = expr.match(/[\d.]*$/)[0];                      // number currently being typed

  if (/^\d$/.test(k)) {
    if (last === ')' || last === '%') expr += '*' + k;
    else if (seg === '0') expr = expr.slice(0, -1) + k;      // no leading zeros ("05")
    else expr += k;
  } else if (k === '.') {
    if (seg.includes('.')) { /* block "2..5" and "2.5.1" */ }
    else if (last === ')' || last === '%') expr += '*0.';
    else expr += seg ? '.' : '0.';
  } else if (OPS.includes(k)) {
    if (!expr) { if (k === '-') expr = '-'; }                // only a unary minus can start
    else if (last === '(') { if (k === '-') expr += k; }
    else if (OPS.includes(last)) {                           // replace the previous operator
      const base = expr.slice(0, -1);
      if ((base && !base.endsWith('(')) || k === '-') expr = base + k;
    } else expr += k;
  } else if (k === '%') {
    if (endsValue) expr += '%';
  } else {                                                   // '(' , ')' or the smart "( )" key
    const depth = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
    const close = k === ')' || (k === 'paren' && depth > 0 && endsValue);
    if (close) { if (depth > 0 && endsValue) expr += ')'; }
    else expr += '(';
  }
  render();
}

function equals() {
  if (!expr || done) return render();
  try {
    const res = fmt(evaluate(expr));
    addHistory(expr, res);
    prev = expr; expr = res; done = true;
    chime();
  } catch (e) {
    err = e instanceof CalcError ? e.message : 'Invalid expression';
    buzz();
    el.calc.classList.remove('shake'); void el.calc.offsetWidth; el.calc.classList.add('shake');
  }
  render();
}

/* ---------- 4. History (localStorage, max 30 items) ---------- */
const STORE = 'glass-calc-history';
const histList = $('histList'), histEmpty = $('histEmpty'), histPanel = $('history'), histToggle = $('histToggle');

const loadHistory = () => {
  try {
    const a = JSON.parse(localStorage.getItem(STORE));
    return Array.isArray(a) ? a.filter(h => h && typeof h.e === 'string' && typeof h.r === 'string').slice(0, 30) : [];
  } catch { return []; }
};
let entries = loadHistory();
const saveHistory = () => { try { localStorage.setItem(STORE, JSON.stringify(entries)); } catch { /* storage blocked: keep in memory */ } };

function addHistory(e, r) {
  if (entries[0] && entries[0].e === e) return;
  entries.unshift({ e, r });
  entries = entries.slice(0, 30);
  saveHistory(); renderHistory();
}

function renderHistory() {
  histList.replaceChildren();                                // textContent only — never innerHTML
  histEmpty.hidden = entries.length > 0;
  entries.forEach(h => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'item';
    b.setAttribute('aria-label', `Reuse ${pretty(h.e)} equals ${pretty(h.r)}`);
    const e = document.createElement('span'); e.className = 'e'; e.textContent = pretty(h.e);
    const r = document.createElement('span'); r.className = 'r'; r.textContent = '= ' + pretty(h.r);
    b.append(e, r);
    b.addEventListener('click', () => { expr = h.e; prev = ''; done = false; err = ''; render(); toggleHistory(false); });
    li.appendChild(b); histList.appendChild(li);
  });
}

function toggleHistory(open) {
  histPanel.classList.toggle('open', open);
  histToggle.setAttribute('aria-expanded', String(open));
  (open ? $('histClose') : histToggle).focus({ preventScroll: true });
}
$('histToggle').addEventListener('click', () => toggleHistory(!histPanel.classList.contains('open')));
$('histClose').addEventListener('click', () => toggleHistory(false));
$('histClear').addEventListener('click', () => { entries = []; saveHistory(); renderHistory(); });

/* ---------- 5. Events ---------- */
// Buttons (touch, mouse, keyboard activation) — one delegated listener
el.keys.addEventListener('click', e => {
  const b = e.target.closest('button[data-k]');
  if (b) press(b.dataset.k);
});

// Physical keyboard behaves exactly like the buttons
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' && histPanel.classList.contains('open')) return toggleHistory(false);
  if ((e.key === 'Enter' || e.key === ' ') && e.target.tagName === 'BUTTON') return;  // native click handles it

  const map = { Enter: '=', '=': '=', Backspace: 'DEL', Escape: 'AC', Delete: 'AC', c: 'AC', C: 'AC', x: '*', X: '*', ',': '.' };
  const k = map[e.key] || (/^[0-9+\-*/%.()]$/.test(e.key) ? e.key : null);
  if (!k) return;
  e.preventDefault();                                        // also stops Firefox's "/" quick-find
  press(k);

  const btn = el.keys.querySelector(`[data-k="${k === '(' || k === ')' ? 'paren' : k}"]`);
  if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 110); }
});

renderHistory();
render();
