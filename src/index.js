const { getBingWallpaper } = require("bing-wallpaper-api");
const fs = require("fs-extra");
const dayjs = require("dayjs");
const path = require("path");

// 加载配置文件
const config = require("../config.json");

/**
 * 延迟函数 - 用于重试机制的等待
 * @param {number} ms - 等待时间（毫秒）
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 必应壁纸自动归档工具
 *
 * 功能说明：
 * 1. 每天自动获取必应当日壁纸（带重试机制）
 * 2. 将壁纸信息保存到按月份分类的 Markdown 归档文件
 * 3. 自动更新 README.md 显示最新壁纸和当月壁纸列表
 *
 * 性能优化：
 * - 缓存机制：减少重复的文件 I/O 操作
 * - 重试机制：API 调用失败时自动重试（最多 3 次，指数退避）
 * - 数据备份：写入前自动备份，失败时可回滚
 *
 * 使用方式：
 * - 直接运行: node src/index.js
 * - 通过 update 脚本运行: node src/update.js
 * - GitHub Actions 定时任务自动执行
 */
class BingWallpaperFetcher {
  constructor() {
    // 从配置文件读取路径，支持自定义
    this.archiveDir = path.join(__dirname, config.archiveDir);
    this.readmeFile = path.join(__dirname, config.readmeFile);

    // ===== 缓存机制配置 =====
    // 用于减少重复的文件 I/O 操作，提升性能
    this.cache = {
      monthlyFiles: new Map(), // key: monthKey, value: { content, wallpapers, timestamp }
      archiveMonths: null,
    };

    // ===== 重试机制配置 =====
    // 当 API 调用网络波动时，自动重试提高成功率
    this.retryConfig = {
      maxRetries: 3,           // 最大重试次数
      initialDelay: 1000,     // 初始延迟 1 秒
      maxDelay: 10000,        // 最大延迟 10 秒
      backoffMultiplier: 2,   // 指数退避倍数
    };
  }

  /**
   * 带重试机制的 API 调用封装
   *
   * 实现策略：
   * - 使用指数退避算法，避免频繁重试导致被限流
   * - 每次重试等待时间 = initialDelay * (backoffMultiplier ^ retryCount)
   * - 但不超过 maxDelay 上限
   *
   * @param {Function} apiCall - 返回 Promise 的 API 调用函数
   * @param {string} operationName - 操作名称（用于日志输出）
   * @param {number} retryCount - 当前重试次数（内部递归使用）
   * @returns {Promise<*>} API 返回结果
   * @throws {Error} 超过最大重试次数后抛出原始错误
   */
  async fetchWithRetry(apiCall, operationName, retryCount = 0) {
    try {
      return await apiCall();
    } catch (error) {
      // 达到最大重试次数，放弃并抛出错误
      if (retryCount >= this.retryConfig.maxRetries) {
        console.error(`❌ ${operationName} 在 ${this.retryConfig.maxRetries} 次重试后仍然失败`);
        throw error;
      }

      // 计算本次重试的等待时间（指数退避）
      const delay = Math.min(
        this.retryConfig.initialDelay * Math.pow(this.retryConfig.backoffMultiplier, retryCount),
        this.retryConfig.maxDelay
      );

      console.warn(`⚠️ ${operationName} 失败: ${error.message}`);
      console.log(`🔄 第 ${retryCount + 1}/${this.retryConfig.maxRetries} 次重试，等待 ${delay}ms...`);

      // 等待后递归调用自身进行重试
      await sleep(delay);
      return this.fetchWithRetry(apiCall, operationName, retryCount + 1);
    }
  }

  /**
   * 获取今日必应壁纸数据（带重试机制）
   *
   * 实现逻辑：
   * 1. 使用 dayjs 格式化当前日期作为查询参数
   * 2. 分别获取普通分辨率版本（用于展示）和 UHD 版本（用于下载）
   * 3. 合并两个版本的 URL 到同一个数据对象中返回
   * 4. 所有 API 调用都通过 fetchWithRetry 进行容错处理
   *
   * @returns {Promise<Object>} 壁纸数据对象，包含 displayUrl 和 downloadUrl4k
   */
  async fetchTodayBingWallpaper() {
    console.log("正在获取今日必应壁纸数据...");

    // 使用 dayjs 格式化今天的日期
    const targetDate = dayjs().format(config.dateFormat);

    // 获取显示用的普通分辨率版本（1920x1080）- 带重试
    const displayWallpaper = await this.fetchWithRetry(
      async () => {
        return await getBingWallpaper({
          date: targetDate,
          resolution: config.displayResolution, // "1920x1080"
          market: config.market, // "zh-CN" 中国区
        });
      },
      "获取 1080p 壁纸"
    );

    // 获取下载用的4K/UHD版本 - 带重试
    const downloadWallpaper = await this.fetchWithRetry(
      async () => {
        return await getBingWallpaper({
          date: targetDate,
          resolution: config.downloadResolution, // "UHD"
          market: config.market,
        });
      },
      "获取 4K 壁纸"
    );

    // 合并两个分辨率的数据到一个对象中
    const wallpaperData = {
      ...displayWallpaper,
      displayUrl: displayWallpaper.url, // 用于页面展示的普通分辨率图片
      downloadUrl4k: downloadWallpaper.url, // 用于用户下载的4K高清图片
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
   * 处理单张壁纸数据，转换为标准格式
   *
   * 重要说明：日期调整逻辑
   * 必应 API 返回的 startdate 格式为 "YYYYMMDD"，表示的是壁纸发布日期（UTC时间）。
   * 由于时区差异（中国 UTC+8），实际显示日期需要 +1 天才能匹配用户的本地日期。
   * 例如：API 返回 startdate=20251223，实际应该显示为 2025-12-24。
   *
   * @param {Object} image - 必应 API 返回的原始壁纸数据
   * @returns {Object} 标准格式的壁纸数据对象
   */
  processSingleWallpaperData(image) {
    // 解析 API 返回的日期格式 YYYYMMDD
    const date = dayjs(image.startdate, config.dateInputFormat);

    // 关键：加一天以修正时区差异，匹配用户看到的实际日期
    const adjustedDate = date.add(1, "day");

    return {
      date: adjustedDate.format(config.dateFormat), // 调整后的实际显示日期
      title: image.title, // 壁纸标题/描述文字
      copyright: image.copyright, // 版权信息（含作者）
      description: image.copyrightlink
        ? `[${image.copyright}](${image.copyrightlink})` // 有链接则生成 Markdown 链接
        : image.copyright, // 无链接则使用纯文本
      imageUrl: image.displayUrl, // 用于 README 展示的普通分辨率图片 URL
      hd4kUrl: image.downloadUrl4k, // 别名：4K 高清版本
      downloadUrl4k: image.downloadUrl4k, // 4K 下载链接（用于 <a> 标签）
      year: adjustedDate.format("YYYY"), // 年份（用于归档路径）
      month: adjustedDate.format("MM"), // 月份（用于归档路径）
      monthName: adjustedDate.format("YYYY-MM"), // 月度文件名（如 "2025-12.md"）
    };
  }

  /**
   * 确保目录存在，不存在则创建
   *
   * @param {string} dir - 目录路径
   */
  async ensureDirectoryExists(dir) {
    await fs.ensureDir(dir);
  }

  /**
   * 从缓存或文件读取月度归档内容
   *
   * 缓存策略：
   * - 缓存有效期为 5 分钟
   * - 在同一次执行流程中多次读取同一月份时，直接使用缓存
   * - 这避免了重复的文件 I/O，显著提升性能
   *
   * @param {string} monthKey - 月份键名（如 "2025-12"）
   * @param {boolean} useCache - 是否使用缓存（默认 true）
   * @returns {Promise<string|null>} 文件内容字符串，文件不存在返回 null
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

    // 缓存失效或未启用缓存，从文件读取
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
   * 检查指定日期的壁纸是否已经存在于月度归档中
   *
   * 去重机制：
   * 通过检查月度 Markdown 文件是否包含 "## {date}" 来判断是否已存在
   * 这种简单的方式可以避免重复保存同一日的壁纸
   *
   * @param {Object} wallpaper - 包含 monthName 和 date 的壁纸对象
   * @returns {Promise<boolean>} true 表示已存在，false 表示不存在或出错
   */
  async checkWallpaperExists(wallpaper) {
    const content = await this.readMonthlyFile(wallpaper.monthName);

    if (content) {
      // 检查是否包含该日期的二级标题（格式：## 2025-12-24）
      return content.includes(`## ${wallpaper.date}`);
    }

    return false;
  }

  /**
   * 追加新壁纸到月度归档文件
   *
   * @param {Object} wallpaper - 处理后的壁纸数据对象
   * @returns {Promise<boolean>} true 表示新保存，false 表示已存在
   */
  async appendToMonthlyArchive(wallpaper) {
    await this.ensureDirectoryExists(this.archiveDir);

    const exists = await this.checkWallpaperExists(wallpaper);
    if (exists) {
      console.log(`壁纸 ${wallpaper.date} 已存在，跳过保存`);
      const monthFile = path.join(this.archiveDir, `${wallpaper.monthName}.md`);
      await this.refreshMonthlyHeaderCount(monthFile);
      return false;
    }

    const monthFile = path.join(this.archiveDir, `${wallpaper.monthName}.md`);
    const newWallpaperContent = this.generateWallpaperMarkdown(wallpaper);

    if (await fs.pathExists(monthFile)) {
      const existingContent = await fs.readFile(monthFile, "utf8");
      await this.insertWallpaperIntoExistingFile(monthFile, wallpaper, newWallpaperContent, existingContent);
    } else {
      await this.createNewMonthlyFile(monthFile, wallpaper, newWallpaperContent);
    }

    this.cache.monthlyFiles.delete(wallpaper.monthName);
    console.log(`✅ 已保存壁纸到归档: ${wallpaper.date}`);
    return true;
  }

  /**
   * 生成单张壁纸的 Markdown 内容块
   *
   * 输出格式示例：
   * ```markdown
   * ## 2025-12-24
   *
   * **圣诞快乐**
   *
   * ![圣诞快乐](图片URL)
   *
   * [版权信息](版权链接)
   *
   * 🔗 <a href="4K下载URL" target="_blank">下载 4K 高清版本</a>
   *
   * ---
   * ```
   *
   * @param {Object} wallpaper - 壁纸数据对象
   * @returns {string} 格式化的 Markdown 字符串
   */
  generateWallpaperMarkdown(wallpaper) {
    let content = `## ${wallpaper.date}\n\n`;
    content += `**${wallpaper.title}**\n\n`;
    content += `![${wallpaper.title}](${wallpaper.imageUrl})\n\n`;
    content += `${wallpaper.description}\n\n`;
    content += `🔗 <a href="${wallpaper.downloadUrl4k}" target="_blank">下载 4K 高清版本</a>\n\n`;
    content += `---\n\n`; // 分隔线，用于视觉分隔不同日期的壁纸
    return content;
  }

  /**
   * 将新壁纸插入到已有的月度归档文件中（保持日期降序排列）
   *
   * 插入算法：
   * 1. 找到文件头部信息结束的位置（第一个 "## " 开头的行）
   * 2. 从头部之后开始遍历，找到第一个日期小于当前壁纸的位置
   * 3. 在该位置之前插入新内容，确保整体保持降序（最新在前）
   *
   * 优化：支持传入已有的 existingContent 参数，避免重复的文件 I/O
   *
   * @param {string} monthFile - 月度归档文件的完整路径
   * @param {Object} wallpaper - 要插入的壁纸数据
   * @param {string} newContent - 已生成的 Markdown 内容字符串
   * @param {string|null} existingContent - 可选的已有文件内容（传入可跳过文件读取）
   */
  async insertWallpaperIntoExistingFile(monthFile, wallpaper, newContent, existingContent = null) {
    // 如果没有提供现有内容，才从文件读取（避免重复 I/O）
    if (existingContent === null) {
      existingContent = await fs.readFile(monthFile, "utf8");
    }

    // 按行分割，便于逐行处理
    const lines = existingContent.split("\n");
    let insertIndex = -1;

    // 第一步：找到头部信息结束位置（即第一个日期标题所在行）
    let headerEndIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        headerEndIndex = i;
        break;
      }
    }

    // 特殊情况：如果没有任何日期标题，直接追加到末尾
    if (headerEndIndex === 0) {
      const updatedContent = existingContent + newContent;
      await fs.writeFile(monthFile, updatedContent, "utf8");
      // 更新统计
      await this.refreshMonthlyHeaderCount(monthFile);
      return;
    }

    // 第二步：在已有壁纸中查找正确的插入位置（保持日期降序）
    for (let i = headerEndIndex; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        // 提取现有壁纸的日期进行比较
        const existingDate = lines[i].substring(3).trim();
        // 如果当前壁纸日期 > 已有壁纸日期，说明应该插在这里（前面）
        if (wallpaper.date > existingDate) {
          insertIndex = i;
          break;
        }
      }
    }

    // 第三步：执行插入操作
    let updatedContent;
    if (insertIndex === -1) {
      // 没找到合适位置（当前壁纸是最早的），追加到文件末尾
      updatedContent = existingContent + newContent;
    } else {
      // 找到了位置，在该行之前插入新内容
      lines.splice(insertIndex, 0, ...newContent.split("\n"));
      updatedContent = lines.join("\n");
    }

    // 写入更新后的内容
    await fs.writeFile(monthFile, updatedContent, "utf8");

    // 最后更新文件头部的统计数量
    await this.refreshMonthlyHeaderCount(monthFile);
  }

  /**
   * 创建新的月度归档文件
   *
   * 文件结构：
   * - 一级标题：月份名称 + "必应壁纸"
   * - 统计行：初始为 1 张
   * - 第一张壁纸的内容
   *
   * @param {string} monthFile - 要创建的文件路径
   * @param {Object} wallpaper - 壁纸数据（用于生成标题中的月份）
   * @param {string} wallpaperContent - 壁纸的 Markdown 内容
   */
  async createNewMonthlyFile(monthFile, wallpaper, wallpaperContent) {
    let content = `# ${wallpaper.monthName} 必应壁纸\n\n`;
    content += `> 本月共收录 1 张壁纸\n\n`; // 初始计数为 1
    content += wallpaperContent;

    await fs.writeFile(monthFile, content, "utf8");
  }

  /**
   * 刷新月度文件头部的壁纸统计数量
   *
   * 统计规则：
   * 只计算以 "## YYYY-MM-DD" 格式开头的行（严格的日期正则匹配）
   * 这样可以避免误统计其他类型的二级标题
   *
   * 更新策略：
   * - 如果找到已有的统计行，直接替换数字
   * - 如果没找到（异常情况），在一级标题后插入新的统计行
   *
   * @param {string} monthFile - 要更新的月度文件路径
   */
  async refreshMonthlyHeaderCount(monthFile) {
    try {
      const content = await fs.readFile(monthFile, "utf8");
      const lines = content.split("\n");

      // 使用严格正则只匹配日期格式的二级标题：## 2025-12-24
      const count = lines.filter((line) =>
        /^## \d{4}-\d{2}-\d{2}/.test(line.trim())
      ).length;

      const newHeaderLine = `> 本月共收录 ${count} 张壁纸`;
      let updated = false;

      // 尝试更新已有的统计行
      const updatedLines = lines.map((line) => {
        if (line.startsWith("> 本月共收录")) {
          updated = true;
          return newHeaderLine;
        }
        return line;
      });

      // 异常情况处理：如果没有找到统计行，则在一级标题后插入
      if (!updated) {
        for (let i = 0; i < updatedLines.length; i++) {
          if (updatedLines[i].startsWith("# ")) {
            // 在一级标题后插入空行、统计行、空行
            updatedLines.splice(i + 1, 0, "");
            updatedLines.splice(i + 2, 0, newHeaderLine);
            updatedLines.splice(i + 3, 0, "");
            break;
          }
        }
      }

      await fs.writeFile(monthFile, updatedLines.join("\n"), "utf8");
    } catch (error) {
      // 统计更新失败不应影响主流程，仅记录警告
      console.warn(`更新月度统计失败: ${error.message}`);
    }
  }

  /**
   * 更新主 README.md 文件
   *
   * 优先增量更新：只替换 "今日壁纸" 部分，保留月壁纸网格、归档链接等不变的内容。
   * 仅在 README 不存在或缺少标记时才全量生成。
   *
   * @param {Object} latestWallpaper - 最新（今日）的壁纸数据
   */
  async updateReadme(latestWallpaper) {
    const todaySection = this.generateTodaySection(latestWallpaper);

    // 尝试增量更新：替换 "今日壁纸" 到下一个 "## " 之间的内容
    if (await fs.pathExists(this.readmeFile)) {
      const existing = await fs.readFile(this.readmeFile, "utf8");
      const updated = existing.replace(
        /## 今日壁纸[\s\S]*?(?=\n## )/,
        todaySection
      );
      if (updated !== existing) {
        await fs.writeFile(this.readmeFile, updated, "utf8");
        console.log("README 已增量更新");
        return;
      }
    }

    // 兜底：全量生成
    await this.generateFullReadme(latestWallpaper);
  }

  /**
   * 生成"今日壁纸"部分的 Markdown 内容
   *
   * @param {Object} wallpaper - 壁纸数据对象
   * @returns {string} "今日壁纸"部分的 Markdown 文本
   */
  generateTodaySection(wallpaper) {
    let content = `## 今日壁纸\n\n`;
    content += `**${wallpaper.title}** (${wallpaper.date})\n\n`;
    content += `![${wallpaper.title}](${wallpaper.imageUrl})\n\n`;
    content += `${wallpaper.description}\n\n`;
    content += `🔗 <a href="${wallpaper.downloadUrl4k}" target="_blank">下载 4K 高清版本</a>\n\n`;
    return content;
  }

  /**
   * 全量生成 README.md（仅在文件不存在或结构异常时使用）
   *
   * @param {Object} latestWallpaper - 最新（今日）的壁纸数据
   */
  async generateFullReadme(latestWallpaper) {
    let content = `# Bing Wallpaper\n\n`;
    content += this.generateTodaySection(latestWallpaper);

    // 当月壁纸网格
    const currentMonth = dayjs().format("YYYY-MM");
    const monthlyWallpapers = await this.getMonthlyWallpapers(currentMonth);

    content += `## ${currentMonth} 月壁纸 (${monthlyWallpapers.length} 张)\n\n`;
    content += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">\n\n`;

    const otherWallpapers = monthlyWallpapers
      .filter((wallpaper) => wallpaper.date !== latestWallpaper.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    for (const wallpaper of otherWallpapers) {
      content += `<div style="text-align: center;">\n`;
      content += `<img src="${wallpaper.imageUrl}" alt="${wallpaper.title}" style="width: 100%; border-radius: 8px;">\n`;
      content += `<p><strong>${wallpaper.date}</strong> <a href="${wallpaper.downloadUrl4k}" target="_blank">下载 4K</a></p>\n`;
      content += `<p>${wallpaper.title}</p>\n`;
      content += `</div>\n\n`;
    }
    content += `</div>\n\n`;

    // 历史归档链接
    content += `## 历史归档\n\n`;
    const archiveMonths = await this.getArchiveMonths();
    if (archiveMonths.length > 0) {
      const links = archiveMonths.map(month => `[${month}](./archives/${month}.md)`);
      content += links.join(" · ") + "\n\n";
    } else {
      content += `📁 [查看按月份归档的壁纸](./archives/)\n\n`;
    }

    // 关于
    content += `## 关于\n\n`;
    content += `🤖 本项目使用 GitHub Actions 每天自动获取必应壁纸并更新\n\n`;
    content += `📸 所有壁纸版权归微软及原作者所有\n\n`;

    await fs.writeFile(this.readmeFile, content, "utf8");
    console.log("README 已全量生成");
  }

  /**
   * 从 Markdown section 中提取壁纸的关键信息
   *
   * 使用正则匹配各字段，不依赖固定行号，对格式变化有更强的容错能力。
   *
   * @param {string} section - 单个壁纸的 Markdown 文本块（以 "## " 分割后的部分）
   * @returns {Object|null} 提取出的壁纸信息对象，无效则返回 null
   */
  extractWallpaperInfo(section) {
    const text = section.trim();

    // 日期：行首的 YYYY-MM-DD
    const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/m);
    // 标题：**xxx**
    const titleMatch = text.match(/\*\*(.*?)\*\*/);
    // 图片：![alt](url)
    const imageMatch = text.match(/!\[.*?\]\((.*?)\)/);
    // 下载链接：<a href="url"
    const downloadMatch = text.match(/<a href="(.*?)"/);

    if (dateMatch && titleMatch && imageMatch && downloadMatch) {
      return {
        date: dateMatch[1],
        title: titleMatch[1],
        imageUrl: imageMatch[1],
        downloadUrl4k: downloadMatch[1],
      };
    }

    return null;
  }

  /**
   * 获取指定月份的所有壁纸数据（使用缓存）
   *
   * 数据来源：从月度归档的 Markdown 文件中解析（优先使用缓存）
   * 解析方式：按 "## " 分割文件内容，逐个调用 extractWallpaperInfo 提取
   *
   * @param {string} monthKey - 月份键名（格式："YYYY-MM"，如 "2025-12"）
   * @returns {Promise<Array>} 该月的壁纸数组（按日期降序排列）
   */
  async getMonthlyWallpapers(monthKey) {
    const wallpapers = [];

    // 使用缓存读取月度文件
    const content = await this.readMonthlyFile(monthKey);

    if (content) {
      // 按 "## " 分割得到各个壁纸的 section
      // slice(1) 移除第一个空元素（因为文件开头就是 "## " 或 "# "）
      const sections = content.split("## ").slice(1);

      // 逐个解析每个壁纸 section
      for (const section of sections) {
        const wallpaperInfo = this.extractWallpaperInfo(section);
        if (wallpaperInfo) {
          wallpapers.push(wallpaperInfo);
        }
      }

      // 按日期降序排列（最新的壁纸排在前面）
      wallpapers.sort((a, b) => new Date(b.date) - new Date(a.date));

      console.log(`📦 已读取 ${monthKey} 的 ${wallpapers.length} 张壁纸`);
    } else {
      console.log(`ℹ️ ${monthKey} 归档文件不存在`);
    }

    return wallpapers;
  }

  /**
   * 获取所有可用的归档月份列表（使用缓存）
   *
   * 扫描 archives 目录下的所有 .md 文件（排除 README.md）
   * 返回值按时间降序排列（最近的月份在前）
   * 结果会被缓存 5 分钟以提高性能
   *
   * @returns {Promise<Array<string>>} 月份名称数组（如 ["2025-12", "2025-11"]）
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
        .filter((file) => file.endsWith(".md") && file !== "README.md") // 排除 README
        .map((file) => file.replace(".md", "")) // 移除扩展名得到 "2025-12" 格式
        .sort((a, b) => b.localeCompare(a)); // 字符串降序排列（最新的在前）

      // 更新缓存
      this.cache.archiveMonths = {
        months,
        timestamp: Date.now(),
      };

      console.log(`📦 已读取归档月份列表: ${months.length} 个月`);
      return months;
    } catch (error) {
      console.warn(`读取归档目录失败: ${error.message}`);
      return []; // 出错时返回空数组
    }
  }

  /**
   * 显示优化统计信息（调试/监控用途）
   *
   * 在每次执行完成后输出当前的优化状态：
   * - 缓存命中情况
   * - 重试配置参数
   *
   * 用于帮助开发者了解优化的实际效果
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
   * 主执行函数 - 完整的一次壁纸抓取与归档流程
   *
   * 执行步骤：
   * 1. 调用必应 API 获取今日壁纸数据（带自动重试）
   * 2. 数据标准化处理（日期转换、字段映射等）
   * 3. 保存到月度归档文件（自动去重 + 备份回滚）
   * 4. 更新 README.md 展示页面（使用缓存加速）
   * 5. 输出优化统计信息
   *
   * 错误处理：
   * - 任何步骤出错都会打印错误信息并以非零状态码退出
   * - 这对于 GitHub Actions 很重要：非零退出码会标记任务失败
   */
  async run() {
    try {
      console.log("🚀 开始获取今日必应壁纸...");
      console.log("⚡ 已启用优化: 重试机制 + 缓存 + 数据备份");

      // 步骤 1：获取今日壁纸原始数据（带重试）
      const todayWallpaper = await this.fetchTodayBingWallpaper();

      // 验证获取到的数据有效性
      if (!todayWallpaper || !todayWallpaper.url) {
        throw new Error("未能获取到有效的壁纸数据");
      }

      // 步骤 2：数据标准化处理
      const processedWallpaper =
        this.processSingleWallpaperData(todayWallpaper);

      console.log(
        `📸 获取到今日壁纸: ${processedWallpaper.title} (${processedWallpaper.date})`
      );

      // 步骤 3：保存到月度归档（自动去重 + 备份回滚）
      const saved = await this.appendToMonthlyArchive(processedWallpaper);

      if (saved) {
        console.log("✅ 今日壁纸已保存到归档");
      } else {
        console.log("ℹ️ 今日壁纸已存在，无需重复保存");
      }

      // 步骤 4：更新 README（每次都更新以确保数据最新）
      await this.updateReadme(processedWallpaper);

      // 步骤 5：输出优化统计信息
      this.showOptimizationStats();

      console.log("✅ 所有任务完成！");
    } catch (error) {
      console.error("❌ 执行失败:", error.message);
      // 使用非零退出码，让 GitHub Actions 知道任务失败了
      process.exit(1);
    }
  }
}

// 支持直接运行此文件进行测试
if (require.main === module) {
  const fetcher = new BingWallpaperFetcher();
  fetcher.run();
}

module.exports = BingWallpaperFetcher;
