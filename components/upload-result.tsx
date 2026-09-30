"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface UploadResultProps {
  result: {
    token?: string;
    manageUrl: string;
    collection: { slug: string; fwdUrl: string; pageUrl: string };
    modules: Array<{ id: string; filename: string; title: string; version?: string; encrypted: boolean }>;
  };
  onReset: () => void;
}

export function UploadResult({ result, onReset }: UploadResultProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
        <h3 className="font-semibold text-green-600">Upload Successful!</h3>
      </div>

      {result.token && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <h4 className="font-semibold text-amber-600">Save Your Management Token</h4>
          <p className="text-sm text-muted-foreground">This token is your only way to manage your modules. Save it now!</p>
          <div className="flex gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">{result.token}</code>
            <Button variant="outline" size="sm" onClick={() => copy(result.token!, "token")}>
              {copied === "token" ? "Copied!" : "Copy"}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <h4 className="font-semibold">Management Link</h4>
        <div className="flex gap-2">
          <code className="flex-1 rounded bg-muted px-3 py-2 text-sm break-all">{result.manageUrl}</code>
          <Button variant="outline" size="sm" onClick={() => copy(result.manageUrl, "manage")}>
            {copied === "manage" ? "Copied!" : "Copy"}
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h4 className="font-semibold">Forward App Subscription Link</h4>
        <p className="text-sm text-muted-foreground">Share this link to import modules in Forward App</p>
        <div className="flex gap-2">
          <code className="flex-1 rounded bg-muted px-3 py-2 text-sm break-all">{result.collection.fwdUrl}</code>
          <Button variant="outline" size="sm" onClick={() => copy(result.collection.fwdUrl, "fwd")}>
            {copied === "fwd" ? "Copied!" : "Copy"}
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h4 className="font-semibold">Uploaded Modules</h4>
        {result.modules.map((mod) => (
          <div key={mod.id} className="flex items-center justify-between border-b pb-2 last:border-0">
            <div>
              <span className="font-medium">{mod.title}</span>
              <span className="text-sm text-muted-foreground ml-2">{mod.filename}</span>
            </div>
            <div className="flex gap-2">
              {mod.version && <Badge variant="secondary">{mod.version}</Badge>}
              {mod.encrypted && <Badge variant="outline">Encrypted</Badge>}
            </div>
          </div>
        ))}
      </Card>

      <Button variant="outline" onClick={onReset} className="w-full">Upload More</Button>
    </div>
  );
}
