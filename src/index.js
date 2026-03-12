const { getBingWallpaper } = require("bing-wallpaper-api");
const fs = require("fs-extra");
const moment = require("moment");
const path = require("path");

const BING_TIMEZONE = "Asia/Shanghai";

/**
 * 延迟函数
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class BingWallpaperFetcher {
  constructor() {
    this.archiveDir = path.join(__dirname, "../archives");
    this.readmeFile = path.join(__dirname, "../README.md");

    // 缓存机制
    this.cache = {
      monthlyFiles: new Map(), // key: monthKey, value: { content, wallpapers, timestamp }
      archiveMonths: null,
    };

    // 重试配置
    this.retryConfig = {
      maxRetries: 3,
      initialDelay: 1000, // 1秒
      maxDelay: 10000, // 10秒
      backoffMultiplier: 2,
    };
  }

  /**
   * 带重试机制的 API 调用
   */
  async fetchWithRetry(apiCall, operationName, retryCount = 0) {
    try {
      return await apiCall();
    } catch (error) {
      if (retryCount >= this.retryConfig.maxRetries) {
        console.error(`❌ ${operationName} 在 ${this.retryConfig.maxRetries} 次重试后仍然失败`);
        throw error;
      }

      // 计算退避时间
      const delay = Math.min(
        this.retryConfig.initialDelay * Math.pow(this.retryConfig.backoffMultiplier, retryCount),
        this.retryConfig.maxDelay
      );

      console.warn(`⚠️ ${operationName} 失败: ${error.message}`);
      console.log(`🔄 第 ${retryCount + 1}/${this.retryConfig.maxRetries} 次重试，等待 ${delay}ms...`);

      await sleep(delay);
      return this.fetchWithRetry(apiCall, operationName, retryCount + 1);
    }
  }

  /**
   * 获取今日必应壁纸数据（带重试）
   */
  async fetchTodayBingWallpaper() {
    console.log("正在获取今日必应壁纸数据...");

    // 只获取今天的壁纸

    // 获取显示用的普通分辨率版本
    const displayWallpaper = await this.fetchWithRetry(
      async () => {
        return await getBingWallpaper({
          index: 0,
          timezone: BING_TIMEZONE,
          resolution: "1920x1080",
          market: "zh-CN",
        });
      },
      "获取 1080p 壁纸"
    );

    // 获取下载用的4K版本
    const downloadWallpaper = await this.fetchWithRetry(
      async () => {
        return await getBingWallpaper({
          index: 0,
          timezone: BING_TIMEZONE,
          resolution: "UHD",
          market: "zh-CN",
        });
      },
      "获取 4K 壁纸"
    );

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
  }

  /**
   * 处理单张壁纸数据
   */
  processSingleWallpaperData(image) {
    // 优先使用请求日期，确保归档日期与实际抓取目标一致
    const effectiveDate = moment(image.startdate, "YYYYMMDD", true);

    if (!effectiveDate.isValid()) {
      throw new Error("壁纸日期无效");
    }

    return {
      date: effectiveDate.format("YYYY-MM-DD"),
      title: image.title,
      copyright: image.copyright,
      description: image.copyrightlink
        ? `[${image.copyright}](${image.copyrightlink})`
        : image.copyright,
      imageUrl: image.displayUrl, // 用于 README 显示的普通分辨率图片
      hd4kUrl: image.downloadUrl4k, // 4K 高清版本
      downloadUrl4k: image.downloadUrl4k, // 4K 下载链接
      year: effectiveDate.format("YYYY"),
      month: effectiveDate.format("MM"),
      monthName: effectiveDate.format("YYYY-MM"),
    };
  }

  /**
   * 确保目录存在
   */
  async ensureDirectoryExists(dir) {
    await fs.ensureDir(dir);
  }

  /**
   * 从缓存或文件读取月度归档内容
   */
  async readMonthlyFile(monthKey, useCache = true) {
    const cacheKey = monthKey;

    // 检查缓存是否有效（5分钟内有效）
    if (useCache && this.cache.monthlyFiles.has(cacheKey)) {
      const cached = this.cache.monthlyFiles.get(cacheKey);
      const now = Date.now();
      if (now - cached.timestamp < 5 * 60 * 1000) {
        console.log(`📦 使用缓存读取 ${monthKey} 归档`);
        return cached.content;
      }
    }

    // 缓存失效，从文件读取
    const monthFile = path.join(this.archiveDir, `${monthKey}.md`);

    try {
      if (await fs.pathExists(monthFile)) {
        const content = await fs.readFile(monthFile, "utf8");

        // 更新缓存
        this.cache.monthlyFiles.set(cacheKey, {
          content,
          timestamp: Date.now(),
        });

        return content;
      }
    } catch (error) {
      console.warn(`读取月度归档失败: ${error.message}`);
      return null;
    }

    return null;
  }

  /**
   * 检查指定日期的壁纸是否已经存在（使用缓存）
   */
  async checkWallpaperExists(wallpaper) {
    const content = await this.readMonthlyFile(wallpaper.monthName);

    if (content) {
      // 检查是否包含当前日期
      return content.includes(`## ${wallpaper.date}`);
    }

    return false;
  }

  /**
   * 追加新壁纸到月度归档（带备份和缓存优化）
   */
  async appendToMonthlyArchive(wallpaper) {
    await this.ensureDirectoryExists(this.archiveDir);

    // 检查壁纸是否已经存在（使用缓存）
    const exists = await this.checkWallpaperExists(wallpaper);
    if (exists) {
      console.log(`壁纸 ${wallpaper.date} 已存在，跳过保存`);
      // 即使已存在，也刷新头部统计，确保数字准确
      const monthFile = path.join(this.archiveDir, `${wallpaper.monthName}.md`);
      await this.refreshMonthlyHeaderCount(monthFile);
      return false;
    }

    const monthFile = path.join(this.archiveDir, `${wallpaper.monthName}.md`);

    // 生成新壁纸的 markdown 内容
    const newWallpaperContent = this.generateWallpaperMarkdown(wallpaper);

    // 创建备份（如果文件存在）
    let backupContent = null;
    if (await fs.pathExists(monthFile)) {
      backupContent = await fs.readFile(monthFile, "utf8");
      console.log(`📦 已创建备份，准备更新 ${wallpaper.monthName} 归档`);
    }

    try {
      // 检查月份文件是否存在
      if (backupContent !== null) {
        // 文件存在，追加内容（使用已读取的内容）
        await this.insertWallpaperIntoExistingFile(
          monthFile,
          wallpaper,
          newWallpaperContent,
          backupContent
        );
      } else {
        // 文件不存在，创建新文件
        await this.createNewMonthlyFile(
          monthFile,
          wallpaper,
          newWallpaperContent
        );
      }

      // 清除缓存，确保下次读取最新内容
      this.cache.monthlyFiles.delete(wallpaper.monthName);

      console.log(`✅ 已保存壁纸到归档: ${wallpaper.date}`);
      return true;
    } catch (error) {
      console.error(`❌ 保存月度归档失败: ${error.message}`);

      // 回滚：恢复备份
      if (backupContent !== null) {
        console.log(`🔄 正在回滚备份...`);
        try {
          await fs.writeFile(monthFile, backupContent, "utf8");
          console.log(`✅ 回滚成功`);
        } catch (rollbackError) {
          console.error(`❌ 回滚失败: ${rollbackError.message}`);
        }
      }

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
   * 优化：直接传入已读取的内容，避免重复 I/O
   */
  async insertWallpaperIntoExistingFile(monthFile, wallpaper, newContent, existingContent = null) {
    // 如果没有提供现有内容，才从文件读取
    if (existingContent === null) {
      existingContent = await fs.readFile(monthFile, "utf8");
    }

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
      // 更新统计
      await this.refreshMonthlyHeaderCount(monthFile);
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

    let updatedContent;
    if (insertIndex === -1) {
      // 插入到文件末尾
      updatedContent = existingContent + newContent;
    } else {
      // 插入到指定位置
      lines.splice(insertIndex, 0, ...newContent.split("\n"));
      updatedContent = lines.join("\n");
    }

    // 写入更新后的内容
    await fs.writeFile(monthFile, updatedContent, "utf8");

    // 更新文件头部的统计数量
    await this.refreshMonthlyHeaderCount(monthFile);
  }

  /**
   * 创建新的月份文件
   */
  async createNewMonthlyFile(monthFile, wallpaper, wallpaperContent) {
    let content = `# ${wallpaper.monthName} 必应壁纸\n\n`;
    content += `> 本月共收录 1 张壁纸\n\n`;
    content += wallpaperContent;

    await fs.writeFile(monthFile, content, "utf8");
  }

  /**
   * 刷新月度文件头部的“本月共收录 X 张壁纸”数量
   */
  async refreshMonthlyHeaderCount(monthFile) {
    try {
      const content = await fs.readFile(monthFile, "utf8");
      const lines = content.split("\n");
      // 只计算以 "## [日期]" 格式开头的行，避免误统计其他二级标题
      const count = lines.filter((line) => /^## \d{4}-\d{2}-\d{2}/.test(line.trim())).length;

      const newHeaderLine = `> 本月共收录 ${count} 张壁纸`;
      let updated = false;

      const updatedLines = lines.map((line) => {
        if (line.startsWith("> 本月共收录")) {
          updated = true;
          return newHeaderLine;
        }
        return line;
      });

      // 如果没有找到统计行（理论上不会发生），则在标题后插入
      if (!updated) {
        for (let i = 0; i < updatedLines.length; i++) {
          if (updatedLines[i].startsWith("# ")) {
            updatedLines.splice(i + 1, 0, "");
            updatedLines.splice(i + 2, 0, newHeaderLine);
            updatedLines.splice(i + 3, 0, "");
            break;
          }
        }
      }

      await fs.writeFile(monthFile, updatedLines.join("\n"), "utf8");
    } catch (error) {
      console.warn(`更新月度统计失败: ${error.message}`);
    }
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
    const currentMonth = latestWallpaper.monthName;
    // 优化：直接从归档文件中获取当月壁纸，而不是重新解析整个文件
    const monthlyWallpapers = await this.getMonthlyWallpapers(currentMonth);

    content += `## ${currentMonth} 月壁纸 (${monthlyWallpapers.length} 张)\n\n`;
    content += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">\n\n`;

    // 显示当月所有壁纸（除了今日壁纸）
    const otherWallpapers = monthlyWallpapers
      .filter((wallpaper) => wallpaper.date !== latestWallpaper.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date)); // 确保按日期倒序排列

    for (const wallpaper of otherWallpapers) {
      content += `<div style="text-align: center;">\n`;
      content += `<img src="${wallpaper.imageUrl}" alt="${wallpaper.title}" style="width: 100%; border-radius: 8px;">\n`;
      content += `<p><strong>${wallpaper.date}</strong> <a href="${wallpaper.downloadUrl4k}" target="_blank">下载 4K</a></p>\n`;
      content += `<p>${wallpaper.title}</p>\n`;
      content += `</div>\n\n`;
    }

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
   * 提取壁纸信息的正则表达式
   */
  extractWallpaperInfo(section) {
    const lines = section.trim().split("\n");
    if (lines.length < 8) {
      return null;
    }

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
      return {
        date,
        title: titleMatch[1],
        imageUrl: imageMatch[1],
        downloadUrl4k: downloadMatch[1],
      };
    }

    return null;
  }

  /**
   * 获取指定月份的所有壁纸数据（使用缓存）
   */
  async getMonthlyWallpapers(monthKey) {
    const wallpapers = [];

    // 使用缓存读取月度文件
    const content = await this.readMonthlyFile(monthKey);

    if (content) {
      // 解析 markdown 文件提取壁纸信息
      const sections = content.split("## ").slice(1); // 移除第一个空部分

      for (const section of sections) {
        const wallpaperInfo = this.extractWallpaperInfo(section);
        if (wallpaperInfo) {
          wallpapers.push(wallpaperInfo);
        }
      }

      // 按日期倒序排列（最新的在前）
      wallpapers.sort((a, b) => new Date(b.date) - new Date(a.date));

      console.log(`📦 已读取 ${monthKey} 的 ${wallpapers.length} 张壁纸`);
    } else {
      console.log(`ℹ️ ${monthKey} 归档文件不存在`);
    }

    return wallpapers;
  }

  /**
   * 获取所有归档月份（使用缓存）
   */
  async getArchiveMonths() {
    // 检查缓存（5分钟有效）
    if (this.cache.archiveMonths) {
      const now = Date.now();
      if (now - this.cache.archiveMonths.timestamp < 5 * 60 * 1000) {
        console.log(`📦 使用缓存读取归档月份列表`);
        return this.cache.archiveMonths.months;
      }
    }

    try {
      const files = await fs.readdir(this.archiveDir);
      const months = files
        .filter((file) => file.endsWith(".md") && file !== "README.md")
        .map((file) => file.replace(".md", ""))
        .sort((a, b) => b.localeCompare(a)); // 按时间倒序排列

      // 更新缓存
      this.cache.archiveMonths = {
        months,
        timestamp: Date.now(),
      };

      console.log(`📦 已读取归档月份列表: ${months.length} 个月`);
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
   * 显示优化统计信息
   */
  showOptimizationStats() {
    console.log("\n📊 优化统计信息:");
    console.log("==================");
    console.log(`缓存命中统计:`);
    console.log(`  - 月度文件缓存: ${this.cache.monthlyFiles.size} 个`);
    if (this.cache.archiveMonths) {
      console.log(`  - 归档月份缓存: 已缓存 (${this.cache.archiveMonths.months.length} 个月)`);
    }
    console.log(`重试配置: ${this.retryConfig.maxRetries} 次重试，最大延迟 ${this.retryConfig.maxDelay}ms`);
    console.log("==================\n");
  }

  /**
   * 主要执行函数
   */
  async run() {
    try {
      console.log("🚀 开始获取今日必应壁纸...");
      console.log("⚡ 已启用优化: 重试机制 + 缓存 + 数据备份");

      // 获取今日壁纸数据
      const todayWallpaper = await this.fetchTodayBingWallpaper();

      // 检查是否成功获取到壁纸数据
      if (!todayWallpaper || !todayWallpaper.url) {
        throw new Error("未能获取到有效的壁纸数据");
      }

      const processedWallpaper = this.processSingleWallpaperData(todayWallpaper);

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

      // 显示优化统计
      this.showOptimizationStats();

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
