namespace GulumsemekSadakadir.Models;

public class User
{
    public int Id { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public string PinHash { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    // ═══════════════════════════════════════════════════════════════
    public int TotalPoints { get; set; } = 0;
    public int CurrentStreak { get; set; } = 0;
    public DateTime? LastStreakDateUtc { get; set; }
}
