using Minio;

var builder = WebApplication.CreateBuilder(args);

// ── MVC ──
builder.Services.AddControllersWithViews();

// ── MinIO ──
builder.Services.AddMinio(client =>
{
    var endpoint  = builder.Configuration["MINIO_ENDPOINT"]      ?? "localhost:9000";
    var accessKey = builder.Configuration["MINIO_ROOT_USER"]      ?? "minioadmin";
    var secretKey = builder.Configuration["MINIO_ROOT_PASSWORD"]  ?? "minioadmin";

    // Protocol prefix varsa çıkar, MinIO client kendi yönetiyor
    var host = endpoint.Replace("http://", "").Replace("https://", "");
    bool useSsl = endpoint.StartsWith("https://");

    client
        .WithEndpoint(host)
        .WithCredentials(accessKey, secretKey)
        .WithSSL(useSsl)
        .Build();
});

var app = builder.Build();

// ── Middleware ──
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseAuthorization();

// Ana route → SadakaController
app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Sadaka}/{action=Index}/{id?}");

app.Run();
