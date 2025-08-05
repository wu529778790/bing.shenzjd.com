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
   * 获取今日必应壁纸数据
   */
  async fetchTodayBingWallpaper() {
    try {
      console.log("正在获取今日必应壁纸数据...");

      // 只获取今天的壁纸
      const targetDate = moment().format("YYYY-MM-DD");

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

      console.log("=== 今日壁纸数据 ===");
      console.log("标题:", wallpaperData.title);
      console.log("开始日期:", wallpaperData.startdate);
      console.log("显示URL:", wallpaperData.displayUrl);
      console.log("下载URL:", wallpaperData.downloadUrl4k);
      console.log("===================");

      return wallpaperData;
    } catch (error) {
      console.error("获取今日必应壁纸数据失败:", error.message);
      throw error;
    }
  }

  /**
   * 处理单张壁纸数据
   */
  processSingleWallpaperData(image) {
    // 直接使用API返回的startdate，确保日期准确性
    const date = moment(image.startdate, "YYYYMMDD");
    const adjustedDate = date.add(1, "day");

    return {
      date: adjustedDate.format("YYYY-MM-DD"), // 使用调整后的日期
      title: image.title,
      copyright: image.copyright,
      description: image.copyrightlink
        ? `[${image.copyright}](${image.copyrightlink})`
        : image.copyright,
      imageUrl: image.displayUrl, // 用于 README 显示的普通分辨率图片
      hd4kUrl: image.downloadUrl4k, // 4K 高清版本
      downloadUrl4k: image.downloadUrl4k, // 4K 下载链接
      year: adjustedDate.format("YYYY"),
      month: adjustedDate.format("MM"),
      monthName: adjustedDate.format("YYYY-MM"),
    };
  }

  /**
   * 确保目录存在
   */
  async ensureDirectoryExists(dir) {
    await fs.ensureDir(dir);
  }

  /**
   * 检查指定日期的壁纸是否已经存在
   */
  async checkWallpaperExists(wallpaper) {
    const monthFile = path.join(this.archiveDir, `${wallpaper.monthName}.md`);

    try {
      if (await fs.pathExists(monthFile)) {
        const content = await fs.readFile(monthFile, "utf8");
        // 检查是否包含当前日期
        return content.includes(`## ${wallpaper.date}`);
      }
    } catch (error) {
      console.warn(`检查壁纸存在性失败: ${error.message}`);
    }

    return false;
  }

  /**
   * 追加新壁纸到月度归档
   */
  async appendToMonthlyArchive(wallpaper) {
    await this.ensureDirectoryExists(this.archiveDir);

    // 检查壁纸是否已经存在
    const exists = await this.checkWallpaperExists(wallpaper);
    if (exists) {
      console.log(`壁纸 ${wallpaper.date} 已存在，跳过保存`);
      return false;
    }

    const monthFile = path.join(this.archiveDir, `${wallpaper.monthName}.md`);

    // 生成新壁纸的 markdown 内容
    const newWallpaperContent = this.generateWallpaperMarkdown(wallpaper);

    try {
      // 检查月份文件是否存在
      if (await fs.pathExists(monthFile)) {
        // 文件存在，追加内容
        await this.insertWallpaperIntoExistingFile(
          monthFile,
          wallpaper,
          newWallpaperContent
        );
      } else {
        // 文件不存在，创建新文件
        await this.createNewMonthlyFile(
          monthFile,
          wallpaper,
          newWallpaperContent
        );
      }

      console.log(`已保存壁纸到归档: ${wallpaper.date}`);
      return true;
    } catch (error) {
      console.error(`保存月度归档失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 生成单张壁纸的 markdown 内容
   */
  generateWallpaperMarkdown(wallpaper) {
    let content = `## ${wallpaper.date}\n\n`;
    content += `**${wallpaper.title}**\n\n`;
    content += `![${wallpaper.title}](${wallpaper.imageUrl})\n\n`;
    content += `${wallpaper.description}\n\n`;
    content += `🔗 <a href="${wallpaper.downloadUrl4k}" target="_blank">下载 4K 高清版本</a>\n\n`;
    content += `---\n\n`;
    return content;
  }

  /**
   * 在现有文件中插入新壁纸（按日期顺序）
   */
  async insertWallpaperIntoExistingFile(monthFile, wallpaper, newContent) {
    const existingContent = await fs.readFile(monthFile, "utf8");

    // 找到插入位置（按日期降序排列）
    const lines = existingContent.split("\n");
    let insertIndex = -1;

    // 查找文件头部信息结束位置
    let headerEndIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        headerEndIndex = i;
        break;
      }
    }

    // 如果没有找到任何日期标题，插入到文件末尾
    if (headerEndIndex === 0) {
      const updatedContent = existingContent + newContent;
      await fs.writeFile(monthFile, updatedContent, "utf8");
      return;
    }

    // 查找正确的插入位置（保持日期降序）
    for (let i = headerEndIndex; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        const existingDate = lines[i].substring(3).trim();
        if (wallpaper.date > existingDate) {
          insertIndex = i;
          break;
        }
      }
    }

    if (insertIndex === -1) {
      // 插入到文件末尾
      const updatedContent = existingContent + newContent;
      await fs.writeFile(monthFile, updatedContent, "utf8");
    } else {
      // 插入到指定位置
      lines.splice(insertIndex, 0, ...newContent.split("\n"));
      const updatedContent = lines.join("\n");
      await fs.writeFile(monthFile, updatedContent, "utf8");
    }
  }

  /**
   * 创建新的月份文件
   */
  async createNewMonthlyFile(monthFile, wallpaper, wallpaperContent) {
    let content = `# ${wallpaper.monthName} 必应壁纸\n\n`;
    content += `> 本月共收录壁纸\n\n`;
    content += wallpaperContent;

    await fs.writeFile(monthFile, content, "utf8");
  }

  /**
   * 更新 README
   */
  async updateReadme(latestWallpaper) {
    let content = `# Bing Wallpaper\n\n`;
    content += `## 今日壁纸\n\n`;
    content += `**${latestWallpaper.title}** (${latestWallpaper.date})\n\n`;
    content += `![${latestWallpaper.title}](${latestWallpaper.imageUrl})\n\n`;
    content += `${latestWallpaper.description}\n\n`;
    content += `🔗 <a href="${latestWallpaper.downloadUrl4k}" target="_blank">下载 4K 高清版本</a>\n\n`;

    // 获取当月所有壁纸数据用于显示
    const currentMonth = moment().format("YYYY-MM");
    const monthlyWallpapers = await this.getMonthlyWallpapers(currentMonth);

    content += `## ${currentMonth} 月壁纸 (${monthlyWallpapers.length} 张)\n\n`;
    content += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">\n\n`;

    // 显示当月所有壁纸（除了今日壁纸）
    monthlyWallpapers
      .filter((wallpaper) => wallpaper.date !== latestWallpaper.date)
      .forEach((wallpaper) => {
        content += `<div style="text-align: center;">\n`;
        content += `<img src="${wallpaper.imageUrl}" alt="${wallpaper.title}" style="width: 100%; border-radius: 8px;">\n`;
        content += `<p><strong>${wallpaper.date}</strong> <a href="${wallpaper.downloadUrl4k}" target="_blank">下载 4K</a></p>\n`;
        content += `<p>${wallpaper.title}</p>\n`;
        content += `</div>\n\n`;
      });

    content += `</div>\n\n`;

    content += `## 历史归档\n\n`;

    // 获取所有归档月份
    const archiveMonths = await this.getArchiveMonths();
    if (archiveMonths.length > 0) {
      content += archiveMonths
        .map((month) => `[${month}](./archives/${month}.md)`)
        .join(" | ");
      content += "\n\n";
    } else {
      content += `📁 [查看按月份归档的壁纸](./archives/)\n\n`;
    }

    content += `## 关于\n\n`;
    content += `🤖 本项目使用 GitHub Actions 每天自动获取必应壁纸并更新\n\n`;
    content += `📸 所有壁纸版权归微软及原作者所有\n\n`;

    await fs.writeFile(this.readmeFile, content, "utf8");
    console.log("README 已更新");
  }

  /**
   * 获取指定月份的所有壁纸数据
   */
  async getMonthlyWallpapers(monthKey) {
    const monthFile = path.join(this.archiveDir, `${monthKey}.md`);
    const wallpapers = [];

    try {
      // 检查月度归档文件是否存在
      if (await fs.pathExists(monthFile)) {
        const content = await fs.readFile(monthFile, "utf8");

        // 解析 markdown 文件提取壁纸信息
        const sections = content.split("## ").slice(1); // 移除第一个空部分

        for (const section of sections) {
          const lines = section.trim().split("\n");
          if (lines.length >= 8) {
            const date = lines[0].trim();
            const titleMatch = lines[2].match(/\*\*(.*?)\*\*/);
            const imageMatch = lines[4].match(/!\[.*?\]\((.*?)\)/);

            // 查找下载链接，它在第8行或更后面
            let downloadMatch = null;
            for (let i = 6; i < lines.length; i++) {
              const match = lines[i].match(/<a href="(.*?)"/);
              if (match) {
                downloadMatch = match;
                break;
              }
            }

            if (titleMatch && imageMatch && downloadMatch) {
              wallpapers.push({
                date,
                title: titleMatch[1],
                imageUrl: imageMatch[1],
                downloadUrl4k: downloadMatch[1],
              });
            }
          }
        }

        // 按日期倒序排列（最新的在前）
        wallpapers.sort((a, b) => new Date(b.date) - new Date(a.date));
      }

      console.log(`已读取 ${monthKey} 的 ${wallpapers.length} 张壁纸`);
    } catch (error) {
      console.warn(`读取月度归档失败: ${error.message}`);
    }

    return wallpapers;
  }

  /**
   * 获取所有归档月份
   */
  async getArchiveMonths() {
    try {
      const files = await fs.readdir(this.archiveDir);
      const months = files
        .filter((file) => file.endsWith(".md") && file !== "README.md")
        .map((file) => file.replace(".md", ""))
        .sort((a, b) => b.localeCompare(a)); // 按时间倒序排列

      return months;
    } catch (error) {
      console.warn(`读取归档目录失败: ${error.message}`);
      return [];
    }
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
      console.log("🚀 开始获取今日必应壁纸...");

      // 获取今日壁纸数据
      const todayWallpaper = await this.fetchTodayBingWallpaper();
      const processedWallpaper =
        this.processSingleWallpaperData(todayWallpaper);

      console.log(
        `📸 获取到今日壁纸: ${processedWallpaper.title} (${processedWallpaper.date})`
      );

      // 尝试保存到月度归档
      const saved = await this.appendToMonthlyArchive(processedWallpaper);

      if (saved) {
        console.log("✅ 今日壁纸已保存到归档");
      } else {
        console.log("ℹ️ 今日壁纸已存在，无需重复保存");
      }

      // 更新 README（总是更新以确保显示最新数据）
      await this.updateReadme(processedWallpaper);

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
