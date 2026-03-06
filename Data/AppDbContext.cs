using Microsoft.EntityFrameworkCore;
using GulumsemekSadakadir.Models;

namespace GulumsemekSadakadir.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users { get; set; }
    public DbSet<TebessumUpload> TebessumUploads { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.DisplayName).IsRequired().HasMaxLength(100);
            entity.Property(e => e.PinHash).IsRequired().HasMaxLength(255);
            entity.HasIndex(e => new { e.DisplayName, e.PinHash }).IsUnique();
        });

        modelBuilder.Entity<TebessumUpload>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ObjectKey).IsRequired().HasMaxLength(500);
            entity.HasOne(e => e.User)
                  .WithMany()
                  .HasForeignKey(e => e.UserId)
                  .OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.UserId, e.UploadedAtUtc });
        });
    }
}
