"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { useState } from "react";

export default function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/manage?token=${token}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "无效的管理链接");
        }
        localStorage.setItem("fwh_token", token);
        router.replace("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "验证失败");
      }
    })();
  }, [token, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-slate-500">请确认管理链接是否正确。</p>
          <a href="/" className="text-sm text-indigo-600 hover:underline">返回首页</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
      <div className="text-center space-y-2">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" />
        <p className="text-sm text-slate-500">正在验证管理链接...</p>
      </div>
    </div>
  );
}
