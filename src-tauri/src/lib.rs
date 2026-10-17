use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use base64::Engine;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs as unix_fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct WorkspaceFsSearchRegistry {
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsEntry {
    path: String,
    parent_path: Option<String>,
    name: String,
    kind: String,
    target_kind: Option<String>,
    size: Option<u64>,
    modified_ms: Option<u128>,
    readonly: bool,
    hidden: bool,
    has_children: Option<bool>,
    executable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsListPayload {
    path: String,
    parent_path: Option<String>,
    entries: Vec<WorkspaceFsEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsSkippedPath {
    path: String,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsSearchPayload {
    root: String,
    query: String,
    entries: Vec<WorkspaceFsEntry>,
    source: String,
    result_count: usize,
    complete: bool,
    result_limit_reached: bool,
    traversal_limit_reached: bool,
    skipped_count: usize,
    skipped: Vec<WorkspaceFsSkippedPath>,
    entries_scanned: usize,
    directories_scanned: usize,
    cancelled: bool,
    result_limit: usize,
    traversal_limit: usize,
    status_text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsListRequest {
    path: String,
    show_hidden: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsPathRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsSearchRequest {
    root_path: String,
    query: String,
    show_hidden: Option<bool>,
    limit: Option<usize>,
    traversal_limit: Option<usize>,
    search_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsSearchCancelRequest {
    search_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsTransferRequest {
    source_paths: Vec<String>,
    destination_directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsRenameRequest {
    path: String,
    new_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsCreateDirectoryRequest {
    parent_path: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsDeleteRequest {
    paths: Vec<String>,
    recursive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsReadTextRequest {
    path: String,
    byte_limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsReadBinaryRequest {
    path: String,
    byte_limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsOperationPayload {
    affected_paths: Vec<String>,
    message: String,
}

fn workspace_fs_error(status: &str, message: String) -> Value {
    json!({
        "ok": false,
        "status": status,
        "error": message,
    })
}

fn system_time_ms(time: SystemTime) -> Option<u128> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

fn clean_absolute_path(input: &str) -> Result<PathBuf, Value> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(workspace_fs_error(
            "empty_path",
            "Path must not be empty.".to_string(),
        ));
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(workspace_fs_error(
            "relative_path",
            format!("Path must be absolute: {}", trimmed),
        ));
    }

    Ok(path)
}

fn validate_entry_name(name: &str) -> Result<String, Value> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(workspace_fs_error(
            "empty_name",
            "Name must not be empty.".to_string(),
        ));
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(workspace_fs_error(
            "invalid_name",
            "Name must not contain path separators or traversal components.".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn path_kind(metadata: &fs::Metadata) -> String {
    if metadata.is_dir() {
        "directory".to_string()
    } else if metadata.is_file() {
        "file".to_string()
    } else {
        "other".to_string()
    }
}

fn child_has_entries(path: &Path) -> Option<bool> {
    fs::read_dir(path)
        .ok()
        .map(|mut entries| entries.next().is_some())
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

fn workspace_fs_entry(path: &Path) -> Result<WorkspaceFsEntry, String> {
    let symlink_metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("failed to stat {}: {}", path.display(), error))?;
    let file_type = symlink_metadata.file_type();
    let is_symlink = file_type.is_symlink();
    let target_metadata = if is_symlink {
        fs::metadata(path).ok()
    } else {
        Some(symlink_metadata.clone())
    };
    let kind = if is_symlink {
        "symlink".to_string()
    } else {
        path_kind(&symlink_metadata)
    };
    let target_kind = target_metadata.as_ref().map(path_kind);
    let effective_metadata = target_metadata.as_ref().unwrap_or(&symlink_metadata);
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_else(|| path.to_str().unwrap_or(""))
        .to_string();

    Ok(WorkspaceFsEntry {
        path: path.display().to_string(),
        parent_path: path.parent().map(|parent| parent.display().to_string()),
        name: name.clone(),
        kind,
        target_kind,
        size: if effective_metadata.is_file() {
            Some(effective_metadata.len())
        } else {
            None
        },
        modified_ms: effective_metadata.modified().ok().and_then(system_time_ms),
        readonly: effective_metadata.permissions().readonly(),
        hidden: name.starts_with('.'),
        has_children: if effective_metadata.is_dir() {
            child_has_entries(path)
        } else {
            None
        },
        executable: is_executable(effective_metadata),
    })
}

fn sort_workspace_fs_entries(entries: &mut Vec<WorkspaceFsEntry>) {
    entries.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.path.cmp(&right.path))
    });
}

fn sort_workspace_fs_skipped(skipped: &mut Vec<WorkspaceFsSkippedPath>) {
    skipped.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.reason.cmp(&right.reason))
    });
}

fn read_workspace_fs_children(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(directory).map_err(|error| {
        format!(
            "failed to read directory {}: {}",
            directory.display(),
            error
        )
    })?;
    let mut children = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "failed to read directory entry in {}: {}",
                directory.display(),
                error
            )
        })?;
        children.push(entry.path());
    }
    Ok(children)
}

const DEFAULT_WORKSPACE_FS_SEARCH_RESULT_LIMIT: usize = 200;
const DEFAULT_WORKSPACE_FS_SEARCH_TRAVERSAL_LIMIT: usize = 25_000;
const MAX_WORKSPACE_FS_SEARCH_RESULT_LIMIT: usize = 1000;
const MAX_WORKSPACE_FS_SEARCH_TRAVERSAL_LIMIT: usize = 100_000;
const DEFAULT_WORKSPACE_FS_TEXT_BYTE_LIMIT: usize = 1_000_000;
const MAX_WORKSPACE_FS_TEXT_BYTE_LIMIT: usize = 5_000_000;
const DEFAULT_WORKSPACE_FS_BINARY_BYTE_LIMIT: usize = 10_000_000;
const MAX_WORKSPACE_FS_BINARY_BYTE_LIMIT: usize = 50_000_000;

#[derive(Debug, Clone, Copy)]
struct WorkspaceFsSearchLimits {
    result_limit: usize,
    traversal_limit: usize,
}

#[derive(Debug, Default)]
struct WorkspaceFsSearchRuntime {
    entries_scanned: usize,
    directories_scanned: usize,
    result_limit_reached: bool,
    traversal_limit_reached: bool,
    cancelled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum WorkspaceFsSearchMatcher {
    Substring(String),
    FilenamePrefix(String),
    FilenameSuffix(String),
    FilenameContains(String),
}

impl WorkspaceFsSearchMatcher {
    fn from_query(query: &str) -> Self {
        let normalized = query.trim().to_lowercase();
        let wildcard_count = normalized.matches('*').count();
        let supports_simple_glob = wildcard_count > 0
            && !normalized.contains('?')
            && normalized
                .chars()
                .all(|character| character != '[' && character != ']');

        if !supports_simple_glob {
            return Self::Substring(normalized);
        }

        if wildcard_count == 1 && normalized.ends_with('*') {
            return Self::FilenamePrefix(normalized.trim_end_matches('*').to_string());
        }

        if wildcard_count == 1 && normalized.starts_with('*') {
            return Self::FilenameSuffix(normalized.trim_start_matches('*').to_string());
        }

        if wildcard_count == 2 && normalized.starts_with('*') && normalized.ends_with('*') {
            return Self::FilenameContains(normalized.trim_matches('*').to_string());
        }

        Self::Substring(normalized)
    }

    fn matches(&self, node: &WorkspaceFsEntry) -> bool {
        let name = node.name.to_lowercase();
        match self {
            Self::Substring(needle) => {
                let haystack = format!("{}\n{}", node.name, node.path).to_lowercase();
                haystack.contains(needle)
            }
            Self::FilenamePrefix(prefix) => name.starts_with(prefix),
            Self::FilenameSuffix(suffix) => name.ends_with(suffix),
            Self::FilenameContains(needle) => name.contains(needle),
        }
    }
}

fn workspace_fs_search_cancelled(cancellation: Option<&Arc<AtomicBool>>) -> bool {
    cancellation.is_some_and(|flag| flag.load(Ordering::Relaxed))
}

#[cfg(unix)]
fn workspace_fs_device_id(metadata: &fs::Metadata) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    Some(metadata.dev())
}

#[cfg(not(unix))]
fn workspace_fs_device_id(_metadata: &fs::Metadata) -> Option<u64> {
    None
}

fn workspace_fs_entry_device_id(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| workspace_fs_device_id(&metadata))
}

fn workspace_fs_root_device_id(root: &Path) -> Option<u64> {
    fs::metadata(root)
        .ok()
        .and_then(|metadata| workspace_fs_device_id(&metadata))
}

fn workspace_fs_can_descend_path(path: &Path, root_device_id: Option<u64>) -> Result<(), String> {
    let Some(root_device_id) = root_device_id else {
        return Ok(());
    };

    match workspace_fs_entry_device_id(path) {
        Some(device_id) if device_id == root_device_id => Ok(()),
        Some(_) => Err("skipped mount boundary".to_string()),
        None => Ok(()),
    }
}

fn search_workspace_fs_with_reader<ReadChildren, DescribeEntry>(
    root: &Path,
    query: &str,
    show_hidden: bool,
    limits: WorkspaceFsSearchLimits,
    cancellation: Option<Arc<AtomicBool>>,
    mut read_children: ReadChildren,
    mut describe_entry: DescribeEntry,
    mut can_descend: impl FnMut(&Path) -> Result<(), String>,
) -> Result<WorkspaceFsSearchPayload, String>
where
    ReadChildren: FnMut(&Path) -> Result<Vec<PathBuf>, String>,
    DescribeEntry: FnMut(&Path) -> Result<WorkspaceFsEntry, String>,
{
    let matcher = WorkspaceFsSearchMatcher::from_query(query);
    let mut results = Vec::new();
    let mut skipped = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut root_read = true;
    let mut runtime = WorkspaceFsSearchRuntime::default();

    while let Some(directory) = stack.pop() {
        if workspace_fs_search_cancelled(cancellation.as_ref()) {
            runtime.cancelled = true;
            break;
        }
        if runtime.directories_scanned >= limits.traversal_limit {
            runtime.traversal_limit_reached = true;
            break;
        }

        let children = match read_children(&directory) {
            Ok(children) => children,
            Err(reason) => {
                if root_read {
                    return Err(reason);
                }
                skipped.push(WorkspaceFsSkippedPath {
                    path: directory.display().to_string(),
                    reason,
                });
                continue;
            }
        };
        runtime.directories_scanned += 1;
        root_read = false;

        for path in children {
            if workspace_fs_search_cancelled(cancellation.as_ref()) {
                runtime.cancelled = true;
                break;
            }
            if runtime.entries_scanned >= limits.traversal_limit {
                runtime.traversal_limit_reached = true;
                break;
            }

            let node = match describe_entry(&path) {
                Ok(node) => node,
                Err(reason) => {
                    skipped.push(WorkspaceFsSkippedPath {
                        path: path.display().to_string(),
                        reason,
                    });
                    continue;
                }
            };
            runtime.entries_scanned += 1;
            if !show_hidden && node.hidden {
                continue;
            }
            if node.kind == "directory" {
                match can_descend(&path) {
                    Ok(()) => stack.push(path),
                    Err(reason) => skipped.push(WorkspaceFsSkippedPath {
                        path: path.display().to_string(),
                        reason,
                    }),
                }
            }
            if matcher.matches(&node) {
                results.push(node);
                if results.len() >= limits.result_limit {
                    runtime.result_limit_reached = true;
                    break;
                }
            }
        }
        if runtime.result_limit_reached || runtime.traversal_limit_reached || runtime.cancelled {
            break;
        }
    }

    sort_workspace_fs_entries(&mut results);
    sort_workspace_fs_skipped(&mut skipped);
    let skipped_count = skipped.len();
    let result_count = results.len();
    let complete =
        !runtime.result_limit_reached && !runtime.traversal_limit_reached && !runtime.cancelled;
    Ok(WorkspaceFsSearchPayload {
        root: root.display().to_string(),
        query: query.to_string(),
        entries: results,
        source: "live".to_string(),
        result_count,
        complete,
        result_limit_reached: runtime.result_limit_reached,
        traversal_limit_reached: runtime.traversal_limit_reached,
        skipped_count,
        skipped,
        entries_scanned: runtime.entries_scanned,
        directories_scanned: runtime.directories_scanned,
        cancelled: runtime.cancelled,
        result_limit: limits.result_limit,
        traversal_limit: limits.traversal_limit,
        status_text: None,
    })
}

fn is_same_or_descendant(path: &Path, ancestor: &Path) -> bool {
    path == ancestor || path.starts_with(ancestor)
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination).map_err(|error| {
        format!(
            "failed to create destination directory {}: {}",
            destination.display(),
            error
        )
    })?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read {}: {}", source.display(), error))?
    {
        let entry = entry.map_err(|error| {
            format!(
                "failed to read directory entry in {}: {}",
                source.display(),
                error
            )
        })?;
        let child_source = entry.path();
        let child_destination = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&child_source)
            .map_err(|error| format!("failed to stat {}: {}", child_source.display(), error))?;

        if metadata.file_type().is_symlink() {
            let target = fs::read_link(&child_source).map_err(|error| {
                format!(
                    "failed to read symlink {}: {}",
                    child_source.display(),
                    error
                )
            })?;
            #[cfg(unix)]
            unix_fs::symlink(&target, &child_destination).map_err(|error| {
                format!(
                    "failed to copy symlink {} to {}: {}",
                    child_source.display(),
                    child_destination.display(),
                    error
                )
            })?;
            #[cfg(not(unix))]
            return Err(format!(
                "copying symlinks is not supported on this platform: {}",
                child_source.display()
            ));
        } else if metadata.is_dir() {
            copy_directory_recursive(&child_source, &child_destination)?;
        } else if metadata.is_file() {
            fs::copy(&child_source, &child_destination).map_err(|error| {
                format!(
                    "failed to copy {} to {}: {}",
                    child_source.display(),
                    child_destination.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

#[tauri::command]
fn workspace_fs_stat(request: WorkspaceFsPathRequest) -> Result<Value, Value> {
    let path = clean_absolute_path(&request.path)?;
    let entry =
        workspace_fs_entry(&path).map_err(|error| workspace_fs_error("stat_failed", error))?;
    Ok(json!({ "ok": true, "data": entry }))
}

#[tauri::command]
fn workspace_fs_list(request: WorkspaceFsListRequest) -> Result<Value, Value> {
    let path = clean_absolute_path(&request.path)?;
    let metadata = fs::metadata(&path).map_err(|error| {
        workspace_fs_error(
            "stat_failed",
            format!("failed to stat {}: {}", path.display(), error),
        )
    })?;

    if !metadata.is_dir() {
        return Err(workspace_fs_error(
            "not_directory",
            format!("Target is not a directory: {}", path.display()),
        ));
    }

    let mut entries = Vec::new();
    let show_hidden = request.show_hidden.unwrap_or(false);
    for entry in fs::read_dir(&path).map_err(|error| {
        workspace_fs_error(
            "read_failed",
            format!("failed to read directory {}: {}", path.display(), error),
        )
    })? {
        let entry = entry.map_err(|error| {
            workspace_fs_error(
                "read_entry_failed",
                format!(
                    "failed to read directory entry in {}: {}",
                    path.display(),
                    error
                ),
            )
        })?;
        let child = workspace_fs_entry(&entry.path())
            .map_err(|error| workspace_fs_error("stat_failed", error))?;
        if show_hidden || !child.hidden {
            entries.push(child);
        }
    }
    sort_workspace_fs_entries(&mut entries);

    Ok(json!({
        "ok": true,
        "data": WorkspaceFsListPayload {
            path: path.display().to_string(),
            parent_path: path.parent().map(|parent| parent.display().to_string()),
            entries,
        }
    }))
}

#[tauri::command]
async fn workspace_fs_search(
    request: WorkspaceFsSearchRequest,
    registry: tauri::State<'_, WorkspaceFsSearchRegistry>,
) -> Result<Value, Value> {
    let root = clean_absolute_path(&request.root_path)?;
    let query = request.query.trim().to_string();
    let result_limit = request
        .limit
        .unwrap_or(DEFAULT_WORKSPACE_FS_SEARCH_RESULT_LIMIT)
        .clamp(1, MAX_WORKSPACE_FS_SEARCH_RESULT_LIMIT);
    let traversal_limit = request
        .traversal_limit
        .unwrap_or(DEFAULT_WORKSPACE_FS_SEARCH_TRAVERSAL_LIMIT)
        .clamp(1, MAX_WORKSPACE_FS_SEARCH_TRAVERSAL_LIMIT);
    if query.is_empty() {
        return Ok(json!({
            "ok": true,
            "data": WorkspaceFsSearchPayload {
                root: root.display().to_string(),
                query: "".to_string(),
                entries: Vec::<WorkspaceFsEntry>::new(),
                source: "live".to_string(),
                result_count: 0,
                complete: true,
                result_limit_reached: false,
                traversal_limit_reached: false,
                skipped_count: 0,
                skipped: Vec::<WorkspaceFsSkippedPath>::new(),
                entries_scanned: 0,
                directories_scanned: 0,
                cancelled: false,
                result_limit,
                traversal_limit,
                status_text: None,
            }
        }));
    }

    let show_hidden = request.show_hidden.unwrap_or(false);
    let search_id = request.search_id.clone();
    let cancellation = Arc::new(AtomicBool::new(false));
    if let Some(search_id) = search_id.as_ref() {
        let mut cancellations = registry.cancellations.lock().map_err(|_| {
            workspace_fs_error(
                "search_registry_failed",
                "File Browser search registry lock was poisoned.".to_string(),
            )
        })?;
        cancellations.insert(search_id.clone(), Arc::clone(&cancellation));
    }

    let root_for_task = root.clone();
    let query_for_task = query.clone();
    let cancellation_for_task = Arc::clone(&cancellation);
    let task = tauri::async_runtime::spawn_blocking(move || {
        let root_device_id = workspace_fs_root_device_id(&root_for_task);
        search_workspace_fs_with_reader(
            &root_for_task,
            &query_for_task,
            show_hidden,
            WorkspaceFsSearchLimits {
                result_limit,
                traversal_limit,
            },
            Some(cancellation_for_task),
            read_workspace_fs_children,
            workspace_fs_entry,
            |path| workspace_fs_can_descend_path(path, root_device_id),
        )
    });

    let task_result = task.await.map_err(|error| {
        workspace_fs_error(
            "search_join_failed",
            format!("File Browser search worker failed: {}", error),
        )
    });

    if let Some(search_id) = search_id.as_ref() {
        if let Ok(mut cancellations) = registry.cancellations.lock() {
            if cancellations
                .get(search_id)
                .is_some_and(|active| Arc::ptr_eq(active, &cancellation))
            {
                cancellations.remove(search_id);
            }
        }
    }

    let payload = task_result?.map_err(|error| {
        workspace_fs_error(
            "read_failed",
            format!("failed to read search root {}: {}", root.display(), error),
        )
    })?;

    Ok(json!({
        "ok": true,
        "data": WorkspaceFsSearchPayload {
            query: request.query,
            ..payload
        }
    }))
}

#[tauri::command]
fn workspace_fs_search_cancel(
    request: WorkspaceFsSearchCancelRequest,
    registry: tauri::State<'_, WorkspaceFsSearchRegistry>,
) -> Result<Value, Value> {
    let search_id = request.search_id.trim();
    if search_id.is_empty() {
        return Ok(json!({ "ok": true, "data": { "cancelled": false }}));
    }

    let cancellation = registry
        .cancellations
        .lock()
        .map_err(|_| {
            workspace_fs_error(
                "search_registry_failed",
                "File Browser search registry lock was poisoned.".to_string(),
            )
        })?
        .remove(search_id);

    if let Some(cancellation) = cancellation {
        cancellation.store(true, Ordering::Relaxed);
        return Ok(json!({ "ok": true, "data": { "cancelled": true }}));
    }

    Ok(json!({ "ok": true, "data": { "cancelled": false }}))
}

#[tauri::command]
fn workspace_fs_copy(request: WorkspaceFsTransferRequest) -> Result<Value, Value> {
    let destination_directory = clean_absolute_path(&request.destination_directory)?;
    if !fs::metadata(&destination_directory)
        .map_err(|error| {
            workspace_fs_error(
                "stat_failed",
                format!(
                    "failed to stat {}: {}",
                    destination_directory.display(),
                    error
                ),
            )
        })?
        .is_dir()
    {
        return Err(workspace_fs_error(
            "not_directory",
            format!(
                "Paste target is not a directory: {}",
                destination_directory.display()
            ),
        ));
    }

    let mut affected = vec![destination_directory.display().to_string()];
    for source in request.source_paths {
        let source_path = clean_absolute_path(&source)?;
        if is_same_or_descendant(&destination_directory, &source_path) {
            return Err(workspace_fs_error(
                "self_copy",
                "Cannot copy a directory into itself or one of its descendants.".to_string(),
            ));
        }
        let name = source_path.file_name().ok_or_else(|| {
            workspace_fs_error(
                "invalid_source",
                format!("Source has no file name: {}", source_path.display()),
            )
        })?;
        let destination = destination_directory.join(name);
        if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
            return Err(workspace_fs_error(
                "collision",
                format!("Destination already exists: {}", destination.display()),
            ));
        }
        let metadata = fs::symlink_metadata(&source_path).map_err(|error| {
            workspace_fs_error(
                "stat_failed",
                format!("failed to stat {}: {}", source_path.display(), error),
            )
        })?;
        if metadata.file_type().is_symlink() {
            let target = fs::read_link(&source_path).map_err(|error| {
                workspace_fs_error(
                    "read_link_failed",
                    format!(
                        "failed to read symlink {}: {}",
                        source_path.display(),
                        error
                    ),
                )
            })?;
            #[cfg(unix)]
            unix_fs::symlink(&target, &destination).map_err(|error| {
                workspace_fs_error(
                    "copy_failed",
                    format!(
                        "failed to copy symlink {} to {}: {}",
                        source_path.display(),
                        destination.display(),
                        error
                    ),
                )
            })?;
            #[cfg(not(unix))]
            return Err(workspace_fs_error(
                "copy_failed",
                format!(
                    "copying symlinks is not supported on this platform: {}",
                    source_path.display()
                ),
            ));
        } else if metadata.is_dir() {
            copy_directory_recursive(&source_path, &destination)
                .map_err(|error| workspace_fs_error("copy_failed", error))?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &destination).map_err(|error| {
                workspace_fs_error(
                    "copy_failed",
                    format!(
                        "failed to copy {} to {}: {}",
                        source_path.display(),
                        destination.display(),
                        error
                    ),
                )
            })?;
        } else {
            return Err(workspace_fs_error(
                "unsupported_source",
                format!("Unsupported source kind: {}", source_path.display()),
            ));
        }
        affected.push(destination.display().to_string());
    }

    Ok(
        json!({ "ok": true, "data": WorkspaceFsOperationPayload { affected_paths: affected, message: "Copy completed.".to_string() }}),
    )
}

#[tauri::command]
fn workspace_fs_move(request: WorkspaceFsTransferRequest) -> Result<Value, Value> {
    let destination_directory = clean_absolute_path(&request.destination_directory)?;
    if !fs::metadata(&destination_directory)
        .map_err(|error| {
            workspace_fs_error(
                "stat_failed",
                format!(
                    "failed to stat {}: {}",
                    destination_directory.display(),
                    error
                ),
            )
        })?
        .is_dir()
    {
        return Err(workspace_fs_error(
            "not_directory",
            format!(
                "Paste target is not a directory: {}",
                destination_directory.display()
            ),
        ));
    }

    let mut affected = vec![destination_directory.display().to_string()];
    for source in request.source_paths {
        let source_path = clean_absolute_path(&source)?;
        if is_same_or_descendant(&destination_directory, &source_path) {
            return Err(workspace_fs_error(
                "descendant_move",
                "Cannot move a parent into itself or one of its descendants.".to_string(),
            ));
        }
        let name = source_path.file_name().ok_or_else(|| {
            workspace_fs_error(
                "invalid_source",
                format!("Source has no file name: {}", source_path.display()),
            )
        })?;
        let destination = destination_directory.join(name);
        if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
            return Err(workspace_fs_error(
                "collision",
                format!("Destination already exists: {}", destination.display()),
            ));
        }
        fs::rename(&source_path, &destination).map_err(|error| {
            workspace_fs_error(
                "move_failed",
                format!(
                    "failed to move {} to {}: {}",
                    source_path.display(),
                    destination.display(),
                    error
                ),
            )
        })?;
        if let Some(parent) = source_path.parent() {
            affected.push(parent.display().to_string());
        }
        affected.push(destination.display().to_string());
    }

    Ok(
        json!({ "ok": true, "data": WorkspaceFsOperationPayload { affected_paths: affected, message: "Move completed.".to_string() }}),
    )
}

#[tauri::command]
fn workspace_fs_rename(request: WorkspaceFsRenameRequest) -> Result<Value, Value> {
    let source_path = clean_absolute_path(&request.path)?;
    let name = validate_entry_name(&request.new_name)?;
    let parent = source_path.parent().ok_or_else(|| {
        workspace_fs_error(
            "invalid_source",
            format!("Source has no parent: {}", source_path.display()),
        )
    })?;
    let destination = parent.join(name);
    if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
        return Err(workspace_fs_error(
            "collision",
            format!("Destination already exists: {}", destination.display()),
        ));
    }
    fs::rename(&source_path, &destination).map_err(|error| {
        workspace_fs_error(
            "rename_failed",
            format!(
                "failed to rename {} to {}: {}",
                source_path.display(),
                destination.display(),
                error
            ),
        )
    })?;
    Ok(
        json!({ "ok": true, "data": WorkspaceFsOperationPayload { affected_paths: vec![parent.display().to_string(), destination.display().to_string()], message: "Rename completed.".to_string() }}),
    )
}

#[tauri::command]
fn workspace_fs_create_directory(
    request: WorkspaceFsCreateDirectoryRequest,
) -> Result<Value, Value> {
    let parent = clean_absolute_path(&request.parent_path)?;
    let name = validate_entry_name(&request.name)?;
    let destination = parent.join(name);
    if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
        return Err(workspace_fs_error(
            "collision",
            format!("Destination already exists: {}", destination.display()),
        ));
    }
    fs::create_dir(&destination).map_err(|error| {
        workspace_fs_error(
            "create_failed",
            format!(
                "failed to create directory {}: {}",
                destination.display(),
                error
            ),
        )
    })?;
    Ok(
        json!({ "ok": true, "data": WorkspaceFsOperationPayload { affected_paths: vec![parent.display().to_string(), destination.display().to_string()], message: "Directory created.".to_string() }}),
    )
}

#[tauri::command]
fn workspace_fs_delete(request: WorkspaceFsDeleteRequest) -> Result<Value, Value> {
    let mut affected = Vec::new();
    for path in request.paths {
        let target = clean_absolute_path(&path)?;
        let metadata = fs::symlink_metadata(&target).map_err(|error| {
            workspace_fs_error(
                "stat_failed",
                format!("failed to stat {}: {}", target.display(), error),
            )
        })?;
        if let Some(parent) = target.parent() {
            affected.push(parent.display().to_string());
        }
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            if !request.recursive {
                return Err(workspace_fs_error(
                    "recursive_required",
                    format!(
                        "Directory deletion requires explicit recursive intent: {}",
                        target.display()
                    ),
                ));
            }
            fs::remove_dir_all(&target).map_err(|error| {
                workspace_fs_error(
                    "delete_failed",
                    format!("failed to delete directory {}: {}", target.display(), error),
                )
            })?;
        } else {
            fs::remove_file(&target).map_err(|error| {
                workspace_fs_error(
                    "delete_failed",
                    format!("failed to delete file {}: {}", target.display(), error),
                )
            })?;
        }
    }
    Ok(
        json!({ "ok": true, "data": WorkspaceFsOperationPayload { affected_paths: affected, message: "Delete completed.".to_string() }}),
    )
}

#[tauri::command]
fn workspace_fs_read_text(request: WorkspaceFsReadTextRequest) -> Result<Value, Value> {
    let path = clean_absolute_path(&request.path)?;
    let mut file = fs::File::open(&path).map_err(|error| {
        workspace_fs_error(
            "open_failed",
            format!("failed to open {}: {}", path.display(), error),
        )
    })?;
    let byte_limit = request
        .byte_limit
        .unwrap_or(DEFAULT_WORKSPACE_FS_TEXT_BYTE_LIMIT)
        .clamp(1, MAX_WORKSPACE_FS_TEXT_BYTE_LIMIT);
    let mut buffer = Vec::new();
    let mut limited = file.by_ref().take(byte_limit as u64 + 1);
    limited.read_to_end(&mut buffer).map_err(|error| {
        workspace_fs_error(
            "read_failed",
            format!("failed to read {}: {}", path.display(), error),
        )
    })?;
    let truncated = buffer.len() > byte_limit;
    if truncated {
        buffer.truncate(byte_limit);
    }
    let bytes_read = buffer.len();
    let content = String::from_utf8_lossy(&buffer).into_owned();
    Ok(json!({
        "ok": true,
        "data": {
            "path": path.display().to_string(),
            "content": content,
            "truncated": truncated,
            "bytesRead": bytes_read,
            "byteLimit": byte_limit,
        }
    }))
}

#[tauri::command]
fn workspace_fs_read_binary(request: WorkspaceFsReadBinaryRequest) -> Result<Value, Value> {
    let path = clean_absolute_path(&request.path)?;
    let mut file = fs::File::open(&path).map_err(|error| {
        workspace_fs_error(
            "open_failed",
            format!("failed to open {}: {}", path.display(), error),
        )
    })?;
    let byte_limit = request
        .byte_limit
        .unwrap_or(DEFAULT_WORKSPACE_FS_BINARY_BYTE_LIMIT)
        .clamp(1, MAX_WORKSPACE_FS_BINARY_BYTE_LIMIT);
    let mut buffer = Vec::new();
    let mut limited = file.by_ref().take(byte_limit as u64 + 1);
    limited.read_to_end(&mut buffer).map_err(|error| {
        workspace_fs_error(
            "read_failed",
            format!("failed to read {}: {}", path.display(), error),
        )
    })?;
    let truncated = buffer.len() > byte_limit;
    if truncated {
        buffer.truncate(byte_limit);
    }
    let bytes_read = buffer.len();
    let content_base64 = base64::engine::general_purpose::STANDARD.encode(&buffer);

    Ok(json!({
        "ok": true,
        "data": {
            "path": path.display().to_string(),
            "contentBase64": content_base64,
            "truncated": truncated,
            "bytesRead": bytes_read,
            "byteLimit": byte_limit,
        }
    }))
}

const THEME_FILE_SUFFIX: &str = ".jarri-theme.json";
const THEME_FILE_MAX_BYTES: usize = 256 * 1024;

fn theme_library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("themes");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn theme_file_name_is_valid(name: &str) -> bool {
    !name.starts_with('.')
        && name.len() <= 120
        && name.ends_with(THEME_FILE_SUFFIX)
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThemeLibraryFile {
    file_name: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThemeLibraryListing {
    directory: String,
    files: Vec<ThemeLibraryFile>,
}

#[tauri::command]
fn theme_library_list(app: tauri::AppHandle) -> Result<ThemeLibraryListing, String> {
    let dir = theme_library_dir(&app)?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|error| error.to_string())? {
        let Ok(entry) = entry else { continue };
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !theme_file_name_is_valid(&file_name) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_file() {
            continue;
        }
        if let Ok(text) = fs::read_to_string(entry.path()) {
            files.push(ThemeLibraryFile { file_name, text });
        }
    }
    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(ThemeLibraryListing {
        directory: dir.to_string_lossy().into_owned(),
        files,
    })
}

#[tauri::command]
fn theme_library_write(app: tauri::AppHandle, file_name: String, text: String) -> Result<(), String> {
    if !theme_file_name_is_valid(&file_name) {
        return Err("Invalid theme file name.".to_string());
    }
    if text.len() > THEME_FILE_MAX_BYTES {
        return Err("The theme file is too large.".to_string());
    }
    let dir = theme_library_dir(&app)?;
    fs::write(dir.join(file_name), text).map_err(|error| error.to_string())
}

#[tauri::command]
fn theme_library_delete(app: tauri::AppHandle, file_name: String) -> Result<(), String> {
    if !theme_file_name_is_valid(&file_name) {
        return Err("Invalid theme file name.".to_string());
    }
    let dir = theme_library_dir(&app)?;
    fs::remove_file(dir.join(file_name)).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(WorkspaceFsSearchRegistry::default())
        .invoke_handler(tauri::generate_handler![
            workspace_fs_stat,
            workspace_fs_list,
            workspace_fs_search,
            workspace_fs_search_cancel,
            workspace_fs_copy,
            workspace_fs_move,
            workspace_fs_rename,
            workspace_fs_create_directory,
            workspace_fs_delete,
            workspace_fs_read_text,
            workspace_fs_read_binary,
            theme_library_list,
            theme_library_write,
            theme_library_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Jarri Workspace Core");
}

#[cfg(test)]
mod workspace_fs_tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "workspace-core-fs-test-{}-{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn ok_data(value: Value) -> Value {
        assert_eq!(value.get("ok").and_then(Value::as_bool), Some(true));
        value.get("data").cloned().expect("data payload")
    }

    fn err_status(error: Value) -> String {
        error
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    }

    fn fake_fs_entry(path: &Path) -> Result<WorkspaceFsEntry, String> {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        let kind = if name.ends_with(".txt") || name.ends_with(".svg") || name.ends_with(".md") {
            "file"
        } else {
            "directory"
        }
        .to_string();
        Ok(WorkspaceFsEntry {
            path: path.display().to_string(),
            parent_path: path.parent().map(|parent| parent.display().to_string()),
            name: name.clone(),
            kind,
            target_kind: None,
            size: None,
            modified_ms: None,
            readonly: false,
            hidden: name.starts_with('.'),
            has_children: None,
            executable: false,
        })
    }

    fn search_limits(result_limit: usize, traversal_limit: usize) -> WorkspaceFsSearchLimits {
        WorkspaceFsSearchLimits {
            result_limit,
            traversal_limit,
        }
    }

    #[test]
    fn workspace_fs_list_sorts_and_filters_hidden() {
        let root = temp_root("list");
        fs::create_dir(root.join("zeta")).expect("create directory");
        fs::write(root.join("alpha.txt"), "alpha").expect("write file");
        fs::write(root.join(".hidden"), "hidden").expect("write hidden");

        let data = ok_data(
            workspace_fs_list(WorkspaceFsListRequest {
                path: root.display().to_string(),
                show_hidden: Some(false),
            })
            .expect("list succeeds"),
        );
        let entries = data.get("entries").and_then(Value::as_array).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].get("name").and_then(Value::as_str), Some("zeta"));
        assert_eq!(
            entries[1].get("name").and_then(Value::as_str),
            Some("alpha.txt")
        );

        let hidden_data = ok_data(
            workspace_fs_list(WorkspaceFsListRequest {
                path: root.display().to_string(),
                show_hidden: Some(true),
            })
            .expect("list succeeds"),
        );
        assert_eq!(
            hidden_data
                .get("entries")
                .and_then(Value::as_array)
                .unwrap()
                .len(),
            3
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn workspace_fs_list_reports_symlink_directory_target_kind() {
        let root = temp_root("symlink-directory");
        let target = root.join("target");
        let link = root.join("target-link");
        fs::create_dir(&target).expect("create target directory");
        unix_fs::symlink(&target, &link).expect("create symlink");

        let data = ok_data(
            workspace_fs_list(WorkspaceFsListRequest {
                path: root.display().to_string(),
                show_hidden: Some(false),
            })
            .expect("list succeeds"),
        );
        let entries = data.get("entries").and_then(Value::as_array).unwrap();
        let link_entry = entries
            .iter()
            .find(|entry| entry.get("name").and_then(Value::as_str) == Some("target-link"))
            .expect("symlink entry exists");
        assert_eq!(
            link_entry.get("kind").and_then(Value::as_str),
            Some("symlink")
        );
        assert_eq!(
            link_entry.get("targetKind").and_then(Value::as_str),
            Some("directory")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_fs_search_skips_descendant_but_root_read_failure_is_error() {
        let root = PathBuf::from("/virtual-root");
        let readable = root.join("readable");
        let blocked = root.join("blocked");
        let match_file = readable.join("match.txt");

        let payload = search_workspace_fs_with_reader(
            &root,
            "match",
            false,
            search_limits(20, 100),
            None,
            |directory| {
                if directory == blocked {
                    return Err("Permission denied".to_string());
                }
                if directory == root {
                    return Ok(vec![readable.clone(), blocked.clone()]);
                }
                if directory == readable {
                    return Ok(vec![match_file.clone()]);
                }
                Ok(Vec::new())
            },
            fake_fs_entry,
            |_| Ok(()),
        )
        .expect("descendant failures are skipped");

        assert_eq!(payload.entries.len(), 1);
        assert_eq!(payload.skipped_count, 1);
        assert!(payload.complete);

        let error = search_workspace_fs_with_reader(
            &root,
            "match",
            false,
            search_limits(20, 100),
            None,
            |_| Err("root denied".to_string()),
            fake_fs_entry,
            |_| Ok(()),
        )
        .expect_err("root read failure must fail search");
        assert_eq!(error, "root denied");
    }

    #[test]
    fn workspace_fs_search_limits_globs_cancellation_and_mount_boundary() {
        let root = PathBuf::from("/virtual-root");
        let paths = vec![
            root.join("diagram.svg"),
            root.join("foo-alpha.txt"),
            root.join("alpha-foo-beta.md"),
        ];
        let run = |query: &str| {
            search_workspace_fs_with_reader(
                &root,
                query,
                false,
                search_limits(20, 100),
                None,
                |directory| {
                    if directory == root {
                        Ok(paths.clone())
                    } else {
                        Ok(Vec::new())
                    }
                },
                fake_fs_entry,
                |_| Ok(()),
            )
            .expect("search succeeds")
        };

        assert_eq!(run("*.svg").entries[0].name, "diagram.svg");
        assert_eq!(run("foo*").entries[0].name, "foo-alpha.txt");
        assert_eq!(run("*foo*").entries.len(), 2);

        let limited = search_workspace_fs_with_reader(
            &root,
            "absent",
            false,
            search_limits(20, 3),
            None,
            |directory| {
                Ok(vec![
                    directory.join("a"),
                    directory.join("b"),
                    directory.join("c"),
                ])
            },
            fake_fs_entry,
            |_| Ok(()),
        )
        .expect("search is bounded");
        assert!(limited.traversal_limit_reached);
        assert!(!limited.result_limit_reached);
        assert!(!limited.complete);

        let result_limited = search_workspace_fs_with_reader(
            &root,
            "match",
            false,
            search_limits(2, 50),
            None,
            |directory| {
                if directory == root {
                    Ok(vec![
                        root.join("match-a.txt"),
                        root.join("match-b.txt"),
                        root.join("match-c.txt"),
                    ])
                } else {
                    Ok(Vec::new())
                }
            },
            fake_fs_entry,
            |_| Ok(()),
        )
        .expect("result limit is independent");
        assert_eq!(result_limited.result_count, 2);
        assert!(result_limited.result_limit_reached);
        assert!(!result_limited.traversal_limit_reached);

        let cancellation = Arc::new(AtomicBool::new(false));
        let cancellation_for_reader = Arc::clone(&cancellation);
        let root_for_reader = root.clone();
        let cancelled = search_workspace_fs_with_reader(
            &root,
            "anything",
            false,
            search_limits(20, 100),
            Some(Arc::clone(&cancellation)),
            move |directory| {
                if directory == root_for_reader {
                    cancellation_for_reader.store(true, Ordering::Relaxed);
                    return Ok(vec![root_for_reader.join("child")]);
                }
                Ok(Vec::new())
            },
            fake_fs_entry,
            |_| Ok(()),
        )
        .expect("cancelled search returns partial state");
        assert!(cancelled.cancelled);

        let mounted = root.join("mounted");
        let boundary = search_workspace_fs_with_reader(
            &root,
            "nothing",
            false,
            search_limits(20, 100),
            None,
            |directory| {
                if directory == root {
                    Ok(vec![mounted.clone()])
                } else {
                    Ok(Vec::new())
                }
            },
            fake_fs_entry,
            |path| {
                if path == mounted {
                    Err("skipped mount boundary".to_string())
                } else {
                    Ok(())
                }
            },
        )
        .expect("mount boundary is reported");
        assert_eq!(boundary.skipped[0].reason, "skipped mount boundary");
    }

    #[test]
    fn workspace_fs_operations_refuse_collisions_and_destructive_ambiguity() {
        let root = temp_root("operations");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(source.join("nested")).expect("create source");
        fs::create_dir_all(&destination).expect("create destination");
        fs::write(source.join("nested/file.txt"), "content").expect("write nested file");

        workspace_fs_copy(WorkspaceFsTransferRequest {
            source_paths: vec![source.display().to_string()],
            destination_directory: destination.display().to_string(),
        })
        .expect("copy succeeds");
        assert!(destination.join("source/nested/file.txt").exists());

        let error = workspace_fs_copy(WorkspaceFsTransferRequest {
            source_paths: vec![source.display().to_string()],
            destination_directory: destination.display().to_string(),
        })
        .expect_err("collision fails");
        assert_eq!(err_status(error), "collision");

        let child = source.join("child");
        fs::create_dir_all(&child).expect("create child");
        let move_error = workspace_fs_move(WorkspaceFsTransferRequest {
            source_paths: vec![source.display().to_string()],
            destination_directory: child.display().to_string(),
        })
        .expect_err("descendant move fails");
        assert_eq!(err_status(move_error), "descendant_move");

        let file = root.join("file.txt");
        fs::write(&file, "content").expect("write file");
        workspace_fs_rename(WorkspaceFsRenameRequest {
            path: file.display().to_string(),
            new_name: "renamed.txt".to_string(),
        })
        .expect("rename succeeds");
        assert!(root.join("renamed.txt").exists());

        let delete_error = workspace_fs_delete(WorkspaceFsDeleteRequest {
            paths: vec![source.display().to_string()],
            recursive: false,
        })
        .expect_err("directory deletion requires recursive intent");
        assert_eq!(err_status(delete_error), "recursive_required");

        workspace_fs_delete(WorkspaceFsDeleteRequest {
            paths: vec![
                source.display().to_string(),
                root.join("renamed.txt").display().to_string(),
            ],
            recursive: true,
        })
        .expect("delete succeeds");
        assert!(!source.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_fs_read_binary_is_bounded_and_lossless() {
        let root = temp_root("read-binary");
        let file = root.join("file.bin");
        fs::write(&file, [0_u8, 1, 2, 127, 128, 255]).expect("write file");
        let data = ok_data(
            workspace_fs_read_binary(WorkspaceFsReadBinaryRequest {
                path: file.display().to_string(),
                byte_limit: Some(4),
            })
            .expect("read succeeds"),
        );
        assert_eq!(
            data.get("contentBase64").and_then(Value::as_str),
            Some("AAECfw==")
        );
        assert_eq!(data.get("bytesRead").and_then(Value::as_u64), Some(4));
        assert_eq!(data.get("truncated").and_then(Value::as_bool), Some(true));
        assert_eq!(data.get("byteLimit").and_then(Value::as_u64), Some(4));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_fs_read_text_is_bounded() {
        let root = temp_root("read-text");
        let file = root.join("file.txt");
        fs::write(&file, "abcdef").expect("write file");
        let data = ok_data(
            workspace_fs_read_text(WorkspaceFsReadTextRequest {
                path: file.display().to_string(),
                byte_limit: Some(3),
            })
            .expect("read succeeds"),
        );
        assert_eq!(data.get("content").and_then(Value::as_str), Some("abc"));
        assert_eq!(data.get("truncated").and_then(Value::as_bool), Some(true));
        let _ = fs::remove_dir_all(root);
    }
}
