# 사입ON

동대문 사입 주문 · 처리 · 수금 정산 웹앱 (PWA). React 19 + Vite + Tailwind 4 + Firebase.

## 실행

```bash
npm install
npm run dev      # 개발 서버
npm run lint     # 타입 검사
npm test         # 도메인 로직 단위 테스트
npm run build    # dist/ 정적 빌드 (GitHub Pages 배포용)
```

`main` 브랜치에 push 하면 `.github/workflows/deploy.yml` 이 타입 검사 · 테스트 · 빌드 후 GitHub Pages 에 배포합니다.

## 역할

| 역할 | 보는 주문 | 주요 화면 |
| --- | --- | --- |
| 관리자 | 전체 | 수금관리, 회원 관리, 대표거래처, 데이터 관리, 건물 목록 |
| 사입삼촌 (서브관리자) | 담당 건물 (서브관리자는 전체) | 주문처리, 갯수 집계, 수금관리 |
| 지방삼촌 | 담당 상인 거래처 (대표거래처로 묶인 상호 포함) | 갯수 집계, 수금관리, 담당 거래처 |
| 상인 | 자기 상호 + 대표거래처로 묶인 상호 | 주문 입력, 빠른주문 |

## 폴더 구조

```
src/
  domain/      화면과 무관한 업무 규칙 (순수 함수, 단위 테스트 대상)
    markets.ts       건물 은어/약어 → 정식명, '디' 호수 판정
    orderParser.ts   카톡 · 신상마켓 텍스트 → 주문 목록
    ledger.ts        대납/입금 구분, 사입비, 중복 판정, 처리 상태 규칙
    groups.ts        대표거래처(종속 상호 묶음), 그룹 검색
    storeGroups.ts   수금관리 · 갯수 집계용 거래처별 합계
    access.ts        역할별 조회 범위
    dates.ts / format.ts / text.ts / excel.ts / keyboard.ts
  data/        Firebase 읽기/쓰기 (저장 형식은 여기서만 다룬다)
  state/       AppContext: 실시간 동기화, 로그인 세션, 저장 액션
  screens/     전체 화면 (로그인, 메인 달력, 주문처리, 갯수 집계, 수금관리, 게시판)
  modals/      팝업 창
  components/  공용 UI
```

## 데이터 (기존 DB와 호환)

같은 Firebase 프로젝트를 쓰는 기존 앱과 데이터를 공유하므로 저장 형식을 바꾸지 않습니다.

| 위치 | 내용 |
| --- | --- |
| RTDB `orders/{YYYY-MM-DD}/{id}` | 주문 · 입금. 필드: 날짜, 상호, 건물명, 층, 호수, 담당, 수량, 반품여부, 대납금, 입금액, 메모, 완료여부, 지역 … |
| RTDB `users/{username}` | 회원 (비밀번호는 SHA-256 해시) |
| RTDB `collectionGroupRules` | 대표거래처 규칙 배열 (Firestore 같은 이름 컬렉션에도 함께 저장) |
| RTDB `board` | 게시판 |
| Firestore `settings/markets_v2` | 건물 목록 |

- 금액은 **천원 단위**로 저장합니다 (15 = 15,000원).
- 입금 건은 `대납금 = -금액`, `입금액 = 금액` 으로 저장하고 읽을 때 한 번만 합산합니다.
- 새로 추가된 선택 필드: `처리비고`, `사입비제외`, `사입비포함`, `구분`. 예전 앱은 이 필드를 무시하므로 함께 써도 안전합니다.
- 화면은 최근 90일치 날짜를 실시간 동기화합니다. 그 이전 기록은 데이터 관리의 백업 · 엑셀 내보내기로 확인합니다.

## 작업 규칙

`AGENTS.md` (동대문 도메인 규칙, UI 원칙)를 먼저 읽으세요.
