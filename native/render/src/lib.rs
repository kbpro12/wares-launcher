//! Wares Launcher player renderer. A tiny software rasteriser: perspective-correct textured triangles, a z-buffer
//! and an analytic skeleton for the dances. `no_std`, no allocation, compiled to WebAssembly (~10 KB).
//!
//! JS side: write the 64x64 RGBA skin to `skin_ptr()`, call `set_skin`, `set_size`, then `frame(...)` and copy
//! `fb_ptr()` (RGBA, w*h*4) into an ImageData. Because every pixel is depth-tested there is no sorting flicker.
#![no_std]

use core::ptr::addr_of_mut;

const MAX_W: usize = 800;
const MAX_H: usize = 960;
static mut FB: [u8; MAX_W * MAX_H * 4] = [0; MAX_W * MAX_H * 4];
static mut ZB: [f32; MAX_W * MAX_H] = [0.0; MAX_W * MAX_H];
static mut SKIN: [u8; 64 * 64 * 4] = [0; 64 * 64 * 4];
static mut VW: usize = 300;
static mut VH: usize = 360;
static mut SLIM: bool = false;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { loop {} }

// ------------------------------------------------------------------ tiny math (no libm in core)
const PI: f32 = 3.141_592_7;
const DEG: f32 = PI / 180.0;

fn fabs(x: f32) -> f32 { if x < 0.0 { -x } else { x } }
fn fmax(a: f32, b: f32) -> f32 { if a > b { a } else { b } }
fn fmin(a: f32, b: f32) -> f32 { if a < b { a } else { b } }
fn floor(x: f32) -> f32 { let i = x as i32; let f = i as f32; if f > x { f - 1.0 } else { f } }
fn sqrt(x: f32) -> f32 {
    if x <= 0.0 { return 0.0; }
    let mut g = f32::from_bits((x.to_bits() >> 1) + 0x1fbd_1df5);
    g = 0.5 * (g + x / g); g = 0.5 * (g + x / g); g = 0.5 * (g + x / g);
    g
}
fn sin(x: f32) -> f32 {
    let a = x - floor(x / (2.0 * PI) + 0.5) * 2.0 * PI; // -pi..pi
    let y = (4.0 / PI) * a - (4.0 / (PI * PI)) * a * fabs(a);
    0.225 * (y * fabs(y) - y) + y
}
fn cos(x: f32) -> f32 { sin(x + PI / 2.0) }

type V3 = [f32; 3];
fn sub(a: V3, b: V3) -> V3 { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
fn dot(a: V3, b: V3) -> f32 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
fn cross(a: V3, b: V3) -> V3 { [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
fn norm(a: V3) -> V3 { let l = sqrt(dot(a, a)); if l < 1e-6 { a } else { [a[0] / l, a[1] / l, a[2] / l] } }

/// Affine transform: p' = r * p + t
#[derive(Clone, Copy)]
struct M { r: [[f32; 3]; 3], t: V3 }
impl M {
    const ID: M = M { r: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], t: [0.0; 3] };
    fn ap(&self, p: V3) -> V3 {
        let r = &self.r;
        [r[0][0] * p[0] + r[0][1] * p[1] + r[0][2] * p[2] + self.t[0],
         r[1][0] * p[0] + r[1][1] * p[1] + r[1][2] * p[2] + self.t[1],
         r[2][0] * p[0] + r[2][1] * p[1] + r[2][2] * p[2] + self.t[2]]
    }
    /// self after o (apply o first)
    fn mul(&self, o: &M) -> M {
        let mut r = [[0.0; 3]; 3];
        for i in 0..3 { for j in 0..3 { r[i][j] = self.r[i][0] * o.r[0][j] + self.r[i][1] * o.r[1][j] + self.r[i][2] * o.r[2][j]; } }
        let t = self.ap(o.t);
        M { r, t }
    }
    fn rx(a: f32) -> M { let (s, c) = (sin(a), cos(a)); M { r: [[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]], t: [0.0; 3] } }
    fn ry(a: f32) -> M { let (s, c) = (sin(a), cos(a)); M { r: [[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]], t: [0.0; 3] } }
    fn rz(a: f32) -> M { let (s, c) = (sin(a), cos(a)); M { r: [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]], t: [0.0; 3] } }
    fn tr(x: f32, y: f32, z: f32) -> M { M { r: M::ID.r, t: [x, y, z] } }
    /// rotate `rot` about the point p
    fn about(rot: M, p: V3) -> M { M::tr(p[0], p[1], p[2]).mul(&rot).mul(&M::tr(-p[0], -p[1], -p[2])) }
}

// ------------------------------------------------------------------ pose (all dances are closed-form in time)
struct Pose { bob: f32, sway: f32, yaw: f32, nod: f32, arm_r: (f32, f32), arm_l: (f32, f32), leg_r: f32, leg_l: f32 }

fn pose(t: f32, dance: u32) -> Pose {
    let mut p = Pose { bob: 0.0, sway: 0.0, yaw: 0.0, nod: 0.0, arm_r: (0.0, 0.0), arm_l: (0.0, 0.0), leg_r: 0.0, leg_l: 0.0 };
    match dance {
        1 => { // disco: one arm points up and out, the other swings down, hips sway, knees lift
            let ph = t / 1.2 * 2.0 * PI;
            p.sway = -5.0 * DEG * cos(ph);
            p.bob = 0.9 * fabs(sin(ph));
            p.arm_r = (0.0, -(86.0 + 64.0 * cos(ph)) * DEG);
            p.arm_l = (0.0, (86.0 - 64.0 * cos(ph)) * DEG);
            p.leg_r = -40.0 * DEG * fmax(0.0, sin(ph));
            p.leg_l = -40.0 * DEG * fmax(0.0, -sin(ph));
            p.nod = 11.0 * DEG * fabs(sin(ph));
        }
        2 => { // pump: fists alternate overhead, quick steps
            let ph = t / 0.6 * 2.0 * PI;
            p.bob = 1.1 * (0.5 - 0.5 * cos(ph));
            p.arm_r = (-(97.0 + 67.0 * cos(ph)) * DEG, -15.0 * DEG);
            p.arm_l = (-(97.0 - 67.0 * cos(ph)) * DEG, 15.0 * DEG);
            p.leg_r = 30.0 * DEG * sin(ph);
            p.leg_l = -30.0 * DEG * sin(ph);
            p.nod = 6.0 * DEG * (0.5 - 0.5 * cos(ph));
        }
        3 => { // sway: both hands up, rocking side to side
            let ph = t / 1.8 * 2.0 * PI;
            p.sway = -7.0 * DEG * cos(ph);
            p.bob = 0.5 * (0.5 - 0.5 * cos(ph));
            p.arm_r = (0.0, -(156.0 + 16.0 * cos(ph)) * DEG);
            p.arm_l = (0.0, (156.0 - 16.0 * cos(ph)) * DEG);
            p.nod = 8.0 * DEG * fabs(sin(ph));
        }
        4 => { // spin: arms out, jump and a full turn every 3 seconds
            let c = (t / 3.0) - floor(t / 3.0);
            p.arm_r = (0.0, -92.0 * DEG);
            p.arm_l = (0.0, 92.0 * DEG);
            if c > 0.55 && c < 0.85 {
                let k = (c - 0.55) / 0.30;
                p.yaw = k * 2.0 * PI;
                p.bob = 3.6 * sin(k * PI);
            }
            p.leg_r = 8.0 * DEG; p.leg_l = -8.0 * DEG;
        }
        5 => { // walking in place (game running)
            let ph = t / 0.45 * 2.0 * PI;
            p.bob = 0.7 * fabs(sin(ph));
            p.arm_r = (-34.0 * DEG * sin(ph), 0.0); p.arm_l = (34.0 * DEG * sin(ph), 0.0);
            p.leg_r = 34.0 * DEG * sin(ph); p.leg_l = -34.0 * DEG * sin(ph);
        }
        _ => { // idle: slow breathing
            let ph = t / 3.2 * 2.0 * PI;
            p.bob = 0.2 * (0.5 - 0.5 * cos(ph));
            p.arm_r = (7.0 * DEG * sin(ph), 2.0 * DEG); p.arm_l = (-7.0 * DEG * sin(ph), -2.0 * DEG);
        }
    }
    p
}

// ------------------------------------------------------------------ rasteriser
#[derive(Clone, Copy)]
struct Cam { cx: f32, cy: f32, f: f32, dist: f32 }

#[derive(Clone, Copy)]
struct Rect { x: f32, y: f32, w: f32, h: f32 }

/// One textured, lit quad. corners: TL, TR, BR, BL (world space). rect: skin pixels.
fn quad(cam: &Cam, c: [V3; 4], rect: Rect, shade_n: V3) {
    // back-face cull against the camera position
    let centre = [(c[0][0] + c[2][0]) * 0.5, (c[0][1] + c[2][1]) * 0.5, (c[0][2] + c[2][2]) * 0.5];
    let n = norm(cross(sub(c[3], c[0]), sub(c[1], c[0]))); // outward normal for TL,TR,BR,BL order
    let to_cam = sub([0.0, 16.0, cam.dist], centre);
    if dot(n, to_cam) <= 0.0 { return; }
    let _ = shade_n;
    let l = norm([0.35, 0.75, 0.55]);
    let shade = 0.56 + 0.44 * fmax(0.0, dot(n, l));

    let uv = [(rect.x, rect.y), (rect.x + rect.w, rect.y), (rect.x + rect.w, rect.y + rect.h), (rect.x, rect.y + rect.h)];
    let mut sx = [0.0f32; 4]; let mut sy = [0.0f32; 4]; let mut iz = [0.0f32; 4];
    for i in 0..4 {
        let d = cam.dist - c[i][2];
        if d < 1.0 { return; }
        iz[i] = 1.0 / d;
        sx[i] = cam.cx + cam.f * c[i][0] * iz[i];
        sy[i] = cam.cy - cam.f * (c[i][1] - 16.0) * iz[i];
    }
    tri(&[0, 1, 2], &sx, &sy, &iz, &uv, rect, shade);
    tri(&[0, 2, 3], &sx, &sy, &iz, &uv, rect, shade);
}

fn tri(ix: &[usize; 3], sx: &[f32; 4], sy: &[f32; 4], iz: &[f32; 4], uv: &[(f32, f32); 4], rect: Rect, shade: f32) {
    let (a, b, c) = (ix[0], ix[1], ix[2]);
    let area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
    if fabs(area) < 1e-4 { return; }
    let (w, h) = unsafe { (VW, VH) };
    let minx = fmax(0.0, floor(fmin(sx[a], fmin(sx[b], sx[c])))) as usize;
    let maxx = fmin((w - 1) as f32, floor(fmax(sx[a], fmax(sx[b], sx[c])))) as usize;
    let miny = fmax(0.0, floor(fmin(sy[a], fmin(sy[b], sy[c])))) as usize;
    let maxy = fmin((h - 1) as f32, floor(fmax(sy[a], fmax(sy[b], sy[c])))) as usize;
    let inv = 1.0 / area;
    let (ua, va, ub, vb, uc, vc) = (uv[a].0 * iz[a], uv[a].1 * iz[a], uv[b].0 * iz[b], uv[b].1 * iz[b], uv[c].0 * iz[c], uv[c].1 * iz[c]);
    let fb = unsafe { &mut *addr_of_mut!(FB) };
    let zb = unsafe { &mut *addr_of_mut!(ZB) };
    let skin = unsafe { &*addr_of_mut!(SKIN) };
    let mut y = miny;
    while y <= maxy {
        let py = y as f32 + 0.5;
        let mut x = minx;
        while x <= maxx {
            let px = x as f32 + 0.5;
            let w0 = ((sx[b] - px) * (sy[c] - py) - (sx[c] - px) * (sy[b] - py)) * inv;
            let w1 = ((sx[c] - px) * (sy[a] - py) - (sx[a] - px) * (sy[c] - py)) * inv;
            let w2 = 1.0 - w0 - w1;
            if w0 >= 0.0 && w1 >= 0.0 && w2 >= 0.0 {
                let z = w0 * iz[a] + w1 * iz[b] + w2 * iz[c];
                let idx = y * w + x;
                if z > zb[idx] {
                    let u = (w0 * ua + w1 * ub + w2 * uc) / z;
                    let v = (w0 * va + w1 * vb + w2 * vc) / z;
                    let tx = fmin(fmax(floor(u), rect.x), rect.x + rect.w - 1.0) as usize;
                    let ty = fmin(fmax(floor(v), rect.y), rect.y + rect.h - 1.0) as usize;
                    let s = (ty * 64 + tx) * 4;
                    if skin[s + 3] >= 128 {
                        zb[idx] = z;
                        let o = idx * 4;
                        fb[o] = (skin[s] as f32 * shade) as u8;
                        fb[o + 1] = (skin[s + 1] as f32 * shade) as u8;
                        fb[o + 2] = (skin[s + 2] as f32 * shade) as u8;
                        fb[o + 3] = 255;
                    }
                }
            }
            x += 1;
        }
        y += 1;
    }
}

/// A skin box: centre c, texture size (w,h,d) with origin (u,v), inflated by e, transformed by m.
fn draw_box(cam: &Cam, m: &M, c: V3, w: f32, h: f32, d: f32, u: f32, v: f32, e: f32) {
    let (hx, hy, hz) = (w * 0.5 + e, h * 0.5 + e, d * 0.5 + e);
    let p = |sx: f32, sy: f32, sz: f32| m.ap([c[0] + sx * hx, c[1] + sy * hy, c[2] + sz * hz]);
    // front (+z), back (-z), player's right (-x), player's left (+x), top, bottom
    quad(cam, [p(-1.0, 1.0, 1.0), p(1.0, 1.0, 1.0), p(1.0, -1.0, 1.0), p(-1.0, -1.0, 1.0)], Rect { x: u + d, y: v + d, w, h }, [0.0, 0.0, 1.0]);
    quad(cam, [p(1.0, 1.0, -1.0), p(-1.0, 1.0, -1.0), p(-1.0, -1.0, -1.0), p(1.0, -1.0, -1.0)], Rect { x: u + 2.0 * d + w, y: v + d, w, h }, [0.0, 0.0, -1.0]);
    quad(cam, [p(-1.0, 1.0, -1.0), p(-1.0, 1.0, 1.0), p(-1.0, -1.0, 1.0), p(-1.0, -1.0, -1.0)], Rect { x: u, y: v + d, w: d, h }, [-1.0, 0.0, 0.0]);
    quad(cam, [p(1.0, 1.0, 1.0), p(1.0, 1.0, -1.0), p(1.0, -1.0, -1.0), p(1.0, -1.0, 1.0)], Rect { x: u + d + w, y: v + d, w: d, h }, [1.0, 0.0, 0.0]);
    quad(cam, [p(-1.0, 1.0, -1.0), p(1.0, 1.0, -1.0), p(1.0, 1.0, 1.0), p(-1.0, 1.0, 1.0)], Rect { x: u + d, y: v, w, h: d }, [0.0, 1.0, 0.0]);
    quad(cam, [p(-1.0, -1.0, 1.0), p(1.0, -1.0, 1.0), p(1.0, -1.0, -1.0), p(-1.0, -1.0, -1.0)], Rect { x: u + d + w, y: v, w, h: d }, [0.0, -1.0, 0.0]);
}

// ------------------------------------------------------------------ exports
#[no_mangle] pub extern "C" fn fb_ptr() -> *mut u8 { addr_of_mut!(FB) as *mut u8 }
#[no_mangle] pub extern "C" fn skin_ptr() -> *mut u8 { addr_of_mut!(SKIN) as *mut u8 }
#[no_mangle] pub extern "C" fn max_pixels() -> u32 { (MAX_W * MAX_H) as u32 }

/// Viewport size in pixels. Returns 0 when it does not fit the static buffers.
#[no_mangle] pub extern "C" fn set_size(w: u32, h: u32) -> u32 {
    let (w, h) = (w as usize, h as usize);
    if w < 16 || h < 16 || w > MAX_W || h > MAX_H { return 0; }
    unsafe { VW = w; VH = h; }
    1
}

/// Call after writing a 64x64 RGBA skin to `skin_ptr()`. slim = 3-pixel (Alex) arms.
#[no_mangle] pub extern "C" fn set_skin(slim: u32) { unsafe { SLIM = slim != 0; } }

/// Render one frame. dance: 0 idle, 1 disco, 2 pump, 3 sway, 4 spin, 5 walk. look_x / look_y in -1..1 (cursor).
#[no_mangle] pub extern "C" fn frame(t: f32, dance: u32, look_x: f32, look_y: f32, yaw_extra: f32) {
    let (w, h) = unsafe { (VW, VH) };
    unsafe {
        let fb = &mut *addr_of_mut!(FB);
        let zb = &mut *addr_of_mut!(ZB);
        let n = w * h;
        let mut i = 0;
        while i < n { zb[i] = 0.0; fb[i * 4] = 0; fb[i * 4 + 1] = 0; fb[i * 4 + 2] = 0; fb[i * 4 + 3] = 0; i += 1; }
    }
    let slim = unsafe { SLIM };
    let aw = if slim { 3.0 } else { 4.0 };
    let unit = h as f32 * 0.80 / 32.0; // pixels per skin pixel: the player fills 80% of the height, feet at 90%
    let dist = 90.0;
    let cam = Cam { cx: w as f32 * 0.5, cy: h as f32 * 0.50, f: unit * dist, dist };

    let ps = pose(t, dance);
    let look_x = fmin(1.0, fmax(-1.0, look_x));
    let look_y = fmin(1.0, fmax(-1.0, look_y));
    // whole body: turn towards the cursor a little, keep a 3/4 view so the depth reads
    let yaw = -0.28 + look_x * 0.35 + ps.yaw + yaw_extra;
    let root = M::tr(0.0, ps.bob, 0.0).mul(&M::about(M::rz(ps.sway), [0.0, 12.0, 0.0])).mul(&M::ry(yaw));

    let head_rot = M::ry(look_x * 0.5).mul(&M::rx(ps.nod - look_y * 0.35));
    let m_head = root.mul(&M::about(head_rot, [0.0, 24.0, 0.0]));
    let arm_r_c = [-(4.0 + aw * 0.5), 18.0, 0.0];
    let arm_l_c = [4.0 + aw * 0.5, 18.0, 0.0];
    let m_arm_r = root.mul(&M::about(M::rz(ps.arm_r.1).mul(&M::rx(ps.arm_r.0)), [arm_r_c[0], 22.0, 0.0]));
    let m_arm_l = root.mul(&M::about(M::rz(ps.arm_l.1).mul(&M::rx(ps.arm_l.0)), [arm_l_c[0], 22.0, 0.0]));
    let m_leg_r = root.mul(&M::about(M::rx(ps.leg_r), [-2.0, 12.0, 0.0]));
    let m_leg_l = root.mul(&M::about(M::rx(ps.leg_l), [2.0, 12.0, 0.0]));

    // base layer first, overlay layers (hat, jacket, sleeves, pants) slightly larger on top: the z-buffer sorts them
    draw_box(&cam, &m_leg_r, [-2.0, 6.0, 0.0], 4.0, 12.0, 4.0, 0.0, 16.0, 0.0);
    draw_box(&cam, &m_leg_l, [2.0, 6.0, 0.0], 4.0, 12.0, 4.0, 16.0, 48.0, 0.0);
    draw_box(&cam, &root, [0.0, 18.0, 0.0], 8.0, 12.0, 4.0, 16.0, 16.0, 0.0);
    draw_box(&cam, &m_arm_r, arm_r_c, aw, 12.0, 4.0, 40.0, 16.0, 0.0);
    draw_box(&cam, &m_arm_l, arm_l_c, aw, 12.0, 4.0, 32.0, 48.0, 0.0);
    draw_box(&cam, &m_head, [0.0, 28.0, 0.0], 8.0, 8.0, 8.0, 0.0, 0.0, 0.0);
    draw_box(&cam, &m_leg_r, [-2.0, 6.0, 0.0], 4.0, 12.0, 4.0, 0.0, 32.0, 0.25);
    draw_box(&cam, &m_leg_l, [2.0, 6.0, 0.0], 4.0, 12.0, 4.0, 0.0, 48.0, 0.25);
    draw_box(&cam, &root, [0.0, 18.0, 0.0], 8.0, 12.0, 4.0, 16.0, 32.0, 0.25);
    draw_box(&cam, &m_arm_r, arm_r_c, aw, 12.0, 4.0, 40.0, 32.0, 0.25);
    draw_box(&cam, &m_arm_l, arm_l_c, aw, 12.0, 4.0, 48.0, 48.0, 0.25);
    draw_box(&cam, &m_head, [0.0, 28.0, 0.0], 8.0, 8.0, 8.0, 32.0, 0.0, 0.5);
}
