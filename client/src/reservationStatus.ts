import type { Reservation } from './types';

/**
 * 예약 계획이 학교에서 확인됐는지에 따른 배지.
 * className 은 `badge` 와 함께 쓰는 색 변형이다. (예: <span className={`badge ${status.className}`}>)
 * 색만으로 구분하지 않도록 label 문구를 항상 함께 보여 준다.
 */
export function reservationStatus(reservation: Reservation) {
  // 시설 없이 잡은 회의는 학교에 신청할 것이 없다
  if (reservation.facilityId === null) {
    return { label: '시설 없음', className: 'badge--gray' };
  }
  if (reservation.schoolStatus === 'confirmed') {
    return { label: '학교 예약 확인됨', className: 'badge--success' };
  }
  return { label: '앱 내 계획 · 학교 신청 필요', className: 'badge--warning' };
}
