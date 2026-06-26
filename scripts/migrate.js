/**
 * 迁移脚本：将 archives/*.md 转换为 data/wallpapers.json
 *
 * 一次性使用，运行方式：node scripts/migrate.js
 */

const fs = require("fs-extra");
const path = require("path");

const ARCHIVE_DIR = path.join(__dirname, "../archives");
const OUTPUT_FILE = path.join(__dirname, "../data/wallpapers.json");

/**
 * 从单个壁纸 section 中提取数据
 */
function extractWallpaper(section) {
  const text = section.trim();

  const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/m);
  const titleMatch = text.match(/\*\*(.*?)\*\*/);
  const imageMatch = text.match(/!\[.*?\]\((.*?)\)/);
  const downloadMatch = text.match(/<a href="(.*?)"/);
  // 版权链接：[text](url) 格式，排除图片 ![...] 和下载链接 <a>
  const copyrightMatch = text.match(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);

  if (!dateMatch || !titleMatch || !imageMatch || !downloadMatch) {
    return null;
  }

  return {
    date: dateMatch[1],
    title: titleMatch[1],
    imageUrl: imageMatch[1],
    downloadUrl4k: downloadMatch[1],
    copyright: copyrightMatch ? copyrightMatch[1] : titleMatch[1],
    copyrightlink: copyrightMatch ? copyrightMatch[2] : "",
  };
}

async function migrate() {
  console.log("🚀 开始迁移 Markdown → JSON...\n");

  const files = (await fs.readdir(ARCHIVE_DIR))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();

  console.log(`找到 ${files.length} 个月度归档文件`);

  const allWallpapers = [];

  for (const file of files) {
    const content = await fs.readFile(path.join(ARCHIVE_DIR, file), "utf8");
    const sections = content.split("## ").slice(1);

    let count = 0;
    for (const section of sections) {
      const wallpaper = extractWallpaper(section);
      if (wallpaper) {
        allWallpapers.push(wallpaper);
        count++;
      }
    }
    console.log(`  ${file}: ${count} 张壁纸`);
  }

  // 按日期降序排列
  allWallpapers.sort((a, b) => b.date.localeCompare(a.date));

  // 写入 JSON
  await fs.ensureDir(path.dirname(OUTPUT_FILE));
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(allWallpapers, null, 2), "utf8");

  console.log(`\n✅ 迁移完成！共 ${allWallpapers.length} 张壁纸`);
  console.log(`📁 输出文件: ${OUTPUT_FILE}`);
}

migrate().catch((err) => {
  console.error("❌ 迁移失败:", err.message);
  process.exit(1);
});
