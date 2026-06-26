const BingWallpaperFetcher = require("../src/index");

describe("BingWallpaperFetcher", () => {
  let fetcher;

  beforeEach(() => {
    fetcher = new BingWallpaperFetcher();
  });

  describe("processSingleWallpaperData()", () => {
    /**
     * 测试必应 API 返回数据到标准格式的转换
     * 验证日期格式化、字段映射等核心逻辑
     */
    it("应该正确处理壁纸数据并返回标准格式", () => {
      const mockImageData = {
        startdate: "20251223",
        title: "测试标题",
        copyright: "测试版权 (© Test Author)",
        copyrightlink: "https://example.com/search?q=test",
        url: "https://example.com/image.jpg",
        displayUrl: "https://example.com/display.jpg",
        downloadUrl4k: "https://example.com/4k.jpg",
      };

      const result = fetcher.processSingleWallpaperData(mockImageData);

      // 验证日期处理（API 返回的 startdate + 1 天）
      expect(result.date).toBe("2025-12-24");
      expect(result.year).toBe("2025");
      expect(result.month).toBe("12");
      expect(result.monthName).toBe("2025-12");

      // 验证基本信息
      expect(result.title).toBe("测试标题");
      expect(result.copyright).toBe("测试版权 (© Test Author)");

      // 验证描述（应该是 Markdown 链接格式）
      expect(result.description).toBe("[测试版权 (© Test Author)](https://example.com/search?q=test)");

      // 验证图片 URL
      expect(result.imageUrl).toBe("https://example.com/display.jpg");
      expect(result.downloadUrl4k).toBe("https://example.com/4k.jpg");
    });

    it("当没有版权链接时，应该使用版权文本作为描述", () => {
      const mockImageData = {
        startdate: "20251223",
        title: "无链接标题",
        copyright: "纯文本版权信息",
        url: "https://example.com/image.jpg",
        displayUrl: "https://example.com/display.jpg",
        downloadUrl4k: "https://example.com/4k.jpg",
      };

      const result = fetcher.processSingleWallpaperData(mockImageData);

      expect(result.description).toBe("纯文本版权信息");
    });
  });

  describe("generateWallpaperMarkdown()", () => {
    /**
     * 测试 Markdown 内容生成
     * 确保生成的格式符合预期
     */
    it("应该生成正确格式的 Markdown 内容", () => {
      const wallpaperData = {
        date: "2025-12-24",
        title: "圣诞快乐",
        description: "[圣诞快乐](https://example.com)",
        imageUrl: "https://example.com/christmas.jpg",
        downloadUrl4k: "https://example.com/christmas_4k.jpg",
      };

      const result = fetcher.generateWallpaperMarkdown(wallpaperData);

      // 验证包含必要的 Markdown 元素
      expect(result).toContain("## 2025-12-24");
      expect(result).toContain("**圣诞快乐**");
      expect(result).toContain("![圣诞快乐](https://example.com/christmas.jpg)");
      expect(result).toContain("[圣诞快乐](https://example.com)");
      expect(result).toContain("下载 4K 高清版本");
      expect(result).toContain("---"); // 分隔线
    });
  });

  describe("extractWallpaperInfo()", () => {
    it("应该从有效的 Markdown section 中提取壁纸信息", () => {
      const validSection = `2025-12-24

**圣诞快乐**

![圣诞快乐](https://example.com/christmas.jpg)

[圣诞快乐](https://example.com)

🔗 <a href="https://example.com/4k.jpg" target="_blank">下载 4K 高清版本</a>

---`;

      const result = fetcher.extractWallpaperInfo(validSection);

      expect(result).not.toBeNull();
      expect(result.date).toBe("2025-12-24");
      expect(result.title).toBe("圣诞快乐");
      expect(result.imageUrl).toBe("https://example.com/christmas.jpg");
      expect(result.downloadUrl4k).toBe("https://example.com/4k.jpg");
    });

    it("当缺少必要元素时应该返回 null", () => {
      const invalidSection = `2025-12-24\n\n没有有效内容`;
      const result = fetcher.extractWallpaperInfo(invalidSection);
      expect(result).toBeNull();
    });

    it("应该能处理下载链接位置不固定的情况", () => {
      const sectionWithLateLink = `2025-12-24

**测试标题**

![测试图片](https://example.com/img.jpg)

额外的一行内容

🔗 <a href="https://example.com/download.jpg" target="_blank">下载 4K 高清版本</a>

---`;

      const result = fetcher.extractWallpaperInfo(sectionWithLateLink);
      expect(result).not.toBeNull();
      expect(result.downloadUrl4k).toBe("https://example.com/download.jpg");
    });

    it("应该能处理多余空行的情况", () => {
      const sectionWithExtraLines = `2025-12-24


**测试标题**


![测试图片](https://example.com/img.jpg)


<a href="https://example.com/download.jpg" target="_blank">下载</a>

---`;

      const result = fetcher.extractWallpaperInfo(sectionWithExtraLines);
      expect(result).not.toBeNull();
      expect(result.date).toBe("2025-12-24");
      expect(result.title).toBe("测试标题");
    });
  });

  describe("checkWallpaperExists()", () => {
    /**
     * 测试壁纸去重逻辑
     */
    it("当月度文件中已存在该日期时应返回 true", async () => {
      // 模拟已存在的文件内容
      jest.spyOn(require("fs-extra"), "pathExists").mockResolvedValue(true);
      jest.spyOn(require("fs-extra"), "readFile").mockResolvedValue(
        "# 2025-12 必应壁纸\n\n> 本月共收录 1 张壁纸\n\n## 2025-12-24\n\n**测试**\n"
      );

      const wallpaper = { monthName: "2025-12", date: "2025-12-24" };
      const exists = await fetcher.checkWallpaperExists(wallpaper);

      expect(exists).toBe(true);
    });

    it("当月度文件不存在时应返回 false", async () => {
      jest.spyOn(require("fs-extra"), "pathExists").mockResolvedValue(false);

      const wallpaper = { monthName: "2026-01", date: "2026-01-01" };
      const exists = await fetcher.checkWallpaperExists(wallpaper);

      expect(exists).toBe(false);
    });
  });
});
