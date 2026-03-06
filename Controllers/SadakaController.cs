using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;
using GulumsemekSadakadir.Data;
using GulumsemekSadakadir.Models;
using BCrypt.Net;

namespace GulumsemekSadakadir.Controllers;

public class SadakaController : Controller
{
    private readonly AppDbContext _db;
    private readonly IMinioClient _minio;
    private readonly MinioSettings _minioSettings;
    private readonly ILogger<SadakaController> _logger;

    public SadakaController(
        AppDbContext db,
        IMinioClient minio,
        IOptions<MinioSettings> minioSettings,
        ILogger<SadakaController> logger)
    {
        _db = db;
        _minio = minio;
        _minioSettings = minioSettings.Value;
        _logger = logger;
    }

    [HttpGet("/")]
    [HttpGet("~/Sadaka")]
    [HttpGet("~/Sadaka/Index")]
    public async Task<IActionResult> Index()
    {
        var (todayCount, totalCount) = await GetTebessumCountsAsync();
        ViewBag.TodayCount = todayCount;
        ViewBag.TotalCount = totalCount;
        return View();
    }

    [HttpPost("~/Sadaka/Register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DisplayName) || string.IsNullOrWhiteSpace(req.Pin) || req.Pin.Length != 4)
            return BadRequest(new { success = false, message = "İsim ve 4 haneli PIN gereklidir." });

        var existing = await _db.Users
            .FirstOrDefaultAsync(u => u.DisplayName == req.DisplayName);

        if (existing != null && BCrypt.Net.BCrypt.Verify(req.Pin, existing.PinHash))
        {
            return Ok(new
            {
                success = true,
                userId = existing.Id,
                displayName = existing.DisplayName,
                totalPoints = existing.TotalPoints,
                currentStreak = existing.CurrentStreak,
                message = "Giriş yapıldı."
            });
        }

        var pinHash = BCrypt.Net.BCrypt.HashPassword(req.Pin);
        var user = new User
        {
            DisplayName = req.DisplayName,
            PinHash = pinHash,
            CreatedAtUtc = DateTime.UtcNow,
            TotalPoints = 0,
            CurrentStreak = 0,
            LastStreakDateUtc = null
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            userId = user.Id,
            displayName = user.DisplayName,
            totalPoints = user.TotalPoints,
            currentStreak = user.CurrentStreak,
            message = "Kayıt başarılı."
        });
    }

    [HttpPost("~/Sadaka/Login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DisplayName) || string.IsNullOrWhiteSpace(req.Pin))
            return BadRequest(new { success = false, message = "İsim ve PIN gereklidir." });

        var users = await _db.Users
            .Where(u => u.DisplayName == req.DisplayName)
            .ToListAsync();

        foreach (var user in users)
        {
            if (BCrypt.Net.BCrypt.Verify(req.Pin, user.PinHash))
            {
                return Ok(new
                {
                    success = true,
                    userId = user.Id,
                    displayName = user.DisplayName,
                    totalPoints = user.TotalPoints,
                    currentStreak = user.CurrentStreak
                });
            }
        }

        return Unauthorized(new { success = false, message = "İsim veya PIN hatalı." });
    }

    // ── Kamera açılmadan önce durum kontrolü ──────────────────────────────────
    [HttpGet("~/Sadaka/CheckStatus/{userId}")]
    public async Task<IActionResult> CheckStatus(int userId)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user == null)
            return NotFound(new { success = false });

        var now = DateTime.UtcNow;
        var todayStart = now.Date;

        // Son yükleme zamanı
        var lastUpload = await _db.TebessumUploads
            .Where(u => u.UserId == userId)
            .OrderByDescending(u => u.UploadedAtUtc)
            .FirstOrDefaultAsync();

        // Bugünkü yükleme sayısı
        var todayUserCount = await _db.TebessumUploads
            .CountAsync(u => u.UserId == userId && u.UploadedAtUtc >= todayStart);

        // 1 saat kontrolü
        int waitSeconds = 0;
        if (lastUpload != null)
        {
            var elapsed = now - lastUpload.UploadedAtUtc;
            if (elapsed.TotalSeconds < 3600)
                waitSeconds = (int)(3600 - elapsed.TotalSeconds);
        }

        return Ok(new
        {
            success = true,
            todayUserCount,
            dailyLimitReached = todayUserCount >= 3,
            waitSeconds,          // 0 ise bekleme yok
            totalPoints = user.TotalPoints,
            currentStreak = user.CurrentStreak
        });
    }

    [HttpPost("~/Sadaka/Upload")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile photo, [FromForm] int userId)
    {
        if (photo == null || photo.Length == 0)
            return BadRequest(new { success = false, message = "Fotoğraf bulunamadı." });

        if (photo.Length > 8 * 1024 * 1024)
            return BadRequest(new { success = false, message = "Dosya boyutu 8 MB'ı geçemez." });

        var allowed = new[] { "image/jpeg", "image/png", "image/webp" };
        if (!allowed.Contains(photo.ContentType.ToLower()))
            return BadRequest(new { success = false, message = "Sadece JPEG, PNG veya WebP yüklenebilir." });

        var user = await _db.Users.FindAsync(userId);
        if (user == null)
            return Unauthorized(new { success = false, message = "Geçersiz kullanıcı." });

        var now = DateTime.UtcNow;

        // 1 saat kontrolü
        var oneHourAgo = now.AddHours(-1);
        var recentCount = await _db.TebessumUploads
            .CountAsync(u => u.UserId == userId && u.UploadedAtUtc >= oneHourAgo);

        if (recentCount >= 1)
        {
            var lastUpload = await _db.TebessumUploads
                .Where(u => u.UserId == userId)
                .OrderByDescending(u => u.UploadedAtUtc)
                .FirstOrDefaultAsync();

            int waitSeconds = lastUpload != null
                ? Math.Max(0, (int)(3600 - (now - lastUpload.UploadedAtUtc).TotalSeconds))
                : 0;

            return BadRequest(new
            {
                success = false,
                waitRequired = true,
                waitSeconds,
                message = "Yüklemeler arasında en az 1 saat geçmelidir."
            });
        }

        // Günlük limit
        var todayStart = now.Date;
        var todayUserCount = await _db.TebessumUploads
            .CountAsync(u => u.UserId == userId && u.UploadedAtUtc >= todayStart);

        if (todayUserCount >= 3)
        {
            return BadRequest(new
            {
                success = false,
                dailyLimitReached = true,
                message = "Bugün en fazla 3 tebessüm yükleyebilirsin."
            });
        }

        try
        {
            var bucket = _minioSettings.Bucket;

            // Her kullanıcının fotoğrafları kendi klasöründe dursun:
            // users/{userId}/tebessum/yyyy/MM/dd/{guid}.jpg
            var objectKey = $"users/{userId}/tebessum/{now:yyyy/MM/dd}/{Guid.NewGuid()}.jpg";

            bool exists = await _minio.BucketExistsAsync(new BucketExistsArgs().WithBucket(bucket));
            if (!exists)
                await _minio.MakeBucketAsync(new MakeBucketArgs().WithBucket(bucket));

            await using var stream = photo.OpenReadStream();
            await _minio.PutObjectAsync(new PutObjectArgs()
                .WithBucket(bucket)
                .WithObject(objectKey)
                .WithStreamData(stream)
                .WithObjectSize(photo.Length)
                .WithContentType("image/jpeg"));

            var upload = new TebessumUpload
            {
                UserId = userId,
                ObjectKey = objectKey,
                UploadedAtUtc = now
            };
            _db.TebessumUploads.Add(upload);

            // ── Streak: günün İLK yüklemesinde güncelle ──────────────────
            bool isFirstUploadToday = todayUserCount == 0;
            if (isFirstUploadToday)
            {
                var yesterday = now.Date.AddDays(-1);
                bool streakContinues = user.LastStreakDateUtc.HasValue &&
                                       user.LastStreakDateUtc.Value.Date == yesterday;

                user.CurrentStreak = streakContinues ? user.CurrentStreak + 1 : 1;
                user.LastStreakDateUtc = now.Date;
            }

            // ── Her yüklemede puan kazan ─────────────────────────────────
            double multiplier = user.CurrentStreak switch
            {
                1 => 1.0,
                2 => 1.5,
                3 => 2.0,
                4 => 2.5,
                _ => 3.0
            };

            int pointsEarned = (int)Math.Round(1 * multiplier); // 1 base puan × katsayı
            user.TotalPoints += pointsEarned;

            await _db.SaveChangesAsync();

            var (todayTotal, totalTotal) = await GetTebessumCountsAsync();
            int newTodayUserCount = todayUserCount + 1;

            _logger.LogInformation(
                "Tebessüm yüklendi: {Key} (User: {UserId}, Streak: {Streak}, +{Points} puan)",
                objectKey, userId, user.CurrentStreak, pointsEarned);

            return Ok(new
            {
                success = true,
                message = "Tebessümün yüklendi, sadakan kabul olsun!",
                todayCount = todayTotal,
                totalCount = totalTotal,
                userTodayCount = newTodayUserCount,
                pointsEarned,
                totalPoints = user.TotalPoints,
                currentStreak = user.CurrentStreak,
                multiplier
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "MinIO upload failed");
            return StatusCode(500, new { success = false, message = "Yükleme sırasında bir hata oluştu." });
        }
    }

    [HttpGet("~/Sadaka/Stats")]
    public async Task<IActionResult> Stats()
    {
        var (todayCount, totalCount) = await GetTebessumCountsAsync();
        return Ok(new { todayCount, totalCount });
    }

    [HttpGet("~/Sadaka/UserStats/{userId}")]
    public async Task<IActionResult> UserStats(int userId)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user == null)
            return NotFound(new { success = false });

        var todayStart = DateTime.UtcNow.Date;
        var todayUserCount = await _db.TebessumUploads
            .CountAsync(u => u.UserId == userId && u.UploadedAtUtc >= todayStart);

        return Ok(new
        {
            totalPoints = user.TotalPoints,
            currentStreak = user.CurrentStreak,
            todayUserCount
        });
    }

    // ── Migration: Eski kayıtları yeni klasör yapısına taşı ─────────────────────
    [HttpPost("~/Sadaka/MigrateOldUploads")]
    [HttpGet("~/Sadaka/MigrateOldUploads")] // Test için GET de ekledik
    public async Task<IActionResult> MigrateOldUploads()
    {
        try
        {
            var bucket = _minioSettings.Bucket;
            
            // Eski formattaki kayıtları bul (users/ ile başlamayanlar)
            var oldUploads = await _db.TebessumUploads
                .Where(u => !u.ObjectKey.StartsWith("users/"))
                .ToListAsync();

            if (oldUploads.Count == 0)
            {
                return Ok(new
                {
                    success = true,
                    message = "Taşınacak eski kayıt bulunamadı.",
                    migrated = 0,
                    failed = 0
                });
            }

            int migrated = 0;
            int failed = 0;
            var errors = new List<string>();

            foreach (var upload in oldUploads)
            {
                try
                {
                    var oldKey = upload.ObjectKey;
                    var newKey = $"users/{upload.UserId}/tebessum/{upload.UploadedAtUtc:yyyy/MM/dd}/{Guid.NewGuid()}.jpg";

                    // MinIO'dan eski dosyayı oku
                    using var memoryStream = new MemoryStream();
                    await _minio.GetObjectAsync(new GetObjectArgs()
                        .WithBucket(bucket)
                        .WithObject(oldKey)
                        .WithCallbackStream(stream =>
                        {
                            stream.CopyTo(memoryStream);
                        }));

                    memoryStream.Position = 0;

                    // Yeni konuma yaz
                    await _minio.PutObjectAsync(new PutObjectArgs()
                        .WithBucket(bucket)
                        .WithObject(newKey)
                        .WithStreamData(memoryStream)
                        .WithObjectSize(memoryStream.Length)
                        .WithContentType("image/jpeg"));

                    // Veritabanını güncelle
                    upload.ObjectKey = newKey;
                    await _db.SaveChangesAsync();

                    // Eski dosyayı sil
                    try
                    {
                        await _minio.RemoveObjectAsync(new RemoveObjectArgs()
                            .WithBucket(bucket)
                            .WithObject(oldKey));
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Eski dosya silinemedi: {OldKey}", oldKey);
                        // Silinmese bile devam et, sadece logla
                    }

                    migrated++;
                    _logger.LogInformation("Kayıt taşındı: {OldKey} -> {NewKey}", oldKey, newKey);
                }
                catch (Exception ex)
                {
                    failed++;
                    var errorMsg = $"Upload ID {upload.Id} taşınamadı: {ex.Message}";
                    errors.Add(errorMsg);
                    _logger.LogError(ex, "Migration hatası: Upload ID {UploadId}", upload.Id);
                }
            }

            return Ok(new
            {
                success = true,
                message = $"Migration tamamlandı. {migrated} kayıt taşındı, {failed} kayıt başarısız.",
                migrated,
                failed,
                total = oldUploads.Count,
                errors = errors.Take(10).ToList() // İlk 10 hatayı göster
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Migration genel hatası");
            return StatusCode(500, new
            {
                success = false,
                message = "Migration sırasında bir hata oluştu.",
                error = ex.Message
            });
        }
    }

    private async Task<(int todayCount, int totalCount)> GetTebessumCountsAsync()
    {
        var todayStart = DateTime.UtcNow.Date;
        var todayCount = await _db.TebessumUploads.CountAsync(u => u.UploadedAtUtc >= todayStart);
        var totalCount = await _db.TebessumUploads.CountAsync();
        return (todayCount, totalCount);
    }
}

public class RegisterRequest
{
    public string DisplayName { get; set; } = string.Empty;
    public string Pin { get; set; } = string.Empty;
}

public class LoginRequest
{
    public string DisplayName { get; set; } = string.Empty;
    public string Pin { get; set; } = string.Empty;
}