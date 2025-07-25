const { getBingWallpaper } = require("bing-wallpaper-api");
const fs = require("fs-extra");
const moment = require("moment");
const path = require("path");

class BingWallpaperFetcher {
  constructor() {
    this.archiveDir = path.join(__dirname, "../archives");
    this.readmeFile = path.join(__dirname, "../README.md");
  }

  /**
   * 获取必应壁纸数据
   */
  async fetchBingWallpapers() {
    try {
      console.log("正在获取必应壁纸数据...");
      const wallpapers = [];

      // 获取最近8张壁纸
      for (let i = 0; i < 8; i++) {
        // 计算目标日期（今天减去 i 天）
        const targetDate = moment().subtract(i, "days").format("YYYY-MM-DD");

        // 获取显示用的普通分辨率版本
        const displayWallpaper = await getBingWallpaper({
          date: targetDate,
          resolution: "1920x1080",
          market: "zh-CN",
        });

        // 获取下载用的4K版本
        const downloadWallpaper = await getBingWallpaper({
          date: targetDate,
          resolution: "UHD",
          market: "zh-CN",
        });

        // 合并数据
        const wallpaperData = {
          ...displayWallpaper,
          displayUrl: displayWallpaper.url,
          downloadUrl4k: downloadWallpaper.url,
        };

        // 添加调试信息
        if (i === 0) {
          console.log("=== 调试信息：第一张壁纸数据 ===");
          console.log("标题:", wallpaperData.title);
          console.log("开始日期:", wallpaperData.startdate);
          console.log("显示URL:", wallpaperData.displayUrl);
          console.log("下载URL:", wallpaperData.downloadUrl4k);
          console.log("===============================");
        }

        wallpapers.push(wallpaperData);
      }

      return wallpapers;
    } catch (error) {
      console.error("获取必应壁纸数据失败:", error.message);
      throw error;
    }
  }

  /**
   * 处理壁纸数据
   */
  processWallpaperData(images) {
    return images.map((image) => {
      // 直接使用API返回的startdate，确保日期准确性
      const date = moment(image.startdate, "YYYYMMDD");

      return {
        date: date.format("YYYY-MM-DD"), // 使用API返回的真实日期
        title: image.title,
        copyright: image.copyright,
        description: image.copyrightlink
          ? `[${image.copyright}](${image.copyrightlink})`
          : image.copyright,
        imageUrl: image.displayUrl, // 用于 README 显示的普通分辨率图片
        hd4kUrl: image.downloadUrl4k, // 4K 高清版本
        downloadUrl4k: image.downloadUrl4k, // 4K 下载链接
        year: date.format("YYYY"),
        month: date.format("MM"),
        monthName: date.format("YYYY-MM"),
      };
    });
  }

  /**
   * 确保目录存在
   */
  async ensureDirectoryExists(dir) {
    await fs.ensureDir(dir);
  }

  /**
   * 更新月度归档
   */
  async updateMonthlyArchive(wallpapers) {
    await this.ensureDirectoryExists(this.archiveDir);

    // 按月份分组
    const groupedByMonth = {};
    wallpapers.forEach((wallpaper) => {
      const monthKey = wallpaper.monthName;
      if (!groupedByMonth[monthKey]) {
        groupedByMonth[monthKey] = [];
      }
      groupedByMonth[monthKey].push(wallpaper);
    });

    // 为每个月份创建或更新 markdown 文件
    for (const [monthKey, monthWallpapers] of Object.entries(groupedByMonth)) {
      await this.createMonthlyMarkdown(monthKey, monthWallpapers);
    }
  }

  /**
   * 创建月度 markdown 文件
   */
  async createMonthlyMarkdown(monthKey, wallpapers) {
    const monthFile = path.join(this.archiveDir, `${monthKey}.md`);

    // 按日期排序（最新的在前）
    wallpapers.sort((a, b) => new Date(b.date) - new Date(a.date));

    let content = `# ${monthKey} 必应壁纸\n\n`;
    content += `> 本月共收录 ${wallpapers.length} 张壁纸\n\n`;

    wallpapers.forEach((wallpaper) => {
      content += `## ${wallpaper.date}\n\n`;
      content += `**${wallpaper.title}**\n\n`;
      content += `![${wallpaper.title}](${wallpaper.imageUrl})\n\n`;
      content += `${wallpaper.description}\n\n`;
      content += `🔗 <a href="${wallpaper.downloadUrl4k}" target="_blank">下载 4K 高清版本</a>\n\n`;
      content += `---\n\n`;
    });

    await fs.writeFile(monthFile, content, "utf8");
    console.log(`已更新月度归档: ${monthFile}`);
  }

  /**
   * 更新 README
   */
  async updateReadme(latestWallpaper, recentWallpapers) {
    // 使用当前日期作为更新时间，因为每天都会获取到新的壁纸
    const currentDate = moment().format("YYYY-MM-DD");

    let content = `# Bing Wallpaper\n\n`;
    content += `📅 最后更新: ${currentDate}\n\n`;
    content += `## 今日壁纸\n\n`;
    content += `**${latestWallpaper.title}** (${latestWallpaper.date})\n\n`;
    content += `![${latestWallpaper.title}](${latestWallpaper.imageUrl})\n\n`;
    content += `${latestWallpaper.description}\n\n`;
    content += `🔗 <a href="${latestWallpaper.downloadUrl4k}" target="_blank">下载 4K 高清版本</a>\n\n`;

    content += `## 最近壁纸\n\n`;
    content += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">\n\n`;

    recentWallpapers.slice(0, 6).forEach((wallpaper) => {
      content += `<div style="text-align: center;">\n`;
      content += `<img src="${wallpaper.imageUrl}" alt="${wallpaper.title}" style="width: 100%; border-radius: 8px;">\n`;
      content += `<p><strong>${wallpaper.date}</strong> <a href="${wallpaper.downloadUrl4k}" target="_blank">下载 4K</a></p>\n`;
      content += `<p>${wallpaper.title}</p>\n`;
      content += `</div>\n\n`;
    });

    content += `</div>\n\n`;

    content += `## 归档\n\n`;
    content += `📁 [查看按月份归档的壁纸](./archives/)\n\n`;

    content += `## 关于\n\n`;
    content += `🤖 本项目使用 GitHub Actions 每天自动获取必应壁纸并更新\n\n`;
    content += `📸 所有壁纸版权归微软及原作者所有\n\n`;

    await fs.writeFile(this.readmeFile, content, "utf8");
    console.log("README 已更新");
  }

  /**
   * 读取现有的归档数据
   */
  async readExistingArchives() {
    const archives = [];
    try {
      const archiveFiles = await fs.readdir(this.archiveDir);

      for (const file of archiveFiles) {
        if (file.endsWith(".md")) {
          const content = await fs.readFile(
            path.join(this.archiveDir, file),
            "utf8"
          );
          // 这里可以解析已有的归档数据，避免重复
        }
      }
    } catch (error) {
      console.log("归档目录不存在或为空，将创建新的归档");
    }
    return archives;
  }

  /**
   * 主要执行函数
   */
  async run() {
    try {
      console.log("🚀 开始获取必应壁纸...");

      // 获取壁纸数据
      const wallpapers = await this.fetchBingWallpapers();
      const processedWallpapers = this.processWallpaperData(wallpapers);

      console.log(`📸 获取到 ${processedWallpapers.length} 张壁纸`);

      // 更新月度归档
      await this.updateMonthlyArchive(processedWallpapers);

      // 更新 README（使用最新的壁纸）
      const latestWallpaper = processedWallpapers[0];
      await this.updateReadme(latestWallpaper, processedWallpapers);

      console.log("✅ 所有任务完成！");
    } catch (error) {
      console.error("❌ 执行失败:", error.message);
      process.exit(1);
    }
  }
}

// 如果直接运行此文件
if (require.main === module) {
  const fetcher = new BingWallpaperFetcher();
  fetcher.run();
}

module.exports = BingWallpaperFetcher;
