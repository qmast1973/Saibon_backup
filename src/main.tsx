import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state/AppContext';
import './index.css';
import { IS_DEMO, seedDemo } from './demo';

/** 예기치 못한 오류가 나도 흰 화면 대신 새로고침 안내를 보여 준다 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: unknown) {
    console.error('App crashed:', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4 text-center">
        <div className="space-y-3">
          <p className="text-sm font-bold text-gray-200">일시적인 오류가 발생했습니다.</p>
          <button type="button" onClick={() => location.reload()} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white">
            새로고침
          </button>
        </div>
      </div>
    );
  }
}

const start = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        {IS_DEMO && (
          <div className="bg-amber-500 px-3 py-1.5 text-center text-xs font-bold text-gray-950">
            미리보기 · 예시 데이터이며 실제 DB에 연결되지 않습니다 (입력 내용은 저장되지 않음)
          </div>
        )}
        <App />
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);

if (IS_DEMO) seedDemo().then(start);
else start();
