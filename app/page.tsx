"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  UploadCloud,
  FileCode,
  FileJson,
  CheckCircle2,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  X,
  Link as LinkIcon,
  Key,
  Globe,
  ArrowRight,
  ExternalLink,
  Trash2,
  RefreshCw,
  Lock,
  Pencil,
  ImagePlus,
  Cat,
  Moon,
  Sun,
  Layers,
  LayoutGrid,
  Settings,
  Plus,
  LogOut,
  ChevronDown,
} from "lucide-react";

interface FileItem {
  id: string;
  name: string;
  size: string;
  type: "js" | "fwd" | "url";
  status: "uploading" | "processing" | "success" | "error";
  progress: number;
  url: string | null;
  fwdUrl?: string | null;
  file: File | null;
  errorMsg?: string;
  processingDetail?: string;
}

interface Module {
  id: string; filename: string; title: string; description: string;
  version: string; author: string; file_size: number; is_encrypted: number;
  source_url: string | null;
}

interface Collection {
  id: string; slug: string; title: string; description: string; icon_url: string;
  fwdUrl: string; pageUrl: string; modules: Module[]; source_url: string | null;
}

async function fetchWithProxy(url: string): Promise<Response> {
  // 1. Try direct browser fetch
  try {
    const res = await fetch(url);
    if (res.ok) return res;
    // Non-ok but reachable — don't retry via proxy, throw directly
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    // Network/CORS error (TypeError) — fall through to proxy
    if (!(e instanceof TypeError)) throw e;
  }

  // 2. Fallback: server-side proxy
  const proxyRes = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
  if (proxyRes.ok) return proxyRes;

  // 3. Both failed — build informative error
  const errBody = await proxyRes.json().catch(() => null);
  const proxyDetail = errBody?.error || `HTTP ${proxyRes.status}`;
  throw new Error(`跨域下载失败，服务端代理也无法访问 (${proxyDetail})。请手动下载文件后拖拽上传`);
}

async function readNdjsonStream(
  res: Response,
  onProgress: (detail: string) => void,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: Record<string, unknown> = {};
  let errorMsg: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const evt = JSON.parse(line);
      if (evt.type === "progress") {
        onProgress(`正在下载 (${evt.current}/${evt.total}): ${evt.filename}`);
      } else if (evt.type === "result") {
        result = evt;
      } else if (evt.type === "error") {
        errorMsg = evt.error;
      }
    }
  }
  if (errorMsg) return { ok: false, data: { error: errorMsg } };
  return { ok: true, data: result };
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export default function Home() {
  const [authState, setAuthState] = useState<"loading" | "need-password" | "authenticated">("loading");
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("fwh_token");
    }
    return null;
  });
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [showTokenBanner, setShowTokenBanner] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- 自定义 UI 状态 ----
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const v = localStorage.getItem("fwh_dark");
      return v === null ? true : v === "1";
    }
    return true;
  });
  const [activeTab, setActiveTab] = useState<"modules" | "collections" | "settings">("collections");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingCol, setEditingCol] = useState<Collection | null>(null);
  const [pickerFor, setPickerFor] = useState<Collection | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("fwh_dark", darkMode ? "1" : "0");
  }, [darkMode]);

  useEffect(() => {
    const savedToken = localStorage.getItem("fwh_token");
    fetch("/api/auth").then((r) => r.json()).then(async (data) => {
      if (!data.required || data.authenticated) {
        setAuthState("authenticated");
      } else if (savedToken) {
        // Has token — verify it; if valid, skip password
        const res = await fetch(`/api/manage?token=${savedToken}`);
        if (res.ok) {
          setAuthState("authenticated");
        } else {
          localStorage.removeItem("fwh_token");
          setToken(null);
          setAuthState("need-password");
        }
      } else {
        setAuthState("need-password");
      }
    }).catch(() => setAuthState("authenticated"));
  }, []);

  const handlePasswordSubmit = async () => {
    if (!passwordInput.trim()) return;
    setPasswordLoading(true);
    setPasswordError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (res.ok) {
        setAuthState("authenticated");
      } else {
        setPasswordError("密码错误");
      }
    } catch {
      setPasswordError("网络错误");
    } finally {
      setPasswordLoading(false);
    }
  };

  const fetchCollections = useCallback(async (t?: string) => {
    const currentToken = t || token;
    if (!currentToken) return;
    setCollectionsLoading(true);
    try {
      const res = await fetch(`/api/manage?token=${currentToken}`);
      if (res.ok) {
        const data = await res.json();
        setCollections(data.collections);
      }
    } finally {
      setCollectionsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchCollections();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onUploadSuccess = useCallback((data: Record<string, unknown>) => {
    let newToken = token;
    if (data.token) {
      newToken = data.token as string;
      setToken(newToken);
      localStorage.setItem("fwh_token", newToken);
      setShowTokenBanner(true);
    }
    // Refresh collections list
    setTimeout(() => fetchCollections(newToken || undefined), 300);
  }, [token, fetchCollections]);

  const processFwdInBrowser = useCallback(async (
    fwdContent: string,
    itemId: string,
    currentToken: string | null,
    fwdSourceUrl?: string,
    syncCollectionId?: string,
  ) => {
    interface FwdData {
      title?: string;
      description?: string;
      icon?: string;
      widgets: Array<{
        id?: string; title?: string; description?: string;
        version?: string; author?: string; requiredVersion?: string;
        url: string;
      }>;
    }

    let fwd: FwdData;
    try {
      fwd = JSON.parse(fwdContent);
      if (!fwd.widgets || !Array.isArray(fwd.widgets)) {
        throw new Error("missing widgets array");
      }
    } catch (e) {
      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: `解析失败: ${(e as Error).message}` } : f
      ));
      return;
    }

    const downloadedFiles: File[] = [];
    const widgetMetas: Array<{
      id?: string; title?: string; description?: string;
      version?: string; author?: string; requiredVersion?: string;
      source_url?: string;
    }> = [];

    for (let i = 0; i < fwd.widgets.length; i++) {
      const widget = fwd.widgets[i];
      let fname = widget.url.split("/").pop() || "widget.js";
      if (!fname.endsWith(".js")) fname += ".js";

      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? {
          ...f,
          status: "processing" as const,
          progress: Math.round((i / fwd.widgets.length) * 80) + 10,
          processingDetail: `正在下载 (${i + 1}/${fwd.widgets.length}): ${fname}`,
        } : f
      ));

      try {
        const res = await fetchWithProxy(widget.url);
        const blob = await res.blob();
        downloadedFiles.push(new File([blob], fname, { type: "application/javascript" }));
        widgetMetas.push({
          id: widget.id, title: widget.title, description: widget.description,
          version: widget.version, author: widget.author, requiredVersion: widget.requiredVersion,
          source_url: widget.url,
        });
      } catch (e) {
        const errorMsg = `下载 ${fname} 失败: ${(e as Error).message}`;
        setFiles((prev) => prev.map((f) =>
          f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg } : f
        ));
        return;
      }
    }

    setFiles((prev) => prev.map((f) =>
      f.id === itemId ? { ...f, processingDetail: "正在上传到服务器...", progress: 90 } : f
    ));

    const formData = new FormData();
    downloadedFiles.forEach((file) => formData.append("files", file));
    if (currentToken) formData.append("token", currentToken);
    if (fwd.title) formData.append("title", fwd.title);
    if (fwd.description) formData.append("description", fwd.description);
    if (fwd.icon) formData.append("icon", fwd.icon);
    formData.append("widget_meta", JSON.stringify(widgetMetas));
    if (fwdSourceUrl) formData.append("source_url", fwdSourceUrl);
    if (syncCollectionId) {
      formData.append("sync", "true");
      formData.append("collection_id", syncCollectionId);
    }

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setFiles((prev) => prev.map((f) =>
          f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: data.error || "上传失败" } : f
        ));
        return;
      }

      onUploadSuccess(data);

      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? {
          ...f,
          status: "success" as const,
          progress: 100,
          url: data.fwdUrl || null,
          fwdUrl: data.fwdUrl || null,
          type: "fwd" as const,
        } : f
      ));
    } catch {
      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: "网络错误" } : f
      ));
    }
  }, [onUploadSuccess]);

  const handleFiles = useCallback(async (newFiles: File[], currentToken: string | null) => {
    const validFiles = newFiles.filter(
      (f) => f.name.endsWith(".js") || f.name.endsWith(".fwd")
    );
    if (validFiles.length !== newFiles.length) {
      alert("仅支持 .js 和 .fwd 格式的文件");
    }
    if (validFiles.length === 0) return;

    const fwdFiles = validFiles.filter((f) => f.name.endsWith(".fwd"));
    const jsFiles = validFiles.filter((f) => f.name.endsWith(".js"));

    // Process .fwd files client-side
    for (const fwdFile of fwdFiles) {
      const itemId = Math.random().toString(36).substring(7);
      setFiles((prev) => [{
        id: itemId,
        name: fwdFile.name,
        size: (fwdFile.size / 1024).toFixed(2) + " KB",
        type: "fwd" as const,
        status: "processing" as const,
        progress: 5,
        url: null,
        file: fwdFile,
        processingDetail: "正在解析...",
      }, ...prev]);
      const content = await fwdFile.text();
      await processFwdInBrowser(content, itemId, currentToken);
    }

    // Upload .js files normally
    if (jsFiles.length === 0) return;

    const fileObjects: FileItem[] = jsFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      size: (file.size / 1024).toFixed(2) + " KB",
      type: "js" as const,
      status: "uploading" as const,
      progress: 0,
      url: null,
      file,
    }));

    setFiles((prev) => [...fileObjects, ...prev]);

    const formData = new FormData();
    jsFiles.forEach((file) => formData.append("files", file));
    if (currentToken) formData.append("token", currentToken);

    const progressInterval = setInterval(() => {
      setFiles((prev) =>
        prev.map((f) => {
          if (fileObjects.some((fo) => fo.id === f.id) && f.status === "uploading") {
            return { ...f, progress: Math.min(f.progress + Math.floor(Math.random() * 15) + 5, 90) };
          }
          return f;
        })
      );
    }, 200);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      clearInterval(progressInterval);
      const data = await res.json();
      if (!res.ok) {
        setFiles((prev) => prev.map((f) =>
          fileObjects.some((fo) => fo.id === f.id)
            ? { ...f, status: "error" as const, progress: 100, errorMsg: data.error as string }
            : f
        ));
        return;
      }

      onUploadSuccess(data);

      const siteUrl = window.location.origin;
      const modules = data.modules as { id: string; filename: string }[] | undefined;
      setFiles((prev) =>
        prev.map((f) => {
          const idx = fileObjects.findIndex((fo) => fo.id === f.id);
          if (idx !== -1 && modules?.[idx]) {
            return { ...f, status: "success" as const, progress: 100, url: `${siteUrl}/api/modules/${modules[idx].id}/raw` };
          }
          return f;
        })
      );
    } catch {
      clearInterval(progressInterval);
      setFiles((prev) =>
        prev.map((f) =>
          fileObjects.some((fo) => fo.id === f.id)
            ? { ...f, status: "error" as const, progress: 100, errorMsg: "网络错误" }
            : f
        )
      );
    }
  }, [onUploadSuccess, processFwdInBrowser]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const currentToken = localStorage.getItem("fwh_token");
      handleFiles(Array.from(e.dataTransfer.files), currentToken);
    }
  }, [handleFiles]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files), token);
      e.target.value = "";
    }
  };

  const handleUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    try { new URL(url); } catch { alert("请输入有效的 URL"); return; }

    setUrlLoading(true);
    const itemId = Math.random().toString(36).substring(7);
    const filename = url.split("/").pop() || "remote";
    const fileItem: FileItem = {
      id: itemId, name: filename, size: "远程文件",
      type: "url", status: "uploading", progress: 10, url: null, file: null,
    };
    setFiles((prev) => [fileItem, ...prev]);
    setUrlInput("");

    try {
      // Download file in browser
      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? { ...f, progress: 20, processingDetail: "正在下载文件..." } : f
      ));

      const res = await fetchWithProxy(url);
      const arrayBuffer = await res.arrayBuffer();
      const text = new TextDecoder().decode(arrayBuffer);

      // Detect .fwd
      let isFwd = filename.endsWith(".fwd");
      if (!isFwd) {
        try {
          const parsed = JSON.parse(text);
          isFwd = Array.isArray(parsed.widgets);
        } catch { /* not JSON, treat as .js */ }
      }

      if (isFwd) {
        setFiles((prev) => prev.map((f) =>
          f.id === itemId ? { ...f, type: "fwd" as const, status: "processing" as const } : f
        ));
        await processFwdInBrowser(text, itemId, localStorage.getItem("fwh_token"), url);
      } else {
        // Single .js file - upload to server
        setFiles((prev) => prev.map((f) =>
          f.id === itemId ? { ...f, progress: 50, processingDetail: "正在上传..." } : f
        ));
        const blob = new Blob([arrayBuffer], { type: "application/javascript" });
        const jsFilename = filename.endsWith(".js") ? filename : filename + ".js";
        const file = new File([blob], jsFilename);
        const formData = new FormData();
        formData.append("files", file);
        const currentToken = localStorage.getItem("fwh_token");
        if (currentToken) formData.append("token", currentToken);
        formData.append("source_url", url);

        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await uploadRes.json();
        if (!uploadRes.ok) {
          setFiles((prev) => prev.map((f) =>
            f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: data.error } : f
          ));
          return;
        }

        onUploadSuccess(data);

        const siteUrl = window.location.origin;
        const modules = data.modules as { id: string; filename: string }[] | undefined;
        if (modules?.length) {
          setFiles((prev) => prev.map((f) =>
            f.id === itemId ? {
              ...f, status: "success" as const, progress: 100,
              name: modules[0].filename,
              url: `${siteUrl}/api/modules/${modules[0].id}/raw`,
            } : f
          ));
        }
      }
    } catch (e) {
      setFiles((prev) => prev.map((f) =>
        f.id === itemId ? { ...f, status: "error" as const, progress: 100, errorMsg: (e as Error).message || "下载失败" } : f
      ));
    } finally {
      setUrlLoading(false);
    }
  }, [urlInput, processFwdInBrowser, onUploadSuccess]);

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (!confirm("确定删除此模块？")) return;
    const res = await fetch(`/api/modules/${moduleId}?token=${token}`, { method: "DELETE" });
    if (res.ok) fetchCollections();
  };

  const handleDeleteCollection = async (slug: string, title: string) => {
    if (!confirm(`确定删除整个合集「${title}」及其所有模块？`)) return;
    const res = await fetch(`/api/collections/${slug}?token=${token}`, { method: "DELETE" });
    if (res.ok) fetchCollections();
  };

  const handleLogout = () => {
    const url = `${window.location.origin}/manage/${token}`;
    if (!confirm(`退出后需通过管理链接恢复访问，请确认已保存：\n\n${url}`)) return;
    setToken(null);
    setCollections([]);
    localStorage.removeItem("fwh_token");
  };

  // ---- 新建 / 编辑合集 ----
  const handleCreateCollection = async (title: string, description: string, icon: File | null): Promise<boolean> => {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("description", description);
    if (icon) fd.append("icon", icon);
    const res = await fetch(`/api/collections?token=${token}`, { method: "POST", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      alert(d?.error || "创建失败");
      return false;
    }
    await fetchCollections();
    return true;
  };

  const handleUpdateCollection = async (slug: string, title: string, description: string, icon: File | null): Promise<boolean> => {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("description", description);
    if (icon) fd.append("icon", icon);
    const res = await fetch(`/api/collections/${slug}?token=${token}`, { method: "PUT", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      alert(d?.error || "保存失败");
      return false;
    }
    await fetchCollections();
    return true;
  };

  // ---- 从模块池挑选 ----
  const handleConfirmPick = async (moduleIds: string[]) => {
    const target = pickerFor;
    setPickerFor(null);
    if (!target || moduleIds.length === 0) return;
    const res = await fetch(`/api/collections/${target.slug}/modules?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module_ids: moduleIds }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      alert(d?.error || "添加失败");
    }
    fetchCollections();
  };

  const manageUrl = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/manage/${token}` : null;
  const dm = darkMode;

  const standaloneCollections = collections.filter((c) => c.modules.length <= 1 && !c.source_url);
  const multiCollections = collections.filter((c) => c.modules.length > 1 || !!c.source_url);
  const poolModules: (Module & { from: string })[] = standaloneCollections.flatMap((c) =>
    c.modules.map((m) => ({ ...m, from: c.title }))
  );

  if (authState === "loading") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (authState === "need-password") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center">
              <Lock className="w-6 h-6 text-indigo-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">访问密码</h1>
            <p className="text-sm text-slate-500">请输入密码以继续</p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handlePasswordSubmit(); }}
              placeholder="请输入密码"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              autoFocus
            />
            {passwordError && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {passwordError}
              </p>
            )}
            <button
              onClick={handlePasswordSubmit}
              disabled={passwordLoading || !passwordInput.trim()}
              className="w-full py-3 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {passwordLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              确认
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ================= 暗色手机风管理台 =================
  return (
    <div className={`min-h-screen font-sans transition-colors ${dm ? "bg-[#0a0c0e] text-white" : "bg-slate-100 text-slate-900"}`}>
      <div className="max-w-md mx-auto px-4 pt-6 pb-32">
        {/* ===== 模块 Tab ===== */}
        {activeTab === "modules" && (
          <div className="space-y-5">
            <PageHeader
              dm={dm}
              icon={<Layers className="w-6 h-6 text-black" />}
              title="模块"
              subtitle={`模块池 · 共 ${poolModules.length} 个独立模块`}
              darkMode={dm}
              onToggleTheme={() => setDarkMode(!dm)}
            />

            {/* 上传区 */}
            <div
              className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${dm ? (isDragging ? "border-[#1a8cff] bg-[#1a8cff]/10" : "border-white/10 bg-[#15181d] hover:border-[#1a8cff]/50") : (isDragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white hover:border-indigo-400")}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input type="file" ref={fileInputRef} onChange={handleFileInput} className="hidden" multiple accept=".js,.fwd" />
              <div className="flex flex-col items-center gap-3">
                <div className={`p-3 rounded-full ${dm ? "bg-white/5" : "bg-slate-100"}`}>
                  <UploadCloud className={`w-8 h-8 ${dm ? "text-[#1a8cff]" : "text-slate-400"}`} />
                </div>
                <div>
                  <p className={`font-medium ${dm ? "text-white" : "text-slate-700"}`}>点击或将文件拖拽至此处</p>
                  <p className={`text-xs mt-1 ${dm ? "text-[#8b949e]" : "text-slate-400"}`}>支持 .js, .fwd 文件 (最大 5MB)</p>
                </div>
              </div>
            </div>

            {/* URL 转存 */}
            <div className={`flex items-center gap-2 rounded-2xl p-2 pl-4 ${dm ? "bg-[#15181d] border border-white/5" : "bg-white border border-slate-200"}`}>
              <Globe className={`w-5 h-5 flex-shrink-0 ${dm ? "text-[#8b949e]" : "text-slate-400"}`} />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleUrl(); }}
                placeholder="输入 Widget URL 直接转存"
                className={`flex-1 text-sm bg-transparent focus:outline-none ${dm ? "text-white placeholder:text-[#5b626b]" : "text-slate-700 placeholder:text-slate-400"}`}
              />
              <button
                onClick={handleUrl}
                disabled={urlLoading || !urlInput.trim()}
                className="px-5 py-2.5 bg-[#1a8cff] text-white text-sm font-medium rounded-xl hover:bg-[#1580f0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                {urlLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "转存"}
              </button>
            </div>

            {/* 上传进度 */}
            {files.length > 0 && (
              <div className={`rounded-2xl overflow-hidden ${dm ? "bg-[#15181d] border border-white/5" : "bg-white border border-slate-200"}`}>
                <div className={`px-4 py-3 flex justify-between items-center ${dm ? "border-b border-white/5" : "border-b border-slate-100"}`}>
                  <span className={`text-sm font-semibold ${dm ? "text-white" : "text-slate-800"}`}>上传列表 ({files.length})</span>
                  <button onClick={() => setFiles([])} className={`text-xs ${dm ? "text-[#8b949e] hover:text-white" : "text-slate-500 hover:text-slate-700"}`}>清空</button>
                </div>
                <div className={`divide-y max-h-[320px] overflow-y-auto ${dm ? "divide-white/5" : "divide-slate-100"}`}>
                  {files.map((file) => (
                    <FileItemRow key={file.id} file={file} dm={dm} onRemove={() => removeFile(file.id)} />
                  ))}
                </div>
              </div>
            )}

            {/* 模块池列表 */}
            <div className="space-y-3">
              {collectionsLoading && poolModules.length === 0 && (
                <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" /></div>
              )}
              {!collectionsLoading && poolModules.length === 0 && standaloneCollections.length === 0 && (
                <div className={`text-center py-8 text-sm ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>模块池是空的，先上传模块吧</div>
              )}
              {standaloneCollections.map((col) => {
                const mod = col.modules[0];
                if (!mod) {
                  return (
                    <div key={col.id} className={`rounded-2xl px-4 py-3 flex items-center justify-between ${dm ? "bg-[#15181d] border border-white/5" : "bg-white border border-slate-200"}`}>
                      <span className={`text-sm ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>空合集: {col.title}</span>
                      <button onClick={() => handleDeleteCollection(col.slug, col.title)} className="text-xs text-red-500/70 hover:text-red-500">删除</button>
                    </div>
                  );
                }
                return (
                  <PoolModuleRow
                    key={mod.id}
                    mod={mod}
                    dm={dm}
                    onDelete={() => { handleDeleteModule(mod.id); }}
                    onDeleteCollection={() => handleDeleteCollection(col.slug, col.title)}
                    onRefresh={fetchCollections}
                    token={token!}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* ===== 合集 Tab ===== */}
        {activeTab === "collections" && (
          <div className="space-y-5">
            <PageHeader
              dm={dm}
              icon={<Cat className="w-6 h-6 text-black" />}
              title="合集"
              subtitle="挑选模块组成订阅"
              darkMode={dm}
              onToggleTheme={() => setDarkMode(!dm)}
            />

            <div className="flex items-center justify-between">
              <span className={`text-sm ${dm ? "text-[#8b949e]" : "text-slate-500"}`}>共 {multiCollections.length} 个合集</span>
              <button
                onClick={() => setShowCreateDialog(true)}
                className="flex items-center gap-1 px-4 py-2 bg-[#1a8cff] text-white text-sm font-medium rounded-full hover:bg-[#1580f0] transition-colors"
              >
                <Plus className="w-4 h-4" /> 新建合集
              </button>
            </div>

            {collectionsLoading && multiCollections.length === 0 && (
              <div className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" /></div>
            )}
            {!collectionsLoading && multiCollections.length === 0 && (
              <div className={`text-center py-10 text-sm ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>
                还没有合集，点右上角新建一个吧
              </div>
            )}

            <div className="space-y-4">
              {multiCollections.map((col) => (
                <CollectionCard
                  key={col.id}
                  col={col}
                  dm={dm}
                  expanded={expandedId === col.id}
                  onToggleExpand={() => setExpandedId(expandedId === col.id ? null : col.id)}
                  onEdit={() => setEditingCol(col)}
                  onDelete={() => handleDeleteCollection(col.slug, col.title)}
                  onPick={() => setPickerFor(col)}
                  onDeleteModule={handleDeleteModule}
                  onRefresh={fetchCollections}
                  token={token!}
                />
              ))}
            </div>
          </div>
        )}

        {/* ===== 设置 Tab ===== */}
        {activeTab === "settings" && (
          <div className="space-y-5">
            <PageHeader
              dm={dm}
              icon={<Settings className="w-6 h-6 text-black" />}
              title="设置"
              subtitle="管理与偏好"
              darkMode={dm}
              onToggleTheme={() => setDarkMode(!dm)}
            />

            {/* 主题 */}
            <div className={`rounded-2xl p-4 flex items-center justify-between ${dm ? "bg-[#15181d] border border-white/5" : "bg-white border border-slate-200"}`}>
              <div className="flex items-center gap-3">
                {dm ? <Moon className="w-5 h-5 text-[#8b949e]" /> : <Sun className="w-5 h-5 text-amber-500" />}
                <span className={`text-sm font-medium ${dm ? "text-white" : "text-slate-800"}`}>{dm ? "深色模式" : "浅色模式"}</span>
              </div>
              <button
                onClick={() => setDarkMode(!dm)}
                className={`w-12 h-7 rounded-full p-1 transition-colors ${dm ? "bg-[#1a8cff]" : "bg-slate-300"}`}
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${dm ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {/* 管理链接 */}
            {showTokenBanner && manageUrl && (
              <div className={`rounded-2xl p-4 relative ${dm ? "bg-amber-500/10 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
                <button onClick={() => setShowTokenBanner(false)} className="absolute top-3 right-3 p-1 text-amber-400 hover:text-amber-600 rounded">
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-500/15 rounded-lg flex-shrink-0">
                    <Key className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="space-y-2 min-w-0">
                    <h3 className={`text-sm font-semibold ${dm ? "text-amber-200" : "text-amber-900"}`}>请保存您的管理链接</h3>
                    <p className={`text-xs ${dm ? "text-amber-200/60" : "text-amber-700"}`}>这是您管理已上传模块的唯一凭证，请妥善保存。</p>
                    <div className={`flex items-center rounded-lg p-1 ${dm ? "bg-black/30 border border-white/10" : "bg-white border border-amber-200"}`}>
                      <input type="text" readOnly value={manageUrl} className={`bg-transparent text-xs font-mono w-full focus:outline-none truncate px-2 ${dm ? "text-amber-200/80" : "text-amber-800"}`} />
                      <CopyButton text={manageUrl} label="复制" dm={dm} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {manageUrl && !showTokenBanner && (
              <div className={`rounded-2xl p-4 ${dm ? "bg-[#15181d] border border-white/5" : "bg-white border border-slate-200"}`}>
                <div className="flex items-center gap-3 mb-2">
                  <Key className={`w-4 h-4 ${dm ? "text-[#8b949e]" : "text-slate-400"}`} />
                  <span className={`text-sm font-medium ${dm ? "text-white" : "text-slate-800"}`}>管理链接</span>
                </div>
                <div className={`flex items-center rounded-lg p-1 ${dm ? "bg-black/30 border border-white/10" : "bg-slate-50 border border-slate-200"}`}>
                  <input type="text" readOnly value={manageUrl} className={`bg-transparent text-xs font-mono w-full focus:outline-none truncate px-2 ${dm ? "text-[#8b949e]" : "text-slate-600"}`} />
                  <CopyButton text={manageUrl} label="复制" dm={dm} />
                </div>
              </div>
            )}

            {/* 退出 */}
            <button
              onClick={handleLogout}
              className={`w-full rounded-2xl p-4 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${dm ? "bg-[#15181d] border border-white/5 text-red-400 hover:bg-red-500/10" : "bg-white border border-slate-200 text-red-600 hover:bg-red-50"}`}
            >
              <LogOut className="w-4 h-4" /> 退出登录
            </button>

            <p className={`text-center text-xs ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>Forward Widget Hub</p>
          </div>
        )}
      </div>

      {/* ===== 底部 Tab 栏 ===== */}
      <div className="fixed bottom-0 inset-x-0 z-40 pb-5 pt-2 pointer-events-none">
        <div className={`pointer-events-auto mx-auto w-fit flex items-center gap-2 rounded-full px-3 py-2 shadow-2xl ${dm ? "bg-[#15181d]/95 border border-white/10" : "bg-white/95 border border-slate-200"}`}>
          {([
            { key: "modules", label: "模块", icon: Layers },
            { key: "collections", label: "合集", icon: LayoutGrid },
            { key: "settings", label: "设置", icon: Settings },
          ] as const).map((t) => {
            const active = activeTab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="relative flex flex-col items-center gap-0.5 px-5 py-1.5 rounded-full transition-colors"
              >
                <Icon className={`w-5 h-5 ${active ? "text-[#1a8cff]" : dm ? "text-[#5b626b]" : "text-slate-400"}`} />
                <span className={`text-[11px] font-medium ${active ? "text-[#1a8cff]" : dm ? "text-[#5b626b]" : "text-slate-400"}`}>{t.label}</span>
                {active && <span className="absolute -bottom-0.5 w-6 h-1 rounded-full bg-[#1a8cff]" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== 新建合集弹窗 ===== */}
      <CollectionFormDialog
        dm={dm}
        open={showCreateDialog}
        title="新建合集"
        onClose={() => setShowCreateDialog(false)}
        onSubmit={async (t, d, icon) => {
          const ok = await handleCreateCollection(t, d, icon);
          if (ok) setShowCreateDialog(false);
        }}
      />

      {/* ===== 编辑合集弹窗 ===== */}
      <CollectionFormDialog
        dm={dm}
        open={!!editingCol}
        title="编辑合集"
        initial={editingCol || undefined}
        onClose={() => setEditingCol(null)}
        onSubmit={async (t, d, icon) => {
          if (!editingCol) return;
          const ok = await handleUpdateCollection(editingCol.slug, t, d, icon);
          if (ok) setEditingCol(null);
        }}
      />

      {/* ===== 从模块池挑选弹窗 ===== */}
      {pickerFor && (
        <ModulePickerDialog
          dm={dm}
          collectionTitle={pickerFor.title}
          modules={poolModules}
          onCancel={() => setPickerFor(null)}
          onConfirm={handleConfirmPick}
        />
      )}
    </div>
  );
}

/* ================= 子组件 ================= */

function PageHeader({ dm, icon, title, subtitle, darkMode, onToggleTheme }: {
  dm: boolean; icon: React.ReactNode; title: string; subtitle: string;
  darkMode: boolean; onToggleTheme: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-white/90 flex items-center justify-center shadow-sm flex-shrink-0">
          {icon}
        </div>
        <div>
          <h1 className={`text-xl font-bold ${dm ? "text-white" : "text-slate-900"}`}>{title}</h1>
          <p className={`text-xs mt-0.5 ${dm ? "text-[#8b949e]" : "text-slate-500"}`}>{subtitle}</p>
        </div>
      </div>
      <button
        onClick={onToggleTheme}
        className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${dm ? "bg-white/5 text-[#8b949e] hover:text-white" : "bg-white border border-slate-200 text-slate-500 hover:text-slate-800"}`}
        aria-label="切换主题"
      >
        {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
      </button>
    </div>
  );
}

function CopyButton({ text, label, dm, iconOnly }: { text: string; label?: string; dm: boolean; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1 rounded-lg transition-colors flex-shrink-0 ${iconOnly ? "p-2" : "px-2.5 py-1.5 text-xs font-medium"} ${dm ? "text-[#8b949e] hover:text-white hover:bg-white/10" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"}`}
      title={label || "复制"}
    >
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
      {label && <span>{copied ? "已复制" : label}</span>}
    </button>
  );
}

function CollectionCard({ col, dm, expanded, onToggleExpand, onEdit, onDelete, onPick, onDeleteModule, onRefresh, token }: {
  col: Collection; dm: boolean; expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void; onDelete: () => void; onPick: () => void;
  onDeleteModule: (id: string) => void;
  onRefresh: () => void; token: string;
}) {
  const iconBtn = `p-2 rounded-lg transition-colors ${dm ? "text-[#6b7280] hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`;
  return (
    <div className={`rounded-2xl overflow-hidden ${dm ? "bg-[#15181d] border border-white/5" : "bg-white border border-slate-200 shadow-sm"}`}>
      {/* 卡片头 */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 cursor-pointer" onClick={onToggleExpand}>
        {col.icon_url ? (
          <img src={col.icon_url} alt={col.title} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <FileJson className="w-6 h-6 text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold truncate ${dm ? "text-white" : "text-slate-900"}`}>{col.title}</h3>
          <p className={`text-xs mt-0.5 truncate ${dm ? "text-[#8b949e]" : "text-slate-500"}`}>
            {col.modules.length} 个模块{col.description ? ` · ${col.description}` : ""}
          </p>
        </div>
        <div className="flex items-center flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <CopyButton text={col.fwdUrl} dm={dm} iconOnly />
          <button onClick={onEdit} className={iconBtn} title="编辑"><Pencil className="w-4 h-4" /></button>
          <button onClick={onDelete} className={iconBtn} title="删除"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      {/* 从模块池挑选 */}
      <button
        onClick={(e) => { e.stopPropagation(); onPick(); }}
        className="block px-4 pb-1 text-sm font-medium text-[#1a8cff] hover:text-[#4da3ff] transition-colors"
      >
        + 从模块池挑选
      </button>

      {/* 展开：模块列表 */}
      {expanded && (
        <div className={`mx-4 mb-4 mt-2 rounded-xl overflow-hidden ${dm ? "bg-black/25 border border-white/5" : "bg-slate-50 border border-slate-200"}`}>
          {/* FWD 订阅链接 */}
          <div className={`flex items-center gap-2 px-3 py-2.5 ${dm ? "border-b border-white/5" : "border-b border-slate-200"}`}>
            <LinkIcon className={`w-4 h-4 flex-shrink-0 ${dm ? "text-[#8b949e]" : "text-slate-400"}`} />
            <input
              type="text" readOnly value={col.fwdUrl}
              onClick={(e) => e.stopPropagation()}
              className={`flex-1 bg-transparent text-xs font-mono truncate focus:outline-none ${dm ? "text-[#8b949e]" : "text-slate-500"}`}
            />
            <CopyButton text={col.fwdUrl} label="复制" dm={dm} />
            <a href={col.fwdUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={iconBtn} title="打开">
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
          <div className={`divide-y ${dm ? "divide-white/5" : "divide-slate-100"}`}>
            {col.modules.map((m) => (
              <ModuleRow key={m.id} mod={m} dm={dm} token={token}
                onDelete={() => onDeleteModule(m.id)} onRefresh={onRefresh} />
            ))}
            {col.modules.length === 0 && (
              <p className={`text-xs text-center py-4 ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>空合集，点「从模块池挑选」添加模块</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModuleRow({ mod, dm, token, onDelete, onRefresh }: {
  mod: Module; dm: boolean; token: string;
  onDelete: () => void; onRefresh: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/admin/modules/${mod.id}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "同步失败"); return; }
      onRefresh();
    } finally { setSyncing(false); }
  };

  const handleReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".js")) { alert("仅支持 .js 文件"); return; }
    setReplacing(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/modules/${mod.id}?token=${token}`, { method: "PUT", body: fd });
    if (!res.ok) { const d = await res.json().catch(() => null); alert(d?.error || "更新失败"); }
    else onRefresh();
    setReplacing(false);
    e.target.value = "";
  };

  const smallBtn = `text-xs font-medium transition-colors disabled:opacity-40 ${dm ? "text-[#8b949e] hover:text-white" : "text-slate-500 hover:text-slate-800"}`;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${dm ? "text-white" : "text-slate-800"}`}>{mod.title}</p>
          <p className={`text-[11px] font-mono truncate mt-0.5 ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>{mod.filename} · {formatSize(mod.file_size)}</p>
        </div>
        {mod.source_url && (
          <button onClick={handleSync} disabled={syncing} className={smallBtn} title="重新从源 URL 下载">
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        )}
        <button onClick={() => replaceInput.current?.click()} disabled={replacing} className={smallBtn}>
          {replacing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "更新版本"}
        </button>
        <button onClick={onDelete} className={`text-xs font-medium ${dm ? "text-red-400/80 hover:text-red-400" : "text-red-500 hover:text-red-600"}`}>删除</button>
      </div>
      <input type="file" ref={replaceInput} className="hidden" accept=".js" onChange={handleReplace} />
    </div>
  );
}

function PoolModuleRow({ mod, dm, token, onDelete, onDeleteCollection, onRefresh }: {
  mod: Module; dm: boolean; token: string;
  onDelete: () => void; onDeleteCollection: () => void; onRefresh: () => void;
}) {
  const rawUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/modules/${mod.id}/raw`;
  return (
    <div className={`rounded-2xl px-4 py-3 ${dm ? "bg-[#15181d] border border-white/5" : "bg-white border border-slate-200 shadow-sm"}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${dm ? "bg-white/5" : "bg-slate-100"}`}>
          <FileCode className={`w-5 h-5 ${dm ? "text-[#8b949e]" : "text-slate-500"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${dm ? "text-white" : "text-slate-800"}`}>{mod.title}</p>
          <p className={`text-[11px] font-mono truncate mt-0.5 ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>{mod.filename} · {formatSize(mod.file_size)}</p>
        </div>
        <CopyButton text={rawUrl} dm={dm} iconOnly />
        <button onClick={onDelete} className={`p-2 rounded-lg transition-colors ${dm ? "text-[#6b7280] hover:text-red-400 hover:bg-white/10" : "text-slate-400 hover:text-red-500 hover:bg-slate-100"}`} title="删除">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-3 mt-1.5 ml-[52px]">
        <ModuleQuickActions mod={mod} dm={dm} token={token} onDelete={onDelete} onRefresh={onRefresh} />
        <button onClick={onDeleteCollection} className={`text-[11px] ${dm ? "text-[#5b626b] hover:text-[#8b949e]" : "text-slate-400 hover:text-slate-500"}`}>删除空合集</button>
      </div>
    </div>
  );
}

function ModuleQuickActions({ mod, dm, token, onDelete, onRefresh }: {
  mod: Module; dm: boolean; token: string;
  onDelete: () => void; onRefresh: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/admin/modules/${mod.id}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "同步失败"); return; }
      onRefresh();
    } finally { setSyncing(false); }
  };

  const handleReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".js")) { alert("仅支持 .js 文件"); return; }
    setReplacing(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/modules/${mod.id}?token=${token}`, { method: "PUT", body: fd });
    if (!res.ok) { const d = await res.json().catch(() => null); alert(d?.error || "更新失败"); }
    else onRefresh();
    setReplacing(false);
    e.target.value = "";
  };

  const btn = `text-[11px] font-medium transition-colors disabled:opacity-40 ${dm ? "text-[#1a8cff] hover:text-[#4da3ff]" : "text-indigo-600 hover:text-indigo-800"}`;
  return (
    <>
      {mod.source_url && (
        <button onClick={handleSync} disabled={syncing} className={btn}>
          {syncing ? "同步中..." : "同步"}
        </button>
      )}
      <button onClick={() => replaceInput.current?.click()} disabled={replacing} className={btn}>
        {replacing ? "更新中..." : "更新版本"}
      </button>
      <input type="file" ref={replaceInput} className="hidden" accept=".js" onChange={handleReplace} />
    </>
  );
}

function FileItemRow({ file, dm, onRemove }: { file: FileItem; dm: boolean; onRemove: () => void }) {
  const statusIcon = {
    uploading: <Loader2 className="w-5 h-5 text-[#1a8cff] animate-spin" />,
    processing: <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />,
    success: <CheckCircle2 className="w-5 h-5 text-green-500" />,
    error: <AlertCircle className="w-5 h-5 text-red-500" />,
  };
  const progressColor = file.status === "error" ? "bg-red-500" : file.status === "success" ? "bg-green-500" : "bg-[#1a8cff]";
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">{statusIcon[file.status]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm font-medium truncate ${dm ? "text-white" : "text-slate-700"}`}>{file.name}</p>
            <button onClick={onRemove} className={`p-1 rounded transition-colors ${dm ? "text-[#5b626b] hover:text-white" : "text-slate-400 hover:text-slate-600"}`}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className={`text-xs mt-0.5 ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>
            {file.status === "uploading" && `上传中 ${file.progress}%`}
            {file.status === "processing" && (file.processingDetail || "处理中...")}
            {file.status === "error" && <span className="text-red-400">{file.errorMsg}</span>}
            {file.status === "success" && <span className="text-green-400">上传成功 · {file.size}</span>}
            {(file.status === "uploading" || file.status === "processing") && file.size && ` · ${file.size}`}
          </p>
          {(file.status === "uploading" || file.status === "processing") && (
            <div className={`mt-1.5 h-1.5 rounded-full overflow-hidden ${dm ? "bg-white/10" : "bg-slate-100"}`}>
              <div className={`h-full ${progressColor} transition-all duration-300`} style={{ width: `${file.progress}%` }} />
            </div>
          )}
          {file.status === "success" && file.fwdUrl && (
            <div className={`mt-2 flex items-center rounded-lg p-1 ${dm ? "bg-black/30 border border-white/10" : "bg-slate-50 border border-slate-200"}`}>
              <input type="text" readOnly value={file.fwdUrl} className={`bg-transparent text-xs font-mono w-full focus:outline-none truncate px-2 ${dm ? "text-[#8b949e]" : "text-slate-600"}`} />
              <CopyButton text={file.fwdUrl} label="复制" dm={dm} />
            </div>
          )}
          {file.status === "success" && file.url && !file.fwdUrl && (
            <div className={`mt-2 flex items-center rounded-lg p-1 ${dm ? "bg-black/30 border border-white/10" : "bg-slate-50 border border-slate-200"}`}>
              <input type="text" readOnly value={file.url} className={`bg-transparent text-xs font-mono w-full focus:outline-none truncate px-2 ${dm ? "text-[#8b949e]" : "text-slate-600"}`} />
              <CopyButton text={file.url} label="复制" dm={dm} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CollectionFormDialog({ dm, open, title, initial, onClose, onSubmit }: {
  dm: boolean; open: boolean; title: string;
  initial?: Collection;
  onClose: () => void;
  onSubmit: (title: string, description: string, icon: File | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const iconInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.title || "");
      setDesc(initial?.description || "");
      setIconFile(null);
      setIconPreview(initial?.icon_url || null);
      setSaving(false);
    }
  }, [open, initial]);

  if (!open) return null;

  const handleIconPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setIconFile(f);
    setIconPreview(URL.createObjectURL(f));
    e.target.value = "";
  };

  const handleSubmit = async () => {
    if (!name.trim()) { alert("标题不能为空"); return; }
    setSaving(true);
    await onSubmit(name.trim(), desc.trim(), iconFile);
    setSaving(false);
  };

  const inputCls = `w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1a8cff] ${dm ? "bg-black/30 border border-white/10 text-white placeholder:text-[#5b626b]" : "bg-slate-50 border border-slate-200 text-slate-800 placeholder:text-slate-400"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={`relative w-full max-w-md rounded-t-3xl p-5 space-y-4 max-h-[85vh] overflow-y-auto ${dm ? "bg-[#1c2026]" : "bg-white"}`}>
        <div className="flex items-center justify-between">
          <h2 className={`text-base font-bold ${dm ? "text-white" : "text-slate-900"}`}>{title}</h2>
          <button onClick={onClose} className={`p-1.5 rounded-full ${dm ? "text-[#8b949e] hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => iconInput.current?.click()}
            className={`w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0 ${dm ? "bg-black/30 border border-white/10" : "bg-slate-100 border border-slate-200"}`}
          >
            {iconPreview ? (
              <img src={iconPreview} alt="icon" className="w-full h-full object-cover" />
            ) : (
              <ImagePlus className={`w-6 h-6 ${dm ? "text-[#5b626b]" : "text-slate-400"}`} />
            )}
          </button>
          <div className="flex-1">
            <p className={`text-sm font-medium ${dm ? "text-white" : "text-slate-800"}`}>合集图标</p>
            <p className={`text-xs mt-0.5 ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>点击左侧更换（可选）</p>
          </div>
          <input type="file" ref={iconInput} className="hidden" accept="image/*" onChange={handleIconPick} />
        </div>

        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="合集标题" className={inputCls} maxLength={60} />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="描述（可选）" rows={2} className={`${inputCls} resize-none`} maxLength={200} />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className={`flex-1 py-3 rounded-full text-sm font-medium transition-colors ${dm ? "bg-white/10 text-white hover:bg-white/15" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className="flex-1 py-3 rounded-full text-sm font-medium bg-[#1a8cff] text-white hover:bg-[#1580f0] disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

function ModulePickerDialog({ dm, collectionTitle, modules, onCancel, onConfirm }: {
  dm: boolean; collectionTitle: string; modules: (Module & { from: string })[];
  onCancel: () => void; onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className={`relative w-full max-w-md rounded-t-3xl p-5 flex flex-col max-h-[75vh] ${dm ? "bg-[#1c2026]" : "bg-white"}`}>
        <div className="flex items-center justify-between mb-1">
          <h2 className={`text-base font-bold ${dm ? "text-white" : "text-slate-900"}`}>
            挑选模块 <span className={`font-normal ${dm ? "text-[#8b949e]" : "text-slate-500"}`}>— {collectionTitle}</span>
          </h2>
          <button onClick={onCancel} className={`p-1.5 rounded-full ${dm ? "text-[#8b949e] hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"}`}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className={`text-xs mb-3 ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>选择模块（勾选已有模块添加到合集）</p>

        <div className={`flex-1 overflow-y-auto rounded-2xl border divide-y ${dm ? "border-white/10 bg-black/20 divide-white/5" : "border-slate-200 bg-slate-50 divide-slate-100"}`}>
          {modules.length === 0 && (
            <p className={`text-sm text-center py-8 ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>模块池是空的，先去「模块」Tab 上传</p>
          )}
          {modules.map((m) => {
            const checked = selected.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggle(m.id)}
                className="w-full flex items-center gap-3 py-3 px-3 text-left"
              >
                <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${checked ? "bg-[#1a8cff] border-[#1a8cff]" : dm ? "border-white/20" : "border-slate-300"}`}>
                  {checked && <Check className="w-3.5 h-3.5 text-white" />}
                </span>
                <span className="flex-1 min-w-0 px-3">
                  <span className={`block text-sm font-medium truncate ${dm ? "text-white" : "text-slate-800"}`}>{m.title}</span>
                  <span className={`block text-[11px] truncate ${dm ? "text-[#5b626b]" : "text-slate-400"}`}>{m.filename}</span>
                </span>
                <span className={`text-xs font-mono flex-shrink-0 pr-3 ${dm ? "text-[#8b949e]" : "text-slate-500"}`}>{formatSize(m.file_size)}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-3 pt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-full text-sm font-medium bg-[#1a8cff] text-white hover:bg-[#1580f0] transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(selected)}
            className="flex-1 py-3 rounded-full text-sm font-medium bg-[#1a8cff] text-white hover:bg-[#1580f0] transition-colors"
          >
            确认{selected.length > 0 ? ` (${selected.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
