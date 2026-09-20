import React, { useMemo, useState } from 'react';
import { Transaction, User, CollectionGroupRule } from '../types';
import { formatMoney, normalizeDateStr } from '../lib/firebase';
import { getCollectionBillingStore, sortTransactionsBySubStoreClick } from '../lib/groupRules';
import { formatRoomDisplay } from '../lib/orderParser';
import { ChevronLeft, ChevronRight, CalendarCheck, Plus, Edit, Trash2, CheckCircle2, Sparkles, Layers, X } from 'lucide-react';
import Holidays from 'date-holidays';

interface CalendarViewProps {
  currentDate: Date;
  selectedDateStr: string;
  transactions: Transaction[];
  currentUser: User | null;
  collectionGroupRules?: CollectionGroupRule[];
  onSelectDate: (dateStr: string, hasData: boolean) => void;
  onChangeMonth: (delta: number) => void;
  onGoToToday: () => void;
  onOpenAddModal: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onCompleteTransaction: (id: string) => void;
  onImportOrders?: (orders: Transaction[]) => void;
  onOpenAiModal?: () => void;
  onOpenWorkdayStats?: () => void;
}

export const CalendarView: React.FC<CalendarViewProps> = React.memo(({
  currentDate,
  selectedDateStr,
  transactions,
  currentUser,
  collectionGroupRules = [],
  onSelectDate,
  onChangeMonth,
  onGoToToday,
  onOpenAddModal,
  onEditTransaction,
  onDeleteTransaction,
  onCompleteTransaction,
  onImportOrders,
  onOpenAiModal,
  onOpenWorkdayStats
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [selectedSubSortStore, setSelectedSubSortStore] = useState<string | null>(null);


  const isMerchant = currentUser?.role === 'merchant';
  const isBuyer = currentUser?.role === 'buyer';

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayIndex = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const prevLastDate = new Date(year, month, 0).getDate();

  const krHolidays = useMemo(() => {
    const hd = new Holidays('KR', { languages: ['ko'] });
    const h = hd.getHolidays(year);
    const map: Record<string, string> = {};
    
    const rawHolidays: { dateStr: string; name: string; dateObj: Date }[] = [];
    
    h.forEach(holiday => {
      if (holiday.type === 'public') {
        let current = new Date(holiday.start);
        const endDate = new Date(holiday.end);
        
        while (current < endDate) {
          const kstDate = new Date(current.getTime() + (9 * 60 * 60 * 1000));
          const y = kstDate.getUTCFullYear();
          const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
          const d = String(kstDate.getUTCDate()).padStart(2, '0');
          
          rawHolidays.push({ 
            dateStr: `${y}-${m}-${d}`, 
            name: holiday.name, 
            dateObj: new Date(y, kstDate.getUTCMonth(), kstDate.getUTCDate()) 
          });
          current.setDate(current.getDate() + 1);
        }
      }
    });
    
    rawHolidays.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
    
    const groups: typeof rawHolidays[] = [];
    let currentGroup: typeof rawHolidays = [];
    
    rawHolidays.forEach((item) => {
      if (currentGroup.length === 0) {
        currentGroup.push(item);
      } else {
        const lastItem = currentGroup[currentGroup.length - 1];
        const diff = (item.dateObj.getTime() - lastItem.dateObj.getTime()) / (1000 * 60 * 60 * 24);
        
        if (diff === 1) {
          currentGroup.push(item);
        } else if (diff === 0) {
          // Overwrite with the later one (usually substitute holiday is more specific)
          currentGroup[currentGroup.length - 1] = item;
        } else {
          groups.push(currentGroup);
          currentGroup = [item];
        }
      }
    });
    if (currentGroup.length > 0) groups.push(currentGroup);
    
    groups.forEach(group => {
      if (group.length > 1) {
        const lastDayStr = group[group.length - 1].dateStr;
        const lastDayNum = parseInt(lastDayStr.split('-')[2], 10);
        group.forEach((item) => {
          let baseName = item.name.replace(/ \(대체공휴일\)/g, '');
          map[item.dateStr] = `${baseName} (~${lastDayNum}일)`;
        });
      } else {
        map[group[0].dateStr] = group[0].name;
      }
    });
    
    return map;
  }, [year]);


  // Aggregate stats per day - Memoized
  const dayMap = useMemo(() => {
    const map: Record<string, { count: number; expense: number; income: number }> = {};
    for (let i = 0; i < transactions.length; i++) {
      const t = transactions[i];
      const d = t.date || normalizeDateStr(t.businessDate);
      if (!d) continue;
      if (!map[d]) {
        map[d] = { count: 0, expense: 0, income: 0 };
      }
      map[d].count += 1;
      if (t.recordType !== 'receivable') {
        const exp = Number(t.expense) || 0;
        const inc = Number(t.income) || 0;
        const billed = exp > 0 ? exp : 0;
        const paid = (exp < 0 ? Math.abs(exp) : 0) + (inc > 0 ? inc : 0);
        map[d].expense += billed;
        map[d].income += paid;
      }
    }
    return map;
  }, [transactions]);

  // Selected Day Transactions - Memoized (종속거래처 클릭 시 정렬 지원)
  const dayTxs = useMemo(() => {
    const raw = transactions.filter(t => (t.date || normalizeDateStr(t.businessDate)) === selectedDateStr);
    if (selectedSubSortStore) {
      return sortTransactionsBySubStoreClick(raw, selectedSubSortStore, collectionGroupRules);
    }
    return raw;
  }, [transactions, selectedDateStr, selectedSubSortStore, collectionGroupRules]);

  const financialDayTxs = useMemo(() => {
    return dayTxs.filter(t => t.recordType !== 'receivable');
  }, [dayTxs]);

  const dayExpense = useMemo(() => {
    return financialDayTxs.reduce((sum, t) => {
      const exp = Number(t.expense) || 0;
      return sum + (exp > 0 ? exp : 0);
    }, 0);
  }, [financialDayTxs]);

  const dayIncome = useMemo(() => {
    return financialDayTxs.reduce((sum, t) => {
      const exp = Number(t.expense) || 0;
      const inc = Number(t.income) || 0;
      return sum + (exp < 0 ? Math.abs(exp) : 0) + (inc > 0 ? inc : 0);
    }, 0);
  }, [financialDayTxs]);
  /*
  // [사용자 요청 비활성화] 달력 스와이프 월 이동 기능 주석 처리 (스크롤/터치 오작동 방지)
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEndX(null);
    setTouchStartX(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEndX(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (touchStartX === null || touchEndX === null) return;
    const distance = touchStartX - touchEndX;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    
    if (isLeftSwipe) {
      onChangeMonth(1);
    } else if (isRightSwipe) {
      onChangeMonth(-1);
    }
  };
  */

  return (
    <section className="flex-1 flex flex-col lg:flex-row gap-4">
      {/* Left: Monthly Calendar Grid */}
      <div 
        className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 flex flex-col"
        /*
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        */
      >
        {/* Month Header & Nav */}
        <div className="flex flex-col gap-2.5 mb-4">
          {/* Row 1: Month Title & Month Nav (월 표시 행과 같은 행에 우측 정렬) */}
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              {year}년 {String(month + 1).padStart(2, '0')}월
            </h2>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onChangeMonth(-1)}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 transition"
                title="이전 달"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onChangeMonth(1)}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 transition"
                title="다음 달"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onGoToToday}
                className="h-8 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-bold transition"
              >
                오늘
              </button>
            </div>
          </div>

          {/* Row 2: Action Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              type="button"
              onClick={onOpenAiModal}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 h-8 rounded-xl flex items-center gap-1 transition shadow-sm"
              title="AI로 텍스트에서 주문 자동 추출"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">빠른주문</span>
            </button>
            <button
              type="button"
              id="selectedDayAddButton"
              onClick={onOpenAddModal}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-3 h-8 rounded-xl flex items-center gap-1 transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isMerchant ? '주문 추가' : '신규 입력'}</span>
            </button>
            {(currentUser?.role === 'buyer' || currentUser?.role === 'admin') && (
              <button
                type="button"
                onClick={onOpenWorkdayStats}
                className="w-[88px] h-[35px] rounded-xl bg-pink-50 hover:bg-pink-100 border border-pink-200 text-pink-700 text-[15px] leading-[18px] font-bold text-center flex items-center justify-center gap-1 transition"
              >
                <span>📊</span> 갯수 집계
              </button>
            )}
          </div>
        </div>

        {/* Days of Week */}
        <div className="grid grid-cols-7 gap-1 text-center font-bold text-xs py-2 border-b border-slate-200 mb-1.5">
          <div className="text-rose-500">일</div>
          <div className="text-slate-600">월</div>
          <div className="text-slate-600">화</div>
          <div className="text-slate-600">수</div>
          <div className="text-slate-600">목</div>
          <div className="text-slate-600">금</div>
          <div className="text-blue-500">토</div>
        </div>

        {/* Grid Cells */}
        <div id="calendarGrid" className="grid grid-cols-7 gap-1 sm:gap-1.5 flex-1 min-h-[340px] sm:min-h-[420px]">
          {/* Previous month filler */}
          {Array.from({ length: firstDayIndex }).map((_, i) => {
            const d = prevLastDate - (firstDayIndex - 1 - i);
  return (
              <div key={`prev-${i}`} className="relative bg-slate-50/50 rounded-xl min-h-[56px] sm:min-h-[72px] border border-slate-100">
                <span className="absolute top-1.5 left-1.5 font-medium text-slate-300 text-[13px] sm:text-[15px] leading-none">{d}</span>
              </div>
            );
          })}

          {/* Current month days */}
          {Array.from({ length: lastDate }).map((_, i) => {
            const d = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const holidayName = krHolidays[dateStr];
            const dayData = dayMap[dateStr] || { count: 0, expense: 0, income: 0 };
            const isSelected = dateStr === selectedDateStr;
            const dayOfWeek = new Date(year, month, d).getDay();

            let dateColor = 'text-slate-800';
            if (dayOfWeek === 0 || holidayName) dateColor = 'text-rose-600';
            else if (dayOfWeek === 6) dateColor = 'text-blue-600';
  return (
              <div
                key={dateStr}
                onClick={() => onSelectDate(dateStr, dayData.count > 0)}
                className={`relative rounded-xl p-1.5 sm:p-2 min-h-[56px] sm:min-h-[72px] border transition cursor-pointer flex flex-col items-end justify-end ${
                  isSelected
                    ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-400 shadow-sm z-10'
                    : dayData.count > 0
                    ? 'bg-white hover:bg-slate-50 border-slate-300 shadow-xs'
                    : 'bg-white/60 hover:bg-slate-50 border-slate-200'
                }`}
              >
                <div className={`absolute top-1 left-1.5 flex flex-col items-start ${dateColor}`}>
                  <span className="font-black text-[13px] sm:text-[15px] leading-none">{d}</span>
                  {holidayName && (
                    <span className="text-[9px] font-bold leading-none tracking-tight mt-0.5 max-w-[40px] sm:max-w-[60px] truncate opacity-80" title={holidayName}>
                      {holidayName}
                    </span>
                  )}
                </div>
                
                {dayData.count > 0 && (
                  <span className="bg-indigo-100 text-indigo-700 text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded-md mt-4 shadow-sm">
                    {dayData.count}건
                  </span>
                )}
              </div>
            );
          })}

          {/* Next month filler */}
          {(() => {
            const totalRendered = firstDayIndex + lastDate;
            const nextDays = (7 - (totalRendered % 7)) % 7;
            return Array.from({ length: nextDays }).map((_, i) => (
              <div key={`next-${i}`} className="relative bg-slate-50/50 rounded-xl min-h-[56px] sm:min-h-[72px] border border-slate-100">
                <span className="absolute top-1.5 left-1.5 font-medium text-slate-300 text-[13px] sm:text-[15px] leading-none">{i + 1}</span>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* Right: Selected Day Details Panel */}
      <div className="w-full lg:w-96 bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5 flex flex-col gap-4">
        {/* Day Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-indigo-600" />
            <h3 id="selectedDateTitle" className="font-bold text-slate-800 text-sm">
              {selectedDateStr} 사입 내역
            </h3>
          </div>
        </div>

        {/* Day Stat Summary */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex justify-around text-center text-xs">
          <div>
            <span className="text-slate-400 block text-[11px]">대납 합계</span>
            <span className="font-bold text-rose-600 text-sm">{formatMoney(dayExpense)}</span>
          </div>
          <div className="border-r border-slate-200"></div>
          <div>
            <span className="text-slate-400 block text-[11px]">입금 합계</span>
            <span className="font-bold text-blue-600 text-sm">{formatMoney(dayIncome)}</span>
          </div>
          <div className="border-r border-slate-200"></div>
          <div>
            <span className="text-slate-400 block text-[11px]">주문 건수</span>
            <span className="font-bold text-slate-800 text-sm">{dayTxs.length}건</span>
          </div>
        </div>

        {/* Subordinate Store Sort Info Banner */}
        {selectedSubSortStore && (
          <div className="mb-2.5 p-2 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-between text-xs animate-fadeIn">
            <div className="flex items-center gap-1.5 text-violet-900 font-bold min-w-0">
              <Layers className="w-3.5 h-3.5 text-violet-600 shrink-0" />
              <span className="truncate">
                '{selectedSubSortStore}' 연계 그룹 최상단 정렬 (1순위: 대표그룹, 2순위: 상호 가나다순)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSubSortStore(null)}
              className="text-violet-600 hover:text-violet-800 p-1 rounded-md hover:bg-violet-100 transition shrink-0 flex items-center gap-0.5 text-[11px] font-bold"
              title="정렬 해제"
            >
              <X className="w-3.5 h-3.5" />
              <span>해제</span>
            </button>
          </div>
        )}

        {/* Selected Day Transaction Items */}
        <div id="dayTransactionsList" className="flex-1 overflow-y-auto space-y-2.5 max-h-[500px] pr-1">
          {dayTxs.length === 0 ? (
            <div className="text-center py-14 text-slate-400 text-xs">
              <CalendarCheck className="w-8 h-8 text-slate-300 mx-auto mb-2 opacity-50" />
              선택된 일자의 거래 내역이 없습니다.
              <button
                type="button"
                onClick={onOpenAddModal}
                className="mt-3 block mx-auto px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm transition"
              >
                + {isMerchant ? '주문 추가하기' : '주문 입력하기'}
              </button>
            </div>
          ) : (
            dayTxs.map(t => {
              const isCompleted = (t.status || '').trim() === '완료';
              const repStore = collectionGroupRules.length > 0 ? getCollectionBillingStore(t.store, collectionGroupRules) : '';
              const isSubordinate = repStore && repStore !== t.store;
              const isStoreActiveInSort = selectedSubSortStore === t.store || selectedSubSortStore === repStore;
  return (
                <div
                  key={t.id}
                  className={`p-3 rounded-xl border text-xs flex flex-col gap-1.5 transition ${
                    isCompleted ? 'bg-emerald-50/40 border-emerald-200' : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200'
                  } ${isStoreActiveInSort ? 'ring-2 ring-violet-400/50' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setSelectedSubSortStore(prev => prev === t.store ? null : t.store)}
                        className="font-bold text-slate-800 text-sm hover:text-indigo-600 hover:underline transition cursor-pointer text-left"
                        title="클릭 시 이 거래처 및 연계 그룹 최상단 정렬"
                      >
                        {t.store || '미지정 상호'}
                      </button>
                      {isSubordinate && (
                        <button
                          type="button"
                          onClick={() => setSelectedSubSortStore(prev => prev === t.store ? null : t.store)}
                          className="bg-violet-100 hover:bg-violet-200 text-violet-800 border border-violet-200 text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5 shadow-2xs transition cursor-pointer" 
                          title={`대표 거래처: ${repStore} (클릭 시 대표그룹 최상단 정렬)`}
                        >
                          <Layers className="w-2.5 h-2.5 text-violet-600" />
                          <span>대표: {repStore}</span>
                        </button>
                      )}
                      {t.manager && (
                        <span className="bg-indigo-100 text-indigo-800 text-[10px] px-1.5 py-0.5 rounded font-semibold">
                          {t.manager}
                        </span>
                      )}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          isCompleted ? 'bg-emerald-200 text-emerald-800' : 
                          t.status ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {t.status || '처리 대기'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {isBuyer && !isCompleted && (
                        <button
                          type="button"
                          onClick={() => onCompleteTransaction(t.id)}
                          className="bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-800 px-1.5 py-0.5 rounded font-bold text-[10px] flex items-center gap-0.5 transition"
                          title="완료 처리"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          완료처리
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onEditTransaction(t)}
                        className="text-slate-400 hover:text-indigo-600 p-1"
                        title="수정"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      {currentUser?.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => onDeleteTransaction(t.id)}
                          className="text-slate-400 hover:text-rose-600 p-1 transition rounded hover:bg-rose-50"
                          title="삭제 (즉시 삭제)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-slate-500 text-[11px] flex items-center gap-2">
                    <span>
                      <b className="text-slate-700">{t.market || '-'}</b> {String(t.floor || '').replace(/층$/, '') ? `${String(t.floor || '').replace(/층$/, '')}층` : ''} {formatRoomDisplay(t.room)}
                    </span>
                    {t.region && <span className="text-slate-400">| {t.region}</span>}
                  </div>

                  <div className="flex items-center justify-between font-semibold pt-1 border-t border-slate-200/60">
                    <span className="text-rose-600">대납: {formatMoney(t.expense)}</span>
                    <span className="text-blue-600">입금: {formatMoney(t.income)}</span>
                  </div>

                  {(t.remark || t.processingRemark) && (
                    <div className="text-[10px] text-slate-500 bg-white p-1.5 rounded-lg border border-slate-200">
                      비고: {[t.remark, t.processingRemark].filter(Boolean).join(' | ')}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {deleteConfirmId && (
        <div className="fixed inset-0 bg-slate-900/60 z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-2">주문 삭제</h3>
              <p className="text-slate-600">선택한 주문이 삭제됩니다. 삭제 하시겠습니까?</p>
            </div>
            <div className="flex bg-slate-50 border-t border-slate-100 p-3 gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2.5 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition"
              >
                취소
              </button>
              <button
                onClick={() => {
                  onDeleteTransaction(deleteConfirmId);
                  setDeleteConfirmId(null);
                }}
                className="flex-1 px-4 py-2.5 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 transition"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
});
