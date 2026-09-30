"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UploadResult {
  token?: string;
  manageUrl: string;
  collection: { id: string; slug: string; fwdUrl: string; pageUrl: string };
  modules: Array<{ id: string; filename: string; title: string; version?: string; encrypted: boolean }>;
}

interface UploadZoneProps {
  onUploadComplete: (result: UploadResult) => void;
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".js"));
    if (droppedFiles.length) setFiles((prev) => [...prev, ...droppedFiles]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).filter((f) => f.name.endsWith(".js"));
    if (selected.length) setFiles((prev) => [...prev, ...selected]);
  };

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const handleUpload = async () => {
    if (!files.length) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      if (title) formData.append("title", title);
      const savedToken = localStorage.getItem("fwh_token");
      if (savedToken) formData.append("token", savedToken);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.token) localStorage.setItem("fwh_token", data.token);
      onUploadComplete(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="collection-title">Collection Title (optional)</Label>
        <Input id="collection-title" placeholder="My Widgets" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
      </div>
      <Card
        className={`border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input id="file-input" type="file" accept=".js" multiple className="hidden" onChange={handleFileSelect} />
        <div className="space-y-2">
          <p className="text-lg font-medium">Drop .js widget files here</p>
          <p className="text-sm text-muted-foreground">or click to browse</p>
        </div>
      </Card>
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{files.length} file(s) selected:</p>
          {files.map((file, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{file.name}</span>
              <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive">&#x2715;</button>
            </div>
          ))}
          <Button onClick={handleUpload} disabled={isUploading} className="w-full">
            {isUploading ? "Uploading..." : "Upload"}
          </Button>
        </div>
      )}
    </div>
  );
}
