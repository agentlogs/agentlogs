import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../../../components/ui/input-otp";
import { authClient } from "../../../lib/auth-client";

export const Route = createFileRoute("/_app/app/device")({
  component: DeviceAuthorizationPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      user_code: (search.user_code as string) || "",
    };
  },
});

function DeviceAuthorizationPage() {
  const { user_code } = Route.useSearch();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Auto-fill code from URL query parameter
  useEffect(() => {
    if (user_code && user_code.length === 8) {
      setCode(user_code);
    }
  }, [user_code]);

  const handleApprove = async () => {
    if (code.length !== 8) {
      setError("Please enter an 8-character code");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: approveError } = await authClient.device.approve({
        userCode: code,
      });

      if (approveError) {
        setError(approveError.error_description || "Failed to approve device");
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);
    } catch {
      setError("An unexpected error occurred");
      setLoading(false);
    }
  };

  const handleDeny = async () => {
    if (code.length !== 8) {
      setError("Please enter an 8-character code");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: denyError } = await authClient.device.deny({
        userCode: code,
      });

      if (denyError) {
        setError(denyError.error_description || "Failed to deny device");
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);
    } catch {
      setError("An unexpected error occurred");
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Success!</CardTitle>
            <CardDescription>You can now close this browser tab and return to your CLI</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Device Authorization</CardTitle>
          <CardDescription>Enter the 8-character code displayed in your CLI to authorize this device</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            <InputOTP maxLength={8} value={code} onChange={(value) => setCode(value.toUpperCase())}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
                <InputOTPSlot index={6} />
                <InputOTPSlot index={7} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>}

          <div className="flex gap-2">
            <Button onClick={handleApprove} disabled={loading || code.length !== 8} className="flex-1">
              {loading ? "Processing..." : "Approve"}
            </Button>
            <Button onClick={handleDeny} disabled={loading || code.length !== 8} variant="outline" className="flex-1">
              Deny
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
