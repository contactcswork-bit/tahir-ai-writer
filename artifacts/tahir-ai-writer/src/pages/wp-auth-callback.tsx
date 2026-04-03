import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { createSite } from "@workspace/api-client-react";
import { CheckCircle2, XCircle, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function WpAuthCallback() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting your WordPress site...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const siteUrl = params.get("site_url");
    const userLogin = params.get("user_login");
    const password = params.get("password");

    if (!siteUrl || !userLogin || !password) {
      setStatus("error");
      setMessage("Authorization was cancelled or no credentials were received from WordPress.");
      return;
    }

    const name = (() => {
      try {
        return new URL(siteUrl).hostname;
      } catch {
        return siteUrl;
      }
    })();

    createSite({
      name,
      url: siteUrl.replace(/\/$/, ""),
      username: userLogin,
      applicationPassword: password,
    })
      .then(() => {
        setStatus("success");
        setMessage(`"${name}" connected successfully!`);
        setTimeout(() => {
          if (window.opener) {
            window.opener.postMessage({ type: "wp-auth-success", siteName: name }, "*");
            window.close();
          } else {
            setLocation("/sites");
          }
        }, 1500);
      })
      .catch((err: any) => {
        setStatus("error");
        setMessage(err?.message || "Failed to save the site. Please try again.");
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-950 p-4">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-lg p-8 max-w-sm w-full text-center space-y-5">
        <div className="flex justify-center">
          <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center text-primary">
            <Zap className="w-6 h-6 fill-current" />
          </div>
        </div>
        <h1 className="text-lg font-bold">Tahir AI Writer</h1>
        <p className="text-sm text-gray-500">WordPress Authorization</p>

        {status === "loading" && (
          <div className="space-y-3">
            <Loader2 className="w-10 h-10 mx-auto text-primary animate-spin" />
            <p className="text-gray-600 dark:text-gray-400 text-sm">{message}</p>
          </div>
        )}

        {status === "success" && (
          <div className="space-y-3">
            <CheckCircle2 className="w-10 h-10 mx-auto text-green-500" />
            <p className="text-gray-800 dark:text-gray-200 font-medium">{message}</p>
            <p className="text-xs text-gray-500">This tab will close automatically...</p>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4">
            <XCircle className="w-10 h-10 mx-auto text-red-500" />
            <p className="text-red-600 dark:text-red-400 text-sm">{message}</p>
            <Button onClick={() => window.close()} variant="outline" className="w-full">
              Close Tab
            </Button>
            <Button onClick={() => setLocation("/sites")} className="w-full">
              Go to Sites
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
