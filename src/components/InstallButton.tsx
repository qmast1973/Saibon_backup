import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Modal } from './ui';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
declare global {
  interface Window {
    __pwaPrompt?: InstallPromptEvent | null;
  }
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** 홈 화면에 앱 설치. 이미 설치된 앱 안에서는 보이지 않는다. */
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(() => window.__pwaPrompt ?? null);
  const [installed, setInstalled] = useState(isStandalone);
  const [guide, setGuide] = useState(false);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onReady = () => setPrompt(window.__pwaPrompt ?? null);
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('pwa-prompt-ready', onReady);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('pwa-prompt-ready', onReady);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!prompt) return setGuide(true);
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    window.__pwaPrompt = null;
    setPrompt(null);
  };

  return (
    <>
      <button type="button" onClick={install} className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-sky-500 sm:text-xs">
        <Download className="h-3.5 w-3.5" />
        <span>앱 설치</span>
      </button>
      {guide && (
        <Modal title="홈 화면에 앱 추가" onClose={() => setGuide(false)} size="sm" z="z-[400]">
          {isIOS ? (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-300">
              <li><b>Safari</b> 브라우저로 열어 주세요. (카카오톡이면 ⋮ → 'Safari로 열기')</li>
              <li>화면 아래 <b>공유 버튼</b>(네모 위 화살표)을 누릅니다.</li>
              <li><b>홈 화면에 추가</b>를 누르면 바로가기 앱이 생깁니다.</li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-300">
              <li><b>크롬</b> 브라우저로 열어 주세요.</li>
              <li>오른쪽 위 <b>⋮ 메뉴</b>를 누릅니다.</li>
              <li><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누릅니다.</li>
            </ol>
          )}
        </Modal>
      )}
    </>
  );
}
