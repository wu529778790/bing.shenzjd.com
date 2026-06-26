const { getBingWallpaper } = require("bing-wallpaper-api");
const fs = require("fs-extra");
const dayjs = require("dayjs");
const path = require("path");

const config = require("../config.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 必应壁纸自动归档工具
 *
 * 数据存储：data/YYYY-MM.json（按月分文件）
 * 页面生成：archives/YYYY-MM.html + index.html + README.md
 */
class BingWallpaperFetcher {
  constructor() {
    this.dataDir = path.join(__dirname, config.dataDir);
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

  // ===== JSON 数据操作（按月分文件）=====

  /**
   * 获取某月数据文件路径
   */
  getMonthFile(monthKey) {
    return path.join(this.dataDir, `${monthKey}.json`);
  }

  /**
   * 读取某月的壁纸数据
   */
  async loadMonth(monthKey) {
    const file = this.getMonthFile(monthKey);
    if (await fs.pathExists(file)) {
      return JSON.parse(await fs.readFile(file, "utf8"));
    }
    return [];
  }

  /**
   * 保存某月的壁纸数据
   */
  async saveMonth(monthKey, data) {
    await fs.ensureDir(this.dataDir);
    data.sort((a, b) => b.date.localeCompare(a.date));
    await fs.writeFile(this.getMonthFile(monthKey), JSON.stringify(data, null, 2), "utf8");
  }

  /**
   * 读取所有月份的数据（用于生成页面）
   */
  async loadAllData() {
    await fs.ensureDir(this.dataDir);
    const files = (await fs.readdir(this.dataDir))
      .filter((f) => f.endsWith(".json"))
      .sort((a, b) => b.localeCompare(a));

    const allData = [];
    for (const file of files) {
      const monthData = JSON.parse(await fs.readFile(path.join(this.dataDir, file), "utf8"));
      allData.push(...monthData);
    }
    allData.sort((a, b) => b.date.localeCompare(a.date));
    return allData;
  }

  /**
   * 获取所有已存在的月份列表
   */
  async getArchiveMonths() {
    await fs.ensureDir(this.dataDir);
    return (await fs.readdir(this.dataDir))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .sort((a, b) => b.localeCompare(a));
  }

  // ===== 页面生成 =====

  generateReadme(data, archiveMonths) {
    const latest = data[0];
    const currentMonth = dayjs().format("YYYY-MM");
    const monthlyWallpapers = data.filter((w) => w.date.startsWith(currentMonth));

    let md = `# Bing Wallpaper\n\n`;

    md += `## 今日壁纸\n\n`;
    md += `**${latest.title}** (${latest.date})\n\n`;
    md += `![${latest.title}](${latest.imageUrl})\n\n`;
    if (latest.copyrightlink) {
      md += `[${latest.copyright}](${latest.copyrightlink})\n\n`;
    } else {
      md += `${latest.copyright}\n\n`;
    }
    md += `🔗 <a href="${latest.downloadUrl4k}" target="_blank">下载 4K 高清版本</a>\n\n`;

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

    md += `## 历史归档\n\n`;
    const links = archiveMonths.map((m) => `[${m}](./archives/${m}.html)`);
    md += links.join(" · ") + "\n\n";

    md += `## 关于\n\n`;
    md += `🤖 本项目使用 GitHub Actions 每天自动获取必应壁纸并更新\n\n`;
    md += `📸 所有壁纸版权归微软及原作者所有\n\n`;

    return md;
  }

  generateArchiveHTML(monthKey, wallpapers) {
    const title = `${monthKey} 必应壁纸`;

    let cards = "";
    for (const w of wallpapers) {
      cards += `
      <div class="card" onclick="openLightbox('${w.downloadUrl4k.replace(/'/g, "\\'")}','${w.title.replace(/'/g, "\\'")}','${w.date}','${w.copyright.replace(/'/g, "\\'")}')">
        <img src="${w.imageUrl}" alt="${w.title}" loading="lazy" width="640" height="360">
        <div class="overlay">
          <span class="card-title">${w.title}</span>
          <span class="card-date">${w.date}</span>
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
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e4e4e7}
    a{color:#a1a1aa;text-decoration:none}a:hover{color:#fafafa}

    .nav{padding:20px clamp(16px,4vw,48px);max-width:1400px;margin:0 auto}
    .nav a{font-size:.85rem;color:#52525b;transition:color .2s}.nav a:hover{color:#fafafa}

    .section{max-width:1400px;margin:0 auto;padding:0 clamp(16px,4vw,48px) 60px}
    .section h1{font-size:clamp(1.5rem,3vw,2rem);font-weight:700;color:#fafafa;margin-bottom:8px}
    .section .count{font-size:.85rem;color:#52525b;margin-bottom:32px;display:block}

    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .card{position:relative;border-radius:10px;overflow:hidden;cursor:pointer;opacity:0;transform:translateY(20px);transition:opacity .5s,transform .5s}
    .card.visible{opacity:1;transform:translateY(0)}
    .card img{width:100%;aspect-ratio:16/9;object-fit-cover;display:block;transition:transform .4s}
    .card:hover img{transform:scale(1.05)}
    .card .overlay{position:absolute;inset:0;background:linear-gradient(0deg,rgba(10,10,10,.8) 0%,transparent 50%);display:flex;flex-direction:column;justify-content:flex-end;padding:16px;opacity:0;transition:opacity .3s}
    .card:hover .overlay{opacity:1}
    .card .overlay .card-title{font-size:.95rem;font-weight:500;color:#fafafa}
    .card .overlay .card-date{font-size:.8rem;color:#a1a1aa;margin-top:4px}

    .lightbox{display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.92);backdrop-filter:blur(8px);align-items:center;justify-content:center;cursor:zoom-out}
    .lightbox.active{display:flex}
    .lightbox img{max-width:92vw;max-height:88vh;object-fit:contain;border-radius:4px}
    .lightbox .lb-info{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);text-align:center;color:#a1a1aa}
    .lightbox .lb-info .lb-title{font-size:1rem;color:#fafafa;margin-bottom:4px}
    .lightbox .lb-info .lb-meta{font-size:.8rem;color:#71717a}
    .lightbox .lb-close{position:absolute;top:24px;right:24px;width:40px;height:40px;background:#18181b;border:1px solid #27272a;border-radius:50%;color:#a1a1aa;font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
    .lightbox .lb-close:hover{background:#27272a;color:#fafafa}
    .lightbox .lb-download{position:absolute;top:24px;right:80px;padding:8px 20px;background:#fafafa;color:#0a0a0a;border-radius:6px;font-size:.85rem;font-weight:500;cursor:pointer;text-decoration:none;transition:all .2s}
    .lightbox .lb-download:hover{background:#d4d4d8}

    @media(max-width:640px){
      .grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
      .card .overlay{opacity:1;background:linear-gradient(0deg,rgba(10,10,10,.7) 0%,transparent 40%)}
    }
  </style>
</head>
<body>
  <div class="nav"><a href="/">← 返回首页</a></div>
  <div class="section">
    <h1>${title}</h1>
    <span class="count">${wallpapers.length} 张壁纸</span>
    <div class="grid">${cards}
    </div>
  </div>

  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <button class="lb-close" onclick="closeLightbox()" aria-label="关闭">&times;</button>
    <a class="lb-download" id="lb-download" href="#" target="_blank" rel="noopener" onclick="event.stopPropagation()">下载 4K</a>
    <img id="lb-img" src="" alt="">
    <div class="lb-info">
      <div class="lb-title" id="lb-title"></div>
      <div class="lb-meta" id="lb-meta"></div>
    </div>
  </div>

  <script>
    function openLightbox(url,title,date,copyright){
      document.getElementById('lb-img').src=url;
      document.getElementById('lb-title').textContent=title;
      document.getElementById('lb-meta').textContent=date+' · '+copyright;
      document.getElementById('lb-download').href=url;
      document.getElementById('lightbox').classList.add('active');
      document.body.style.overflow='hidden';
    }
    function closeLightbox(){
      document.getElementById('lightbox').classList.remove('active');
      document.body.style.overflow='';
    }
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLightbox()});

    const observer=new IntersectionObserver(entries=>{
      entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}});
    },{threshold:0.1});
    document.querySelectorAll('.card').forEach(c=>observer.observe(c));
  </script>
</body>
</html>`;
  }

  generateIndexHTML(data, archiveMonths) {
    const latest = data[0];
    const currentMonth = dayjs().format("YYYY-MM");
    const monthlyWallpapers = data.filter((w) => w.date.startsWith(currentMonth));
    const otherWallpapers = monthlyWallpapers.filter((w) => w.date !== latest.date);

    const archiveLinks = archiveMonths.map((m) => `<a href="./archives/${m}.html">${m}</a>`).join("\n          ");

    let grid = "";
    for (const w of otherWallpapers) {
      grid += `
        <div class="card" onclick="openLightbox('${w.downloadUrl4k.replace(/'/g, "\\'")}','${w.title.replace(/'/g, "\\'")}','${w.date}','${w.copyright.replace(/'/g, "\\'")}')">
          <img src="${w.imageUrl}" alt="${w.title}" loading="lazy" width="640" height="360">
          <div class="overlay">
            <span class="card-title">${w.title}</span>
            <span class="card-date">${w.date}</span>
          </div>
        </div>`;
    }

    const copyrightHtml = latest.copyrightlink
      ? `<a href="${latest.copyrightlink}" target="_blank" rel="noopener">${latest.copyright}</a>`
      : latest.copyright;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bing Wallpaper | bing.shenzjd.com</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e4e4e7}
    a{color:#a1a1aa;text-decoration:none}a:hover{color:#fafafa}

    /* Hero */
    .hero{position:relative;width:100%;height:100vh;min-height:500px;overflow:hidden}
    .hero img{width:100%;height:100%;object-fit-cover;transition:transform 8s ease}
    .hero:hover img{transform:scale(1.03)}
    .hero .gradient{position:absolute;inset:0;background:linear-gradient(0deg,rgba(10,10,10,.95) 0%,rgba(10,10,10,.4) 40%,transparent 70%)}
    .hero .content{position:absolute;bottom:0;left:0;right:0;padding:48px clamp(24px,5vw,80px)}
    .hero .content h1{font-size:clamp(1.8rem,4vw,3rem);font-weight:700;color:#fafafa;margin-bottom:8px;letter-spacing:-.02em}
    .hero .content .meta{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px}
    .hero .content .date{font-size:.9rem;color:#a1a1aa}
    .hero .content .copyright{font-size:.85rem;color:#71717a}
    .hero .content .copyright a{color:#71717a}.hero .content .copyright a:hover{color:#a1a1aa}
    .hero .content .btn{display:inline-flex;align-items:center;gap:8px;padding:12px 28px;background:#fafafa;color:#0a0a0a;border-radius:8px;font-size:.9rem;font-weight:500;cursor:pointer;transition:all .2s;border:none;text-decoration:none}
    .hero .content .btn:hover{background:#d4d4d8;transform:translateY(-1px)}
    .hero .scroll-hint{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:#52525b;font-size:.75rem;animation:bounce 2s infinite}
    @keyframes bounce{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-6px)}}

    /* Section */
    .section{max-width:1400px;margin:0 auto;padding:60px clamp(16px,4vw,48px)}
    .section-header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:32px}
    .section-header h2{font-size:1.3rem;font-weight:600;color:#e4e4e7}
    .section-header .count{font-size:.85rem;color:#52525b}

    /* Grid */
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .card{position:relative;border-radius:10px;overflow:hidden;cursor:pointer;opacity:0;transform:translateY(20px);transition:opacity .5s,transform .5s}
    .card.visible{opacity:1;transform:translateY(0)}
    .card img{width:100%;aspect-ratio:16/9;object-fit-cover;display:block;transition:transform .4s}
    .card:hover img{transform:scale(1.05)}
    .card .overlay{position:absolute;inset:0;background:linear-gradient(0deg,rgba(10,10,10,.8) 0%,transparent 50%);display:flex;flex-direction:column;justify-content:flex-end;padding:16px;opacity:0;transition:opacity .3s}
    .card:hover .overlay{opacity:1}
    .card .overlay .card-title{font-size:.95rem;font-weight:500;color:#fafafa}
    .card .overlay .card-date{font-size:.8rem;color:#a1a1aa;margin-top:4px}

    /* Archives */
    .archives{margin-top:24px}
    .archives h3{font-size:1rem;color:#71717a;margin-bottom:16px}
    .archives .links{display:flex;flex-wrap:wrap;gap:8px}
    .archives .links a{padding:6px 16px;background:#18181b;border:1px solid #27272a;border-radius:6px;color:#a1a1aa;font-size:.85rem;transition:all .2s}
    .archives .links a:hover{background:#27272a;color:#fafafa;border-color:#3f3f46}

    /* Footer */
    .footer{text-align:center;padding:40px 20px;color:#3f3f46;font-size:.75rem;border-top:1px solid#18181b;margin-top:60px}

    /* Lightbox */
    .lightbox{display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.92);backdrop-filter:blur(8px);align-items:center;justify-content:center;cursor:zoom-out}
    .lightbox.active{display:flex}
    .lightbox img{max-width:92vw;max-height:88vh;object-fit:contain;border-radius:4px}
    .lightbox .lb-info{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);text-align:center;color:#a1a1aa}
    .lightbox .lb-info .lb-title{font-size:1rem;color:#fafafa;margin-bottom:4px}
    .lightbox .lb-info .lb-meta{font-size:.8rem;color:#71717a}
    .lightbox .lb-close{position:absolute;top:24px;right:24px;width:40px;height:40px;background:#18181b;border:1px solid #27272a;border-radius:50%;color:#a1a1aa;font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
    .lightbox .lb-close:hover{background:#27272a;color:#fafafa}
    .lightbox .lb-download{position:absolute;top:24px;right:80px;padding:8px 20px;background:#fafafa;color:#0a0a0a;border-radius:6px;font-size:.85rem;font-weight:500;cursor:pointer;text-decoration:none;transition:all .2s}
    .lightbox .lb-download:hover{background:#d4d4d8}

    @media(max-width:640px){
      .hero{min-height:70vh}
      .grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
      .card .overlay{opacity:1;background:linear-gradient(0deg,rgba(10,10,10,.7) 0%,transparent 40%)}
      .section{padding:40px 16px}
    }
  </style>
</head>
<body>
  <div class="hero">
    <img src="${latest.imageUrl}" alt="${latest.title}" width="1920" height="1080">
    <div class="gradient"></div>
    <div class="content">
      <h1>${latest.title}</h1>
      <div class="meta">
        <span class="date">${latest.date}</span>
        <span class="copyright">${copyrightHtml}</span>
      </div>
      <a class="btn" href="${latest.downloadUrl4k}" target="_blank" rel="noopener">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        下载 4K
      </a>
    </div>
    <div class="scroll-hint">向下滚动</div>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>${currentMonth} 月壁纸</h2>
      <span class="count">${monthlyWallpapers.length} 张</span>
    </div>
    <div class="grid">${grid}
    </div>

    <div class="archives">
      <h3>历史归档</h3>
      <div class="links">
          ${archiveLinks}
      </div>
    </div>
  </div>

  <div class="footer">
    GitHub Actions 每天自动更新 · 壁纸版权归微软及原作者所有
  </div>

  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <button class="lb-close" onclick="closeLightbox()" aria-label="关闭">&times;</button>
    <a class="lb-download" id="lb-download" href="#" target="_blank" rel="noopener" onclick="event.stopPropagation()">下载 4K</a>
    <img id="lb-img" src="" alt="">
    <div class="lb-info">
      <div class="lb-title" id="lb-title"></div>
      <div class="lb-meta" id="lb-meta"></div>
    </div>
  </div>

  <script>
    function openLightbox(url,title,date,copyright){
      document.getElementById('lb-img').src=url;
      document.getElementById('lb-title').textContent=title;
      document.getElementById('lb-meta').textContent=date+' · '+copyright;
      document.getElementById('lb-download').href=url;
      document.getElementById('lightbox').classList.add('active');
      document.body.style.overflow='hidden';
    }
    function closeLightbox(){
      document.getElementById('lightbox').classList.remove('active');
      document.body.style.overflow='';
    }
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLightbox()});

    const observer=new IntersectionObserver(entries=>{
      entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}});
    },{threshold:0.1});
    document.querySelectorAll('.card').forEach(c=>observer.observe(c));
  </script>
</body>
</html>`;
  }

  async generateAllPages() {
    await fs.ensureDir(this.archiveDir);
    const archiveMonths = await this.getArchiveMonths();
    const allData = await this.loadAllData();

    if (allData.length === 0) {
      console.log("⚠️ 没有数据，跳过页面生成");
      return;
    }

    // 首页
    const indexHtml = this.generateIndexHTML(allData, archiveMonths);
    await fs.writeFile(path.join(__dirname, "../index.html"), indexHtml, "utf8");
    console.log("✅ index.html 已生成");

    // README
    const readme = this.generateReadme(allData, archiveMonths);
    await fs.writeFile(this.readmeFile, readme, "utf8");
    console.log("✅ README.md 已生成");

    // 归档页面（只为有数据的月份生成）
    for (const month of archiveMonths) {
      const monthData = await this.loadMonth(month);
      const html = this.generateArchiveHTML(month, monthData);
      await fs.writeFile(path.join(this.archiveDir, `${month}.html`), html, "utf8");
    }
    console.log(`✅ ${archiveMonths.length} 个归档页面已生成`);
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
      const monthKey = processed.date.substring(0, 7);
      console.log(`📸 获取到今日壁纸: ${processed.title} (${processed.date})`);

      // 读取当月数据 → 去重 → 追加 → 保存
      const monthData = await this.loadMonth(monthKey);
      const exists = monthData.some((w) => w.date === processed.date);

      if (exists) {
        console.log(`ℹ️ 壁纸 ${processed.date} 已存在，跳过保存`);
      } else {
        monthData.push(processed);
        await this.saveMonth(monthKey, monthData);
        console.log(`✅ 已保存到 data/${monthKey}.json`);
      }

      // 生成页面
      await this.generateAllPages();

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
