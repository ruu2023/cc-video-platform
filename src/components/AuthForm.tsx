"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { authClient } from "@/lib/auth-client";

const MIN_PASSWORD_LENGTH = 8;

/** Maps better-auth error codes/messages onto Japanese copy. */
function localizeError(code: string | undefined, message: string | undefined) {
  switch (code) {
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "このメールアドレスはすでに登録されています。ログインしてください。";
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "INVALID_EMAIL":
      return "メールアドレスまたはパスワードが正しくありません。";
    case "PASSWORD_TOO_SHORT":
      return `パスワードは ${MIN_PASSWORD_LENGTH} 文字以上で入力してください。`;
    case "PASSWORD_TOO_LONG":
      return "パスワードが長すぎます。";
    default:
      return message || "処理に失敗しました。時間をおいて再度お試しください。";
  }
}

/** Only same-site absolute paths may be used as a post-login destination. */
function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export function AuthForm({
  mode,
  next,
}: {
  mode: "signup" | "login";
  next?: string;
}) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const nameId = useId();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignup = mode === "signup";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setError("メールアドレスとパスワードを入力してください。");
      return;
    }
    if (isSignup && password.length < MIN_PASSWORD_LENGTH) {
      setError(`パスワードは ${MIN_PASSWORD_LENGTH} 文字以上で入力してください。`);
      return;
    }

    setSubmitting(true);

    try {
      const result = isSignup
        ? await authClient.signUp.email({
            email: trimmedEmail,
            password,
            name: name.trim() || trimmedEmail.split("@")[0],
          })
        : await authClient.signIn.email({ email: trimmedEmail, password });

      if (result.error) {
        setError(localizeError(result.error.code, result.error.message));
        setSubmitting(false);
        return;
      }

      // Creators go straight to the admin area unless a specific page asked
      // for them (?next=…, e.g. after being bounced off /admin).
      const role = (result.data?.user as { role?: string } | undefined)?.role;
      const destination =
        safeNext(next) ?? (role === "creator" ? "/admin" : "/courses");

      router.replace(destination);
      router.refresh();
    } catch (cause) {
      console.error(cause);
      setError("サーバーに接続できませんでした。時間をおいて再度お試しください。");
      setSubmitting(false);
    }
  }

  return (
    <div className="container auth">
      <div className="auth__card">
        <h1 className="display-sm auth__title">
          {isSignup ? "アカウントを作成" : "ログイン"}
        </h1>
        <p className="auth__sub">
          {isSignup
            ? "メールアドレスとパスワードだけで作成できます。購入前にアカウントが必要です。"
            : "登録済みのメールアドレスとパスワードを入力してください。"}
        </p>

        {error && (
          <p className="form-error" role="alert" data-testid="auth-error">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {isSignup && (
            <div className="field">
              <label className="field__label" htmlFor={nameId}>
                お名前
              </label>
              <input
                id={nameId}
                className="input"
                type="text"
                name="name"
                autoComplete="name"
                placeholder="山田 太郎"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <span className="field__hint">
                未入力の場合はメールアドレスから自動で設定します。
              </span>
            </div>
          )}

          <div className="field">
            <label className="field__label" htmlFor={emailId}>
              メールアドレス
            </label>
            <input
              id={emailId}
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              aria-invalid={error ? "true" : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor={passwordId}>
              パスワード
            </label>
            <input
              id={passwordId}
              className="input"
              type="password"
              name="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={isSignup ? MIN_PASSWORD_LENGTH : undefined}
              placeholder="8文字以上"
              value={password}
              aria-invalid={error ? "true" : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            {isSignup && (
              <span className="field__hint">
                {MIN_PASSWORD_LENGTH} 文字以上で設定してください。
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--block"
            style={{ marginTop: "var(--space-md)" }}
            disabled={submitting}
          >
            {submitting
              ? "送信中…"
              : isSignup
                ? "アカウントを作成"
                : "ログイン"}
          </button>
        </form>

        <p className="auth__footer">
          {isSignup ? (
            <>
              すでにアカウントをお持ちですか？ <Link href="/login">ログイン</Link>
            </>
          ) : (
            <>
              アカウントをお持ちでない方は{" "}
              <Link href="/signup">アカウント作成</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
