import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { fuzzyIncludes } from '../domain/text';
import { EmptyState, Input, Modal } from '../components/ui';

const TOPICS: { title: string; who: string; body: string[] }[] = [
  {
    title: '달력과 날짜',
    who: '전체',
    body: [
      '날짜 칸의 숫자는 그날 주문 건수입니다. 날짜를 누르면 오른쪽(모바일은 아래)에 그날 내역이 나옵니다.',
      '새벽 7시 전까지는 전날 장사로 계산합니다. "오늘" 버튼도 이 기준을 따릅니다.',
      '공휴일은 빨간색, 연휴는 "설날 (~12일)"처럼 끝나는 날짜가 같이 표시됩니다.',
    ],
  },
  {
    title: '주문 입력',
    who: '전체',
    body: [
      '"신규 입력"에서 상호를 고르고 건물 · 층 · 호수를 줄마다 입력합니다. 줄은 "줄 추가"로 늘릴 수 있습니다.',
      '건물명은 은어도 됩니다: 청평 → 청평화, 제평 → 제일평화, 럭스 → APM럭스, 초성(ㅊㅍㅎ)도 인식합니다.',
      '"디" 또는 "d"는 호수로 구분합니다. 호수에 영문/한글이 있으면 디오트(f10, 가-10), 숫자만 있으면 디자이너(1-10, 15).',
      '같은 날 · 같은 상호 · 같은 매장 주문이 이미 있으면 알려 주고, 중복만 빼고 등록할 수 있습니다.',
      '주문 접수는 아침 7시 ~ 새벽 2시입니다 (관리자 제외).',
    ],
  },
  {
    title: '빠른주문 (카톡 붙여넣기)',
    who: '전체',
    body: [
      '카톡 · 문자 · 신상마켓 요청서를 통째로 붙여넣으면 건물 · 층 · 호수 · 도매처가 자동으로 나뉩니다.',
      '맨 윗줄이나 "소매명 :" 줄의 상호를 소매 상호로 씁니다. 잘못 나뉜 칸은 바로 고칠 수 있습니다.',
      '"블루문/디오트/3층/12호", "디 3-12 바지 2장", "APM / 2층 18 / 도매상호 / 대납" 형식 모두 됩니다.',
    ],
  },
  {
    title: '주문처리 (사입삼촌)',
    who: '사입삼촌 · 관리자',
    body: [
      '담당 건물 주문만 건물 → 층 → 호수 순으로 나옵니다. 건물 · 층으로 걸러서 동선대로 처리하세요.',
      '완료처리(주문찾기/샘플/주문없음/물건없음), 미송(올미송/미송찾기), 반품(교환/반품만/반송/교환매입/매입처리) 중 선택합니다. 같은 버튼을 다시 누르면 처리 대기로 돌아갑니다.',
      '반품 버튼은 "반품 있음"을 체크해야 열립니다. 대납금 · 물건갯수 · 처리 메모는 입력 후 엔터(또는 다른 곳 누르기)하면 바로 저장됩니다.',
      '새 주문이 들어오면 화면 위에 알림이 뜹니다. 엑셀 저장은 지금 걸러진 목록만 저장합니다.',
    ],
  },
  {
    title: '갯수 집계',
    who: '사입삼촌 · 관리자',
    body: ['처리 상태별 건수와 물건 갯수 합계를 봅니다. 카드를 누르면 그 상태만 걸러지고, 아래 표는 대표 거래처별 소계입니다.'],
  },
  {
    title: '수금관리',
    who: '관리자 · 삼촌',
    body: [
      '날짜별로 대표 거래처 단위 청구액(대납 + 사입비) · 입금 · 미수금을 봅니다. 행을 누르면 상세 내역이 열립니다.',
      '사입비는 완료된 주문 1건당 4,000원입니다. 월사입 거래처는 빠집니다. 설정에서 사입비 계산을 끌 수 있습니다.',
      '상세 내역의 "미처리 전환 / 완료 처리"는 사입비 부과 여부만 바꿉니다 (사입삼촌 처리 상태는 그대로).',
      '"수금 입력"에서 온라인 입금과 현금 수금을 나눠 적습니다. 입금액을 넣으면 남은 금액이 수금칸에 자동으로 채워집니다.',
    ],
  },
  {
    title: '대표거래처 묶기',
    who: '상인 제외',
    body: [
      '여러 상호(지점)를 대표 거래처 하나로 묶으면 수금 · 검색 · 상인 화면이 합쳐집니다.',
      '"앞글자 일치"로 묶으면 그 이름으로 시작하는 상호가 모두 포함됩니다.',
      '대표 거래처별로 월사입(건당 사입비 제외)을 켤 수 있습니다.',
    ],
  },
  {
    title: '회원 · 권한',
    who: '관리자',
    body: [
      '회원가입 후 관리자가 승인해야 로그인할 수 있습니다. 승인을 취소하면 그 회원은 바로 로그아웃됩니다.',
      '사입삼촌은 담당 건물, 지방삼촌은 담당 거래처를 지정해야 주문이 보입니다. 서브관리자는 전체 주문을 봅니다.',
      '비밀번호를 잊은 회원은 "임시 비번"으로 새 비밀번호를 발급해 전달하세요.',
    ],
  },
  {
    title: '데이터 · 백업',
    who: '관리자 · 서브관리자',
    body: [
      '엑셀 가져오기는 날짜 · 담당자를 확인한 뒤 이미 있는 주문은 건너뛰고 등록합니다.',
      '백업 파일에는 전체 주문과 대표거래처가 들어갑니다. 큰 작업 전에는 꼭 백업하세요.',
      '화면은 최근 90일치 날짜를 실시간으로 보여 줍니다. 그 이전 기록은 백업 · 엑셀 내보내기로 확인합니다.',
    ],
  },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const shown = TOPICS.filter(t => !q.trim() || fuzzyIncludes([t.title, t.who, ...t.body].join(' '), q));
  return (
    <Modal title="도움말" icon={<BookOpen className="h-5 w-5 text-emerald-400" />} onClose={onClose} size="lg">
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder="찾을 기능 (예: 수금, 디오트, 반품)" className="mb-3" autoFocus />
      <div className="space-y-3">
        {shown.length === 0 && <EmptyState>검색 결과가 없습니다.</EmptyState>}
        {shown.map(t => (
          <section key={t.title} className="rounded-xl border border-gray-800 bg-gray-950 p-3">
            <h4 className="text-sm font-bold text-gray-100">{t.title} <span className="ml-1 text-[11px] font-normal text-gray-500">{t.who}</span></h4>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-gray-300">
              {t.body.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
