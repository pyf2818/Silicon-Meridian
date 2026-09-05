import cv2
import numpy as np
import os
from PIL import Image, ImageDraw, ImageFont

SCREENSHOTS_DIR = r"e:\VStudio_Project\ai\Silicon Meridian\screenshots"
OUTPUT_PATH = os.path.join(SCREENSHOTS_DIR, "silicon_meridian_promo.mp4")
FPS = 30
WIDTH, HEIGHT = 1920, 1080

# Font paths
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"      # Microsoft YaHei Bold
FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"     # Microsoft YaHei
FONT_HEADING = r"C:\Windows\Fonts\simhei.ttf"   # SimHei

# Scene durations (seconds)
TITLE_DURATION = 3
SCENE_DURATION = 5
FADE_DURATION = 1.2
OUTRO_DURATION = 3

# Color palette (BGR for OpenCV, RGB for PIL)
BG_DARK_BGR = (8, 12, 30)
ACCENT_CYAN_BGR = (255, 220, 0)    # BGR: B=255, G=220, R=0 -> #00DCFF
ACCENT_GOLD_BGR = (50, 200, 255)   # BGR: #FFC832
ACCENT_PURPLE_BGR = (220, 60, 120) # BGR: #783CDF

ACCENT_CYAN_RGB = (0, 220, 255)
ACCENT_GOLD_RGB = (255, 200, 50)
ACCENT_PURPLE_RGB = (120, 60, 220)
WHITE_RGB = (255, 255, 255)
LIGHT_GRAY_RGB = (200, 210, 230)

# Scene definitions
SCENES = [
    {
        "file": "screenshot-1785511612903.png",
        "title": "万般硅川",
        "subtitle": "AI 工作站",
        "desc": "您的个人智能情报中枢",
        "accent_bgr": ACCENT_CYAN_BGR,
        "accent_rgb": ACCENT_CYAN_RGB,
    },
    {
        "file": "screenshot-1785511532021.png",
        "title": "全源情报聚合",
        "subtitle": "239+ 全球信源 · AI 智能筛选",
        "desc": "智能摘要 · 重点推荐 · 个性定制",
        "accent_bgr": ACCENT_CYAN_BGR,
        "accent_rgb": ACCENT_CYAN_RGB,
    },
    {
        "file": "screenshot-1785511555476.png",
        "title": "智能股市研判",
        "subtitle": "实时行情 · K线分析 · AI 诊断",
        "desc": "风险预警 · 智能建议 · 数据洞察",
        "accent_bgr": ACCENT_GOLD_BGR,
        "accent_rgb": ACCENT_GOLD_RGB,
    },
    {
        "file": "screenshot-1785511572512.png",
        "title": "GitHub 前沿探索",
        "subtitle": "开源趋势 · 项目洞察",
        "desc": "发现最值得关注的技术项目",
        "accent_bgr": ACCENT_PURPLE_BGR,
        "accent_rgb": ACCENT_PURPLE_RGB,
    },
    {
        "file": "screenshot-1785511592615.png",
        "title": "个性化画像",
        "subtitle": "AI 持续学习 · 深度理解",
        "desc": "进化您的情报 · 专属您的洞察",
        "accent_bgr": ACCENT_CYAN_BGR,
        "accent_rgb": ACCENT_CYAN_RGB,
    },
]


def cv2_to_pil(cv2_img):
    """Convert OpenCV BGR to PIL RGB."""
    if len(cv2_img.shape) == 2:
        return Image.fromarray(cv2.cvtColor(cv2_img, cv2.COLOR_GRAY2RGB))
    return Image.fromarray(cv2.cvtColor(cv2_img, cv2.COLOR_BGR2RGB))


def pil_to_cv2(pil_img):
    """Convert PIL RGB to OpenCV BGR."""
    if pil_img.mode == 'RGBA':
        return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGBA2BGR)
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def draw_chinese_text(img_pil, text, y, font_size, color_rgb, font_path, stroke_color=None, stroke_width=0, anchor="mm"):
    """Draw Chinese text on PIL image with glow/stroke support."""
    draw = ImageDraw.Draw(img_pil)
    
    try:
        font = ImageFont.truetype(font_path, font_size)
    except:
        font = ImageFont.load_default()
    
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    
    x = img_pil.width // 2
    
    if stroke_color and stroke_width > 0:
        for dx in range(-stroke_width, stroke_width + 1):
            for dy in range(-stroke_width, stroke_width + 1):
                if dx * dx + dy * dy <= stroke_width * stroke_width:
                    draw.text((x + dx, y + dy), text, font=font, fill=stroke_color, anchor=anchor)
    
    draw.text((x, y), text, font=font, fill=color_rgb, anchor=anchor)
    return text_w, text_h


def draw_glow_text(img_pil, text, y, font_size, glow_color_rgb, text_color_rgb, font_path, glow_layers=6):
    """Draw glowing text."""
    draw = ImageDraw.Draw(img_pil)
    
    try:
        font = ImageFont.truetype(font_path, font_size)
    except:
        font = ImageFont.load_default()
    
    x = img_pil.width // 2
    
    for i in range(glow_layers, 0, -1):
        alpha = int(40 * (1 - i / glow_layers))
        glow_with_alpha = glow_color_rgb + (alpha,)
        draw.text((x, y), text, font=font, fill=glow_with_alpha, anchor="mm")
    
    draw.text((x, y), text, font=font, fill=text_color_rgb, anchor="mm")


def create_radial_background(width, height, center_bgr, edge_bgr):
    """Create a radial gradient in BGR (vectorized)."""
    center_x, center_y = width // 2, height // 2
    max_dist = np.sqrt(center_x**2 + center_y**2)
    y_coords, x_coords = np.mgrid[0:height, 0:width].astype(np.float32)
    dist = np.sqrt((x_coords - center_x)**2 + (y_coords - center_y)**2)
    t = np.clip(dist / max_dist, 0, 1).astype(np.float32)
    
    center_arr = np.array(center_bgr, dtype=np.float32)
    edge_arr = np.array(edge_bgr, dtype=np.float32)
    
    img = np.zeros((height, width, 3), dtype=np.uint8)
    for c in range(3):
        img[:, :, c] = (center_arr[c] * (1 - t) + edge_arr[c] * t).astype(np.uint8)
    return img


def load_screenshot(filepath, target_width, target_height):
    """Load and resize screenshot to target dimensions."""
    img = cv2.imread(filepath)
    if img is None:
        return None
    
    h, w = img.shape[:2]
    target_ratio = target_width / target_height
    img_ratio = w / h
    
    if img_ratio > target_ratio:
        new_w = int(h * target_ratio)
        x_start = (w - new_w) // 2
        img = img[:, x_start:x_start + new_w]
    else:
        new_h = int(w / target_ratio)
        y_start = (h - new_h) // 2
        img = img[y_start:y_start + new_h, :]
    
    img = cv2.resize(img, (target_width, target_height), interpolation=cv2.INTER_LANCZOS4)
    return img


def apply_ken_burns(img, progress, zoom_start=1.0, zoom_end=1.12, pan_x=0.03, pan_y=0.02):
    """Apply Ken Burns effect."""
    h, w = img.shape[:2]
    zoom = zoom_start + (zoom_end - zoom_start) * progress
    
    new_w = int(w / zoom)
    new_h = int(h / zoom)
    
    x_center = w // 2 + int(pan_x * w * progress)
    y_center = h // 2 + int(pan_y * h * progress)
    
    x_offset = max(0, min(x_center - new_w // 2, w - new_w))
    y_offset = max(0, min(y_center - new_h // 2, h - new_h))
    
    cropped = img[y_offset:y_offset + new_h, x_offset:x_offset + new_w]
    result = cv2.resize(cropped, (w, h), interpolation=cv2.INTER_LANCZOS4)
    return result


def darken_image(img, factor=0.4):
    """Darken image for text overlay."""
    result = img.copy()
    cv2.addWeighted(result, factor, np.zeros_like(result), 0, 0, result)
    return result


def add_particles(img_pil, count=40, seed_val=0, colors=None):
    """Add particle effects to PIL image."""
    if colors is None:
        colors = [ACCENT_CYAN_RGB, ACCENT_GOLD_RGB, ACCENT_PURPLE_RGB]
    
    np.random.seed(seed_val)
    draw = ImageDraw.Draw(img_pil)
    
    for _ in range(count):
        px = np.random.randint(0, img_pil.width)
        py = np.random.randint(0, img_pil.height)
        size = np.random.randint(1, 4)
        color = colors[np.random.randint(0, len(colors))]
        draw.ellipse([px - size, py - size, px + size, py + size], fill=color)


def create_title_frame(duration_frames):
    """Create the opening title sequence."""
    frames = []
    bg = create_radial_background(WIDTH, HEIGHT, (15, 25, 60), (3, 5, 15))
    
    for i in range(duration_frames):
        progress = i / duration_frames
        frame_bgr = bg.copy()
        frame_pil = cv2_to_pil(frame_bgr)
        
        # Animated particles
        particle_count = int(50 * (1 - progress * 0.3))
        add_particles(frame_pil, count=particle_count, seed_val=i * 7)
        
        # Text fade in
        text_alpha = min(1.0, progress * 2.5)
        
        if text_alpha > 0:
            # Create overlay with text
            overlay = Image.new('RGBA', frame_pil.size, (0, 0, 0, 0))
            
            title_y = HEIGHT // 2 - 80 + int(progress * 15)
            
            # Glow + fade effect
            alpha_int = int(255 * text_alpha)
            
            # Draw subtitle (English) - above Chinese title
            sub_font_size = 36
            draw_chinese_text(
                overlay, "Silicon Meridian", title_y - 120,
                sub_font_size, (0, 220, 255, alpha_int),
                FONT_REGULAR, stroke_color=(0, 220, 255, int(60 * text_alpha)), stroke_width=3
            )
            
            # Main Chinese title with glow
            title_font_size = 120
            draw_glow_text(
                overlay, "万般硅川", title_y,
                title_font_size, ACCENT_CYAN_RGB,
                (255, 255, 255, alpha_int), FONT_BOLD, glow_layers=8
            )
            
            # Subtitle line
            draw_chinese_text(
                overlay, "AI 工作站", title_y + 90,
                40, ACCENT_CYAN_RGB + (alpha_int,),
                FONT_REGULAR
            )
            
            # Tagline
            draw_chinese_text(
                overlay, "面向 AI 时代的个人情报与创作平台", title_y + 155,
                26, LIGHT_GRAY_RGB + (alpha_int,),
                FONT_REGULAR
            )
            
            # Decorative lines
            line_alpha = int(180 * text_alpha)
            draw = ImageDraw.Draw(overlay)
            draw.line([(WIDTH // 2 - 250, title_y - 160), (WIDTH // 2 + 250, title_y - 160)],
                     fill=(0, 220, 255, line_alpha), width=1)
            draw.line([(WIDTH // 2 - 350, title_y + 200), (WIDTH // 2 + 350, title_y + 200)],
                     fill=(0, 220, 255, int(line_alpha * 0.5)), width=1)
            
            # Composite
            frame_pil = Image.alpha_composite(frame_pil.convert('RGBA'), overlay)
            frame_pil = frame_pil.convert('RGB')
        
        frame_bgr = pil_to_cv2(frame_pil)
        frames.append(frame_bgr)
    
    return frames


def create_scene_frames(scene, duration_frames):
    """Create scene frames from screenshot with Ken Burns and text overlay."""
    frames = []
    filepath = os.path.join(SCREENSHOTS_DIR, scene["file"])
    
    img = load_screenshot(filepath, WIDTH, HEIGHT)
    if img is None:
        print(f"Warning: Could not load {filepath}")
        img = create_radial_background(WIDTH, HEIGHT, BG_DARK_BGR, (3, 5, 15))
    
    accent_bgr = scene["accent_bgr"]
    accent_rgb = scene["accent_rgb"]
    
    for i in range(duration_frames):
        progress = i / duration_frames
        
        # Ken Burns effect
        frame_bgr = apply_ken_burns(img, progress)
        
        # Darken for text readability
        darkened = darken_image(frame_bgr, 0.3)
        
        # Convert to PIL for text overlay
        frame_pil = cv2_to_pil(darkened)
        
        # Text fade in/out
        if progress < 0.15:
            text_alpha = progress / 0.15
        elif progress > 0.85:
            text_alpha = (1 - progress) / 0.15
        else:
            text_alpha = 1.0
        
        alpha_int = int(255 * text_alpha)
        
        # Draw text overlay
        text_overlay = Image.new('RGBA', frame_pil.size, (0, 0, 0, 0))
        
        title_y = HEIGHT // 2 - 50
        
        # Main title
        title_font_size = 80
        draw_glow_text(
            text_overlay, scene["title"], title_y,
            title_font_size,
            accent_rgb,
            (255, 255, 255, alpha_int),
            FONT_BOLD, glow_layers=6
        )
        
        # Subtitle
        draw_chinese_text(
            text_overlay, scene["subtitle"], title_y + 65,
            36, (accent_rgb[0], accent_rgb[1], accent_rgb[2], alpha_int),
            FONT_REGULAR
        )
        
        # Description
        draw_chinese_text(
            text_overlay, scene["desc"], title_y + 115,
            24, (LIGHT_GRAY_RGB[0], LIGHT_GRAY_RGB[1], LIGHT_GRAY_RGB[2], int(alpha_int * 0.85)),
            FONT_REGULAR
        )
        
        # Accent line
        draw = ImageDraw.Draw(text_overlay)
        line_w = int(250 * text_alpha)
        line_y = title_y + 155
        if line_w > 0:
            draw.line([(WIDTH // 2 - line_w, line_y), (WIDTH // 2 + line_w, line_y)],
                     fill=(accent_rgb[0], accent_rgb[1], accent_rgb[2], alpha_int), width=3)
        
        # Composite
        frame_pil = Image.alpha_composite(frame_pil.convert('RGBA'), text_overlay)
        frame_pil = frame_pil.convert('RGB')
        frame_bgr = pil_to_cv2(frame_pil)
        
        frames.append(frame_bgr)
    
    return frames


def create_outro_frames(duration_frames):
    """Create closing sequence."""
    frames = []
    bg = create_radial_background(WIDTH, HEIGHT, (10, 20, 50), (2, 3, 10))
    
    for i in range(duration_frames):
        progress = i / duration_frames
        frame_bgr = bg.copy()
        frame_pil = cv2_to_pil(frame_bgr)
        
        # Particles
        add_particles(frame_pil, count=int(30 * (1 - progress * 0.3)), seed_val=i * 11,
                     colors=[ACCENT_CYAN_RGB, ACCENT_GOLD_RGB])
        
        alpha = min(1.0, progress * 2)
        alpha_int = int(255 * alpha)
        
        if alpha > 0:
            overlay = Image.new('RGBA', frame_pil.size, (0, 0, 0, 0))
            
            center_y = HEIGHT // 2
            
            # Line 1: CTA
            draw_glow_text(
                overlay, "开启您的智能情报之旅", center_y - 50,
                56,
                ACCENT_CYAN_RGB,
                (255, 255, 255, alpha_int), FONT_BOLD, glow_layers=6
            )
            
            # Line 2: Brand
            draw_chinese_text(
                overlay, "Silicon Meridian", center_y + 20,
                36, (ACCENT_GOLD_RGB[0], ACCENT_GOLD_RGB[1], ACCENT_GOLD_RGB[2], alpha_int),
                FONT_REGULAR
            )
            
            # Line 3: URL
            draw_chinese_text(
                overlay, "silicon-meridian.com", center_y + 75,
                24, (LIGHT_GRAY_RGB[0], LIGHT_GRAY_RGB[1], LIGHT_GRAY_RGB[2], alpha_int),
                FONT_REGULAR
            )
            
            frame_pil = Image.alpha_composite(frame_pil.convert('RGBA'), overlay)
            frame_pil = frame_pil.convert('RGB')
        
        frame_bgr = pil_to_cv2(frame_pil)
        frames.append(frame_bgr)
    
    return frames


def main():
    print("=" * 60)
    print("  万般硅川 Silicon Meridian - Promotional Video Generator")
    print("=" * 60)
    
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(OUTPUT_PATH, fourcc, FPS, (WIDTH, HEIGHT))
    
    all_frames = []
    
    # 1. Title sequence
    print("\n[1/7] Creating title sequence...")
    title_frames = create_title_frame(int(TITLE_DURATION * FPS))
    all_frames.extend(title_frames)
    print(f"  -> {len(title_frames)} frames")
    
    # 2. Scenes with fade transitions
    total_scenes = len(SCENES)
    for idx, scene in enumerate(SCENES):
        scene_num = idx + 2
        print(f"\n[{scene_num}/7] Creating scene {idx + 1}: {scene['title']}...")
        scene_frames = create_scene_frames(scene, int(SCENE_DURATION * FPS))
        
        next_scene = SCENES[idx + 1] if idx + 1 < total_scenes else None
        fade_count = int(FADE_DURATION * FPS)
        
        if next_scene:
            all_frames.extend(scene_frames[:-fade_count])
            
            next_preview = create_scene_frames(next_scene, fade_count + 5)
            for fi in range(fade_count):
                alpha = fi / fade_count
                blended = cv2.addWeighted(
                    scene_frames[-fade_count + fi], 1 - alpha,
                    next_preview[fi], alpha, 0
                )
                all_frames.append(blended)
        else:
            all_frames.extend(scene_frames)
        
        print(f"  -> {len(scene_frames)} frames")
    
    # 3. Outro
    print(f"\n[{total_scenes + 2}/7] Creating closing sequence...")
    outro_frames = create_outro_frames(int(OUTRO_DURATION * FPS))
    all_frames.extend(outro_frames)
    print(f"  -> {len(outro_frames)} frames")
    
    # Write all frames
    print(f"\n[Writing] Saving {len(all_frames)} frames to video...")
    for idx, frame in enumerate(all_frames):
        out.write(frame)
        if (idx + 1) % 100 == 0:
            print(f"  Progress: {idx + 1}/{len(all_frames)} frames")
    
    out.release()
    
    duration_sec = len(all_frames) / FPS
    print(f"\n{'=' * 60}")
    print(f"  Video saved to: {OUTPUT_PATH}")
    print(f"  Total frames: {len(all_frames)}")
    print(f"  Duration: {duration_sec:.1f} seconds")
    print(f"  Resolution: {WIDTH}x{HEIGHT}")
    print(f"  File size: {os.path.getsize(OUTPUT_PATH) / (1024*1024):.1f} MB")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()