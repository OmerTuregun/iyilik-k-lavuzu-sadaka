using Microsoft.AspNetCore.Mvc;
using Minio;
using Minio.DataModel.Args;

namespace GulumsemekSadakadir.Controllers
{
    public class SadakaController : Controller
    {
        private readonly IMinioClient _minio;
        private readonly IConfiguration _config;
        private readonly ILogger<SadakaController> _logger;

        public SadakaController(IMinioClient minio, IConfiguration config, ILogger<SadakaController> logger)
        {
            _minio  = minio;
            _config = config;
            _logger = logger;
        }

        // GET /
        [HttpGet("/")]
        // GET /Sadaka
        [HttpGet("~/Sadaka")]
        // GET /Sadaka/Index
        [HttpGet("~/Sadaka/Index")]
        public async Task<IActionResult> Index()
        {
            var bucket = _config["MINIO_BUCKET_NAME"] ?? "sadaka";
            var (todayCount, totalCount) = await GetSmileCountsAsync(bucket);

            ViewBag.TodayCount = todayCount;
            ViewBag.TotalCount = totalCount;

            return View();
        }

        // POST /Sadaka/Upload
        [HttpPost]
        [RequestSizeLimit(10 * 1024 * 1024)] // 10 MB
        public async Task<IActionResult> Upload(IFormFile photo)
        {
            if (photo == null || photo.Length == 0)
                return BadRequest(new { success = false, message = "Fotoğraf bulunamadı." });

            if (photo.Length > 8 * 1024 * 1024)
                return BadRequest(new { success = false, message = "Dosya boyutu 8 MB'ı geçemez." });

            var allowed = new[] { "image/jpeg", "image/png", "image/webp" };
            if (!allowed.Contains(photo.ContentType.ToLower()))
                return BadRequest(new { success = false, message = "Sadece JPEG, PNG veya WebP yüklenebilir." });

            try
            {
                var bucket    = _config["MINIO_BUCKET_NAME"] ?? "sadaka";
                var objectKey = $"smiles/{DateTime.UtcNow:yyyy/MM/dd}/{Guid.NewGuid()}.jpg";

                // Bucket yoksa oluştur
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

                // Sayaçları MinIO üzerinden güncel olarak oku
                var (todayCount, totalCount) = await GetSmileCountsAsync(bucket);

                _logger.LogInformation("Smile uploaded: {Key}", objectKey);

                return Ok(new
                {
                    success    = true,
                    message    = "Gülümsemen yüklendi, sadakan kabul olsun!",
                    todayCount,
                    totalCount
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MinIO upload failed");
                return StatusCode(500, new { success = false, message = "Yükleme sırasında bir hata oluştu." });
            }
        }

        // GET /Sadaka/Stats  — counter strip için JSON endpoint
        [HttpGet]
        public async Task<IActionResult> Stats()
        {
            var bucket = _config["MINIO_BUCKET_NAME"] ?? "sadaka";
            var (todayCount, totalCount) = await GetSmileCountsAsync(bucket);
            return Ok(new { todayCount, totalCount });
        }

        /// <summary>
        /// MinIO'daki tüm gülümseme objelerini sayar.
        /// </summary>
        private Task<(int todayCount, int totalCount)> GetSmileCountsAsync(string bucket)
        {
            int total = 0;
            int today = 0;

            var tcs = new TaskCompletionSource<(int todayCount, int totalCount)>();
            var todayPrefix = $"smiles/{DateTime.UtcNow:yyyy/MM/dd}/";

            var observable = _minio.ListObjectsAsync(
                new ListObjectsArgs()
                    .WithBucket(bucket)
                    .WithPrefix("smiles/")
                    .WithRecursive(true));

            observable.Subscribe(
                item =>
                {
                    total++;
                    if (!string.IsNullOrEmpty(item.Key) &&
                        item.Key.StartsWith(todayPrefix, StringComparison.Ordinal))
                    {
                        today++;
                    }
                },
                ex => tcs.SetException(ex),
                () => tcs.SetResult((today, total))
            );

            return tcs.Task;
        }
    }
}
