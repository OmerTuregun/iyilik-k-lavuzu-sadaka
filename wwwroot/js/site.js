/**
 * Gülümsemek Sadakadır — site.js
 * Camera → Countdown → Shoot → Consent → Upload → Confetti
 */

'use strict';

/* ── DOM REFS ──────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const videoEl         = $('videoEl');
const canvasEl        = $('canvasEl');
const cameraFrame     = $('cameraFrame');
const cameraPlaceholder = $('cameraPlaceholder');
const liveBadge       = $('liveBadge');
const countdownOverlay = $('countdownOverlay');
const countdownNum    = $('countdownNum');
const countdownRing   = $('countdownRing');
const flashOverlay    = $('flashOverlay');
const ctrlStart       = $('ctrlStart');
const ctrlShoot       = $('ctrlShoot');
const photoPreview    = $('photoPreview');
const previewImg      = $('previewImg');
const statusMsg       = $('statusMsg');
const btnUpload       = $('btnUpload');
const progressTrack   = $('progressTrack');
const progressFill    = $('progressFill');
const progressPct     = $('progressPct');
const successModal    = $('successModal');
const modalTodayNum   = $('modalTodayNum');
const modalTotalNum   = $('modalTotalNum');
const confettiCanvas  = $('confettiCanvas');
const galleryGrid     = $('galleryGrid');
const uploadNote      = $('uploadNote');

// Yükleme için zorunlu onay kutuları (sadece depolama izni)
const CHECKBOXES = ['consentStorage'];

/* ── STATE ─────────────────────────────────────────────────── */
let stream         = null;
let capturedBlob   = null;
let countdownTimer = null;

/* ── INIT ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  animateCounters();
  buildGallery();
  CHECKBOXES.forEach(id => $(id).addEventListener('change', checkUploadReady));
});

/* ── COUNTER ANIMATION ──────────────────────────────────────── */
function animateCounters() {
  document.querySelectorAll('.stat-num[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target, 10);
    if (isNaN(target)) return;
    el.textContent = '0';
    let current = 0;
    const duration = 1200;
    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      current = Math.round(eased * target);
      el.textContent = current.toLocaleString('tr-TR');
      if (progress < 1) requestAnimationFrame(tick);
    }

    // Delay per element for stagger
    const delay = parseInt(el.id.replace(/\D/g, ''), 10) || 0;
    setTimeout(() => requestAnimationFrame(tick), 300 + delay * 80);
  });
}

/* ── GALLERY (mock thumbnails) ──────────────────────────────── */
const GALLERY_ITEMS = [
  { bg: '#1a4a4a', emoji: '😊' },
  { bg: '#2d6b6b', emoji: '🙂' },
  { bg: '#3a8080', emoji: '😄' },
  { bg: '#1f5858', emoji: '😁' },
  { bg: '#4a9595', emoji: '🌟' },
  { bg: '#1a4a4a', emoji: '✨' },
  { bg: '#3d8585', emoji: '💛' },
  { bg: '#2a6060', emoji: '🌸' },
];

function buildGallery() {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = '';
  GALLERY_ITEMS.forEach(item => {
    const div = document.createElement('div');
    div.className = 'gallery-thumb';
    div.innerHTML = `
      <div class="gallery-thumb-img" style="background:${item.bg};width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;filter:blur(7px) brightness(.85);transition:filter .35s;"></div>
      <div class="gallery-thumb-overlay">${item.emoji}</div>
    `;
    // hover clear
    div.addEventListener('mouseenter', () => {
      div.querySelector('.gallery-thumb-img').style.filter = 'none';
    });
    div.addEventListener('mouseleave', () => {
      div.querySelector('.gallery-thumb-img').style.filter = 'blur(7px) brightness(.85)';
    });
    galleryGrid.appendChild(div);
  });
}


/* ── CAMERA ─────────────────────────────────────────────────── */
async function startCamera() {
  hideStatus();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();

    cameraPlaceholder.classList.add('hidden');
    videoEl.classList.add('active');
    liveBadge.classList.add('show');

    ctrlStart.classList.add('hidden');
    ctrlShoot.classList.remove('hidden');
  } catch (err) {
    showStatus('error', '⚠️ Kamera erişimi sağlanamadı. Lütfen tarayıcı kamera iznini kontrol edin.');
    console.error('[Camera]', err);
  }
}
window.startCamera = startCamera;

function stopCamera() {
  clearCountdown();
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  videoEl.srcObject = null;
  videoEl.classList.remove('active');
  cameraPlaceholder.classList.remove('hidden');
  liveBadge.classList.remove('show');
  ctrlShoot.classList.add('hidden');
  ctrlStart.classList.remove('hidden');
}
window.stopCamera = stopCamera;

/* ── COUNTDOWN ──────────────────────────────────────────────── */
function startCountdown() {
  let n = 3;
  setCountdownNum(n);
  countdownOverlay.classList.add('active');

  countdownTimer = setInterval(() => {
    n--;
    if (n > 0) {
      setCountdownNum(n);
    } else {
      clearCountdown();
      shootNow();
    }
  }, 1000);
}
window.startCountdown = startCountdown;

function setCountdownNum(n) {
  countdownNum.textContent = n;
  // Restart animation
  countdownRing.style.animation = 'none';
  countdownNum.style.animation  = 'none';
  void countdownNum.offsetHeight; // reflow
  countdownRing.style.animation = 'cdRing 1s var(--ease-out)';
  countdownNum.style.animation  = 'cdNum 1s var(--ease-out)';
}

function clearCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  countdownOverlay.classList.remove('active');
}

/* ── SHOOT ───────────────────────────────────────────────────── */
function shootNow() {
  clearCountdown();
  if (!stream) return;

  // Flash effect
  triggerFlash();

  // Shutter sound
  playShutter();

  // Capture frame
  canvasEl.width  = videoEl.videoWidth  || 1280;
  canvasEl.height = videoEl.videoHeight || 960;
  const ctx = canvasEl.getContext('2d');
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, -canvasEl.width, 0, canvasEl.width, canvasEl.height);
  ctx.restore();

  canvasEl.toBlob(blob => {
    capturedBlob = blob;
    const url = URL.createObjectURL(blob);
    previewImg.src = url;
    photoPreview.classList.remove('hidden');
    checkUploadReady();
  }, 'image/jpeg', 0.90);

  stopCamera();
}
window.shootNow = shootNow;

function retake() {
  capturedBlob = null;
  photoPreview.classList.add('hidden');
  previewImg.src = '';
  checkUploadReady();
  startCamera();
}
window.retake = retake;

function triggerFlash() {
  flashOverlay.classList.add('active');
  setTimeout(() => flashOverlay.classList.remove('active'), 100);
}

/* ── SHUTTER SOUND ───────────────────────────────────────────── */
function playShutter() {
  try {
    const ac  = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ac.createBuffer(1, ac.sampleRate * 0.09, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const decay = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * decay * decay;
    }
    const src  = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    gain.gain.value = 0.2;
    src.connect(gain);
    gain.connect(ac.destination);
    src.start();
    src.onended = () => ac.close();
  } catch (_) { /* ignore */ }
}

/* ── CONSENT CHECK ───────────────────────────────────────────── */
function checkUploadReady() {
  const allChecked = CHECKBOXES.every(id => $(id).checked);
  const ready = !!(capturedBlob && allChecked);
  btnUpload.disabled = !ready;
  btnUpload.setAttribute('aria-disabled', !ready);

  if (ready) {
    uploadNote.textContent = 'Her şey hazır — gülümseni yükle!';
    uploadNote.style.color = 'var(--petrol-700)';
    uploadNote.style.opacity = '1';
  } else {
    uploadNote.textContent = 'Fotoğraf çekip onayı işaretledikten sonra aktif olur';
    uploadNote.style.color  = '';
    uploadNote.style.opacity = '';
  }
}

/* ── UPLOAD ─────────────────────────────────────────────────── */
async function doUpload() {
  if (!capturedBlob) return;
  btnUpload.disabled = true;
  hideStatus();

  progressTrack.classList.remove('hidden');
  setProgress(0);

  const formData = new FormData();
  formData.append('photo', capturedBlob, `smile_${Date.now()}.jpg`);

  // Simüle eden ilerleyici progress
  let fakeProgress = 0;
  const fakeTimer = setInterval(() => {
    fakeProgress = Math.min(fakeProgress + Math.random() * 12, 88);
    setProgress(fakeProgress);
  }, 150);

  try {
    const response = await fetch('/Sadaka/Upload', {
      method: 'POST',
      body: formData,
    });

    clearInterval(fakeTimer);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Sunucu hatası');
    }

    const data = await response.json();

    setProgress(100);
    await sleep(300);

    // Update live counters
    if (data.todayCount) animateNum($('statToday'), data.todayCount);
    if (data.totalCount) animateNum($('statTotal'), data.totalCount);

    // Show modal
    if (data.todayCount) modalTodayNum.textContent = data.todayCount.toLocaleString('tr-TR');
    if (data.totalCount) modalTotalNum.textContent = data.totalCount.toLocaleString('tr-TR');

    setTimeout(showSuccess, 200);

  } catch (err) {
    clearInterval(fakeTimer);
    progressTrack.classList.add('hidden');
    setProgress(0);
    btnUpload.disabled = false;
    showStatus('error', `⚠️ ${err.message || 'Yükleme sırasında bir hata oluştu.'}`);
  }
}
window.doUpload = doUpload;

function setProgress(pct) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  progressFill.style.width = clamped + '%';
  progressPct.textContent  = clamped + '%';
}

/* ── SUCCESS ─────────────────────────────────────────────────── */
function showSuccess() {
  progressTrack.classList.add('hidden');
  setProgress(0);
  successModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  launchConfetti();
}

function resetAll() {
  successModal.classList.add('hidden');
  document.body.style.overflow = '';

  capturedBlob = null;
  previewImg.src = '';
  photoPreview.classList.add('hidden');

  CHECKBOXES.forEach(id => { $(id).checked = false; });
  checkUploadReady();

  hideStatus();
  progressTrack.classList.add('hidden');
  setProgress(0);

  ctrlStart.classList.remove('hidden');
  ctrlShoot.classList.add('hidden');
  cameraPlaceholder.classList.remove('hidden');
  videoEl.classList.remove('active');

  buildGallery(); // refresh with mock
}
window.resetAll = resetAll;

/* ── STATUS ──────────────────────────────────────────────────── */
function showStatus(type, msg) {
  statusMsg.className = `status-msg ${type}`;
  statusMsg.textContent = msg;
  statusMsg.classList.remove('hidden');
}

function hideStatus() {
  statusMsg.classList.add('hidden');
  statusMsg.textContent = '';
}

/* ── SHARE ───────────────────────────────────────────────────── */
function copyShareLink() {
  const url  = window.location.href;
  const btn  = $('btnShare');
  const orig = btn.innerHTML;

  navigator.clipboard.writeText(url)
    .then(() => {
      btn.innerHTML = '✅ Kopyalandı!';
      setTimeout(() => { btn.innerHTML = orig; }, 2200);
    })
    .catch(() => {
      try { prompt('Bu linki kopyalayın:', url); }
      catch (_) {}
    });
}
window.copyShareLink = copyShareLink;

/* ── COUNTER ANIMATE ─────────────────────────────────────────── */
function animateNum(el, target) {
  if (!el) return;
  const start  = parseInt(el.textContent.replace(/\D/g, ''), 10) || 0;
  const dur    = 600;
  const t0     = performance.now();
  function tick(now) {
    const p = Math.min((now - t0) / dur, 1);
    el.textContent = Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3))).toLocaleString('tr-TR');
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ── CONFETTI ────────────────────────────────────────────────── */
function launchConfetti() {
  const cvs = confettiCanvas;
  const ctx = cvs.getContext('2d');
  cvs.width  = window.innerWidth;
  cvs.height = window.innerHeight;

  const PALETTE = [
    '#1a4a4a', '#2d6b6b', '#4a9595',
    '#c9a84c', '#d9be6e', '#e8cc82',
    '#f5efe6', '#e8ddd0', '#c9b99a',
    '#ffffff',
  ];

  const SHAPES = ['rect', 'circle', 'strip'];

  const pieces = Array.from({ length: 140 }, () => ({
    x:     Math.random() * cvs.width,
    y:     -(Math.random() * cvs.height * 0.5),
    w:     Math.random() * 10 + 5,
    h:     Math.random() * 6  + 3,
    rot:   Math.random() * Math.PI * 2,
    vx:    (Math.random() - 0.5) * 2.5,
    vy:    Math.random() * 3.5 + 1.5,
    vr:    (Math.random() - 0.5) * 0.18,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
  }));

  let frame = 0;
  const MAX  = 280;

  function draw() {
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    const alpha = Math.max(0, 1 - frame / MAX);

    pieces.forEach(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.rot += p.vr;
      p.vy  += 0.055;
      if (p.y > cvs.height + 20) {
        p.y = -20;
        p.x = Math.random() * cvs.width;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // strip
        ctx.fillRect(-p.w / 2, -1.5, p.w, 3);
      }
      ctx.restore();
    });

    frame++;
    if (frame < MAX) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, cvs.width, cvs.height);
  }

  requestAnimationFrame(draw);
}

/* ── UTILS ───────────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
