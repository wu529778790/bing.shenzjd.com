const BingWallpaperFetcher = require("../src/index");
const fs = require("fs-extra");
const path = require("path");

describe("BingWallpaperFetcher", () => {
  let fetcher;

  beforeEach(() => {
    fetcher = new BingWallpaperFetcher();
  });

  describe("processSingleWallpaperData()", () => {
    it("应该正确处理壁纸数据并返回标准格式", () => {
      const result = fetcher.processSingleWallpaperData({
        startdate: "20251223",
        title: "测试标题",
        copyright: "测试版权",
        copyrightlink: "https://example.com",
        url: "https://example.com/image.jpg",
        displayUrl: "https://example.com/display.jpg",
        downloadUrl4k: "https://example.com/4k.jpg",
      });

      expect(result.date).toBe("2025-12-24");
      expect(result.title).toBe("测试标题");
      expect(result.copyrightlink).toBe("https://example.com");
    });

    it("没有版权链接时 copyrightlink 为空字符串", () => {
      const result = fetcher.processSingleWallpaperData({
        startdate: "20251223", title: "test", copyright: "test",
        url: "u", displayUrl: "d", downloadUrl4k: "k",
      });
      expect(result.copyrightlink).toBe("");
    });
  });

  describe("JSON 数据操作", () => {
    const tmpDir = path.join(__dirname, "../data-test");

    beforeEach(async () => {
      fetcher.dataDir = tmpDir;
      await fs.ensureDir(tmpDir);
    });

    afterEach(async () => {
      await fs.remove(tmpDir);
    });

    it("loadMonth / saveMonth 正确读写", async () => {
      const data = [
        { date: "2026-06-02", title: "B" },
        { date: "2026-06-01", title: "A" },
      ];
      await fetcher.saveMonth("2026-06", data);

      const loaded = await fetcher.loadMonth("2026-06");
      expect(loaded.length).toBe(2);
      expect(loaded[0].date).toBe("2026-06-02"); // 降序
    });

    it("loadMonth 不存在时返回空数组", async () => {
      const loaded = await fetcher.loadMonth("2099-01");
      expect(loaded).toEqual([]);
    });

    it("loadAllData 合并所有月份", async () => {
      await fetcher.saveMonth("2026-05", [{ date: "2026-05-01", title: "A" }]);
      await fetcher.saveMonth("2026-06", [{ date: "2026-06-01", title: "B" }]);

      const all = await fetcher.loadAllData();
      expect(all.length).toBe(2);
      expect(all[0].date).toBe("2026-06-01"); // 降序
    });

    it("getArchiveMonths 返回月份列表", async () => {
      await fetcher.saveMonth("2026-05", []);
      await fetcher.saveMonth("2026-06", []);

      const months = await fetcher.getArchiveMonths();
      expect(months).toEqual(["2026-06", "2026-05"]);
    });
  });

  describe("页面生成", () => {
    const mockData = [
      { date: "2026-06-02", title: "今日", imageUrl: "t.jpg", downloadUrl4k: "t4k.jpg", copyright: "© T", copyrightlink: "https://ex.com" },
      { date: "2026-06-01", title: "昨日", imageUrl: "y.jpg", downloadUrl4k: "y4k.jpg", copyright: "© Y", copyrightlink: "" },
    ];
    const months = ["2026-06"];

    it("generateReadme 应包含关键内容", () => {
      const md = fetcher.generateReadme(mockData, months);
      expect(md).toContain("## 今日壁纸");
      expect(md).toContain("**今日** (2026-06-02)");
      expect(md).toContain("## 历史归档");
      expect(md).toContain("[2026-06](./archives/2026-06.html)");
    });

    it("generateArchiveHTML 应包含所有壁纸", () => {
      const html = fetcher.generateArchiveHTML("2026-06", mockData);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("今日");
      expect(html).toContain("昨日");
    });

    it("generateIndexHTML 应包含今日壁纸和归档链接", () => {
      const html = fetcher.generateIndexHTML(mockData, months);
      expect(html).toContain("今日");
      expect(html).toContain("2026-06");
    });
  });
});
