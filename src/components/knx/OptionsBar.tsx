"use client";

import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Play, FileCode, Filter, KeyRound, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function OptionsBar({
  file,
  busy,
  dropReserveFromUnknown,
  onToggleReserve,
  password,
  onPasswordChange,
  passwordError,
  onParse,
  onReset,
}: {
  file: File | null;
  busy: boolean;
  dropReserveFromUnknown: boolean;
  onToggleReserve: (v: boolean) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  passwordError?: string | null;
  onParse: () => void;
  onReset: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-6">
      {file && (
        <div className="flex items-center gap-3 rounded-lg border bg-background p-4">
          <div className="rounded-md bg-primary/10 p-2">
            <FileCode className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Selected file</p>
            <p className="truncate text-sm font-semibold">{file.name}</p>
          </div>
          <Badge variant="secondary">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </Badge>
        </div>
      )}

      <div className="space-y-2 rounded-lg border bg-background p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted p-2">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <Label htmlFor="opt-password" className="text-sm font-medium">
              Project password
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Only needed for password protected ETS projects. Stays in your browser.
            </p>
          </div>
        </div>
        <div className="relative">
          <Input
            id="opt-password"
            type={showPassword ? "text" : "password"}
            autoComplete="off"
            placeholder="Optional"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && file && !busy) onParse();
            }}
            disabled={busy}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "opt-password-error" : undefined}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {passwordError && (
          <p id="opt-password-error" className="text-xs font-medium text-destructive">
            {passwordError}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-background p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted p-2">
            <Filter className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <Label htmlFor="opt-reserve" className="cursor-pointer text-sm font-medium">
              Filter reserve entities
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Hide entities marked as &quot;Reserve&quot;
            </p>
          </div>
        </div>
        <Switch
          id="opt-reserve"
          checked={dropReserveFromUnknown}
          onCheckedChange={onToggleReserve}
          disabled={busy}
        />
      </div>

      <div className="space-y-3">
        <Button
          onClick={onParse}
          disabled={!file || busy}
          size="lg"
          className={cn("w-full", busy && "cursor-wait")}
        >
          {busy ? (
            <>
              <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
              Working...
            </>
          ) : (
            <>
              <Play className="mr-1 h-4 w-4" />
              Parse
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground">
          Snapshot controls live in the header so you can import/export from any step.
        </p>
      </div>
    </div>
  );
}
