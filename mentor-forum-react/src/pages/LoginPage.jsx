// Login page with auth/session handling and password reset.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, KeyRound, Lock, LogIn, Mail, ShieldCheck, UserRoundPlus } from 'lucide-react';
import {
  auth,
  db,
  ensureFirebaseConfigured,
  onAuthStateChanged,
  configureLoginPersistence,
  clearTemporaryLoginExpiry,
  enforceTemporaryLoginExpiry,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from '../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../legacy/config.js';
import { usePageMeta } from '../hooks/usePageMeta.js';
import { useTheme } from '../hooks/useTheme.js';
import { cn } from '../lib/utils.js';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Label } from '../components/ui/label.jsx';
import { ThemeToggle } from '../components/ui/theme-toggle.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog.jsx';
const autoLogoutMessage = '로그인 유지를 선택하지 않아 10분이 지나 자동 로그아웃되었습니다. 다시 로그인해주세요.';
const resetPasswordNotice = '비밀번호 재설정 요청이 접수되었습니다. 가입된 이메일이면 재설정 메일이 발송되며, 받은편지함과 스팸함을 확인해주세요.';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}


async function syncEmailVerifiedProfile(user) {
  if (!user || !user.emailVerified) return;

  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email || '',
      realName: '',
      nickname: user.email ? user.email.split('@')[0] : 'new-user',
      role: MENTOR_FORUM_CONFIG.app.defaultRole,
      emailVerified: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return;
  }

  const profile = snap.data();
  if (!profile.emailVerified) {
    await updateDoc(ref, {
      emailVerified: true,
      updatedAt: serverTimestamp()
    });
  }
}

function normalizeErrMessage(err, fallback) {
  const code = err && err.code ? String(err.code) : '';
  if (code.includes('permission-denied')) {
    return '권한 오류입니다. 현재 등급에서 허용되지 않은 작업입니다.';
  }
  return (err && err.message) ? err.message : fallback;
}

export default function LoginPage() {
  usePageMeta('멘토스 로그인', 'auth-page');

  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  // Auth pages only support light/dark. Force-downgrade excel to light.
  useEffect(() => {
    if (theme === 'excel') setTheme('light');
  }, [theme, setTheme]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetMessage, setResetMessage] = useState({ type: '', text: '' });

  // Password reveal is intentionally "press-and-hold" to reduce accidental exposure.
  const bindPressToReveal = (setVisible) => ({
    onMouseDown: (event) => {
      event.preventDefault();
      setVisible(true);
    },
    onMouseUp: () => setVisible(false),
    onMouseLeave: () => setVisible(false),
    onTouchStart: (event) => {
      event.preventDefault();
      setVisible(true);
    },
    onTouchEnd: () => setVisible(false),
    onTouchCancel: () => setVisible(false),
    onBlur: () => setVisible(false),
    onKeyDown: (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        setVisible(true);
      }
    },
    onKeyUp: (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        setVisible(false);
      }
    }
  });

  const redirectToApp = () => {
    navigate(MENTOR_FORUM_CONFIG.app.appPage, { replace: true });
  };

  useEffect(() => {
    let active = true;

    try {
      ensureFirebaseConfigured();
    } catch (err) {
      if (active) setMessage({ type: 'error', text: err.message || 'Firebase 설정 오류' });
      return () => {
        active = false;
      };
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active || !user) return;

      // Temporary session users are blocked here when the idle expiry is reached.
      const sessionState = await enforceTemporaryLoginExpiry();
      if (!active) return;
      if (sessionState.expired) {
        setMessage({ type: 'notice', text: autoLogoutMessage });
        return;
      }

      try {
        await user.reload();
      } catch (_) {
        // Keep current auth state if reload fails.
      }

      if (!user.emailVerified) return;

      try {
        await syncEmailVerifiedProfile(user);
      } catch (_) {
        // Profile sync failure should not block login flow.
      }

      if (active) redirectToApp();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [navigate]);


  const onSubmit = async (event) => {
    event.preventDefault();
    setMessage({ type: '', text: '' });

    const normalizedEmail = String(email || '').trim();
    const rawPassword = String(password || '');

    if (!normalizedEmail || !rawPassword) {
      setMessage({ type: 'error', text: '이메일과 비밀번호를 입력해주세요.' });
      return;
    }

    setSubmitting(true);
    try {
      // Persistence mode must be configured before sign-in so the auth session is saved correctly.
      await configureLoginPersistence(rememberLogin);
      const credential = await signInWithEmailAndPassword(auth, normalizedEmail, rawPassword);

      try {
        await credential.user.reload();
      } catch (_) {
        // Keep current auth state if reload fails.
      }

      if (!credential.user.emailVerified) {
        clearTemporaryLoginExpiry();
        await signOut(auth);
        throw new Error('이메일 인증이 완료되지 않았습니다. 메일함에서 인증 링크를 먼저 확인해주세요. 스팸 메일함도 확인해주세요.');
      }

      await syncEmailVerifiedProfile(credential.user);
      redirectToApp();
    } catch (err) {
      if (!auth.currentUser) {
        clearTemporaryLoginExpiry();
      }
      setMessage({ type: 'error', text: normalizeErrMessage(err, '로그인에 실패했습니다.') });
    } finally {
      setSubmitting(false);
    }
  };

  const openResetDialog = () => {
    setResetMessage({ type: '', text: '' });
    setResetEmail(normalizeEmail(email));
    setResetOpen(true);
  };

  const onResetSubmit = async (event) => {
    event.preventDefault();
    setResetMessage({ type: '', text: '' });

    const normalizedEmail = normalizeEmail(resetEmail);
    if (!normalizedEmail || !isEmailValid(normalizedEmail)) {
      setResetMessage({ type: 'error', text: '올바른 이메일 주소를 입력해주세요.' });
      return;
    }

    setResetSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      setResetMessage({ type: 'notice', text: resetPasswordNotice });
    } catch (err) {
      const code = err && err.code ? String(err.code) : '';
      if (code.includes('invalid-email')) {
        setResetMessage({ type: 'error', text: '올바른 이메일 주소를 입력해주세요.' });
      } else if (code.includes('too-many-requests')) {
        setResetMessage({ type: 'error', text: '요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.' });
      } else if (code.includes('network-request-failed')) {
        setResetMessage({ type: 'error', text: '네트워크 오류가 발생했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.' });
      } else {
        // For account-enumeration safety, keep a generic success-style message on unknown cases.
        setResetMessage({ type: 'notice', text: resetPasswordNotice });
      }
    } finally {
      setResetSubmitting(false);
    }
  };

  return (
    <>
      <main className="page auth-page-wrap flex min-h-[calc(100vh-2rem)] items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: 'easeOut' }}
        className="mx-auto w-full max-w-[560px]"
      >
        <Card className="auth-card auth-login-card border-primary/20">
          <CardHeader className="space-y-2">
            <div className="row space-between auth-head-row">
              <p className="hero-kicker"><ShieldCheck size={15} /> Mentor Forum</p>
              <ThemeToggle className="theme-toggle-auth" />
            </div>
            <CardTitle className="text-balance">멘토스 로그인</CardTitle>
            <CardDescription className="text-sm">
              회원 전용 커뮤니티입니다. 로그인 후 포럼을 이용할 수 있습니다.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {message.text ? (
              <div
                className={cn(
                  'auth-inline-message',
                  message.type === 'error' ? 'is-error' : 'is-notice'
                )}
              >
                {message.text}
              </div>
            ) : null}

            <form className="auth-form space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email" className="auth-label inline-flex items-center gap-2">
                  <Mail size={15} />
                  이메일
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="auth-input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="auth-label inline-flex items-center gap-2">
                  <Lock size={15} />
                  비밀번호
                </Label>
                <div className="auth-input-wrap">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    className="auth-input auth-input-with-toggle"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="auth-input-toggle"
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                    {...bindPressToReveal(setShowPassword)}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="login-remember-box">
                <div className="login-remember-row">
                  <input
                    id="rememberLogin"
                    type="checkbox"
                    className="login-remember-check"
                    checked={rememberLogin}
                    onChange={(event) => setRememberLogin(event.target.checked)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="rememberLogin" className="login-remember-label cursor-pointer">로그인 상태 유지</Label>
                    <p className="text-xs text-muted-foreground">
                      체크하지 않으면 10분 뒤 자동 로그아웃됩니다.
                    </p>
                  </div>
                </div>
              </div>

              <Button id="loginBtn" type="submit" className="w-full auth-submit-btn" disabled={submitting}>
                <LogIn size={16} />
                {submitting ? '로그인 중...' : '로그인'}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="auth-footer justify-between border-t border-border/70 pt-4">
            <p className="text-sm text-muted-foreground">처음 방문하셨나요?</p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="auth-secondary-btn" onClick={openResetDialog}>
                <KeyRound size={15} />
                비밀번호 찾기
              </Button>
              <Button asChild variant="outline" size="sm" className="auth-secondary-btn">
                <Link to="/signup">
                  <UserRoundPlus size={15} />
                  회원가입
                </Link>
              </Button>
            </div>
          </CardFooter>
        </Card>
      </motion.div>

      <Dialog
        open={resetOpen}
        onOpenChange={(nextOpen) => {
          setResetOpen(nextOpen);
          if (!nextOpen) {
            setResetSubmitting(false);
          }
        }}
      >
        <DialogContent className="auth-reset-dialog">
          <DialogHeader className="auth-reset-header">
            <DialogTitle>비밀번호 찾기</DialogTitle>
            <DialogDescription>
              가입한 이메일을 입력해 주세요. 계정이 확인되면 비밀번호 재설정 링크를 보내드립니다.
            </DialogDescription>
          </DialogHeader>

          <form className="auth-reset-form mt-4 space-y-4" onSubmit={onResetSubmit}>
            <div className="space-y-2">
              <Label htmlFor="resetEmail" className="auth-label inline-flex items-center gap-2">
                <Mail size={15} />
                이메일
              </Label>
              <Input
                id="resetEmail"
                type="email"
                autoComplete="email"
                required
                className="auth-input"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
              />
            </div>

            {resetMessage.text ? (
              <div
                className={cn(
                  'auth-inline-message',
                  resetMessage.type === 'error' ? 'is-error' : 'is-notice'
                )}
              >
                {resetMessage.text}
              </div>
            ) : null}

            <DialogFooter className="auth-reset-footer">
              <Button type="button" variant="outline" className="auth-secondary-btn" onClick={() => setResetOpen(false)} disabled={resetSubmitting}>
                닫기
              </Button>
              <Button type="submit" className="auth-submit-btn" disabled={resetSubmitting}>
                {resetSubmitting ? '전송 중...' : '재설정 메일 보내기'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      </main>
    </>
  );
}
