const express = require("express");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const cors = require("cors");
const bucket = require("./public/js/firebase-config");

const app = express();
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

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
	const timestamp = Date.now(); // 生成一次時間戳
	const outputDir = `hls/${timestamp}`; // HLS 目錄
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

			// 等待所有 HLS 片段產生後再開始上傳
			setTimeout(async () => {
				if (fs.existsSync(`${outputDir}/index.m3u8`)) {
					console.log("📂 開始上傳到 Firebase...");
					const firebaseFolder = `coding-bit-video/${timestamp}`;
					try {
						await uploadDirectoryToFirebase(outputDir, firebaseFolder);

						// 影片的 Firebase Storage 公開 URL
						const publicUrl = `https://storage.googleapis.com/${bucket.name}/${firebaseFolder}/index.m3u8`;
						console.log("✅ 上傳到 Firebase 成功：", publicUrl);

						// 清理本地 HLS 檔案
						await fs.remove(inputPath);
						await fs.remove(outputDir);

						res.status(200).json({ src: publicUrl, title: "影片預覽" });

						// 回應成功結果，顯示 Firebase 上的影片 URL
						// res.render("successUpload", {
						// 	title: "影片預覽",
						// 	src: publicUrl,
						// });
					} catch (err) {
						console.error("❌ 上傳到 Firebase 失敗：", err);
						res.status(500).json({ error: "上傳到 Firebase 失敗" });
					}
				} else {
					console.error("❌ 錯誤：找不到 index.m3u8，可能 FFmpeg 轉換失敗");
					return res.status(500).json({ error: "FFmpeg 轉換失敗，無法找到 index.m3u8" });
				}
			}, 3000); // 等待 3 秒，確保所有 HLS 片段已寫入磁碟


			// await fs.remove(inputPath); // 刪除原始 MP4 檔案
			// res.json({ hlsUrl: `http://localhost:5000/${outputDir}/index.m3u8` });
		})
		.on("error", (err) => {
			console.error("❌ FFmpeg 轉換失敗：", err);
			res.status(500).json({ error: "HLS 轉換失敗" });
		})
		.run();
});

// 🔹 **將本地 HLS 目錄上傳到 Firebase**
async function uploadDirectoryToFirebase(localDir, remoteDir) {
	const files = fs.readdirSync(localDir);
	for (const file of files) {
		const localFilePath = path.join(localDir, file);
		const remoteFilePath = `${remoteDir}/${file}`;

		const stat = fs.statSync(localFilePath);
		if (stat.isDirectory()) {
			await uploadDirectoryToFirebase(localFilePath, remoteFilePath);
		} else {
			await uploadFileToFirebase(localFilePath, remoteFilePath);
		}
	}
}

// 🔹 **單個檔案上傳到 Firebase**
async function uploadFileToFirebase(localFilePath, remoteFilePath) {
	return new Promise((resolve, reject) => {
		console.log(`開始上傳: ${localFilePath} 到 ${remoteFilePath}`);
		bucket.upload(localFilePath, {
			destination: remoteFilePath,
			metadata: {
				cacheControl: "public, max-age=31536000",
			},
		})
			.then(async(file) => {
				console.log(`✅ 已上傳: ${remoteFilePath}`);
				// ✅ 設定檔案為公開
				await file[0].makePublic();

				resolve();
			})
			.catch((err) => {
				console.error(`❌ 上傳失敗: ${remoteFilePath}`, err);
				reject(err);
			});
	});
}

// 啟動伺服器
const PORT = 5000;
app.listen(PORT, () => {
	console.log(`🚀 伺服器運行中：http://localhost:${PORT}`);
});
