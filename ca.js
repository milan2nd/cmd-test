const axios = require("axios");
const request = require("request");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { createCanvas, loadImage, registerFont } = require('canvas');

module.exports = {
  config: {
    name: "ca",
    aliases: [],
    version: "1.0",
    author: "yourmom",
    countDown: 5,
    role: 0,
    shortDescription: "Add a caption to a video",
    longDescription: "Add a caption to a video",
    category: "fun",
    guide: "{pn} captionvideo <text>",
  },
  onStart: async function ({ api, event, message, args }) {
    try {
      if (event.messageReply && event.messageReply.attachments.length > 0) {
        const videoUrl = event.messageReply.attachments[0].url;
        const captionText = args.join(" ");
        const initialReply = await api.sendMessage("Adding caption to video...", event.threadID);

        const cacheDir = path.join(__dirname, "cache");
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }

        const inputVideoPath = path.join(cacheDir, "input.mp4");
        const framesDir = path.join(cacheDir, "frames");
        const outputVideoPath = path.join(cacheDir, "output.mp4");
        const tempAudioPath = path.join(cacheDir, "audio.mp3");
        const fontPath = path.join(__dirname, "assets/font/BeVietnamPro-Regular.ttf");

        // Register the font
        registerFont(fontPath, { family: 'BeVietnamPro-Regular' });

        const videoStream = fs.createWriteStream(inputVideoPath);
        const rqs = request(encodeURI(videoUrl));
        rqs.pipe(videoStream);

        videoStream.on("finish", async () => {
          // Extract audio from video
          await extractAudio(inputVideoPath, tempAudioPath);

          // Extract frames from video
          if (!fs.existsSync(framesDir)) {
            fs.mkdirSync(framesDir, { recursive: true });
          }
          await extractFrames(inputVideoPath, framesDir);

          // Process each frame
          const frameFiles = fs.readdirSync(framesDir);
          for (const file of frameFiles) {
            await drawCaptionOnFrame(path.join(framesDir, file), captionText);
          }

          // Reassemble frames into video and merge audio
          await createVideoFromFramesWithAudio(framesDir, tempAudioPath, outputVideoPath);

          await api.sendMessage(
            {
              body: "Here is your captioned video:",
              attachment: fs.createReadStream(outputVideoPath),
            },
            event.threadID,
            event.messageID
          );

          setTimeout(() => {
            api.deleteMessage(initialReply.messageID);
          }, 5000);

          // Cleanup
          fs.unlinkSync(inputVideoPath);
          fs.unlinkSync(outputVideoPath);
          fs.unlinkSync(tempAudioPath);
          fs.rmdirSync(framesDir, { recursive: true });
        });

        videoStream.on("error", (err) => {
          api.sendMessage(`An error occurred while downloading the video: ${err}`, event.threadID, event.messageID);
        });
      } else {
        message.reply("Please reply to a video with your caption text.");
      }
    } catch (error) {
      api.sendMessage("An error occurred while generating the video: " + error, event.threadID, event.messageID);
    }
  },
};

async function extractAudio(inputVideoPath, audioOutputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputVideoPath)
      .noVideo()
      .save(audioOutputPath)
      .on('end', resolve)
      .on('error', reject);
  });
}

async function extractFrames(inputVideoPath, framesDir) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputVideoPath)
      .on('end', resolve)
      .on('error', reject)
      .save(`${framesDir}/frame_%04d.png`);
  });
}

async function drawCaptionOnFrame(framePath, captionText) {
  const image = await loadImage(framePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  // Draw the frame
  ctx.drawImage(image, 0, 0);

  // Draw the caption
  ctx.font = '30px "BeVietnamPro-Regular"';
  ctx.fillStyle = 'black';
  ctx.textAlign = 'center';

  // Handle text wrapping
  const maxWidth = canvas.width - 40; // Padding from the sides
  const lineHeight = 35;
  const x = canvas.width / 2;
  let y = 50;

  const words = captionText.split(' ');
  let line = '';

  for (const word of words) {
    const testLine = line + word + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && line.length > 0) {
      ctx.fillText(line, x, y);
      line = word + ' ';
      y += lineHeight;
    } else {
      line = testLine;
    }
  }

  ctx.fillText(line, x, y);

  // Save the frame
  const out = fs.createWriteStream(framePath);
  const stream = canvas.createPNGStream();
  stream.pipe(out);
  await new Promise(resolve => out.on('finish', resolve));
}

async function createVideoFromFramesWithAudio(framesDir, audioInputPath, outputVideoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(`${framesDir}/frame_%04d.png`)
      .input(audioInputPath)
      .outputOptions('-c:v libx264', '-pix_fmt yuv420p', '-c:a aac')
      .on('end', resolve)
      .on('error', reject)
      .save(outputVideoPath);
  });
}
