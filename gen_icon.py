#!/usr/bin/env python3
"""Tech-style line-art icon for AI Gateway Proxy.

Composition:
- Outer dual radar rings with tick marks
- Central hexagonal core (nested) with center dot
- 6 satellite nodes connected to the core via dashed data links
- Adjacent nodes joined by solid mesh lines forming a network topology
"""
import struct, zlib, os, math

SIZE = 1024
CX, CY = SIZE / 2, SIZE / 2

# ---------------------------------------------------------------------------
# PNG helpers
# ---------------------------------------------------------------------------
def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

BG = (0, 0, 0, 0)
FG = (0x21, 0x96, 0xF3)  # tech blue

pixels = [[BG for _ in range(SIZE)] for _ in range(SIZE)]


def add_pixel(x, y, a):
    if a <= 0:
        return
    if 0 <= x < SIZE and 0 <= y < SIZE:
        r, g, b, old = pixels[y][x]
        total = old + a
        if total == 0:
            return
        nr = int((r * old + FG[0] * a) / total)
        ng = int((g * old + FG[1] * a) / total)
        nb = int((b * old + FG[2] * a) / total)
        na = min(0xFF, total)
        pixels[y][x] = (nr, ng, nb, na)


# ---------------------------------------------------------------------------
# Drawing primitives (anti-aliased)
# ---------------------------------------------------------------------------
def stroke_circle(cx, cy, r, w):
    """Outlined circle, total stroke width w."""
    half = w / 2.0
    y0 = max(0, int(cy - r - half - 2))
    y1 = min(SIZE, int(cy + r + half + 3))
    x0 = max(0, int(cx - r - half - 2))
    x1 = min(SIZE, int(cx + r + half + 3))
    for y in range(y0, y1):
        for x in range(x0, x1):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            diff = abs(d - r)
            if diff < half:
                a = int(0xFF * (1 - diff / half))
                add_pixel(x, y, a)


def stroke_line(x0, y0, x1, y1, w):
    """Anti-aliased segment with squared ends."""
    dx, dy = x1 - x0, y1 - y0
    L = (dx * dx + dy * dy) ** 0.5
    if L < 1:
        return
    ux, uy = dx / L, dy / L
    px, py = -uy, ux
    half = w / 2.0
    minx = int(min(x0, x1) - half - 2)
    maxx = int(max(x0, x1) + half + 2)
    miny = int(min(y0, y1) - half - 2)
    maxy = int(max(y0, y1) + half + 2)
    for y in range(max(0, miny), min(SIZE, maxy + 1)):
        for x in range(max(0, minx), min(SIZE, maxx + 1)):
            t = (x - x0) * ux + (y - y0) * uy
            if t < 0 or t > L:
                continue
            d = abs((x - x0) * px + (y - y0) * py)
            if d < half:
                a = int(0xFF * (1 - d / half))
                add_pixel(x, y, a)


def dashed_line(x0, y0, x1, y1, w, dash=22, gap=14):
    dx, dy = x1 - x0, y1 - y0
    L = (dx * dx + dy * dy) ** 0.5
    if L < 1:
        return
    ux, uy = dx / L, dy / L
    t = 0.0
    while t < L:
        seg = min(dash, L - t)
        sx = x0 + ux * t
        sy = y0 + uy * t
        ex = x0 + ux * (t + seg)
        ey = y0 + uy * (t + seg)
        stroke_line(sx, sy, ex, ey, w)
        t += dash + gap


def dot(cx, cy, r):
    y0 = max(0, int(cy - r - 2))
    y1 = min(SIZE, int(cy + r + 3))
    x0 = max(0, int(cx - r - 2))
    x1 = min(SIZE, int(cx + r + 3))
    for y in range(y0, y1):
        for x in range(x0, x1):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= r:
                a = 0xFF if d < r - 1 else int(0xFF * max(0.0, r - d))
                add_pixel(x, y, a)


def stroke_polygon(cx, cy, r, sides, rotation, w):
    pts = []
    for i in range(sides):
        a = rotation + 2 * math.pi * i / sides
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    for i in range(sides):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % sides]
        stroke_line(x0, y0, x1, y1, w)
    return pts


# ---------------------------------------------------------------------------
# Compose the icon
# ---------------------------------------------------------------------------
print("Drawing tech-style line-art icon...")

# Outer dual radar rings
stroke_circle(CX, CY, 470, 5)
stroke_circle(CX, CY, 432, 2)

# Tick marks around the outer ring (every 15°, accent every 45°)
for i in range(24):
    a = 2 * math.pi * i / 24
    r_inner = 442
    r_outer = 472 if i % 3 == 0 else 460
    width = 6 if i % 3 == 0 else 3
    x1 = CX + r_inner * math.cos(a)
    y1 = CY + r_inner * math.sin(a)
    x2 = CX + r_outer * math.cos(a)
    y2 = CY + r_outer * math.sin(a)
    stroke_line(x1, y1, x2, y2, width)

# Mid faint guide ring
stroke_circle(CX, CY, 320, 1)

# Six satellite nodes
NODE_RING_R = 320
NODE_R = 42
NODE_COUNT = 6
node_pts = []
for i in range(NODE_COUNT):
    a = math.pi / 6 + 2 * math.pi * i / NODE_COUNT
    nx = CX + NODE_RING_R * math.cos(a)
    ny = CY + NODE_RING_R * math.sin(a)
    node_pts.append((nx, ny, a))
    stroke_circle(nx, ny, NODE_R, 12)
    dot(nx, ny, 12)

# Mesh lines between adjacent nodes
for i in range(NODE_COUNT):
    x0, y0, _ = node_pts[i]
    x1, y1, _ = node_pts[(i + 1) % NODE_COUNT]
    dx, dy = x1 - x0, y1 - y0
    L = (dx * dx + dy * dy) ** 0.5
    ux, uy = dx / L, dy / L
    sx = x0 + ux * (NODE_R + 6)
    sy = y0 + uy * (NODE_R + 6)
    ex = x1 - ux * (NODE_R + 6)
    ey = y1 - uy * (NODE_R + 6)
    stroke_line(sx, sy, ex, ey, 4)

# Central hexagonal core (outer + inner)
HEX_R = 150
stroke_polygon(CX, CY, HEX_R, 6, math.pi / 6, 18)
stroke_polygon(CX, CY, 86, 6, math.pi / 6, 8)

# Center node
dot(CX, CY, 26)
stroke_circle(CX, CY, 44, 4)

# Dashed data links from core to each satellite node
for nx, ny, a in node_pts:
    sx = CX + (HEX_R + 22) * math.cos(a)
    sy = CY + (HEX_R + 22) * math.sin(a)
    ex = nx - (NODE_R + 6) * math.cos(a)
    ey = ny - (NODE_R + 6) * math.sin(a)
    dashed_line(sx, sy, ex, ey, 6, dash=20, gap=12)

# ---------------------------------------------------------------------------
# Encode and write PNG (RGBA)
# ---------------------------------------------------------------------------
print("Saving...")

# Composite onto a circular white background that fills the canvas.
WHITE = (0xFF, 0xFF, 0xFF)
MASK_R = SIZE / 2.0  # circle radius adapts to canvas size
for y in range(SIZE):
    row = pixels[y]
    for x in range(SIZE):
        r, g, b, a = row[x]
        # Pixel-center distance to canvas center for anti-aliased circle mask.
        d = ((x + 0.5 - CX) ** 2 + (y + 0.5 - CY) ** 2) ** 0.5
        if d >= MASK_R:
            row[x] = (0, 0, 0, 0)
            continue
        if d <= MASK_R - 1:
            mask_a = 0xFF
        else:
            mask_a = int(0xFF * (MASK_R - d))
            if mask_a <= 0:
                row[x] = (0, 0, 0, 0)
                continue
        if a == 0:
            row[x] = (WHITE[0], WHITE[1], WHITE[2], mask_a)
        elif a == 0xFF:
            row[x] = (r, g, b, mask_a)
        else:
            inv = 0xFF - a
            nr = (r * a + WHITE[0] * inv) // 0xFF
            ng = (g * a + WHITE[1] * inv) // 0xFF
            nb = (b * a + WHITE[2] * inv) // 0xFF
            row[x] = (nr, ng, nb, mask_a)

header = b'\x89PNG\r\n\x1a\n'
ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
raw = bytearray()
for row in pixels:
    raw.append(0)
    for r, g, b, a in row:
        raw += bytes((r, g, b, a))
idat = chunk(b'IDAT', zlib.compress(bytes(raw), 9))
iend = chunk(b'IEND', b'')

icons_dir = os.path.join(os.path.dirname(__file__), 'src-tauri', 'icons')
os.makedirs(icons_dir, exist_ok=True)
path = os.path.join(icons_dir, 'icon.png')
with open(path, 'wb') as f:
    f.write(header + ihdr + idat + iend)
print(f"Done: {path}")
