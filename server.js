const express = require("express");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const cors = require("cors");

const app = express();
app.use(cors()); // 允許跨域請求
app.use("/hls", express.static("hls")); // 釋出 HLS 目錄
app.use(express.static("hls")); // 提供 HLS 串流

// 設定 FFmpeg 路徑（避免手動安裝）
ffmpeg.setFfmpegPath(ffmpegStatic);

// 設定 Multer 來處理上傳
const upload = multer({ dest: "uploads/" });

// 影片上傳 API
app.post("/upload", upload.single("video"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "未上傳影片" });
    }

    const inputPath = req.file.path; // 上傳的 MP4 檔案
    const outputDir = `hls/${Date.now()}`; // HLS 目錄
    await fs.ensureDir(outputDir); // 確保 HLS 目錄存在

    console.log("🎬 開始轉換 HLS...");
    ffmpeg(inputPath)
        .outputOptions([
            "-profile:v baseline", // 適用於大多數設備
            "-level 3.0",
            "-start_number 0",
            "-hls_time 10", // 每個片段 10 秒
            "-hls_list_size 0",
            "-f hls"
        ])
        .output(`${outputDir}/index.m3u8`)
        .on("end", async () => {
            console.log("✅ HLS 轉換完成！");
            await fs.remove(inputPath); // 刪除原始 MP4 檔案
            res.json({ hlsUrl: `http://localhost:5000/${outputDir}/index.m3u8` });
        })
        .on("error", (err) => {
            console.error("❌ FFmpeg 轉換失敗：", err);
            res.status(500).json({ error: "HLS 轉換失敗" });
        })
        .run();
});

// 啟動伺服器
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`🚀 伺服器運行中：http://localhost:${PORT}`);
});
