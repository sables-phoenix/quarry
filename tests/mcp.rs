use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn mcp_lists_text_tools() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_quarry"))
        .arg("mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn quarry mcp");
    {
        let stdin = child.stdin.as_mut().expect("stdin");
        writeln!(
            stdin,
            r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{}}}}"#
        )
        .unwrap();
        writeln!(stdin, r#"{{"jsonrpc":"2.0","id":2,"method":"tools/list"}}"#).unwrap();
    }
    let output = child.wait_with_output().expect("wait");
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("web_fetch"), "{text}");
    assert!(text.contains("web_ask"), "{text}");
    assert!(text.contains("web_research"), "{text}");
}

#[test]
fn loopback_is_refused() {
    let output = Command::new(env!("CARGO_BIN_EXE_quarry"))
        .args(["fetch", "http://127.0.0.1:1/"])
        .output()
        .expect("run quarry fetch");
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("private or loopback"), "{stderr}");
}
