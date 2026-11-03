//! The local LanguageTool server (ADR-020), started on demand and stopped when idle.
//!
//! A portable Java and LanguageTool live in `%LOCALAPPDATA%\Typely\languagetool` (see
//! docs/development/setup.md). The server listens on loopback only. It is started when the
//! panel opens, warmed up for English and French in the background, and stopped after
//! `IDLE_STOP` without use, or with Typely: a job object kills it even if Typely crashes.
//! Corrections never wait for it; until it is ready they use the other layers.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

pub const PORT: u16 = 18081;
pub const URL: &str = "http://127.0.0.1:18081";
const IDLE_STOP: Duration = Duration::from_secs(10 * 60);
const START_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    NotInstalled,
    Stopped,
    Starting,
    Ready,
    Failed,
}

#[derive(Debug, Clone)]
pub struct Install {
    java: PathBuf,
    jar: PathBuf,
    pub version: String,
}

/// Where the portable install is expected.
pub fn install_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| Path::new(&d).join("Typely").join("languagetool"))
}

/// Finds `jdk-*\bin\java.exe` and `LanguageTool-*\languagetool-server.jar` in `dir`.
pub fn find_install(dir: &Path) -> Option<Install> {
    let mut java = None;
    let mut server = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if name.starts_with("jdk") && path.join("bin").join("java.exe").is_file() {
            java = Some(path.join("bin").join("java.exe"));
        } else if let Some(version) = name.strip_prefix("LanguageTool-")
            && path.join("languagetool-server.jar").is_file()
        {
            server = Some((path.join("languagetool-server.jar"), version.to_owned()));
        }
    }
    let (jar, version) = server?;
    Some(Install {
        java: java?,
        jar,
        version,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub state: State,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub url: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct Inner {
    state: State,
    child: Option<Child>,
    #[cfg(windows)]
    job: Option<job::Job>,
    last_used: Instant,
    error: Option<String>,
}

pub struct LanguageTool {
    inner: Mutex<Inner>,
}

impl Default for LanguageTool {
    fn default() -> Self {
        LanguageTool {
            inner: Mutex::new(Inner {
                state: State::Stopped,
                child: None,
                #[cfg(windows)]
                job: None,
                last_used: Instant::now(),
                error: None,
            }),
        }
    }
}

impl LanguageTool {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn status(&self) -> Status {
        let dir = install_dir();
        let install = dir.as_deref().and_then(find_install);
        let inner = self.lock();
        Status {
            state: if install.is_none() {
                State::NotInstalled
            } else {
                inner.state
            },
            version: install.map(|i| i.version),
            url: URL,
            folder: dir.map(|d| d.display().to_string()),
            error: inner.error.clone(),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.lock().state == State::Ready
    }

    /// Marks the server as used, which postpones the idle stop.
    pub fn touch(&self) {
        self.lock().last_used = Instant::now();
    }

    /// Starts the server in the background if it is not running. Returns at once.
    pub fn ensure_started(self: &Arc<Self>) {
        let Some(install) = install_dir().as_deref().and_then(find_install) else {
            return;
        };
        {
            let mut inner = self.lock();
            if matches!(inner.state, State::Starting | State::Ready) {
                inner.last_used = Instant::now();
                return;
            }
            match spawn(&install) {
                Ok((child, job)) => {
                    inner.child = Some(child);
                    #[cfg(windows)]
                    {
                        inner.job = job;
                    }
                    #[cfg(not(windows))]
                    let _ = job;
                    inner.state = State::Starting;
                    inner.error = None;
                    inner.last_used = Instant::now();
                }
                Err(error) => {
                    inner.state = State::Failed;
                    inner.error = Some(error);
                    return;
                }
            }
        }
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            let outcome = wait_until_ready().and_then(|()| warm_up());
            let mut inner = this.lock();
            if inner.state != State::Starting {
                return; // stopped meanwhile
            }
            match outcome {
                Ok(()) => inner.state = State::Ready,
                Err(error) => {
                    inner.state = State::Failed;
                    inner.error = Some(error);
                    if let Some(mut child) = inner.child.take() {
                        let _ = child.kill();
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        let mut inner = self.lock();
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        #[cfg(windows)]
        {
            inner.job = None;
        }
        if inner.state != State::NotInstalled {
            inner.state = State::Stopped;
        }
    }

    /// Stops the server after `IDLE_STOP` without use, and notices if it exited.
    pub fn watch(self: Arc<Self>) {
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(30));
                let idle = {
                    let mut inner = self.lock();
                    if let Some(child) = inner.child.as_mut()
                        && let Ok(Some(_)) = child.try_wait()
                    {
                        inner.child = None;
                        inner.state = State::Stopped;
                    }
                    inner.state == State::Ready && inner.last_used.elapsed() >= IDLE_STOP
                };
                if idle {
                    self.stop();
                }
            }
        });
    }
}

#[cfg(windows)]
type JobHandle = Option<job::Job>;
#[cfg(not(windows))]
type JobHandle = ();

/// Server options. Without `pipelineCaching` LanguageTool rebuilds its rule pipeline on every
/// request: 3–5 s per French check on the reference laptop, ~0.1 s with it (about +75 MB).
const SERVER_CONFIG: &str = "\
pipelineCaching=true
maxPipelinePoolSize=10
pipelineExpireTimeInSeconds=3600
";

/// Writes the server options next to the install and returns their path.
fn write_config(install: &Install) -> Result<PathBuf, String> {
    let dir = install
        .jar
        .parent()
        .and_then(Path::parent)
        .ok_or("The grammar checker folder is incomplete")?;
    let path = dir.join("server.properties");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(SERVER_CONFIG) {
        std::fs::write(&path, SERVER_CONFIG)
            .map_err(|e| format!("Cannot write the grammar checker settings: {e}"))?;
    }
    Ok(path)
}

fn spawn(install: &Install) -> Result<(Child, JobHandle), String> {
    let config = write_config(install)?;
    let mut command = Command::new(&install.java);
    command
        // Small heap and the serial collector: ~400-500 MB in use instead of a default JVM's GBs.
        .args([
            "-Xms32m",
            "-Xmx512m",
            "-XX:+UseSerialGC",
            "-Dfile.encoding=UTF-8",
            "-cp",
        ])
        .arg(&install.jar)
        .args([
            "org.languagetool.server.HTTPServer",
            "--port",
            &PORT.to_string(),
            "--config",
        ])
        .arg(&config)
        .current_dir(install.jar.parent().unwrap_or(Path::new(".")))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command
        .spawn()
        .map_err(|e| format!("Cannot start the grammar checker: {e}"))?;
    #[cfg(windows)]
    let job = job::Job::kill_on_close(&child);
    #[cfg(not(windows))]
    let job = ();
    Ok((child, job))
}

/// Minimal HTTP/1.1 exchange with the local server (no TLS, loopback only).
fn http(request: &str, timeout: Duration) -> Result<String, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", PORT)).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| e.to_string())?;
    stream
        .write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| e.to_string())?;
    Ok(response)
}

fn wait_until_ready() -> Result<(), String> {
    let start = Instant::now();
    let request = "GET /v2/languages HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    while start.elapsed() < START_TIMEOUT {
        if http(request, Duration::from_secs(2)).is_ok_and(|r| r.starts_with("HTTP/1.1 200")) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("The grammar checker did not start in time".to_owned())
}

/// The first check per language loads its rules (~10 s for English): do it now. The codes
/// match what corrections send, so the cached pipelines are the ones they use.
fn warm_up() -> Result<(), String> {
    for (language, text) in [("en-US", "This are a test."), ("fr", "Ceci est un test.")] {
        let body = format!("language={language}&text={}", text.replace(' ', "%20"));
        let request = format!(
            "POST /v2/check HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let response = http(&request, Duration::from_secs(60))?;
        if !response.starts_with("HTTP/1.1 200") {
            return Err("The grammar checker failed its first check".to_owned());
        }
    }
    Ok(())
}

#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };
    use windows::core::PCWSTR;

    /// Kills the assigned process when the last handle closes, including when Typely dies.
    pub struct Job(HANDLE);

    // SAFETY: a job handle is a kernel handle usable from any thread.
    unsafe impl Send for Job {}

    impl Job {
        pub fn kill_on_close(child: &Child) -> Option<Job> {
            // SAFETY: creates and configures an unnamed job; the handle is owned by `Job`.
            unsafe {
                let handle = CreateJobObjectW(None, PCWSTR::null()).ok()?;
                let job = Job(handle);
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
                .ok()?;
                AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())).ok()?;
                Some(job)
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: closes the job handle once; the process is killed with it.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_portable_install() {
        let dir = std::env::temp_dir().join(format!("typely-lt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(find_install(&dir).is_none());
        std::fs::create_dir_all(dir.join("jdk-21.0.12.1+1-jre").join("bin")).unwrap();
        std::fs::write(dir.join("jdk-21.0.12.1+1-jre/bin/java.exe"), b"").unwrap();
        assert!(find_install(&dir).is_none(), "Java alone is not an install");
        std::fs::create_dir_all(dir.join("LanguageTool-6.6")).unwrap();
        std::fs::write(dir.join("LanguageTool-6.6/languagetool-server.jar"), b"").unwrap();
        let install = find_install(&dir).unwrap();
        assert_eq!(install.version, "6.6");

        // The server options are written next to the install, once.
        let config = write_config(&install).unwrap();
        assert_eq!(config, dir.join("server.properties"));
        let written = std::fs::read_to_string(&config).unwrap();
        assert!(written.contains("pipelineCaching=true"));
        assert_eq!(write_config(&install).unwrap(), config);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
