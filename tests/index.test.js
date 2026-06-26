const BingWallpaperFetcher = require("../src/index");

describe("BingWallpaperFetcher", () => {
  let fetcher;

  beforeEach(() => {
    fetcher = new BingWallpaperFetcher();
  });

  describe("processSingleWallpaperData()", () => {
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

      expect(result.date).toBe("2025-12-24");
      expect(result.title).toBe("测试标题");
      expect(result.copyright).toBe("测试版权 (© Test Author)");
      expect(result.copyrightlink).toBe("https://example.com/search?q=test");
      expect(result.imageUrl).toBe("https://example.com/display.jpg");
      expect(result.downloadUrl4k).toBe("https://example.com/4k.jpg");
    });

    it("当没有版权链接时，copyrightlink 应为空字符串", () => {
      const mockImageData = {
        startdate: "20251223",
        title: "无链接标题",
        copyright: "纯文本版权信息",
        url: "https://example.com/image.jpg",
        displayUrl: "https://example.com/display.jpg",
        downloadUrl4k: "https://example.com/4k.jpg",
      };

      const result = fetcher.processSingleWallpaperData(mockImageData);
      expect(result.copyrightlink).toBe("");
    });
  });

  describe("JSON 数据操作", () => {
    const mockData = [
      { date: "2026-06-02", title: "B", imageUrl: "b.jpg", downloadUrl4k: "b_4k.jpg", copyright: "B", copyrightlink: "" },
      { date: "2026-06-01", title: "A", imageUrl: "a.jpg", downloadUrl4k: "a_4k.jpg", copyright: "A", copyrightlink: "" },
      { date: "2026-05-31", title: "C", imageUrl: "c.jpg", downloadUrl4k: "c_4k.jpg", copyright: "C", copyrightlink: "" },
    ];

    it("wallpaperExists 应正确判断是否存在", () => {
      expect(fetcher.wallpaperExists(mockData, "2026-06-01")).toBe(true);
      expect(fetcher.wallpaperExists(mockData, "2026-06-03")).toBe(false);
    });

    it("addWallpaper 应追加并按日期降序排列", () => {
      const data = [...mockData];
      fetcher.addWallpaper(data, { date: "2026-06-03", title: "D" });
      expect(data[0].date).toBe("2026-06-03");
      expect(data.length).toBe(4);
    });

    it("getWallpapersByMonth 应按月筛选", () => {
      const june = fetcher.getWallpapersByMonth(mockData, "2026-06");
      expect(june.length).toBe(2);
      expect(june[0].date).toBe("2026-06-02");
    });

    it("getArchiveMonths 应返回去重月份列表", () => {
      const months = fetcher.getArchiveMonths(mockData);
      expect(months).toEqual(["2026-06", "2026-05"]);
    });
  });

  describe("页面生成", () => {
    const mockData = [
      { date: "2026-06-02", title: "今日", imageUrl: "today.jpg", downloadUrl4k: "today_4k.jpg", copyright: "© Test", copyrightlink: "https://example.com" },
      { date: "2026-06-01", title: "昨日", imageUrl: "yesterday.jpg", downloadUrl4k: "yesterday_4k.jpg", copyright: "© Test2", copyrightlink: "" },
    ];

    it("generateReadme 应生成正确的 Markdown", () => {
      const md = fetcher.generateReadme(mockData);
      expect(md).toContain("## 今日壁纸");
      expect(md).toContain("**今日** (2026-06-02)");
      expect(md).toContain("## 2026-06 月壁纸 (2 张)");
      expect(md).toContain("## 历史归档");
      expect(md).toContain("[2026-06](./archives/2026-06.html)");
    });

    it("generateArchiveHTML 应生成有效的 HTML", () => {
      const html = fetcher.generateArchiveHTML("2026-06", mockData);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("2026-06 必应壁纸");
      expect(html).toContain("今日");
      expect(html).toContain("昨日");
      expect(html).toContain("下载 4K");
    });
  });
});
