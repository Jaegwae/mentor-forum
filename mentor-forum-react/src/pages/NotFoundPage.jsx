// Fallback page shown for unknown routes.
import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Compass, Home, LogIn } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta.js';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';

export default function NotFoundPage() {
  usePageMeta('페이지를 찾을 수 없음', 'auth-page');

  return (
    <main className="page auth-page-wrap flex min-h-[calc(100vh-2rem)] items-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="mx-auto w-full max-w-[540px]"
      >
        <Card className="auth-card border-primary/20">
          <CardHeader className="space-y-2">
            <p className="hero-kicker"><Compass size={15} /> Not Found</p>
            <CardTitle>페이지를 찾을 수 없습니다.</CardTitle>
            <p className="hero-copy">주소를 다시 확인하거나 아래 메뉴를 이용해 이동해 주세요.</p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/app">
                <Home size={15} />
                포럼으로 이동
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/login">
                <LogIn size={15} />
                로그인으로 이동
              </Link>
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </main>
  );
}
