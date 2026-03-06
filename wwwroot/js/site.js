/* ═══════════════════════════════════════════════════════════════
   GLOBALS
   ═══════════════════════════════════════════════════════════════ */
   const $ = id => document.getElementById(id);
   const $$$ = sel => document.querySelectorAll(sel);
   
   let currentUser = null;
   let stream = null;
   let currentFacingMode = 'user'; // 'user' (ön kamera) veya 'environment' (arka kamera)
   let photoData = null;
   let waitTimerInterval = null;
   
   const CHECKBOXES = ['consentStorage'];
   
   /* ═══════════════════════════════════════════════════════════════
      AUTH MODAL
      ═══════════════════════════════════════════════════════════════ */
   function initAuth() {
     const stored = localStorage.getItem('sadaka_user');
     if (stored) {
       try {
         currentUser = JSON.parse(stored);
         hideAuthModal();
         refreshUserStats();
         return;
       } catch (e) {
         localStorage.removeItem('sadaka_user');
       }
     }
     showAuthModal();
   }
   
   function showAuthModal() { $('authModal')?.classList.remove('hidden'); }
   function hideAuthModal()  { $('authModal')?.classList.add('hidden'); }
   
   function switchTab(tabName) {
     $$$('.auth-tab').forEach(t => t.classList.remove('active'));
     $$$('.auth-form').forEach(f => f.classList.add('hidden'));
     $(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`)?.classList.add('active');
     $(`form${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`)?.classList.remove('hidden');
   }
   $$$('.auth-tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
   
   $('formRegister')?.addEventListener('submit', async (e) => {
     e.preventDefault();
     const statusEl = $('registerStatus');
     const displayName = $('regDisplayName').value.trim();
     const pin = $('regPin').value.trim();
     if (!displayName || pin.length !== 4) {
       statusEl.textContent = 'Lütfen isim ve 4 haneli PIN girin.';
       statusEl.className = 'auth-status error';
       return;
     }
     statusEl.textContent = 'Kaydediliyor...';
     statusEl.className = 'auth-status';
     try {
       const res = await fetch('/Sadaka/Register', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ displayName, pin })
       });
       const data = await res.json();
       if (data.success) {
         currentUser = { userId: data.userId, displayName: data.displayName, totalPoints: data.totalPoints ?? 0, currentStreak: data.currentStreak ?? 0 };
         localStorage.setItem('sadaka_user', JSON.stringify(currentUser));
         statusEl.textContent = data.message || 'Kayıt başarılı!';
         statusEl.className = 'auth-status success';
         setTimeout(() => { hideAuthModal(); updatePointsDisplay(); refreshUserStats(); }, 800);
       } else {
         statusEl.textContent = data.message || 'Kayıt başarısız.';
         statusEl.className = 'auth-status error';
       }
     } catch { statusEl.textContent = 'Bağlantı hatası.'; statusEl.className = 'auth-status error'; }
   });
   
   $('formLogin')?.addEventListener('submit', async (e) => {
     e.preventDefault();
     const statusEl = $('loginStatus');
     const displayName = $('loginDisplayName').value.trim();
     const pin = $('loginPin').value.trim();
     if (!displayName || pin.length !== 4) {
       statusEl.textContent = 'Lütfen isim ve 4 haneli PIN girin.';
       statusEl.className = 'auth-status error';
       return;
     }
     statusEl.textContent = 'Giriş yapılıyor...';
     statusEl.className = 'auth-status';
     try {
       const res = await fetch('/Sadaka/Login', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ displayName, pin })
       });
       const data = await res.json();
       if (data.success) {
         currentUser = { userId: data.userId, displayName: data.displayName, totalPoints: data.totalPoints ?? 0, currentStreak: data.currentStreak ?? 0 };
         localStorage.setItem('sadaka_user', JSON.stringify(currentUser));
         statusEl.textContent = 'Giriş başarılı!';
         statusEl.className = 'auth-status success';
         setTimeout(() => { hideAuthModal(); updatePointsDisplay(); refreshUserStats(); }, 800);
       } else {
         statusEl.textContent = data.message || 'Giriş başarısız.';
         statusEl.className = 'auth-status error';
       }
     } catch { statusEl.textContent = 'Bağlantı hatası.'; statusEl.className = 'auth-status error'; }
   });
   
   $$$('input[pattern="[0-9]{4}"]').forEach(input => {
     input.addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
   });
   
   /* ═══════════════════════════════════════════════════════════════
      LİMİT MODAL
      ═══════════════════════════════════════════════════════════════ */
   function showLimitModal(streak) {
     const streakInfo = $('limitStreakInfo');
     const streakBadge = $('limitStreakBadge');
     if (streak > 0 && streakInfo && streakBadge) {
       streakBadge.textContent = `🔥 ${streak} Günlük Serinin Var!`;
       streakInfo.style.display = 'block';
     } else if (streakInfo) {
       streakInfo.style.display = 'none';
     }
     $('limitModal')?.classList.remove('hidden');
   }
   
   function closeLimitModal() { $('limitModal')?.classList.add('hidden'); }
   window.closeLimitModal = closeLimitModal;
   
   /* ═══════════════════════════════════════════════════════════════
      BEKLEME MODAL — geri sayım ile
      ═══════════════════════════════════════════════════════════════ */
   function showWaitModal(totalSeconds) {
     let remaining = totalSeconds;
   
     function updateDisplay() {
       const h = Math.floor(remaining / 3600);
       const m = Math.floor((remaining % 3600) / 60);
       const s = remaining % 60;
       $('waitHours').textContent   = String(h).padStart(2, '0');
       $('waitMinutes').textContent = String(m).padStart(2, '0');
       $('waitSeconds').textContent = String(s).padStart(2, '0');
     }
   
     // Önceki timer varsa temizle
     if (waitTimerInterval) clearInterval(waitTimerInterval);
   
     updateDisplay();
     $('waitModal')?.classList.remove('hidden');
   
     waitTimerInterval = setInterval(() => {
       remaining--;
       if (remaining <= 0) {
         clearInterval(waitTimerInterval);
         waitTimerInterval = null;
         closeWaitModal();
         // Süre doldu — kamerayı otomatik aç
         openCameraDirectly();
       } else {
         updateDisplay();
       }
     }, 1000);
   }
   
   function closeWaitModal() {
     $('waitModal')?.classList.add('hidden');
     // Modal kapatılınca timer çalışmaya devam etsin ama modal görünmesin
   }
   
   window.closeWaitModal = closeWaitModal;
   
   /* ═══════════════════════════════════════════════════════════════
      PUAN & STREAK GÜNCELLEME
      ═══════════════════════════════════════════════════════════════ */
   function updatePointsDisplay(points, streak) {
     const p = points !== undefined ? points : (currentUser?.totalPoints ?? null);
     const s = streak !== undefined ? streak : (currentUser?.currentStreak ?? 0);
   
     const statPoints = $('statPoints');
     if (statPoints && p !== null) animateCounter(statPoints, p);
   
     const streakCard = $('streakCard');
     if (streakCard && p !== null) {
       streakCard.classList.remove('hidden');
       const streakNum = $('streakNum');
       const streakFire = $('streakFire');
       const pointsNum = $('pointsNum');
       const multiplierEl = $('streakMultiplier');
       if (streakNum) streakNum.textContent = s;
       if (pointsNum) animateCounter(pointsNum, p);
       if (streakFire) streakFire.textContent = s >= 3 ? '🔥' : s >= 1 ? '✨' : '⭐';
       if (multiplierEl) {
         const txt = { 0:'', 1:'1× puan', 2:'1.5× puan (seri bonusu!)', 3:'2× puan (seri bonusu!)', 4:'2.5× puan (seri bonusu!)' };
         const text = s >= 5 ? '3× puan (maksimum bonus! 🏆)' : (txt[s] ?? '');
         multiplierEl.textContent = text;
         multiplierEl.style.display = text ? 'block' : 'none';
       }
     }
   }
   
   async function refreshUserStats() {
     if (!currentUser?.userId) return;
     try {
       const res = await fetch(`/Sadaka/UserStats/${currentUser.userId}`);
       if (res.ok) {
         const data = await res.json();
         currentUser.totalPoints = data.totalPoints;
         currentUser.currentStreak = data.currentStreak;
         localStorage.setItem('sadaka_user', JSON.stringify(currentUser));
         updatePointsDisplay(data.totalPoints, data.currentStreak);
       }
     } catch { /* sessizce geç */ }
   }
   
   /* ═══════════════════════════════════════════════════════════════
      CAMERA — önce durum kontrolü
      ═══════════════════════════════════════════════════════════════ */
   async function startCamera() {
     if (!currentUser) { showAuthModal(); return; }
   
     // Sunucudan durum kontrolü
     try {
       const res = await fetch(`/Sadaka/CheckStatus/${currentUser.userId}`);
       if (res.ok) {
         const status = await res.json();
   
         // Günlük limit doldu
         if (status.dailyLimitReached) {
           showLimitModal(currentUser.currentStreak ?? 0);
           return;
         }
   
         // 1 saat dolmadı
         if (status.waitSeconds > 0) {
           showWaitModal(status.waitSeconds);
           return;
         }
       }
     } catch { /* kontrol edilemedi, yine de kamerayı aç */ }
   
     openCameraDirectly();
   }
   
   async function openCameraDirectly() {
     try {
       // Mevcut akışı kapat (yeniden başlatma veya kamera değiştirme durumunda)
       if (stream) {
         stream.getTracks().forEach(t => t.stop());
         stream = null;
       }

       stream = await navigator.mediaDevices.getUserMedia({
         video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
         audio: false
       });
       const video = $('videoEl');
       video.srcObject = stream;
       video.classList.add('active');
       $('cameraPlaceholder').classList.add('hidden');
       $('liveBadge').classList.add('show');
       $('ctrlStart').classList.add('hidden');
       $('ctrlShoot').classList.remove('hidden');
     } catch {
       showStatus('Kamera erişimi reddedildi veya bulunamadı.', 'error');
     }
   }

   async function toggleCameraFacing() {
     // Ön/arka kamera arasında geçiş yap
     currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
     await openCameraDirectly();
   }
   
   function stopCamera() {
     if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
     const video = $('videoEl');
     video.srcObject = null;
     video.classList.remove('active');
     $('cameraPlaceholder').classList.remove('hidden');
     $('liveBadge').classList.remove('show');
     $('ctrlStart').classList.remove('hidden');
     $('ctrlShoot').classList.add('hidden');
     $('photoPreview').classList.add('hidden');
     photoData = null;
     checkUploadReady();
   }
   
   function startCountdown() {
     const overlay = $('countdownOverlay');
     const numEl = $('countdownNum');
     overlay.classList.add('active');
     let count = 3;
     numEl.textContent = count;
     const interval = setInterval(() => {
       count--;
       if (count <= 0) { clearInterval(interval); overlay.classList.remove('active'); shootPhoto(); }
       else numEl.textContent = count;
     }, 1000);
   }
   
   function shootNow() { shootPhoto(); }
   
   function shootPhoto() {
     const video = $('videoEl');
     const canvas = $('canvasEl');
     const ctx = canvas.getContext('2d');
     canvas.width = video.videoWidth;
     canvas.height = video.videoHeight;

     // Selfie (ön kamera) için aynalı görüntü, arka kamera için normal görüntü
     if (currentFacingMode === 'user') {
       ctx.translate(canvas.width, 0);
       ctx.scale(-1, 1);
     }

     ctx.drawImage(video, 0, 0);
     canvas.toBlob((blob) => {
       photoData = blob;
       $('previewImg').src = URL.createObjectURL(blob);
       $('photoPreview').classList.remove('hidden');
       $('ctrlShoot').classList.add('hidden');
       const flash = $('flashOverlay');
       flash.classList.add('active');
       setTimeout(() => flash.classList.remove('active'), 100);
       checkUploadReady();
     }, 'image/jpeg', 0.92);
   }
   
   function retake() {
     $('photoPreview').classList.add('hidden');
     photoData = null;
     $('ctrlShoot').classList.remove('hidden');
     checkUploadReady();
   }
   
   window.startCamera = startCamera;
   window.startCountdown = startCountdown;
   window.shootNow = shootNow;
   window.stopCamera = stopCamera;
   window.retake = retake;
   window.toggleCameraFacing = toggleCameraFacing;
   
   /* ═══════════════════════════════════════════════════════════════
      UPLOAD
      ═══════════════════════════════════════════════════════════════ */
   function checkUploadReady() {
     if (!currentUser) {
       $('btnUpload').disabled = true;
       $('uploadNote').textContent = 'Önce giriş yapmalısın.';
       return;
     }
     const allChecked = CHECKBOXES.every(id => $(id)?.checked);
     const hasPhoto = photoData !== null;
     $('btnUpload').disabled = !(allChecked && hasPhoto);
     $('uploadNote').textContent = allChecked && hasPhoto
       ? 'Yüklemeye hazır!'
       : 'Fotoğraf çekip onayı işaretledikten sonra aktif olur';
   }
   
   CHECKBOXES.forEach(id => $(id)?.addEventListener('change', checkUploadReady));
   
   async function doUpload() {
     if (!currentUser || !photoData) {
       showStatus('Lütfen önce giriş yap ve fotoğraf çek.', 'error');
       return;
     }
   
     const formData = new FormData();
     formData.append('photo', photoData, 'tebessum.jpg');
     formData.append('userId', currentUser.userId);
   
     const btn = $('btnUpload');
     const progressTrack = $('progressTrack');
     const progressFill = $('progressFill');
     const progressPct = $('progressPct');
   
     btn.disabled = true;
     progressTrack.classList.remove('hidden');
   
     try {
       const xhr = new XMLHttpRequest();
   
       xhr.upload.addEventListener('progress', (e) => {
         if (e.lengthComputable) {
           const pct = Math.round((e.loaded / e.total) * 100);
           progressFill.style.width = pct + '%';
           progressPct.textContent = pct + '%';
         }
       });
   
       xhr.addEventListener('load', () => {
         const data = JSON.parse(xhr.responseText);
   
         // Günlük limit
         if (xhr.status === 400 && data.dailyLimitReached) {
           progressTrack.classList.add('hidden');
           btn.disabled = false;
           showLimitModal(currentUser?.currentStreak ?? 0);
           return;
         }
   
         // 1 saat bekleme (çift güvenlik — normalde kamera açılmadan yakalanır)
         if (xhr.status === 400 && data.waitRequired) {
           progressTrack.classList.add('hidden');
           btn.disabled = false;
           showWaitModal(data.waitSeconds ?? 3600);
           return;
         }
   
         if (xhr.status === 200 && data.success) {
           progressFill.style.width = '100%';
           progressPct.textContent = '100%';
   
           // Stat bar güncelle
           if (data.todayCount !== undefined) animateCounter($('statToday'), data.todayCount);
           if (data.totalCount !== undefined) animateCounter($('statTotal'), data.totalCount);
   
           // Puan güncelle
           if (data.totalPoints !== undefined) {
             currentUser.totalPoints = data.totalPoints;
             currentUser.currentStreak = data.currentStreak ?? currentUser.currentStreak;
             localStorage.setItem('sadaka_user', JSON.stringify(currentUser));
             updatePointsDisplay(data.totalPoints, data.currentStreak);
           }
   
           // Success modal
           $('modalTodayNum').textContent = data.todayCount ?? '—';
           $('modalTotalNum').textContent = data.totalCount ?? '—';
           $('modalPointsNum').textContent = data.totalPoints ?? '—';
   
           // Her yüklemede puan göster
           const earnedEl = $('modalPointsEarned');
           const earnedNum = $('modalPointsEarnedNum');
           if (data.pointsEarned > 0 && earnedEl) {
             earnedNum.textContent = `+${data.pointsEarned}`;
             earnedEl.classList.remove('hidden');
           } else if (earnedEl) {
             earnedEl.classList.add('hidden');
           }
   
           // Streak bilgisi
           const streakEl = $('modalStreak');
           const streakText = $('modalStreakText');
           if (data.currentStreak > 1 && streakEl) {
             streakText.textContent = `🔥 ${data.currentStreak} Günlük Serin Var!`;
             streakEl.classList.remove('hidden');
           } else if (streakEl) {
             streakEl.classList.add('hidden');
           }
   
           $('successModal').classList.remove('hidden');
   
           if (typeof confetti !== 'undefined') {
             confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
           }
         } else {
           showStatus(data.message || 'Yükleme başarısız.', 'error');
         }
   
         setTimeout(() => {
           progressTrack.classList.add('hidden');
           progressFill.style.width = '0%';
           progressPct.textContent = '0%';
         }, 1000);
       });
   
       xhr.addEventListener('error', () => {
         showStatus('Bağlantı hatası.', 'error');
         progressTrack.classList.add('hidden');
       });
   
       xhr.open('POST', '/Sadaka/Upload');
       xhr.send(formData);
     } catch {
       showStatus('Yükleme sırasında bir hata oluştu.', 'error');
       progressTrack.classList.add('hidden');
     }
   }
   
   window.doUpload = doUpload;
   
   function resetAll() {
     $('successModal').classList.add('hidden');
     stopCamera();
     photoData = null;
     CHECKBOXES.forEach(id => { if ($(id)) $(id).checked = false; });
     checkUploadReady();
   }
   window.resetAll = resetAll;
   
   /* ═══════════════════════════════════════════════════════════════
      STATS & COUNTERS
      ═══════════════════════════════════════════════════════════════ */
   function animateCounter(el, target) {
     if (!el) return;
     const start = parseInt(el.textContent) || 0;
     const startTime = performance.now();
     function update(now) {
       const progress = Math.min((now - startTime) / 800, 1);
       const easeOut = 1 - Math.pow(1 - progress, 3);
       el.textContent = Math.round(start + (target - start) * easeOut);
       if (progress < 1) requestAnimationFrame(update);
       else el.textContent = target;
     }
     requestAnimationFrame(update);
   }
   
   function animateCounters() {
     ['statToday', 'statTotal'].forEach(id => {
       const el = $(id);
       if (el) animateCounter(el, parseInt(el.dataset.target) || 0);
     });
   }
   
   /* ═══════════════════════════════════════════════════════════════
      SHARE
      ═══════════════════════════════════════════════════════════════ */
   function copyShareLink() {
     const url = window.location.href;
     const btn = $('btnShare');
     const orig = btn.innerHTML;
     navigator.clipboard.writeText(url)
       .then(() => { btn.innerHTML = '✅ Kopyalandı!'; setTimeout(() => { btn.innerHTML = orig; }, 2200); })
       .catch(() => { try { prompt('Bu linki kopyalayın:', url); } catch (_) {} });
   }
   window.copyShareLink = copyShareLink;
   
   /* ═══════════════════════════════════════════════════════════════
      UTILS
      ═══════════════════════════════════════════════════════════════ */
   function showStatus(msg, type = 'info') {
     const el = $('statusMsg');
     if (!el) return;
     el.textContent = msg;
     el.className = `status-msg ${type}`;
     el.classList.remove('hidden');
     if (type === 'success' || type === 'error') setTimeout(() => el.classList.add('hidden'), 4000);
   }
   
   /* ═══════════════════════════════════════════════════════════════
      INIT
      ═══════════════════════════════════════════════════════════════ */
   document.addEventListener('DOMContentLoaded', () => {
     initAuth();
     animateCounters();
     checkUploadReady();
   });