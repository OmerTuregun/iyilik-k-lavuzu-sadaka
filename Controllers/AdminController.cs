using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Minio;
using Minio.DataModel.Args;
using GulumsemekSadakadir.Data;
using GulumsemekSadakadir.Models;

namespace GulumsemekSadakadir.Controllers;

public class AdminController : Controller
{
    private readonly AppDbContext _db;
    private readonly IMinioClient _minio;
    private readonly MinioSettings _minioSettings;
    private readonly IConfiguration _config;
    private readonly ILogger<AdminController> _logger;

    public AdminController(
        AppDbContext db,
        IMinioClient minio,
        IOptions<MinioSettings> minioSettings,
        IConfiguration config,
        ILogger<AdminController> logger)
    {
        _db = db;
        _minio = minio;
        _minioSettings = minioSettings.Value;
        _config = config;
        _logger = logger;
    }

    private bool IsAdminAuthenticated() =>
        HttpContext.Session.GetString("admin_auth") == "true";

    [HttpGet("~/user-admin")]
    public IActionResult Index()
    {
        if (!IsAdminAuthenticated()) return View("Login");
        return View("Index");
    }

    [HttpGet("~/user-admin/login")]
    public IActionResult Login() => View("Login");

    [HttpPost("~/user-admin/login")]
    public IActionResult DoLogin([FromBody] AdminLoginRequest req)
    {
        var adminPassword = _config["Admin:Password"] ?? "";
        if (string.IsNullOrEmpty(adminPassword))
            return StatusCode(500, new { success = false, message = "Admin şifresi yapılandırılmamış." });
        if (req.Password != adminPassword)
            return Unauthorized(new { success = false, message = "Şifre hatalı." });
        HttpContext.Session.SetString("admin_auth", "true");
        return Ok(new { success = true });
    }

    [HttpPost("~/user-admin/logout")]
    public IActionResult Logout()
    {
        HttpContext.Session.Remove("admin_auth");
        return Ok(new { success = true });
    }

    [HttpGet("~/user-admin/stats")]
    public async Task<IActionResult> Stats()
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        var todayStart = DateTime.UtcNow.Date;
        var totalUploads = await _db.TebessumUploads.CountAsync();
        var todayUploads = await _db.TebessumUploads.CountAsync(u => u.UploadedAtUtc >= todayStart);
        var totalUsers   = await _db.Users.CountAsync();
        var totalPoints  = await _db.Users.SumAsync(u => u.TotalPoints);
        var lastUpload   = await _db.TebessumUploads
            .OrderByDescending(u => u.UploadedAtUtc)
            .Select(u => (DateTime?)u.UploadedAtUtc)
            .FirstOrDefaultAsync();
        return Ok(new { totalUploads, todayUploads, totalUsers, totalPoints, lastUpload });
    }

    [HttpGet("~/user-admin/users")]
    public async Task<IActionResult> Users()
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        var users = await _db.Users
            .Select(u => new {
                u.Id, u.DisplayName, u.TotalPoints, u.CurrentStreak,
                u.CreatedAtUtc, u.LastStreakDateUtc,
                UploadCount = _db.TebessumUploads.Count(t => t.UserId == u.Id)
            })
            .OrderByDescending(u => u.TotalPoints)
            .ToListAsync();
        return Ok(users);
    }

    [HttpGet("~/user-admin/user-uploads/{userId}")]
    public async Task<IActionResult> UserUploads(int userId)
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        var uploads = await _db.TebessumUploads
            .Where(u => u.UserId == userId)
            .OrderByDescending(u => u.UploadedAtUtc)
            .Select(u => new { u.Id, u.ObjectKey, u.UploadedAtUtc })
            .ToListAsync();
        return Ok(uploads);
    }

    [HttpPatch("~/user-admin/user/{userId}/points")]
    public async Task<IActionResult> UpdatePoints(int userId, [FromBody] UpdatePointsRequest req)
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        var user = await _db.Users.FindAsync(userId);
        if (user == null) return NotFound();
        user.TotalPoints = req.Points;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, totalPoints = user.TotalPoints });
    }

    [HttpPatch("~/user-admin/user/{userId}/streak-reset")]
    public async Task<IActionResult> ResetStreak(int userId)
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        var user = await _db.Users.FindAsync(userId);
        if (user == null) return NotFound();
        user.CurrentStreak = 0;
        user.LastStreakDateUtc = null;
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpDelete("~/user-admin/user/{userId}")]
    public async Task<IActionResult> DeleteUser(int userId)
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        var user = await _db.Users.FindAsync(userId);
        if (user == null) return NotFound();
        var uploads = await _db.TebessumUploads.Where(u => u.UserId == userId).ToListAsync();
        foreach (var upload in uploads)
        {
            try { await _minio.RemoveObjectAsync(new RemoveObjectArgs().WithBucket(_minioSettings.Bucket).WithObject(upload.ObjectKey)); } catch { }
        }
        _db.TebessumUploads.RemoveRange(uploads);
        _db.Users.Remove(user);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpGet("~/user-admin/photos")]
    public async Task<IActionResult> Photos([FromQuery] int page = 1, [FromQuery] int pageSize = 24)
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        var total = await _db.TebessumUploads.CountAsync();
        var uploads = await _db.TebessumUploads
            .OrderByDescending(u => u.UploadedAtUtc)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Join(_db.Users, u => u.UserId, usr => usr.Id,
                (u, usr) => new { u.Id, u.ObjectKey, u.UploadedAtUtc, u.UserId, DisplayName = usr.DisplayName })
            .ToListAsync();

        var result = new List<object>();
        foreach (var u in uploads)
        {
            try
            {
                var url = await _minio.PresignedGetObjectAsync(
                    new PresignedGetObjectArgs().WithBucket(_minioSettings.Bucket).WithObject(u.ObjectKey).WithExpiry(3600));
                result.Add(new { u.Id, u.ObjectKey, u.UploadedAtUtc, u.UserId, u.DisplayName, Url = url });
            }
            catch
            {
                result.Add(new { u.Id, u.ObjectKey, u.UploadedAtUtc, u.UserId, u.DisplayName, Url = (string?)null });
            }
        }
        return Ok(new { total, page, pageSize, items = result });
    }

    [HttpDelete("~/user-admin/photo/{id}")]
    public async Task<IActionResult> DeletePhoto(int id)
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        var upload = await _db.TebessumUploads.FindAsync(id);
        if (upload == null) return NotFound();
        try { await _minio.RemoveObjectAsync(new RemoveObjectArgs().WithBucket(_minioSettings.Bucket).WithObject(upload.ObjectKey)); } catch { }
        _db.TebessumUploads.Remove(upload);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpDelete("~/user-admin/photos/bulk")]
    public async Task<IActionResult> DeletePhotosBulk([FromBody] BulkDeleteRequest req)
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        if (req.Ids == null || req.Ids.Count == 0) return BadRequest();
        var uploads = await _db.TebessumUploads.Where(u => req.Ids.Contains(u.Id)).ToListAsync();
        foreach (var upload in uploads)
        {
            try { await _minio.RemoveObjectAsync(new RemoveObjectArgs().WithBucket(_minioSettings.Bucket).WithObject(upload.ObjectKey)); } catch { }
        }
        _db.TebessumUploads.RemoveRange(uploads);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, deleted = uploads.Count });
    }

    [HttpGet("~/user-admin/photo-url/{id}")]
    public async Task<IActionResult> PhotoUrl(int id)
    {
        if (!IsAdminAuthenticated()) return Unauthorized();
        var upload = await _db.TebessumUploads.FindAsync(id);
        if (upload == null) return NotFound();
        var url = await _minio.PresignedGetObjectAsync(
            new PresignedGetObjectArgs().WithBucket(_minioSettings.Bucket).WithObject(upload.ObjectKey).WithExpiry(300));
        return Ok(new { url });
    }
}

public class AdminLoginRequest   { public string Password { get; set; } = ""; }
public class UpdatePointsRequest { public int Points { get; set; } }
public class BulkDeleteRequest   { public List<int> Ids { get; set; } = new(); }