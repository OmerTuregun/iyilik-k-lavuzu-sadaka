using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Minio;
using GulumsemekSadakadir.Data;
using Pomelo.EntityFrameworkCore.MySql.Infrastructure;
using Microsoft.Extensions.Logging;

var builder = WebApplication.CreateBuilder(args);

// MVC
builder.Services.AddControllersWithViews();

// MySQL
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, new MySqlServerVersion(new Version(8, 0, 21)),
        mySqlOptions => mySqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(30),
            errorNumbersToAdd: null)));

// MinIO
builder.Services.Configure<MinioSettings>(
    builder.Configuration.GetSection("Minio"));

builder.Services.AddSingleton<IMinioClient>(sp =>
{
    var options = sp.GetRequiredService<IOptions<MinioSettings>>().Value;
    return new MinioClient()
        .WithEndpoint(options.Endpoint)
        .WithCredentials(options.AccessKey, options.SecretKey)
        .Build();
});

var app = builder.Build();

// MySQL hazır olana kadar bekle, sonra migration uygula
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    var maxRetries = 10;
    var retryDelay = TimeSpan.FromSeconds(5);

    for (int i = 0; i < maxRetries; i++)
    {
        try
        {
            // Migrate hem tabloları oluşturur hem de bekleyen migration'ları uygular.
            // EnsureCreated() KULLANMA — Migrate() ile çakışır.
            db.Database.Migrate();
            logger.LogInformation("Database migration successful.");
            break;
        }
        catch (Exception ex)
        {
            if (i == maxRetries - 1)
            {
                logger.LogError(ex, "Failed to connect to database after {Retries} attempts.", maxRetries);
                throw;
            }
            logger.LogWarning(
                "Database not ready. Retrying in {Delay}s... ({Attempt}/{MaxRetries})",
                retryDelay.TotalSeconds, i + 1, maxRetries);
            Thread.Sleep(retryDelay);
        }
    }
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();
app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Sadaka}/{action=Index}/{id?}");

app.Run();

public class MinioSettings
{
    public string Endpoint { get; set; } = string.Empty;
    public string AccessKey { get; set; } = string.Empty;
    public string SecretKey { get; set; } = string.Empty;
    public string Bucket { get; set; } = "sadaka-photos";
}