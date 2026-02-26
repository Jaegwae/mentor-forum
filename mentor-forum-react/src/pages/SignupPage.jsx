// Signup page with validation and nickname uniqueness check.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CircleCheck, Eye, EyeOff, KeyRound, Mail, UserPlus2, UserRound } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta.js';
import { useTheme } from '../hooks/useTheme.js';
import {
  auth,
  db,
  ensureFirebaseConfigured,
  createUserWithEmailAndPassword,
  deleteUser,
  sendEmailVerification,
  serverTimestamp,
  doc,
  getDoc,
  runTransaction,
  signOut
} from '../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../legacy/config.js';
import { cn } from '../lib/utils.js';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Label } from '../components/ui/label.jsx';
import { ThemeToggle } from '../components/ui/theme-toggle.jsx';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmailValid(email) {
  const value = normalizeEmail(email);
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPasswordStrong(password) {
  return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/.test(String(password || ''));
}

function isPasswordMatch(password, passwordConfirm) {
  return String(password || '') !== '' && String(password || '') === String(passwordConfirm || '');
}


function validatePassword(password, passwordConfirm) {
  if (!isPasswordStrong(password)) {
    return '비밀번호는 영문, 숫자, 특수문자를 포함한 8자 이상이어야 합니다.';
  }
  if (!isPasswordMatch(password, passwordConfirm)) {
    return '비밀번호 확인이 일치하지 않습니다.';
  }
  return '';
}

function normalizeNickname(value) {
  return String(value || '').trim();
}

function buildNicknameKey(value) {
  const normalized = normalizeNickname(value);
  if (!normalized) return '';
  return encodeURIComponent(normalized.toLowerCase());
}

async function isNicknameAvailable(nicknameValue) {
  const nicknameKey = buildNicknameKey(nicknameValue);
  if (!nicknameKey) return false;

  const snap = await getDoc(doc(db, 'nickname_index', nicknameKey));
  return !snap.exists();
}

export default function SignupPage() {
  usePageMeta('멘토포럼 회원가입', 'auth-page');

  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  // Auth pages only support light/dark. Force-downgrade excel to light.
  useEffect(() => {
    if (theme === 'excel') setTheme('light');
  }, [theme, setTheme]);

  const [email, setEmail] = useState('');
  const [realName, setRealName] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [nicknameCheck, setNicknameCheck] = useState({
    status: 'idle',
    text: '',
    checkedValue: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [ready, setReady] = useState(false);
  // Sequence guard to ignore stale nickname-check responses when user types quickly.
  const nicknameCheckSeqRef = useRef(0);

  // Password reveal is "press-and-hold" so the value is not left exposed after a click.
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

  useEffect(() => {
    try {
      ensureFirebaseConfigured();
      setReady(true);
    } catch (err) {
      setReady(false);
      setMessage({ type: 'error', text: err.message || 'Firebase 설정 오류' });
    }
  }, []);


  const passwordRule = useMemo(() => {
    if (!password) {
      return { text: '영문 + 숫자 + 특수문자를 포함한 8자 이상이어야 합니다.', tone: 'neutral' };
    }
    if (isPasswordStrong(password)) {
      return { text: '사용 가능한 비밀번호입니다.', tone: 'ok' };
    }
    return { text: '영문/숫자/특수문자를 모두 포함해 8자 이상 입력하세요.', tone: 'bad' };
  }, [password]);

  const passwordMatch = useMemo(() => {
    if (!passwordConfirm) {
      return { text: '비밀번호 확인을 입력해 주세요.', tone: 'neutral' };
    }
    if (isPasswordMatch(password, passwordConfirm)) {
      return { text: '비밀번호가 일치합니다.', tone: 'ok' };
    }
    return { text: '비밀번호가 다릅니다.', tone: 'bad' };
  }, [password, passwordConfirm]);

  const formValid = useMemo(() => {
    const normalized = normalizeEmail(email);
    return (
      !!normalized
      && isEmailValid(normalized)
      && !!String(realName || '').trim()
      && !!String(nickname || '').trim()
      && isPasswordStrong(password)
      && isPasswordMatch(password, passwordConfirm)
    );
  }, [email, realName, nickname, password, passwordConfirm]);

  const helperToneClass = (tone) => {
    if (tone === 'ok') return 'text-emerald-700';
    if (tone === 'bad') return 'text-red-700';
    return 'text-muted-foreground';
  };

  const nicknameCheckToneClass = (status) => {
    if (status === 'available') return 'text-emerald-700';
    if (status === 'checking') return 'text-muted-foreground';
    return 'text-red-700';
  };

  const checkNicknameAvailability = async (nicknameValue, options = {}) => {
    const { showChecking = true } = options;
    const cleanNickname = normalizeNickname(nicknameValue);
    const requestId = nicknameCheckSeqRef.current + 1;
    nicknameCheckSeqRef.current = requestId;

    if (!cleanNickname) {
      setNicknameCheck({
        status: 'unavailable',
        text: '사용 불가능한 닉네임 입니다.',
        checkedValue: ''
      });
      return { available: false, cleanNickname: '' };
    }

    if (showChecking) {
      setNicknameCheck({
        status: 'checking',
        text: '닉네임을 확인하는 중입니다...',
        checkedValue: cleanNickname
      });
    }

    let available = false;
    try {
      available = await isNicknameAvailable(cleanNickname);
    } catch (err) {
      if (requestId === nicknameCheckSeqRef.current) {
        setNicknameCheck({
          status: 'error',
          text: '닉네임 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
          checkedValue: cleanNickname
        });
      }
      throw err;
    }
    if (requestId !== nicknameCheckSeqRef.current) {
      // Newer check request has already been started; discard this stale response.
      return { available: false, cleanNickname, stale: true };
    }

    if (available) {
      setNicknameCheck({
        status: 'available',
        text: '사용 가능한 닉네임입니다.',
        checkedValue: cleanNickname
      });
      return { available: true, cleanNickname };
    }

    setNicknameCheck({
      status: 'unavailable',
      text: '사용 불가능한 닉네임 입니다.',
      checkedValue: cleanNickname
    });
    return { available: false, cleanNickname };
  };

  const onCheckNickname = async () => {
    setMessage({ type: '', text: '' });
    try {
      await checkNicknameAvailability(nickname, { showChecking: true });
    } catch (_) {
      setNicknameCheck({
        status: 'error',
        text: '닉네임 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        checkedValue: normalizeNickname(nickname)
      });
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setMessage({ type: '', text: '' });
    setEmailError('');

    if (!formValid) {
      setMessage({ type: 'error', text: '입력값을 모두 올바르게 입력한 뒤 다시 시도해주세요.' });
      return;
    }

    const normalizedEmail = normalizeEmail(email);
    const cleanRealName = String(realName || '').trim();
    const cleanNickname = normalizeNickname(nickname);

    const passwordError = validatePassword(password, passwordConfirm);
    if (passwordError) {
      setMessage({ type: 'error', text: passwordError });
      return;
    }

    setSubmitting(true);
    try {
      const nicknameResult = await checkNicknameAvailability(cleanNickname, { showChecking: true });
      if (!nicknameResult.available) {
        return;
      }

      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      const user = credential.user;
      const nicknameKey = buildNicknameKey(cleanNickname);

      try {
        // Claim profile + nickname index atomically to prevent duplicate nickname race conditions.
        await runTransaction(db, async (tx) => {
          const userRef = doc(db, 'users', user.uid);
          const nicknameRef = doc(db, 'nickname_index', nicknameKey);
          const nicknameSnap = await tx.get(nicknameRef);

          if (nicknameSnap.exists()) {
            const dupErr = new Error('nickname already in use');
            dupErr.code = 'nickname-already-in-use';
            throw dupErr;
          }

          tx.set(userRef, {
            uid: user.uid,
            email: normalizedEmail,
            realName: cleanRealName,
            nickname: cleanNickname,
            role: MENTOR_FORUM_CONFIG.app.defaultRole,
            emailVerified: !!user.emailVerified,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          tx.set(nicknameRef, {
            uid: user.uid,
            nickname: cleanNickname,
            nicknameKey,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
      } catch (txErr) {
        const txCode = txErr && txErr.code ? String(txErr.code) : '';
        if (txCode.includes('nickname-already-in-use')) {
          setNicknameCheck({
            status: 'unavailable',
            text: '사용 불가능한 닉네임 입니다.',
            checkedValue: cleanNickname
          });
          try {
            await deleteUser(user);
          } catch (_) {
            await signOut(auth);
          }
          return;
        }
        throw txErr;
      }

      await sendEmailVerification(user);
      await signOut(auth);

      setMessage({ type: 'notice', text: '회원가입이 완료되었습니다. 이메일 인증 링크를 확인한 뒤 로그인해주세요. 메일이 보이지 않으면 스팸메일함도 확인해주세요.' });
      window.setTimeout(() => {
        navigate(MENTOR_FORUM_CONFIG.app.loginPage, { replace: true });
      }, 1700);
    } catch (err) {
      const code = err && err.code ? String(err.code) : '';
      if (code.includes('email-already-in-use')) {
        setEmailError('이미 가입된 이메일이 있습니다.');
        return;
      }
      setMessage({ type: 'error', text: (err && err.message) ? err.message : '회원가입에 실패했습니다.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <main className="page auth-page-wrap flex min-h-[calc(100vh-2rem)] items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: 'easeOut' }}
        className="mx-auto w-full max-w-[760px]"
      >
        <Card className="auth-card auth-signup-card border-primary/20">
          <CardHeader className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="hero-kicker"><UserPlus2 size={15} /> Welcome</p>
                <CardTitle>회원가입</CardTitle>
              </div>
              <div className="auth-head-actions flex flex-wrap items-center justify-end gap-2">
                <ThemeToggle className="theme-toggle-auth" />
                <Button asChild variant="outline" size="sm" className="auth-secondary-btn">
                  <Link to="/login">로그인으로 이동</Link>
                </Button>
              </div>
            </div>
            <CardDescription className="text-sm">
              가입 후 인증 링크가 이메일로 전송됩니다. 메일 인증을 완료하면 로그인할 수 있으며 기본 등급은
              <strong className="ml-1">Newbie(새싹)</strong>입니다.
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
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="email" className="auth-label inline-flex items-center gap-2">
                    <Mail size={15} />
                    이메일
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    aria-invalid={emailError ? 'true' : 'false'}
                    className={cn('auth-input', emailError ? 'border-red-500 focus-visible:ring-red-300' : '')}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (emailError) setEmailError('');
                    }}
                  />
                  {emailError ? (
                    <p className="text-xs font-medium text-red-600">
                      {emailError}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    이메일 인증번호 입력 없이 Firebase 기본 인증 메일 링크로 인증합니다.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="realName" className="auth-label inline-flex items-center gap-2">
                    <UserRound size={15} />
                    실명
                  </Label>
                  <Input
                    id="realName"
                    type="text"
                    maxLength={30}
                    required
                    className="auth-input"
                    value={realName}
                    onChange={(event) => setRealName(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nickname" className="auth-label inline-flex items-center gap-2">
                    <UserRound size={15} />
                    닉네임
                  </Label>
                  <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    <Input
                      id="nickname"
                      type="text"
                      maxLength={20}
                      required
                      value={nickname}
                      className="auth-input min-w-0 flex-1"
                      aria-invalid={nicknameCheck.status === 'unavailable' ? 'true' : 'false'}
                      onChange={(event) => {
                        const next = event.target.value;
                        setNickname(next);
                        const cleanNext = normalizeNickname(next);
                        if (cleanNext !== nicknameCheck.checkedValue) {
                          nicknameCheckSeqRef.current += 1;
                          setNicknameCheck({
                            status: 'idle',
                            text: '',
                            checkedValue: ''
                          });
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="auth-secondary-btn h-10 shrink-0 px-3"
                      disabled={!ready || submitting || nicknameCheck.status === 'checking' || !normalizeNickname(nickname)}
                      onClick={() => {
                        void onCheckNickname();
                      }}
                    >
                      {nicknameCheck.status === 'checking' ? '확인 중...' : '중복확인'}
                    </Button>
                  </div>
                  {nicknameCheck.text ? (
                    <p className={cn('text-xs font-medium', nicknameCheckToneClass(nicknameCheck.status))}>
                      {nicknameCheck.text}
                    </p>
                  ) : null}
                </div>

              <div className="space-y-2">
                  <Label htmlFor="password" className="auth-label inline-flex items-center gap-2">
                    <KeyRound size={15} />
                    비밀번호
                  </Label>
                  <div className="auth-input-wrap">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
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
                  <p className={cn('text-xs font-medium', helperToneClass(passwordRule.tone))}>
                    {passwordRule.text}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="passwordConfirm" className="auth-label inline-flex items-center gap-2">
                    <CircleCheck size={15} />
                    비밀번호 확인
                  </Label>
                  <Input
                    id="passwordConfirm"
                    type="password"
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                    required
                    className="auth-input"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                  />
                  <p className={cn('text-xs font-medium', helperToneClass(passwordMatch.tone))}>
                    {passwordMatch.text}
                  </p>
                </div>
              </div>

              <Button type="submit" className="w-full md:w-auto auth-submit-btn" disabled={!ready || !formValid || submitting}>
                {submitting ? '가입 중...' : '회원가입 완료'}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="auth-footer border-t border-border/70 pt-4">
            <p className="text-xs text-muted-foreground">
              회원가입 후에는 인증 메일 확인이 반드시 필요합니다.
            </p>
          </CardFooter>
        </Card>
      </motion.div>
      </main>
    </>
  );
}
