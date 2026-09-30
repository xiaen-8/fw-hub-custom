"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Shield,
  Loader2,
  ArrowRight,
  AlertCircle,
  Trash2,
  FileCode,
  FileJson,
  Lock,
  UploadCloud,
  RefreshCw,
  Copy,
  Check,
  Key,
} from "lucide-react";

interface Module {
  id: string;
  filename: string;
  title: string;
  version: string;
  author: string;
  file_size: number;
  is_encrypted: number;
  source_url: string;
}

interface Collection {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string;
  user_id: string;
  source_url: string;
  created_at: number;
  updated_at: number;
  modules: Module[];
}

function InlineCopy({ text, title }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={`p-1.5 rounded-lg transition-all flex-shrink-0 ${copied ? "bg-green-500 text-white" : "text-slate-300 hover:text-indigo-500 hover:bg-indigo-50"}`}
      title={title ?? (copied ? "已复制" : "复制链接")}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function AdminPage() {
  const [authState, setAuthState] = useState<
    "loading" | "disabled" | "need-password" | "authenticated"
  >("loading");
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingModuleId, setDeletingModuleId] = useState<string | null>(null);
  const [replacingModuleId, setReplacingModuleId] = useState<string | null>(null);
  const [syncingModuleId, setSyncingModuleId] = useState<string | null>(null);
  const [syncingColId, setSyncingColId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((data) => {
        if (!data.enabled) {
          setAuthState("disabled");
        } else if (data.authenticated) {
          setAuthState("authenticated");
        } else {
          setAuthState("need-password");
        }
      })
      .catch(() => setAuthState("disabled"));
  }, []);

  const fetchCollections = useCallback(async () => {
    setCollectionsLoading(true);
    try {
      const res = await fetch("/api/admin/collections");
      if (res.ok) {
        const data = await res.json();
        setCollections(data.collections);
      }
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authState === "authenticated") fetchCollections();
  }, [authState, fetchCollections]);

  const handlePasswordSubmit = async () => {
    if (!passwordInput.trim()) return;
    setPasswordLoading(true);
    setPasswordError("");
    try {
      const res = await fetch("/api/admin/auth", {
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

  const handleReplaceModule = async (mod: Module, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReplacingModuleId(mod.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/admin/modules/${mod.id}`, { method: "PUT", body: formData });
      if (res.ok) fetchCollections();
    } finally {
      setReplacingModuleId(null);
      e.target.value = "";
    }
  };

  const handleSyncModule = async (mod: Module) => {
    if (!mod.source_url) return;
    if (!confirm(`确定从源地址同步「${mod.title || mod.filename}」？`)) return;
    setSyncingModuleId(mod.id);
    try {
      const res = await fetch(mod.source_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const fname = mod.source_url.split("/").pop() || mod.filename;
      const file = new File([blob], fname, { type: "application/javascript" });
      const formData = new FormData();
      formData.append("file", file);
      const putRes = await fetch(`/api/admin/modules/${mod.id}`, { method: "PUT", body: formData });
      if (putRes.ok) fetchCollections();
      else alert("同步失败");
    } catch (e) {
      alert(`同步失败: ${(e as Error).message}`);
    } finally {
      setSyncingModuleId(null);
    }
  };

  const handleSyncCollection = async (col: Collection) => {
    if (!col.source_url) return;
    if (!confirm(`确定从源地址重新同步合集「${col.title}」？`)) return;
    setSyncingColId(col.id);
    try {
      const res = await fetch(col.source_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const fwd = JSON.parse(text);
      if (!fwd.widgets || !Array.isArray(fwd.widgets)) throw new Error("Invalid .fwd");
      const downloadedFiles: File[] = [];
      const widgetMetas: object[] = [];
      for (const widget of fwd.widgets) {
        let fname = widget.url.split("/").pop() || "widget.js";
        if (!fname.endsWith(".js")) fname += ".js";
        const dlRes = await fetch(widget.url);
        if (!dlRes.ok) throw new Error(`Failed to download ${fname}`);
        const blob = await dlRes.blob();
        downloadedFiles.push(new File([blob], fname, { type: "application/javascript" }));
        widgetMetas.push({ id: widget.id, title: widget.title, description: widget.description, version: widget.version, author: widget.author, requiredVersion: widget.requiredVersion, source_url: widget.url });
      }
      const formData = new FormData();
      downloadedFiles.forEach((f) => formData.append("files", f));
      formData.append("token", "__admin__");
      formData.append("collection_id", col.id);
      formData.append("sync", "true");
      formData.append("source_url", col.source_url);
      formData.append("widget_meta", JSON.stringify(widgetMetas));
      if (fwd.title) formData.append("title", fwd.title);
      if (fwd.description) formData.append("description", fwd.description);
      if (fwd.icon) formData.append("icon", fwd.icon);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (uploadRes.ok) fetchCollections();
      else { const d = await uploadRes.json(); alert(d.error || "同步失败"); }
    } catch (e) {
      alert(`同步失败: ${(e as Error).message}`);
    } finally {
      setSyncingColId(null);
    }
  };

  const handleDeleteModule = async (colId: string, mod: Module) => {
    if (!confirm(`确定删除模块「${mod.title || mod.filename}」？此操作不可恢复。`))
      return;
    setDeletingModuleId(mod.id);
    try {
      const res = await fetch(`/api/admin/modules/${mod.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setCollections((prev) =>
          prev.map((c) =>
            c.id === colId
              ? { ...c, modules: c.modules.filter((m) => m.id !== mod.id) }
              : c
          )
        );
      }
    } finally {
      setDeletingModuleId(null);
    }
  };

  const handleDeleteCollection = async (col: Collection) => {
    if (!confirm(`确定删除合集「${col.title}」及其所有模块？此操作不可恢复。`))
      return;
    setDeletingId(col.id);
    try {
      const res = await fetch(`/api/admin/collections/${col.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setCollections((prev) => prev.filter((c) => c.id !== col.id));
      }
    } finally {
      setDeletingId(null);
    }
  };

  if (authState === "loading") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (authState === "disabled") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center">
            <Lock className="w-6 h-6 text-slate-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">管理后台未启用</h1>
          <p className="text-sm text-slate-500">
            请设置 <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">ADMIN_PASSWORD</code> 环境变量以启用管理后台。
          </p>
        </div>
      </div>
    );
  }

  if (authState === "need-password") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 bg-orange-50 rounded-full flex items-center justify-center">
              <Shield className="w-6 h-6 text-orange-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">管理后台</h1>
            <p className="text-sm text-slate-500">请输入管理员密码</p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePasswordSubmit();
              }}
              placeholder="请输入管理员密码"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
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
              className="w-full py-3 bg-orange-600 text-white text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {passwordLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalModules = collections.reduce(
    (sum, c) => sum + c.modules.length,
    0
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-50 rounded-lg">
              <Shield className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">管理后台</h1>
              <p className="text-sm text-slate-500">
                {collections.length} 个合集 · {totalModules} 个模块
              </p>
            </div>
          </div>
          <a
            href="/"
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            返回首页
          </a>
        </div>

        {/* Loading */}
        {collectionsLoading && collections.length === 0 && (
          <div className="text-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" />
          </div>
        )}

        {/* Empty */}
        {!collectionsLoading && collections.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            暂无合集
          </div>
        )}

        {/* Collections */}
        {collections.map((col) => (
          <div
            key={col.id}
            className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
          >
            {/* Collection Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {col.icon_url ? (
                    <img
                      src={col.icon_url}
                      alt=""
                      className="w-9 h-9 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <FileJson className="w-4.5 h-4.5 text-indigo-600" />
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-slate-800">
                      {col.title}
                    </h3>
                    {col.description && (
                      <p className="text-xs text-slate-500">
                        {col.description}
                      </p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">
                      ID: {col.id} · 用户: {col.user_id.slice(0, 8)}... ·
                      更新于{" "}
                      {new Date(col.updated_at * 1000).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-md mr-1">
                    {col.modules.length} 个模块
                  </span>
                  {col.source_url && (
                    <button
                      onClick={() => handleSyncCollection(col)}
                      disabled={syncingColId === col.id}
                      className="p-1.5 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                      title="从源地址同步"
                    >
                      <RefreshCw className={`w-4 h-4 ${syncingColId === col.id ? "animate-spin" : ""}`} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteCollection(col)}
                    disabled={deletingId === col.id}
                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    title="删除合集"
                  >
                    {deletingId === col.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* FWD URL */}
            <div className="px-6 py-2 bg-indigo-50/40 border-b border-slate-100 flex items-center gap-2">
              <Key className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
              <span className="text-xs text-indigo-600 font-medium flex-shrink-0">订阅链接</span>
              <input type="text" readOnly value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/collections/${col.slug}/fwd`} className="bg-transparent text-xs font-mono text-indigo-500 flex-1 min-w-0 focus:outline-none truncate" />
              <InlineCopy text={`${typeof window !== "undefined" ? window.location.origin : ""}/api/collections/${col.slug}/fwd`} title="复制订阅链接" />
            </div>

            {/* Modules */}
            <div className="divide-y divide-slate-100">
              {col.modules.map((mod) => (
                <div
                  key={mod.id}
                  className="px-6 py-3 flex items-center gap-4 hover:bg-slate-50 transition-colors group"
                >
                  <div className="p-2 rounded-lg bg-amber-50 text-amber-600 flex-shrink-0">
                    <FileCode className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-800 truncate">
                        {mod.title || mod.filename}
                      </span>
                      {mod.version && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                          {mod.version}
                        </span>
                      )}
                      {mod.is_encrypted ? (
                        <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded border border-purple-100">
                          加密
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-400">
                      {mod.filename} ·{" "}
                      {mod.file_size < 1024
                        ? `${mod.file_size} B`
                        : `${(mod.file_size / 1024).toFixed(1)} KB`}
                      {mod.author ? ` · ${mod.author}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <InlineCopy text={`${typeof window !== "undefined" ? window.location.origin : ""}/api/modules/${mod.id}/raw`} title="复制模块链接" />
                    <input type="file" accept=".js" className="hidden" id={`admin-replace-${mod.id}`} onChange={(e) => handleReplaceModule(mod, e)} />
                    <button
                      disabled={replacingModuleId === mod.id}
                      onClick={() => document.getElementById(`admin-replace-${mod.id}`)?.click()}
                      className="p-1.5 text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                      title="更新文件"
                    >
                      {replacingModuleId === mod.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    </button>
                    {mod.source_url && (
                      <button
                        disabled={syncingModuleId === mod.id}
                        onClick={() => handleSyncModule(mod)}
                        className="p-1.5 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                        title="从源地址同步"
                      >
                        <RefreshCw className={`w-4 h-4 ${syncingModuleId === mod.id ? "animate-spin" : ""}`} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteModule(col.id, mod)}
                      disabled={deletingModuleId === mod.id}
                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title="删除模块"
                    >
                      {deletingModuleId === mod.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
              {col.modules.length === 0 && (
                <div className="px-6 py-4 text-center text-sm text-slate-400">
                  暂无模块
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
