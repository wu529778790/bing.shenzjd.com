const BingWallpaperFetcher = require("./index.js");

/**
 * 独立的更新脚本
 * 可以用于手动更新或定时任务
 */
async function updateWallpapers() {
  const fetcher = new BingWallpaperFetcher();

  console.log("📅", new Date().toLocaleString("zh-CN"));
  console.log("🔄 开始更新必应壁纸...");

  try {
    await fetcher.run();
    console.log("🎉 壁纸更新成功！");
  } catch (error) {
    console.error("❌ 更新失败:", error.message);
    process.exit(1);
  }
}

// 执行更新
updateWallpapers();
