const { getBingWallpaper } = require("bing-wallpaper-api");
const fs = require("fs-extra");
const dayjs = require("dayjs");
const path = require("path");

// 加载配置文件
const config = require("../config.json");

/**
 * 延迟函数
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 必应壁纸自动归档工具
 *
 * 数据存储：data/wallpapers.json（JSON 格式，单一数据源）
 * 页面生成：archives/YYYY-MM.html + README.md（由脚本生成，静态托管）
 */
class BingWallpaperFetcher {
  constructor() {
    this.dataFile = path.join(__dirname, config.dataFile);
    this.archiveDir = path.join(__dirname, config.archiveDir);
    this.readmeFile = path.join(__dirname, config.readmeFile);

    this.retryConfig = {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
    };
  }

  // ===== API 调用 =====

  async fetchWithRetry(apiCall, operationName, retryCount = 0) {
    try {
      return await apiCall();
    } catch (error) {
      if (retryCount >= this.retryConfig.maxRetries) {
        console.error(`❌ ${operationName} 在 ${this.retryConfig.maxRetries} 次重试后仍然失败`);
        throw error;
      }
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

  async fetchTodayBingWallpaper() {
    console.log("正在获取今日必应壁纸数据...");
    const targetDate = dayjs().format(config.dateFormat);

    const displayWallpaper = await this.fetchWithRetry(
      () => getBingWallpaper({ date: targetDate, resolution: config.displayResolution, market: config.market }),
      "获取 1080p 壁纸"
    );

    const downloadWallpaper = await this.fetchWithRetry(
      () => getBingWallpaper({ date: targetDate, resolution: config.downloadResolution, market: config.market }),
      "获取 4K 壁纸"
    );

    const wallpaperData = {
      ...displayWallpaper,
      displayUrl: displayWallpaper.url,
      downloadUrl4k: downloadWallpaper.url,
    };

    console.log("=== 今日壁纸数据 ===");
    console.log("标题:", wallpaperData.title);
    console.log("开始日期:", wallpaperData.startdate);
    console.log("===================");

    return wallpaperData;
  }

  processSingleWallpaperData(image) {
    const date = dayjs(image.startdate, config.dateInputFormat);
    const adjustedDate = date.add(1, "day");

    return {
      date: adjustedDate.format(config.dateFormat),
      title: image.title,
      copyright: image.copyright,
      copyrightlink: image.copyrightlink || "",
      imageUrl: image.displayUrl,
      downloadUrl4k: image.downloadUrl4k,
    };
  }

  // ===== JSON 数据操作 =====

  async loadData() {
    if (await fs.pathExists(this.dataFile)) {
      return JSON.parse(await fs.readFile(this.dataFile, "utf8"));
    }
    return [];
  }

  async saveData(data) {
    await fs.ensureDir(path.dirname(this.dataFile));
    await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2), "utf8");
  }

  wallpaperExists(data, date) {
    return data.some((w) => w.date === date);
  }

  addWallpaper(data, wallpaper) {
    data.push(wallpaper);
    data.sort((a, b) => b.date.localeCompare(a.date));
    return data;
  }

  getWallpapersByMonth(data, monthKey) {
    return data
      .filter((w) => w.date.startsWith(monthKey))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  getArchiveMonths(data) {
    const months = [...new Set(data.map((w) => w.date.substring(0, 7)))];
    return months.sort((a, b) => b.localeCompare(a));
  }

  // ===== 页面生成 =====

  generateReadme(data) {
    const latest = data[0];
    const currentMonth = dayjs().format("YYYY-MM");
    const monthlyWallpapers = this.getWallpapersByMonth(data, currentMonth);
    const archiveMonths = this.getArchiveMonths(data);

    let md = `# Bing Wallpaper\n\n`;

    // 今日壁纸
    md += `## 今日壁纸\n\n`;
    md += `**${latest.title}** (${latest.date})\n\n`;
    md += `![${latest.title}](${latest.imageUrl})\n\n`;
    if (latest.copyrightlink) {
      md += `[${latest.copyright}](${latest.copyrightlink})\n\n`;
    } else {
      md += `${latest.copyright}\n\n`;
    }
    md += `🔗 <a href="${latest.downloadUrl4k}" target="_blank">下载 4K 高清版本</a>\n\n`;

    // 当月壁纸网格
    const otherWallpapers = monthlyWallpapers.filter((w) => w.date !== latest.date);
    md += `## ${currentMonth} 月壁纸 (${monthlyWallpapers.length} 张)\n\n`;
    if (otherWallpapers.length > 0) {
      md += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">\n\n`;
      for (const w of otherWallpapers) {
        md += `<div style="text-align: center;">\n`;
        md += `<img src="${w.imageUrl}" alt="${w.title}" style="width: 100%; border-radius: 8px;">\n`;
        md += `<p><strong>${w.date}</strong> <a href="${w.downloadUrl4k}" target="_blank">下载 4K</a></p>\n`;
        md += `<p>${w.title}</p>\n`;
        md += `</div>\n\n`;
      }
      md += `</div>\n\n`;
    }

    // 归档链接
    md += `## 历史归档\n\n`;
    const links = archiveMonths.map((m) => `[${m}](./archives/${m}.html)`);
    md += links.join(" · ") + "\n\n";

    // 关于
    md += `## 关于\n\n`;
    md += `🤖 本项目使用 GitHub Actions 每天自动获取必应壁纸并更新\n\n`;
    md += `📸 所有壁纸版权归微软及原作者所有\n\n`;

    return md;
  }

  generateArchiveHTML(monthKey, data) {
    const wallpapers = this.getWallpapersByMonth(data, monthKey);
    const title = `${monthKey} 必应壁纸`;

    let cards = "";
    for (const w of wallpapers) {
      cards += `
      <div class="card">
        <img src="${w.imageUrl}" alt="${w.title}" loading="lazy">
        <div class="info">
          <h3>${w.date}</h3>
          <p class="title">${w.title}</p>
          <p class="copyright">${w.copyright}</p>
          <a href="${w.downloadUrl4k}" target="_blank">下载 4K</a>
        </div>
      </div>`;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .header { background: #fff; padding: 20px; text-align: center; border-bottom: 1px solid #eee; }
    .header h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .header a { color: #0969da; text-decoration: none; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
    .card { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card img { width: 100%; display: block; }
    .card .info { padding: 16px; }
    .card .info h3 { font-size: 0.9rem; color: #666; margin-bottom: 4px; }
    .card .info .title { font-size: 1.1rem; font-weight: 600; margin-bottom: 8px; }
    .card .info .copyright { font-size: 0.85rem; color: #888; margin-bottom: 12px; }
    .card .info a { display: inline-block; padding: 6px 16px; background: #0969da; color: #fff; border-radius: 6px; text-decoration: none; font-size: 0.85rem; }
    .card .info a:hover { background: #0550ae; }
    .back { display: inline-block; margin-bottom: 20px; color: #0969da; text-decoration: none; }
    .back:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="header">
    <h1><a href="/">bing.shenzjd.com</a></h1>
  </div>
  <div class="container">
    <a class="back" href="/">← 返回首页</a>
    <h2>${title}（${wallpapers.length} 张）</h2>
    <div class="grid">${cards}
    </div>
  </div>
</body>
</html>`;
  }

  generateIndexHTML(data) {
    const latest = data[0];
    const currentMonth = dayjs().format("YYYY-MM");
    const monthlyWallpapers = this.getWallpapersByMonth(data, currentMonth);
    const archiveMonths = this.getArchiveMonths(data);
    const otherWallpapers = monthlyWallpapers.filter((w) => w.date !== latest.date);

    let archiveLinks = archiveMonths.map((m) => `<a href="./archives/${m}.html">${m}</a>`).join("\n        ");

    let grid = "";
    for (const w of otherWallpapers) {
      grid += `
          <div class="thumb">
            <img src="${w.imageUrl}" alt="${w.title}" loading="lazy">
            <p><strong>${w.date}</strong> <a href="${w.downloadUrl4k}" target="_blank">4K</a></p>
            <p>${w.title}</p>
          </div>`;
    }

    const copyrightHtml = latest.copyrightlink
      ? `<a href="${latest.copyrightlink}" target="_blank">${latest.copyright}</a>`
      : latest.copyright;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bing Wallpaper | bing.shenzjd.com</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .header { background: #fff; padding: 20px; text-align: center; border-bottom: 1px solid #eee; }
    .header h1 { font-size: 1.5rem; }
    .header h1 a { color: #333; text-decoration: none; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .hero { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px; }
    .hero img { width: 100%; display: block; }
    .hero .info { padding: 20px; }
    .hero .info h2 { font-size: 1.3rem; margin-bottom: 4px; }
    .hero .info .date { color: #666; font-size: 0.9rem; margin-bottom: 8px; }
    .hero .info .copyright { color: #888; font-size: 0.85rem; margin-bottom: 12px; }
    .hero .info .copyright a { color: #888; }
    .hero .info a.btn { display: inline-block; padding: 8px 20px; background: #0969da; color: #fff; border-radius: 6px; text-decoration: none; font-size: 0.9rem; }
    .hero .info a.btn:hover { background: #0550ae; }
    .section-title { font-size: 1.1rem; margin: 24px 0 16px; color: #333; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .thumb { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
    .thumb img { width: 100%; display: block; }
    .thumb p { padding: 0 12px 4px; font-size: 0.85rem; }
    .thumb p strong { color: #666; }
    .thumb p a { color: #0969da; text-decoration: none; }
    .archives { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px; }
    .archives h2 { font-size: 1.1rem; margin-bottom: 12px; }
    .archives .links { display: flex; flex-wrap: wrap; gap: 8px; }
    .archives .links a { padding: 4px 12px; background: #f0f0f0; border-radius: 4px; color: #0969da; text-decoration: none; font-size: 0.9rem; }
    .archives .links a:hover { background: #e0e0e0; }
    .footer { text-align: center; padding: 20px; color: #999; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1><a href="/">bing.shenzjd.com</a></h1>
  </div>
  <div class="container">
    <div class="hero">
      <img src="${latest.imageUrl}" alt="${latest.title}">
      <div class="info">
        <h2>${latest.title}</h2>
        <p class="date">${latest.date}</p>
        <p class="copyright">${copyrightHtml}</p>
        <a class="btn" href="${latest.downloadUrl4k}" target="_blank">下载 4K 高清版本</a>
      </div>
    </div>

    <h3 class="section-title">${currentMonth} 月壁纸（${monthlyWallpapers.length} 张）</h3>
    <div class="grid">${grid}
    </div>

    <div class="archives">
      <h2>历史归档</h2>
      <div class="links">
        ${archiveLinks}
      </div>
    </div>

    <div class="footer">
      🤖 GitHub Actions 每天自动更新 · 📸 壁纸版权归微软及原作者所有
    </div>
  </div>
</body>
</html>`;
  }

  async generateAllPages(data) {
    await fs.ensureDir(this.archiveDir);

    // 生成首页
    const indexHtml = this.generateIndexHTML(data);
    await fs.writeFile(path.join(__dirname, "../index.html"), indexHtml, "utf8");
    console.log("✅ index.html 已生成");

    // 生成 README（给 GitHub 仓库页面看）
    const readme = this.generateReadme(data);
    await fs.writeFile(this.readmeFile, readme, "utf8");
    console.log("✅ README.md 已生成");

    // 生成归档 HTML
    const months = this.getArchiveMonths(data);
    for (const month of months) {
      const html = this.generateArchiveHTML(month, data);
      await fs.writeFile(path.join(this.archiveDir, `${month}.html`), html, "utf8");
    }
    console.log(`✅ ${months.length} 个归档页面已生成`);
  }

  // ===== 主流程 =====

  async run() {
    try {
      console.log("🚀 开始获取今日必应壁纸...");

      const todayWallpaper = await this.fetchTodayBingWallpaper();
      if (!todayWallpaper || !todayWallpaper.url) {
        throw new Error("未能获取到有效的壁纸数据");
      }

      const processed = this.processSingleWallpaperData(todayWallpaper);
      console.log(`📸 获取到今日壁纸: ${processed.title} (${processed.date})`);

      // 读取数据 → 去重 → 追加 → 保存
      const data = await this.loadData();
      if (this.wallpaperExists(data, processed.date)) {
        console.log(`ℹ️ 壁纸 ${processed.date} 已存在，跳过保存`);
      } else {
        this.addWallpaper(data, processed);
        await this.saveData(data);
        console.log(`✅ 已保存壁纸到 JSON`);
      }

      // 生成页面
      await this.generateAllPages(data);

      console.log("✅ 所有任务完成！");
    } catch (error) {
      console.error("❌ 执行失败:", error.message);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  const fetcher = new BingWallpaperFetcher();
  fetcher.run();
}

module.exports = BingWallpaperFetcher;
