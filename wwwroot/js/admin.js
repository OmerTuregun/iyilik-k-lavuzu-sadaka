/* ═══════════════════════════════════════════════════════
   ADMIN PANEL JS — Tebessüm Sadakadır
   ═══════════════════════════════════════════════════════ */

   let currentPhotoPage = 1;
   let selectedPhotos = new Set();
   let activeUserId = null;
   let lightboxPhotoId = null;
   
   /* ── TABS ── */
   document.querySelectorAll('.nav-item').forEach(btn => {
     btn.addEventListener('click', () => {
       document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
       document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
       btn.classList.add('active');
       const tab = document.getElementById('tab-' + btn.dataset.tab);
       if (tab) tab.classList.add('active');
       if (btn.dataset.tab === 'overview') loadOverview();
       if (btn.dataset.tab === 'users')    loadUsers();
       if (btn.dataset.tab === 'photos')   loadPhotos(1);
     });
   });
   
   /* ── LOGOUT ── */
   document.getElementById('btnLogout').addEventListener('click', async () => {
     await fetch('/user-admin/logout', { method: 'POST' });
     window.location.href = '/user-admin/login';
   });
   
   /* ── TOAST ── */
   function toast(msg, type = 'ok') {
     const el = document.createElement('div');
     el.className = 'toast' + (type === 'error' ? ' error' : '');
     el.textContent = msg;
     document.body.appendChild(el);
     setTimeout(() => el.remove(), 3000);
   }
   
   /* ── OVERVIEW ── */
   async function loadOverview() {
     try {
       const res = await fetch('/user-admin/stats');
       if (!res.ok) { if (res.status === 401) redirect(); return; }
       const d = await res.json();
       document.getElementById('ov-totalUploads').textContent = d.totalUploads ?? '—';
       document.getElementById('ov-todayUploads').textContent = d.todayUploads ?? '—';
       document.getElementById('ov-totalUsers').textContent   = d.totalUsers ?? '—';
       document.getElementById('ov-totalPoints').textContent  = d.totalPoints ?? '—';
       document.getElementById('ov-lastUpload').textContent   = d.lastUpload
         ? new Date(d.lastUpload).toLocaleString('tr-TR') : '—';
     } catch { toast('Veri alınamadı.', 'error'); }
   }
   
   /* ── USERS ── */
   async function loadUsers() {
     try {
       const res = await fetch('/user-admin/users');
       if (!res.ok) { if (res.status === 401) redirect(); return; }
       const users = await res.json();
       const tbody = document.getElementById('usersTbody');
       if (!users.length) {
         tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px">Kullanıcı yok</td></tr>';
         return;
       }
       tbody.innerHTML = users.map(u => `
         <tr>
           <td style="color:var(--text-muted)">#${u.id}</td>
           <td><strong>${esc(u.displayName)}</strong></td>
           <td><span style="color:var(--gold);font-weight:600">⭐ ${u.totalPoints}</span></td>
           <td><span class="badge-streak">🔥 ${u.currentStreak}</span></td>
           <td>${u.uploadCount}</td>
           <td style="color:var(--text-muted);font-size:12px">${u.lastStreakDateUtc ? new Date(u.lastStreakDateUtc).toLocaleDateString('tr-TR') : '—'}</td>
           <td><button class="btn-detail" onclick="openUserModal(${u.id}, '${esc(u.displayName)}', ${u.totalPoints})">Yönet</button></td>
         </tr>
       `).join('');
     } catch { toast('Kullanıcılar alınamadı.', 'error'); }
   }
   
   /* ── USER MODAL ── */
   function openUserModal(userId, name, points) {
     activeUserId = userId;
     document.getElementById('modalUserName').textContent = name;
     document.getElementById('editPoints').value = points;
     document.getElementById('uploadHistory').innerHTML = '<div style="color:var(--text-muted);font-size:12px">Yükleniyor...</div>';
     document.getElementById('userModal').classList.remove('hidden');
     loadUserUploads(userId);
   }
   
   function closeUserModal() {
     document.getElementById('userModal').classList.add('hidden');
     activeUserId = null;
   }
   
   async function loadUserUploads(userId) {
     try {
       const res = await fetch(`/user-admin/user-uploads/${userId}`);
       const uploads = await res.json();
       const el = document.getElementById('uploadHistory');
       if (!uploads.length) {
         el.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Henüz yükleme yok.</div>';
         return;
       }
       el.innerHTML = uploads.map(u => `
         <div class="upload-item">
           <span>#${u.id} — ${u.objectKey.split('/').pop()}</span>
           <span>${new Date(u.uploadedAtUtc).toLocaleString('tr-TR')}</span>
         </div>
       `).join('');
     } catch { document.getElementById('uploadHistory').innerHTML = '<div style="color:#e88">Yüklenemedi.</div>'; }
   }
   
   async function savePoints() {
     if (!activeUserId) return;
     const pts = parseInt(document.getElementById('editPoints').value);
     if (isNaN(pts) || pts < 0) { toast('Geçersiz puan.', 'error'); return; }
     try {
       const res = await fetch(`/user-admin/user/${activeUserId}/points`, {
         method: 'PATCH',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ points: pts })
       });
       if (res.ok) { toast('Puan güncellendi ✓'); loadUsers(); }
       else toast('Hata oluştu.', 'error');
     } catch { toast('Bağlantı hatası.', 'error'); }
   }
   
   async function resetStreak() {
     if (!activeUserId) return;
     if (!confirm('Streak sıfırlansın mı?')) return;
     try {
       const res = await fetch(`/user-admin/user/${activeUserId}/streak-reset`, { method: 'PATCH' });
       if (res.ok) { toast('Streak sıfırlandı ✓'); loadUsers(); }
       else toast('Hata oluştu.', 'error');
     } catch { toast('Bağlantı hatası.', 'error'); }
   }
   
   async function deleteUser() {
     if (!activeUserId) return;
     if (!confirm('Bu kullanıcı ve tüm yüklemeleri silinecek. Emin misin?')) return;
     try {
       const res = await fetch(`/user-admin/user/${activeUserId}`, { method: 'DELETE' });
       if (res.ok) { toast('Kullanıcı silindi ✓'); closeUserModal(); loadUsers(); }
       else toast('Hata oluştu.', 'error');
     } catch { toast('Bağlantı hatası.', 'error'); }
   }
   
   window.openUserModal  = openUserModal;
   window.closeUserModal = closeUserModal;
   window.savePoints     = savePoints;
   window.resetStreak    = resetStreak;
   window.deleteUser     = deleteUser;
   
   /* ── PHOTOS ── */
   async function loadPhotos(page = 1) {
     currentPhotoPage = page;
     selectedPhotos.clear();
     updateBulkBtn();
   
     try {
       const res = await fetch(`/user-admin/photos?page=${page}&pageSize=24`);
       if (!res.ok) { if (res.status === 401) redirect(); return; }
       const data = await res.json();
   
       const grid = document.getElementById('photoGrid');
       if (!data.items.length) {
         grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🖼️</div><p>Henüz fotoğraf yok.</p></div>';
         document.getElementById('pagination').innerHTML = '';
         return;
       }
   
       grid.innerHTML = data.items.map(p => `
         <div class="photo-item" id="photo-${p.id}" onclick="toggleSelect(event, ${p.id}, this)">
           <div class="photo-check" id="check-${p.id}">✓</div>
           ${p.url
             ? `<img src="${p.url}" alt="Tebessüm" loading="lazy" onerror="this.parentElement.querySelector('.photo-broken').style.display='flex';this.style.display='none'" onclick="openLightbox(event, ${p.id}, '${p.url}', '${esc(p.displayName)}', '${new Date(p.uploadedAtUtc).toLocaleString('tr-TR')}')"/>`
             : ''}
           <div class="photo-broken" style="display:none">📷</div>
           <div class="photo-meta">
             <div class="photo-user">${esc(p.displayName)}</div>
             <div>${new Date(p.uploadedAtUtc).toLocaleDateString('tr-TR')}</div>
           </div>
         </div>
       `).join('');
   
       // Pagination
       const totalPages = Math.ceil(data.total / data.pageSize);
       const pag = document.getElementById('pagination');
       if (totalPages <= 1) { pag.innerHTML = ''; return; }
       let html = '';
       for (let i = 1; i <= totalPages; i++) {
         html += `<button class="page-btn${i === page ? ' active' : ''}" onclick="loadPhotos(${i})">${i}</button>`;
       }
       pag.innerHTML = html;
     } catch { toast('Fotoğraflar alınamadı.', 'error'); }
   }
   
   function toggleSelect(e, id, el) {
     // Img click → lightbox, div click → select
     if (e.target.tagName === 'IMG') return;
     if (selectedPhotos.has(id)) { selectedPhotos.delete(id); el.classList.remove('selected'); }
     else { selectedPhotos.add(id); el.classList.add('selected'); }
     updateBulkBtn();
   }
   
   function updateBulkBtn() {
     const btn = document.getElementById('btnBulkDelete');
     if (selectedPhotos.size > 0) {
       btn.style.display = 'inline-block';
       btn.textContent = `🗑 Seçilenleri Sil (${selectedPhotos.size})`;
     } else {
       btn.style.display = 'none';
     }
   }
   
   async function bulkDelete() {
     if (!selectedPhotos.size) return;
     if (!confirm(`${selectedPhotos.size} fotoğraf silinecek. Emin misin?`)) return;
     try {
       const res = await fetch('/user-admin/photos/bulk', {
         method: 'DELETE',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ ids: [...selectedPhotos] })
       });
       const d = await res.json();
       if (res.ok) { toast(`${d.deleted} fotoğraf silindi ✓`); loadPhotos(currentPhotoPage); }
       else toast('Hata oluştu.', 'error');
     } catch { toast('Bağlantı hatası.', 'error'); }
   }
   
   window.loadPhotos  = loadPhotos;
   window.toggleSelect = toggleSelect;
   window.bulkDelete  = bulkDelete;
   
   /* ── LIGHTBOX ── */
   function openLightbox(e, id, url, user, date) {
     e.stopPropagation();
     lightboxPhotoId = id;
     document.getElementById('lightboxImg').src = url;
     document.getElementById('lightboxMeta').textContent = `${user} — ${date}`;
     document.getElementById('lightboxDownload').href = url;
   
     document.getElementById('lightboxDelete').onclick = async () => {
       if (!confirm('Bu fotoğraf silinsin mi?')) return;
       const res = await fetch(`/user-admin/photo/${id}`, { method: 'DELETE' });
       if (res.ok) { toast('Fotoğraf silindi ✓'); closeLightbox(); loadPhotos(currentPhotoPage); }
       else toast('Hata oluştu.', 'error');
     };
   
     document.getElementById('lightbox').classList.remove('hidden');
   }
   
   function closeLightbox() {
     document.getElementById('lightbox').classList.add('hidden');
     lightboxPhotoId = null;
   }
   
   window.openLightbox  = openLightbox;
   window.closeLightbox = closeLightbox;
   
   /* ── HELPERS ── */
   function esc(str) {
     return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
   }
   
   function redirect() { window.location.href = '/user-admin/login'; }
   
   /* ── INIT ── */
   loadOverview();