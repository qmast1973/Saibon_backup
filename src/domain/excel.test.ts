import { describe, expect, it } from 'vitest';
import { toThousandUnit, type ExcelRow } from './excel';

const row = (expense: number, income = 0): ExcelRow => ({
  date: '2026-10-01', sourceManager: '', region: '합성동', store: '상호A', market: 'APM', floor: '1', room: '1호', expense, income, status: '', remark: '',
});

describe('엑셀 금액 단위', () => {
  it('원 단위 파일(35000)은 천원 단위(35)로 바꿔 읽는다', () => {
    const { rows, convertedFromWon } = toThousandUnit([row(35000), row(12500), row(0, 20000)]);
    expect(convertedFromWon).toBe(true);
    expect(rows.map(r => [r.expense, r.income])).toEqual([[35, 0], [12.5, 0], [0, 20]]);
  });

  it('이미 천원 단위(35)인 파일은 그대로 둔다', () => {
    const { rows, convertedFromWon } = toThousandUnit([row(35), row(12), row(0, 20)]);
    expect(convertedFromWon).toBe(false);
    expect(rows.map(r => r.expense)).toEqual([35, 12, 0]);
  });

  it('작은 금액이 섞여 있으면(1000 이상이 80% 미만) 바꾸지 않는다', () => {
    expect(toThousandUnit([row(35), row(1500), row(20), row(8), row(12)]).convertedFromWon).toBe(false);
  });

  it('금액이 하나도 없으면 바꾸지 않는다', () => {
    expect(toThousandUnit([row(0)]).convertedFromWon).toBe(false);
  });
});

describe('백업 복원 금액 단위', () => {
  it('원 단위로 기록된 주문 목록도 천원 단위로 바꾼다', () => {
    const { rows, convertedFromWon } = toThousandUnit([{ expense: 35000, income: 0 }, { expense: 0, income: 20000 }]);
    expect(convertedFromWon).toBe(true);
    expect(rows).toEqual([{ expense: 35, income: 0 }, { expense: 0, income: 20 }]);
  });
});
