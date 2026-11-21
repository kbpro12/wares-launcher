//! wares-native (fetch / boost / prefetch). fetch: reads TSV tasks (url \t dest \t sha1 \t size) on stdin, downloads them in
//! parallel, verifies SHA-1 while streaming, and reports JSON lines on stdout:
//!   {"t":"b","n":<bytes since last report>}  {"t":"f","d":"<dest>"}  {"t":"e","d":"<dest>","m":"<msg>"}
use rayon::prelude::*;
use sha1::{Digest, Sha1};
use std::fs::{self, File};
use std::io::{self, BufRead, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

struct Task { url: String, dest: String, sha1: String }

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' | '\r' | '\t' => o.push(' '),
            c if (c as u32) < 0x20 => {}
            c => o.push(c),
        }
    }
    o
}

fn say(out: &Mutex<io::Stdout>, line: String) {
    if let Ok(mut o) = out.lock() { let _ = writeln!(o, "{}", line); let _ = o.flush(); }
}

fn fetch(agent: &ureq::Agent, t: &Task, bytes: &AtomicU64) -> Result<(), String> {
    let resp = agent.get(&t.url).call().map_err(|e| e.to_string())?;
    let mut reader = resp.into_reader();
    if let Some(dir) = Path::new(&t.dest).parent() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    let tmp = format!("{}.wtmp", t.dest);
    let mut f = File::create(&tmp).map_err(|e| e.to_string())?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
        f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        bytes.fetch_add(n as u64, Ordering::Relaxed);
    }
    drop(f);
    if !t.sha1.is_empty() {
        let got: String = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect();
        if !got.eq_ignore_ascii_case(&t.sha1) {
            let _ = fs::remove_file(&tmp);
            return Err("checksum mismatch".into());
        }
    }
    let _ = fs::remove_file(&t.dest);
    fs::rename(&tmp, &t.dest).map_err(|e| e.to_string())
}


/// Windows process tuning. Declared by hand (no extra crate); only called on Windows, but it is type-checked everywhere.
#[allow(dead_code)]
mod win {
    use std::ffi::c_void;
    type Handle = *mut c_void;
    #[cfg_attr(windows, link(name = "kernel32"))]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(h: Handle) -> i32;
        fn SetPriorityClass(h: Handle, class: u32) -> i32;
        fn SetProcessInformation(h: Handle, class: i32, info: *const c_void, size: u32) -> i32;
        fn K32EmptyWorkingSet(h: Handle) -> i32;
    }
    const PROCESS_SET_QUOTA: u32 = 0x0100;
    const PROCESS_SET_INFORMATION: u32 = 0x0200;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const ABOVE_NORMAL_PRIORITY_CLASS: u32 = 0x0000_8000;
    const PROCESS_POWER_THROTTLING: i32 = 4; // ProcessPowerThrottling
    #[repr(C)]
    struct PowerThrottling { version: u32, control_mask: u32, state_mask: u32 }

    /// Game process: above-normal priority and no EcoQoS (Windows 11 otherwise may park it on efficiency cores).
    pub fn boost_game(pid: u32) -> bool {
        unsafe {
            let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() { return false; }
            let ok = SetPriorityClass(h, ABOVE_NORMAL_PRIORITY_CLASS) != 0;
            // ControlMask = execution speed throttling; StateMask 0 = "do not throttle"
            let st = PowerThrottling { version: 1, control_mask: 1, state_mask: 0 };
            SetProcessInformation(h, PROCESS_POWER_THROTTLING, &st as *const PowerThrottling as *const c_void, core::mem::size_of::<PowerThrottling>() as u32);
            CloseHandle(h);
            ok
        }
    }

    /// Give a process's idle memory back to Windows (the launcher's own UI processes while the game runs).
    pub fn trim(pid: u32) -> bool {
        unsafe {
            let h = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() { return false; }
            let ok = K32EmptyWorkingSet(h) != 0;
            CloseHandle(h);
            ok
        }
    }
}

/// boost <game_pid> [trim_pid,trim_pid,...]
fn boost(mut args: impl Iterator<Item = String>) {
    let game: u32 = args.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let trims: Vec<u32> = args.next().map(|v| v.split(',').filter_map(|p| p.parse().ok()).collect()).unwrap_or_default();
    let (mut boosted, mut trimmed) = (false, 0u32);
    #[cfg(windows)]
    {
        if game != 0 { boosted = win::boost_game(game); }
        for p in &trims { if win::trim(*p) { trimmed += 1; } }
    }
    #[cfg(not(windows))]
    { let _ = (game, &trims, &mut boosted, &mut trimmed); }
    println!("{{\"boosted\":{},\"trimmed\":{}}}", boosted, trimmed);
}

/// prefetch <threads>: read the files listed on stdin once so the OS file cache is warm before Java asks for them.
fn prefetch(mut args: impl Iterator<Item = String>) {
    let threads: usize = args.next().and_then(|v| v.parse().ok()).unwrap_or(4).clamp(1, 16);
    let files: Vec<String> = io::stdin().lock().lines().map_while(Result::ok).filter(|l| !l.is_empty()).collect();
    let total = AtomicU64::new(0);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().expect("thread pool");
    pool.install(|| {
        files.par_iter().for_each(|f| {
            let Ok(meta) = fs::metadata(f) else { return };
            if !meta.is_file() || meta.len() > 1 << 30 { return; }
            let Ok(mut fh) = File::open(f) else { return };
            let mut buf = vec![0u8; 1 << 20];
            while let Ok(n) = fh.read(&mut buf) { if n == 0 { break; } total.fetch_add(n as u64, Ordering::Relaxed); }
        });
    });
    println!("{{\"files\":{},\"bytes\":{}}}", files.len(), total.load(Ordering::Relaxed));
}

fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("--version") => { println!("wares-native {}", env!("CARGO_PKG_VERSION")); return; }
        Some("fetch") => {}
        Some("boost") => { boost(args); return; }
        Some("prefetch") => { prefetch(args); return; }
        _ => { eprintln!("usage: wares-native fetch <threads> | boost <pid> [trim pids] | prefetch <threads>"); std::process::exit(2); }
    }
    let threads: usize = args.next().and_then(|v| v.parse().ok()).unwrap_or(16).clamp(1, 64);

    let tasks: Vec<Task> = io::stdin().lock().lines().map_while(Result::ok).filter_map(|l| {
        let mut p = l.split('\t');
        let (url, dest) = (p.next()?.to_string(), p.next()?.to_string());
        if url.is_empty() || dest.is_empty() { return None; }
        Some(Task { url, dest, sha1: p.next().unwrap_or("").to_string() })
    }).collect();

    let out = Arc::new(Mutex::new(io::stdout()));
    let bytes = Arc::new(AtomicU64::new(0));
    let alive = Arc::new(AtomicU64::new(1));

    // One reporter thread: batches progress into ~10 lines per second instead of one per chunk.
    let reporter = {
        let (out, bytes, alive) = (out.clone(), bytes.clone(), alive.clone());
        thread::spawn(move || {
            while alive.load(Ordering::Relaxed) == 1 {
                thread::sleep(Duration::from_millis(100));
                let n = bytes.swap(0, Ordering::Relaxed);
                if n > 0 { say(&out, format!("{{\"t\":\"b\",\"n\":{}}}", n)); }
            }
            let n = bytes.swap(0, Ordering::Relaxed);
            if n > 0 { say(&out, format!("{{\"t\":\"b\",\"n\":{}}}", n)); }
        })
    };

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(30))
        .user_agent("WaresLauncher/native")
        .build();
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().expect("thread pool");
    pool.install(|| {
        tasks.par_iter().for_each(|t| {
            let mut last = String::new();
            for attempt in 0..3u64 {
                match fetch(&agent, t, &bytes) {
                    Ok(()) => { say(&out, format!("{{\"t\":\"f\",\"d\":\"{}\"}}", esc(&t.dest))); return; }
                    Err(e) => { last = e; thread::sleep(Duration::from_millis(300 * (attempt + 1))); }
                }
            }
            say(&out, format!("{{\"t\":\"e\",\"d\":\"{}\",\"m\":\"{}\"}}", esc(&t.dest), esc(&last)));
        });
    });
    alive.store(0, Ordering::Relaxed);
    let _ = reporter.join();
}
