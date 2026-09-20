import React, { useState, useEffect } from 'react';
import { User, Transaction } from '../types';
import { Trash2, AlertTriangle, CheckCircle2, X, Database, Loader2, Layers, FileSpreadsheet, Download, Upload } from 'lucide-react';
import { factoryResetDatabase, fullSystemReset, deleteOrderFromFirebase } from '../lib/firebase';
import { saveTransactionsToIndexedDB, saveCollections } from '../lib/storage';

interface DataManagementModalProps {
  currentUser: User | null;
  transactions: Transaction[];
  onClose: () => void;
  onExcelImport: (file: File) => void;
  onExcelExport: () => void;
  onBackupDB: () => void;
  onRestoreDB: (file: File) => void;
  onResetComplete: () => void;
  onResetCollectionsOnly: () => void;
}

export const DataManagementModal: React.FC<DataManagementModalProps> = ({
  currentUser,
  transactions,
  onClose,
  onResetComplete,
  onResetCollectionsOnly,
  onExcelImport,
  onExcelExport,
  onBackupDB,
  onRestoreDB
}) => {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmStep, setConfirmStep] = useState<'idle' | 'confirm_factory_reset' | 'confirm_full_reset' | 'confirm_deduplicate'>('idle');

  const isAdmin = currentUser?.role === 'admin';
  const isSubAdmin = currentUser?.role === 'buyer' && currentUser?.isBuyerAdmin;
  const hasAdminAccess = isAdmin || isSubAdmin;

  
  const handleFullReset = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      await fullSystemReset();
      localStorage.setItem('SAIPON_DATA_INITIALIZED', 'true');
      await saveTransactionsToIndexedDB([]);
      saveCollections([]);
      onResetComplete();
      setStatusMessage({
        type: 'success',
        text: '모든 데이터 및 회원이 초기화되었습니다. (관리자 계정 유지)'
      });
      setConfirmStep('idle');
    } catch (err: any) {
      console.error('전체 초기화 실패:', err);
      setStatusMessage({
        type: 'error',
        text: `전체 초기화 중 오류가 발생했습니다: ${err.message || '네트워크 상태를 확인해주세요.'}`
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFactoryReset = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      // 1. Firebase RTDB orders & rules reset
      await factoryResetDatabase();

      // 2. Mark initialized in localStorage so default data won't auto-reload
      localStorage.setItem('SAIPON_DATA_INITIALIZED', 'true');

      // 3. Clear local storage & indexedDB
      await saveTransactionsToIndexedDB([]);
      saveCollections([]);

      // 4. Callback to clear App.tsx state
      onResetComplete();

      setStatusMessage({
        type: 'success',
        text: '모든 사입 장부 및 수금 데이터가 완벽하게 초기화되었습니다. 실사용 데이터를 등록하실 수 있습니다.'
      });
      setConfirmStep('idle');
    } catch (err: any) {
      console.error('초기화 실패:', err);
      setStatusMessage({
        type: 'error',
        text: `초기화 중 오류가 발생했습니다: ${err.message || '네트워크 상태를 확인해주세요.'}`
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeduplicate = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const seen = new Set<string>();
      const toDelete = [];
      
      transactions.forEach(t => {
        const tDate = t.date || t.businessDate || '';
        const tStore = (t.store || '').trim();
        const tMarket = (t.market || '').trim();
        const tFloor = (t.floor || '').trim();
        const tRoom = (t.room || '').trim();
        const tExpense = Number(t.expense) || 0;
        const tIncome = Number(t.income) || 0;
        const tRemark = (t.remark || '').trim();

        // 중복 판단 시 관리자(manager)는 제외하고 날짜, 상호, 건물, 층, 호수, 금액, 비고가 같으면 중복으로 간주
        const key = [tDate, tStore, tMarket, tFloor, tRoom, tExpense, tIncome, tRemark].join('|');
        if (seen.has(key)) {
          toDelete.push(t);
        } else {
          seen.add(key);
        }
      });

      let deletedCount = 0;
      for (const t of toDelete) {
        if (t.firebaseDate && t.firebaseOrderId) {
          await deleteOrderFromFirebase(t);
          deletedCount++;
        }
      }

      setStatusMessage({
        type: 'success',
        text: `총 ${deletedCount}건의 중복 데이터가 성공적으로 정리되었습니다.`
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `중복 정리 실패: ${err.message}`
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetCollections = () => {
    try {
      saveCollections([]);
      onResetCollectionsOnly();
      setStatusMessage({
        type: 'success',
        text: '수금 관리 데이터가 초기화되었습니다.'
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: '수금 초기화에 실패했습니다.'
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-white flex flex-col">
        {/* Header */}
        <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-950/80 border border-red-800/60 flex items-center justify-center text-red-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">데이터 관리 및 초기화</h2>
              <p className="text-xs text-gray-500">실사용 전환을 위한 데이터 비우기 및 테스트 데이터 관리</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ml-auto shrink-0"
          >
            [닫기]
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto overscroll-contain">
          {/* Status Banner */}
          
          {/* Excel & DB Options */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="cursor-pointer bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-800/50 rounded-xl p-3 flex flex-col items-center justify-center gap-2 transition group">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-emerald-200">엑셀 업로드</span>
              <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={(e) => { if(e.target.files?.[0]) { onExcelImport(e.target.files[0]); onClose(); } e.target.value = ''; }} />
            </label>
            <button type="button" onClick={() => { onExcelExport(); onClose(); }} className="bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-800/50 rounded-xl p-3 flex flex-col items-center justify-center gap-2 transition group">
              <Download className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-emerald-200">엑셀 내보내기</span>
            </button>
            <button type="button" onClick={() => { onBackupDB(); onClose(); }} className="bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-800/50 rounded-xl p-3 flex flex-col items-center justify-center gap-2 transition group">
              <Download className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-indigo-200">DB 백업</span>
            </button>
            <label className="cursor-pointer bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-800/50 rounded-xl p-3 flex flex-col items-center justify-center gap-2 transition group">
              <Upload className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-indigo-200">DB 복원</span>
              <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { if(e.target.files?.[0]) { onRestoreDB(e.target.files[0]); onClose(); } e.target.value = ''; }} />
            </label>
          </div>

          {statusMessage && (
            <div
              className={`p-3.5 rounded-xl text-xs font-semibold flex items-start gap-2.5 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/80 border border-emerald-700/80 text-emerald-200'
                  : 'bg-red-950/80 border border-red-700/80 text-red-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {isAdmin && (
            <>
                    <div className="bg-red-950/20 border border-red-900/60 rounded-xl p-4 space-y-3 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-900/50 flex items-center justify-center text-red-300 shrink-0 mt-0.5">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-red-200">시스템 전체 초기화 (회원 포함 완전 삭제)</h3>
                  <span className="text-[10px] bg-red-800/80 text-red-100 px-2 py-0.5 rounded-full font-bold">추천</span>
                </div>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  장부, 수금 내역은 물론 <strong className="text-red-300">관리자를 제외한 모든 가입 회원(사입삼촌, 상인 등) 정보까지 영구 삭제</strong>합니다. 빈 상태에서 다시 시작할 때만 사용하세요.
                </p>
              </div>
            </div>
            
            {confirmStep !== 'confirm_full_reset' ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => setConfirmStep('confirm_full_reset')}
                className="w-full mt-2 py-2.5 px-4 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-red-950/50 flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                <span>데이터 및 일반회원 전체 삭제</span>
              </button>
            ) : (
              <div className="mt-2 p-3 bg-red-950/50 border border-red-800/80 rounded-xl">
                <p className="text-xs text-red-300 font-bold mb-2.5 flex items-center justify-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  정말 모든 회원과 데이터를 삭제하시겠습니까? 복구 불가합니다.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmStep('idle')}
                    disabled={loading}
                    className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-lg transition"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleFullReset}
                    className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>네, 모두 삭제합니다</span>}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="bg-amber-950/20 border border-amber-900/60 rounded-xl p-4 space-y-2.5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-900/50 flex items-center justify-center text-amber-300 shrink-0 mt-0.5">
                <Layers className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-amber-200">중복 데이터 자동 병합 (오류 복구용)</h3>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  엑셀 여러번 업로드 등으로 <strong>완전히 똑같은 주문이 중복 생성된 경우</strong>, 1개만 남기고 나머지를 자동 삭제합니다. <br/>
                  <span className="text-amber-500 font-bold">*일부러 동일하게 2건 입력한 내역도 합쳐지므로 주의하세요.</span>
                </p>
              </div>
            </div>
            {confirmStep !== 'confirm_deduplicate' ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => setConfirmStep('confirm_deduplicate')}
                className="w-full py-2 px-4 bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl transition flex items-center justify-center gap-2 shadow-md"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>중복 내역 1건으로 정리하기</span>}
              </button>
            ) : (
              <div className="p-3 bg-amber-900/40 rounded-xl border border-amber-800 flex flex-col gap-2 mt-2">
                <p className="text-xs text-amber-200 font-semibold text-center mb-1">
                  정말로 중복 데이터를 모두 정리하시겠습니까?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmStep('idle')}
                    className="flex-1 py-2 px-3 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-bold rounded-lg transition"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmStep('idle');
                      handleDeduplicate();
                    }}
                    className="flex-1 py-2 px-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg transition shadow-md"
                  >
                    확인 및 진행
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Option 2: Reset Collections Only */}
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4 space-y-2.5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-slate-300 shrink-0 mt-0.5">
                <Database className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-slate-200">수금 기록만 초기화</h3>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  사입 장부는 그대로 유지하고, 수금 관리 화면의 입금/수금 체크 기록만 초기화합니다.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={handleResetCollections}
              className="w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-2"
            >
              <span>수금 기록 초기화</span>
            </button>
          </div>
          </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-800/60 px-6 py-3 border-t border-slate-700/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-xl transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
