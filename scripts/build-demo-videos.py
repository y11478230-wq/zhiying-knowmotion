"""Build two clearly labeled, playable community demo clips."""
from pathlib import Path
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = Path(r"C:\Windows\Fonts\msyh.ttc")

CLIPS = {
    "demo-hello": [
        ("从一行输出开始", "printf(\"Hello, world!\\n\");", "把文字交给标准输出"),
        ("代码先交给编译器", "gcc main.c -o main.exe", "源代码变成可执行程序"),
        ("运行后看到结果", "Hello, world!", "写代码 → 编译 → 运行"),
    ],
    "demo-sky": [
        ("太阳光包含多种颜色", "阳光进入大气", "不同颜色的光，会有不同的传播表现"),
        ("蓝光更容易被散射", "蓝光从更多方向进入眼睛", "空气中的微小粒子改变光的传播方向"),
        ("所以白天天空常呈蓝色", "日落时颜色还会改变", "观察现象，再追问背后的原因"),
    ],
}


def frame(title, main, subtitle, index, is_sky):
    image = Image.new("RGB", (1280, 720), "#f8fbf9")
    draw = ImageDraw.Draw(image)
    accent = "#227e9f" if is_sky else "#087f69"
    pale = "#e8f4fa" if is_sky else "#e7f6ef"
    draw.rounded_rectangle((72, 62, 1208, 658), radius=34, fill="white", outline="#dcebe5", width=2)
    draw.rounded_rectangle((116, 104, 326, 148), radius=18, fill=pale)
    draw.text((137, 112), "知映 · 演示视频", fill=accent, font=ImageFont.truetype(FONT, 24))
    draw.text((118, 206), f"0{index} / 03", fill=accent, font=ImageFont.truetype(FONT, 28))
    draw.text((118, 261), title, fill="#153d43", font=ImageFont.truetype(FONT, 51))
    draw.rounded_rectangle((116, 363, 1164, 487), radius=20, fill=pale)
    draw.text((146, 397), main, fill="#173f43", font=ImageFont.truetype(FONT, 36))
    draw.text((120, 540), subtitle, fill="#71867e", font=ImageFont.truetype(FONT, 26))
    draw.rounded_rectangle((118, 601, 118 + 1046 * index // 3, 609), radius=4, fill=accent)
    return image


for name, slides in CLIPS.items():
    with tempfile.TemporaryDirectory() as tmp:
        for index, (title, main, subtitle) in enumerate(slides, 1):
            frame(title, main, subtitle, index, name == "demo-sky").save(Path(tmp) / f"scene{index:03d}.png")
        output = ROOT / "examples" / f"{name}.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-framerate", "1/4",
            "-i", str(Path(tmp) / "scene%03d.png"), "-t", "12", "-r", "24", "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
        ], check=True)
        print(f"{output.name}: {output.stat().st_size} bytes")
