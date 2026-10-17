//! Outbound MCP connections for the built-in agent, separate from the canvas MCP server.
use rmcp::{
    model::{CallToolRequestParams, Tool},
    service::RunningService,
    transport::{StreamableHttpClientTransport, TokioChildProcess},
    RoleClient, ServiceExt,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri::{Manager, State};
use tokio::sync::Mutex;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpConfig {
    pub id: String,
    pub label: String,
    pub transport: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
}

struct Connection {
    service: Arc<RunningService<RoleClient, ()>>,
    tools: Vec<Tool>,
    revision: String,
}
#[derive(Default)]
pub struct McpClientState {
    mutations: Mutex<()>,
    // Never hold this lock across connection setup or remote tool execution.
    connections: Mutex<HashMap<String, Connection>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerView {
    config: McpConfig,
    connected: bool,
    tools: Vec<Tool>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAgentTool {
    agent_name: String,
    server_id: String,
    revision: String,
    tool: Tool,
}

fn validate(config: &McpConfig) -> Result<(), String> {
    if config.id.is_empty()
        || config.id.len() > 48
        || !config
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("无效 MCP ID".into());
    }
    if config.label.len() > 120
        || config.args.len() > 64
        || config.args.iter().any(|a| a.len() > 4096)
        || config.allowed_tools.len() > 256
        || config.allowed_tools.iter().any(|name| name.len() > 256)
    {
        return Err("MCP 配置过大".into());
    }
    match config.transport.as_str() {
        "stdio" if !config.command.is_empty() && config.command.len() <= 4096 => {}
        "http" => {
            let url = reqwest::Url::parse(&config.url).map_err(|e| e.to_string())?;
            let local = matches!(
                url.host_str(),
                Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
            );
            if !(url.scheme() == "https" || url.scheme() == "http" && local)
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
            {
                return Err("MCP 地址须为 HTTPS 或本机 HTTP；不支持 URL 中的凭据和查询参数".into());
            }
        }
        _ => return Err("请选择 stdio 或 http，并提供有效启动命令/地址".into()),
    }
    Ok(())
}

fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("mcp.json"))
}
fn configs(app: &tauri::AppHandle) -> Result<Vec<McpConfig>, String> {
    let path = path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("MCP 配置文件过大".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}
fn persist(app: &tauri::AppHandle, configs: &[McpConfig]) -> Result<(), String> {
    let path = path(app)?;
    let bytes = serde_json::to_vec_pretty(configs).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("MCP 配置总大小超过 1 MiB".into());
    }
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("无效配置路径")?)
        .map_err(|e| e.to_string())?;
    use std::io::Write;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn revision(config: &McpConfig, tools: &[Tool]) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(config, tools)).unwrap_or_default())
    )
}

#[tauri::command]
pub async fn list_mcp_servers(
    app: tauri::AppHandle,
    state: State<'_, McpClientState>,
) -> Result<Vec<McpServerView>, String> {
    let connections = state.connections.lock().await;
    Ok(configs(&app)?
        .into_iter()
        .map(|config| {
            let connection = connections
                .get(&config.id)
                .filter(|c| !c.service.is_closed());
            McpServerView {
                connected: connection.is_some(),
                tools: connection.map(|c| c.tools.clone()).unwrap_or_default(),
                config,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn save_mcp_server(
    app: tauri::AppHandle,
    state: State<'_, McpClientState>,
    config: McpConfig,
) -> Result<(), String> {
    validate(&config)?;
    let _mutation = state.mutations.lock().await;
    let mut connections = state.connections.lock().await;
    let mut items = configs(&app)?;
    items.retain(|item| item.id != config.id);
    if items.len() >= 32 {
        return Err("最多配置 32 个 MCP 服务".into());
    }
    items.push(config.clone());
    persist(&app, &items)?;
    if let Some(old) = connections.remove(&config.id) {
        old.service.cancellation_token().cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_mcp_server(
    app: tauri::AppHandle,
    state: State<'_, McpClientState>,
    id: String,
) -> Result<(), String> {
    let _mutation = state.mutations.lock().await;
    let mut connections = state.connections.lock().await;
    let mut items = configs(&app)?;
    items.retain(|item| item.id != id);
    persist(&app, &items)?;
    if let Some(old) = connections.remove(&id) {
        old.service.cancellation_token().cancel();
    }
    Ok(())
}

async fn open_connection(
    config: &McpConfig,
) -> Result<(RunningService<RoleClient, ()>, Vec<Tool>), String> {
    let service = tokio::time::timeout(Duration::from_secs(30), async {
        if config.transport == "stdio" {
            let mut command = tokio::process::Command::new(&config.command);
            command
                .args(&config.args)
                .kill_on_drop(true)
                .stderr(std::process::Stdio::null());
            ().serve(TokioChildProcess::new(command).map_err(|e| e.to_string())?)
                .await
                .map_err(|e| e.to_string())
        } else {
            ().serve(StreamableHttpClientTransport::from_uri(config.url.clone()))
                .await
                .map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|_| "MCP 连接超时".to_string())??;
    let tools = tokio::time::timeout(Duration::from_secs(20), service.list_all_tools())
        .await
        .map_err(|_| "MCP 工具发现超时".to_string())?
        .map_err(|e| e.to_string())?;
    if tools.len() > 256
        || serde_json::to_vec(&tools).map_err(|e| e.to_string())?.len() > 1024 * 1024
    {
        return Err("MCP 工具目录过大".into());
    }
    Ok((service, tools))
}

#[tauri::command]
pub async fn connect_mcp_server(
    app: tauri::AppHandle,
    state: State<'_, McpClientState>,
    id: String,
) -> Result<(), String> {
    let _mutation = state.mutations.lock().await;
    if state
        .connections
        .lock()
        .await
        .get(&id)
        .is_some_and(|c| !c.service.is_closed())
    {
        return Ok(());
    }
    let config = configs(&app)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or("MCP 服务不存在")?;
    validate(&config)?;
    let (service, tools) = open_connection(&config).await?;
    let rev = revision(&config, &tools);
    state.connections.lock().await.insert(
        id,
        Connection {
            service: Arc::new(service),
            tools,
            revision: rev,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn disconnect_mcp_server(
    state: State<'_, McpClientState>,
    id: String,
) -> Result<(), String> {
    let _mutation = state.mutations.lock().await;
    if let Some(old) = state.connections.lock().await.remove(&id) {
        old.service.cancellation_token().cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn list_mcp_agent_tools(
    app: tauri::AppHandle,
    state: State<'_, McpClientState>,
) -> Result<Vec<McpAgentTool>, String> {
    let connections = state.connections.lock().await;
    let mut result = Vec::new();
    for config in configs(&app)? {
        if let Some(connection) = connections
            .get(&config.id)
            .filter(|c| !c.service.is_closed())
        {
            for tool in &connection.tools {
                if config
                    .allowed_tools
                    .iter()
                    .any(|name| name == tool.name.as_ref())
                {
                    result.push(McpAgentTool {
                        agent_name: format!(
                            "mcp_{}_{}",
                            &config.id[..config.id.len().min(20)],
                            &format!(
                                "{:x}",
                                Sha256::digest(
                                    format!("{}/{}/{}", config.id, connection.revision, tool.name)
                                        .as_bytes()
                                )
                            )[..32]
                        )
                        .replace('-', "_"),
                        server_id: config.id.clone(),
                        revision: connection.revision.clone(),
                        tool: tool.clone(),
                    });
                }
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn call_mcp_tool(
    app: tauri::AppHandle,
    state: State<'_, McpClientState>,
    server_id: String,
    tool_name: String,
    revision: String,
    arguments: serde_json::Map<String, Value>,
) -> Result<Value, String> {
    if serde_json::to_vec(&arguments)
        .map_err(|e| e.to_string())?
        .len()
        > 128 * 1024
    {
        return Err("MCP 参数过大，请使用资产文件引用".into());
    }
    let service = {
        let connections = state.connections.lock().await;
        let config = configs(&app)?
            .into_iter()
            .find(|c| c.id == server_id)
            .ok_or("MCP 配置已移除")?;
        if !config.allowed_tools.contains(&tool_name) {
            return Err("此 MCP 工具尚未授权".into());
        }
        let connection = connections
            .get(&server_id)
            .filter(|c| !c.service.is_closed())
            .ok_or("MCP 未连接")?;
        if connection.revision != revision {
            return Err("MCP 配置或工具版本已变更，请重新发起任务".into());
        }
        if !connection
            .tools
            .iter()
            .any(|t| t.name.as_ref() == tool_name)
        {
            return Err("未知 MCP 工具".into());
        }
        connection.service.clone()
    };
    let result = tokio::time::timeout(
        Duration::from_secs(120),
        service.call_tool(CallToolRequestParams::new(tool_name).with_arguments(arguments)),
    )
    .await
    .map_err(|_| "MCP 调用超时，执行结果未知；不要自动重试写入或渲染操作".to_string())?
    .map_err(|e| format!("MCP 调用失败，执行结果可能未知：{e}"))?;
    let bytes = serde_json::to_vec(&result).map_err(|e| e.to_string())?;
    if bytes.len() > 512 * 1024 {
        return Err("MCP 结果过大，操作可能已完成；请改用文件/任务引用查询，勿重复提交".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn connects_to_a_real_stdio_process_discovers_and_calls_a_tool() {
        let script = r#"
import json, sys
for line in sys.stdin:
    msg = json.loads(line)
    if 'id' not in msg: continue
    method = msg.get('method')
    if method == 'initialize':
        result = {'protocolVersion':'2025-03-26','capabilities':{'tools':{}},'serverInfo':{'name':'fixture','version':'1'}}
    elif method == 'tools/list':
        result = {'tools':[{'name':'echo','description':'Echo','inputSchema':{'type':'object','properties':{'text':{'type':'string'}},'required':['text']}}]}
    elif method == 'tools/call':
        result = {'content':[{'type':'text','text':msg['params']['arguments']['text']}], 'isError':False}
    else:
        print(json.dumps({'jsonrpc':'2.0','id':msg['id'],'error':{'code':-32601,'message':'unsupported'}}), flush=True)
        continue
    print(json.dumps({'jsonrpc':'2.0','id':msg['id'],'result':result}), flush=True)
"#;
        let config = McpConfig {
            id: "fixture".into(),
            label: "Fixture".into(),
            transport: "stdio".into(),
            command: "python3".into(),
            args: vec!["-u".into(), "-c".into(), script.into()],
            url: String::new(),
            allowed_tools: vec!["echo".into()],
        };
        let (service, tools) = open_connection(&config).await.unwrap();
        assert_eq!(tools[0].name, "echo");
        let result = service
            .call_tool(
                CallToolRequestParams::new("echo").with_arguments(
                    serde_json::json!({"text":"connected"})
                        .as_object()
                        .unwrap()
                        .clone(),
                ),
            )
            .await
            .unwrap();
        assert!(serde_json::to_string(&result)
            .unwrap()
            .contains("connected"));
        service.cancel().await.unwrap();
    }
    #[test]
    fn validates_transport_and_rejects_remote_plaintext() {
        let mut config = McpConfig {
            id: "test".into(),
            label: "Test".into(),
            transport: "http".into(),
            command: String::new(),
            args: vec![],
            url: "http://127.0.0.1:8000/mcp".into(),
            allowed_tools: vec![],
        };
        assert!(validate(&config).is_ok());
        for url in [
            "http://example.com/mcp",
            "file:///tmp/mcp",
            "https://example.com/mcp?token=x",
            "https://user:pass@example.com/mcp",
        ] {
            config.url = url.into();
            assert!(validate(&config).is_err());
        }
    }
}
