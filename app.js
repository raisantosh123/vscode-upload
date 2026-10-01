'use strict';
document.title = 'Interactive PDF Reader';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ---------- Storage: notes and progress in localStorage, PDF files in IndexedDB ---------- */
const KEY = 'ipr-data';
let data;
try { data = JSON.parse(localStorage.getItem(KEY)) || { docs: {} }; } catch { data = { docs: {} }; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ } };

const db = new Promise((res, rej) => {
  const r = indexedDB.open('ipr', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => {
  const d = await db;
  return new Promise((res, rej) => {
    const q = fn(d.transaction('files', mode).objectStore('files'));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
};

/* ---------- State ---------- */
let pdf = null, id = null, page = 1, zoom = 1, tab = 'notes', task = null, token = 0;
let mediaUrl = null;
const D = () => data.docs[id];

/* ---------- Open documents ---------- */
async function addFile(f) {
  const i = `${f.name}|${f.size}`;
  data.docs[i] = data.docs[i] || { name: f.name, page: 1, zoom: 1, marks: [], bms: [] };
  await tx('readwrite', s => s.put(f, i));
  save();
  return openDoc(i, f);
}

async function openDoc(i, blob) {
  blob = blob || await tx('readonly', s => s.get(i));
  if (!blob) { alert('This PDF is not stored on this device. Open the file again to reattach your notes.'); return false; }
  try {
    pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
  } catch { alert('This file could not be read as a PDF.'); return false; }
  closeMedia();
  id = i;
  const d = D();
  d.pages = pdf.numPages;
  page = Math.min(d.page || 1, pdf.numPages);
  zoom = d.zoom || 1;
  document.body.classList.add('document-open');
  $('#home-page').hidden = true;
  $('#empty').hidden = true;
  $('#pagewrap').hidden = false;
  $('#pc').textContent = pdf.numPages;
  $('#pn').max = pdf.numPages;
  go(page);
  panel();
  return true;
}

function closeMedia() {
  const video = $('#video-player'), audio = $('#audio-player');
  video.pause();
  audio.pause();
  video.onerror = null;
  audio.onerror = null;
  video.removeAttribute('src');
  audio.removeAttribute('src');
  video.load();
  audio.load();
  video.hidden = true;
  audio.hidden = true;
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = null;
  $('#media-view').hidden = true;
  document.body.classList.remove('media-open', 'media-audio', 'media-video');
}

function openMedia(file) {
  const name = file.name.toLowerCase();
  const isAudio = file.type.startsWith('audio/') || /\.(aac|m4a|mp3|oga|ogg|opus|wav|weba|flac)$/.test(name);
  const isVideo = file.type.startsWith('video/') || /\.(3gp|avi|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)$/.test(name);
  if (!isAudio && !isVideo) {
    alert('Choose a supported audio or video file.');
    return;
  }

  closeMedia();
  mediaUrl = URL.createObjectURL(file);
  const player = isVideo ? $('#video-player') : $('#audio-player');
  player.hidden = false;
  player.src = mediaUrl;
  player.load();
  $('#media-title').textContent = file.name;
  $('#media-heading').textContent = file.name;
  $('#media-status').textContent = 'Your media stays on this device and is not uploaded.';
  player.onerror = () => {
    if (mediaUrl && player.currentSrc === mediaUrl)
      $('#media-status').textContent = 'This format or codec is not supported by your browser. Try an MP4, WebM, MP3, or WAV file.';
  };

  $('#home-page').hidden = true;
  $('#pagewrap').hidden = true;
  $('#empty').hidden = true;
  $('#media-view').hidden = false;
  document.body.classList.add('document-open', 'media-open', isAudio ? 'media-audio' : 'media-video');
  $('#stage').scrollTop = 0;
}

/* ---------- Render one page ---------- */
async function go(n) {
  if (!pdf) return;
  page = Math.max(1, Math.min(pdf.numPages, n));
  const t = ++token;
  D().page = page; D().zoom = zoom; save();
  ui();
  if (task) task.cancel();
  const p = await pdf.getPage(page);
  const vp = p.getViewport({ scale: zoom * 1.4 });
  const dpr = window.devicePixelRatio || 1;
  const cv = $('#cv'), w = $('#pagewrap');
  cv.width = vp.width * dpr; cv.height = vp.height * dpr;
  cv.style.width = w.style.width = vp.width + 'px';
  cv.style.height = w.style.height = vp.height + 'px';
  task = p.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] });
  try { await task.promise; } catch { return; }
  if (t !== token) return;
  const tl = $('#tl');
  tl.innerHTML = '';
  tl.style.setProperty('--scale-factor', vp.scale);
  await pdfjsLib.renderTextLayer({ textContentSource: await p.getTextContent(), container: tl, viewport: vp }).promise;
  drawHl();
  $('#stage').scrollTop = 0;
}

function ui() {
  $('#pn').value = page;
  $('#zl').textContent = Math.round(zoom * 100) + '%';
  $('#bar').style.width = (page / pdf.numPages * 100) + '%';
  refresh();
}

/* ---------- Highlights ---------- */
function drawHl() {
  const L = $('#hl');
  L.innerHTML = '';
  D().marks.filter(m => m.page === page).forEach(m => m.rects.forEach(r => {
    const e = document.createElement('div');
    e.className = 'hl';
    e.style.cssText = `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%;background:${m.color}`;
    L.appendChild(e);
  }));
}

function addHl(color) {
  const s = getSelection();
  if (!pdf || s.isCollapsed || !$('#tl').contains(s.anchorNode)) return;
  const b = $('#pagewrap').getBoundingClientRect(), seen = new Set();
  const rects = [...s.getRangeAt(0).getClientRects()]
    .filter(r => r.width > 1 && r.height > 1)
    .map(r => [(r.left - b.left) / b.width, (r.top - b.top) / b.height, r.width / b.width, r.height / b.height])
    .filter(r => { const k = r.map(v => v.toFixed(3)).join(); return seen.has(k) ? false : seen.add(k); });
  if (!rects.length) return;
  D().marks.push({ id: Date.now(), page, color, note: '', text: s.toString().trim().replace(/\s+/g, ' '), rects });
  s.removeAllRanges();
  save(); drawHl(); refresh();
}

/* ---------- Side panel ---------- */
const refresh = () => { if (tab !== 'find') panel(); };

function panel() {
  const P = $('#panel'), d = id && D();
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.t === tab));
  if (tab === 'lib') {
    const k = Object.keys(data.docs);
    P.innerHTML = k.length ? k.map(i => {
      const x = data.docs[i];
      return `<div class="item"><b>${esc(x.name)}</b><br><small>Page ${x.page || 1}${x.pages ? ' of ' + x.pages : ''}, ${x.marks.length} highlights, ${x.bms.length} bookmarks</small>
      <div class="acts"><button data-a="open" data-i="${esc(i)}">Open</button><button data-a="rm" data-i="${esc(i)}">Remove</button></div></div>`;
    }).join('') : '<p class="hint">Your library is empty. Open a PDF to add it.</p>';
    return;
  }
  if (!d) { P.innerHTML = '<p class="hint">Open a PDF to use this panel.</p>'; return; }
  if (tab === 'notes') {
    const ms = [...d.marks].sort((a, b) => a.page - b.page);
    P.innerHTML = ms.length ? ms.map(m => `<div class="item" style="border-left:5px solid ${m.color}"><small>Page ${m.page}</small><p>${esc(m.text)}</p>
      <textarea data-n="${m.id}" placeholder="Add a note">${esc(m.note)}</textarea>
      <div class="acts"><button data-a="goto" data-p="${m.page}">Go to page</button><button data-a="delhl" data-n="${m.id}">Delete</button></div></div>`).join('')
      : '<p class="hint">Select text on the page, then pick a colour at the top to highlight it. Your notes appear here.</p>';
  } else if (tab === 'bms') {
    const bs = [...d.bms].sort((a, b) => a.page - b.page);
    P.innerHTML = bs.length ? bs.map(b => `<div class="item"><small>Page ${b.page}</small>
      <input data-b="${b.id}" value="${esc(b.label)}" aria-label="Bookmark name">
      <div class="acts"><button data-a="goto" data-p="${b.page}">Go to page</button><button data-a="delbm" data-n="${b.id}">Delete</button></div></div>`).join('')
      : '<p class="hint">Choose Bookmark page to save the page you are on.</p>';
  } else {
    P.innerHTML = '<form id="sf"><input id="q" placeholder="Search this PDF" aria-label="Search text"><button>Search</button></form><div id="res"></div>';
  }
}

async function find(q) {
  const R = $('#res'), low = q.toLowerCase(), out = [];
  R.textContent = 'Searching...';
  for (let n = 1; n <= pdf.numPages && out.length < 100; n++) {
    const t = (await (await pdf.getPage(n)).getTextContent()).items.map(i => i.str).join(' '), tl = t.toLowerCase();
    for (let k = tl.indexOf(low); k > -1 && out.length < 100; k = tl.indexOf(low, k + low.length))
      out.push({ n, s: t.slice(Math.max(0, k - 30), k + low.length + 40) });
  }
  R.innerHTML = out.length ? out.map(o => `<button class="item" data-a="goto" data-p="${o.n}"><small>Page ${o.n}</small><br>${esc(o.s)}</button>`).join('')
    : '<p class="hint">No matches. Scanned PDFs have no searchable text.</p>';
}

/* ---------- Events ---------- */
$('#panel').addEventListener('click', async e => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a, n = +b.dataset.n;
  if (a === 'goto') go(+b.dataset.p);
  if (a === 'delhl') { D().marks = D().marks.filter(m => m.id !== n); save(); drawHl(); panel(); }
  if (a === 'delbm') { D().bms = D().bms.filter(m => m.id !== n); save(); panel(); }
  if (a === 'open') openDoc(b.dataset.i);
  if (a === 'rm' && confirm('Remove this PDF and its notes from the library?')) {
    await tx('readwrite', s => s.delete(b.dataset.i));
    delete data.docs[b.dataset.i]; save();
    if (b.dataset.i === id) location.reload(); else panel();
  }
});
$('#panel').addEventListener('change', e => {
  if (e.target.dataset.n) D().marks.find(m => m.id === +e.target.dataset.n).note = e.target.value;
  if (e.target.dataset.b) D().bms.find(m => m.id === +e.target.dataset.b).label = e.target.value;
  save();
});
$('#panel').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (pdf && q) find(q);
});
document.querySelectorAll('.tab').forEach(t => t.onclick = () => { tab = t.dataset.t; panel(); });

$('#file').onchange = e => { if (e.target.files[0]) addFile(e.target.files[0]); e.target.value = ''; };
$('#media-file').onchange = e => {
  if (e.target.files[0]) openMedia(e.target.files[0]);
  e.target.value = '';
};
$('#home-open').onclick = () => $('#file').click();
$('#home-media').onclick = () => $('#media-file').click();
const onlineDialog = $('#online-dialog');
const openOnlineDialog = () => {
  $('#online-status').textContent = '';
  $('#online-url').value = '';
  onlineDialog.showModal();
  $('#online-url').focus();
};
$('#guide-open').onclick = openOnlineDialog;
$('#online-open').onclick = openOnlineDialog;
$('#online-close').onclick = () => onlineDialog.close();
$('#online-cancel').onclick = () => onlineDialog.close();
$('#nav-open').onclick = () => $('#file').click();
$('#footer-year').textContent = new Date().getFullYear();

function showReaderWorkspace() {
  closeMedia();
  document.body.classList.add('document-open');
  $('#home-page').hidden = true;
  $('#pagewrap').hidden = !pdf;
  $('#empty').hidden = Boolean(pdf);
  if (!pdf) $('#empty').textContent = 'Open a PDF to use this tool, or browse your library.';
  panel();
}

document.querySelectorAll('[data-tool]').forEach(tool => {
  tool.addEventListener('click', () => {
    const action = tool.dataset.tool;
    if (action === 'open') {
      $('#file').click();
    } else if (action === 'media') {
      $('#media-file').click();
    } else if (action === 'online') {
      openOnlineDialog();
    } else if (action === 'export') {
      $('#export').click();
    } else if (action === 'import') {
      $('#import').click();
    } else {
      tab = action;
      if (action === 'lib' || pdf) showReaderWorkspace();
      else $('#file').click();
    }
  });
});

$('#online-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('#online-url');
  let url;
  try {
    url = new URL(input.value.trim());
  } catch {
    $('#online-status').textContent = 'Enter a valid web page or PDF URL.';
    return;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    $('#online-status').textContent = 'Only HTTP and HTTPS links can be opened.';
    return;
  }

  const kind = $('#online-kind').value;
  if (kind === 'page' || (kind === 'auto' && !url.pathname.toLowerCase().endsWith('.pdf'))) {
    const link = document.createElement('a');
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
    onlineDialog.close();
    return;
  }

  const submit = $('#online-submit');
  submit.disabled = true;
  $('#online-status').textContent = 'Loading PDF…';
  try {
    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`The PDF server responded with ${response.status}.`);
    const file = await response.blob();
    const signature = await file.slice(0, 5).text();
    if (signature !== '%PDF-') throw new Error('The link did not return a valid PDF file.');

    let filename = url.pathname.split('/').pop();
    try { filename = decodeURIComponent(filename); } catch { filename = 'online-document.pdf'; }
    if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';
    const opened = await addFile(new File([file], filename, { type: 'application/pdf' }));
    if (!opened) {
      $('#online-status').textContent = 'This link could not be read as a PDF.';
      return;
    }
    onlineDialog.close();
  } catch (error) {
    $('#online-status').textContent = error instanceof TypeError
      ? 'Could not load this PDF. The site may block cross-origin access (CORS). Try downloading it and using Open PDF.'
      : error.message || 'Could not open this PDF.';
  } finally {
    submit.disabled = false;
  }
});

function showHome(target) {
  closeMedia();
  document.body.classList.remove('document-open');
  $('#home-page').hidden = false;
  $('#pagewrap').hidden = true;
  $('#empty').hidden = true;
  $('#bar').style.width = '0';
  if (target) {
    requestAnimationFrame(() => {
      $('#stage').scrollTo({ top: Math.max(0, $(target).offsetTop - $('#stage').offsetTop), behavior: 'smooth' });
    });
  } else {
    $('#stage').scrollTop = 0;
  }
}

document.querySelectorAll('[data-home-target]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    showHome(link.dataset.homeTarget === 'home-page' ? null : `#${link.dataset.homeTarget}`);
  });
});

$('#home-library').onclick = () => {
  tab = 'lib';
  panel();
};
$('#contact-toggle').onclick = () => {
  const toggle = $('#contact-toggle');
  const options = $('#contact-options');
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!expanded));
  options.hidden = expanded;
};
document.addEventListener('click', e => {
  if ($('#contact-details')?.contains(e.target)) return;
  $('#contact-toggle').setAttribute('aria-expanded', 'false');
  $('#contact-options').hidden = true;
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  $('#contact-toggle').setAttribute('aria-expanded', 'false');
  $('#contact-options').hidden = true;
  $('#contact-toggle').focus();
});
$('#prev').onclick = () => go(page - 1);
$('#next').onclick = () => go(page + 1);
$('#pn').onchange = e => go(+e.target.value || page);
$('#zi').onclick = () => { zoom = Math.min(3, zoom + 0.15); go(page); };
$('#zo').onclick = () => { zoom = Math.max(0.4, zoom - 0.15); go(page); };
$('#bm').onclick = () => {
  if (!pdf || D().bms.some(b => b.page === page)) return;
  D().bms.push({ id: Date.now(), page, label: 'Page ' + page });
  save(); tab = 'bms'; panel();
};
document.querySelectorAll('.sw').forEach(b => {
  b.onmousedown = e => e.preventDefault();          // keep the text selection
  b.onclick = () => addHl(b.dataset.c);
});
document.addEventListener('keydown', e => {
  if (document.body.classList.contains('media-open')) return;
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') go(page + 1);
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(page - 1);
});

/* Drag and drop */
const st = $('#stage');
st.ondragover = e => { e.preventDefault(); st.classList.add('drag'); };
st.ondragleave = () => st.classList.remove('drag');
st.ondrop = e => {
  e.preventDefault(); st.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f && f.type === 'application/pdf') addFile(f);
  else if (f && (f.type.startsWith('audio/') || f.type.startsWith('video/'))) openMedia(f);
};

/* Back up and restore (notes, highlights, bookmarks, progress; PDFs themselves stay on this device) */
$('#export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = 'pdf-reader-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#import').onchange = async e => {
  try {
    if (!e.target.files[0]) return;
    const obj = JSON.parse(await e.target.files[0].text());
    if (!obj.docs || typeof obj.docs !== 'object') throw 0;
    Object.assign(data.docs, obj.docs);
    save(); panel();
    alert('Backup restored. Open each PDF once to reattach it to its notes.');
  } catch { alert('That file is not a valid backup.'); }
  e.target.value = '';
};

panel();
