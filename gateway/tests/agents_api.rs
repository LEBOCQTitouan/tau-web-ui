use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

fn make_project() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("tau.toml"),
        "[project]\nname = \"demo\"\n\n[agents.greeter]\ndisplay_name = \"Greeter\"\nllm_backend = \"anthropic\"\n",
    )
    .unwrap();
    d
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn agent_crud_over_http() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    reg.add_local(proj.path()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // create
    let body = serde_json::json!({
        "id": "writer",
        "display_name": "Writer",
        "package": "critic@^0.1",
        "llm_backend": "anthropic",
        "prompt": { "system": "you are a writer", "system_file": null },
        "requires_tools": [{ "name": "web", "source": "https://x/web.git", "version": null }]
    });
    let created = http
        .put(format!("{base}/api/projects/demo/agents/writer?create=1"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), reqwest::StatusCode::OK);

    // duplicate create -> 409
    let dup = http
        .put(format!("{base}/api/projects/demo/agents/writer?create=1"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(dup.status(), reqwest::StatusCode::CONFLICT);

    // list shows greeter + writer
    let list: serde_json::Value = http
        .get(format!("{base}/api/projects/demo/agents"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(list.as_array().unwrap().len(), 2);

    // get one
    let one: serde_json::Value = http
        .get(format!("{base}/api/projects/demo/agents/writer"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(one["prompt"]["system"], "you are a writer");

    // invalid id -> 400
    let bad = http
        .put(format!("{base}/api/projects/demo/agents/bad%20id"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);

    // delete -> 204 then 404
    let del = http
        .delete(format!("{base}/api/projects/demo/agents/writer"))
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), reqwest::StatusCode::NO_CONTENT);
    let del2 = http
        .delete(format!("{base}/api/projects/demo/agents/writer"))
        .send()
        .await
        .unwrap();
    assert_eq!(del2.status(), reqwest::StatusCode::NOT_FOUND);
}
