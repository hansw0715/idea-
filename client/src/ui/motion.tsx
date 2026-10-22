import { motion } from 'motion/react';
import type { HTMLMotionProps, Transition, Variants } from 'motion/react';

/**
 * 앱 공통 모션 값. 화면마다 숫자를 새로 정하지 말고 여기서 가져다 쓴다.
 * 접근성: App.tsx 의 <MotionConfig reducedMotion="user"> 가 OS "동작 줄이기" 설정이면
 * 이동·크기 변화를 끄고 투명도만 남긴다.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const SPRING: Transition = { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 };

/** 화면 진입: 아래에서 8px 떠오르며 나타남 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } },
};

/** 목록 부모: 자식이 40ms 간격으로 차례로 등장 (최대 지연은 자식 쪽에서 제한) */
export const listVariants: Variants = {
  hidden: {},
  show: {},
};

export const itemVariants: Variants = {
  hidden: { opacity: 1 },
  show: { opacity: 1 },
};

/**
 * 차례로 등장하는 목록. <ul> 대신 쓴다.
 *   <StaggerList className="list">{items.map(i => <StaggerItem key=…>…</StaggerItem>)}</StaggerList>
 */
export function StaggerList({ children, ...rest }: HTMLMotionProps<'ul'>) {
  return (
    <motion.ul variants={listVariants} initial="hidden" animate="show" {...rest}>
      {children}
    </motion.ul>
  );
}

export function StaggerItem({ children, ...rest }: HTMLMotionProps<'li'>) {
  return (
    <motion.li variants={itemVariants} {...rest}>
      {children}
    </motion.li>
  );
}

/** 한 덩어리를 살짝 늦게 띄울 때 (카드·히어로) */
export function Reveal({ delay = 0, children, ...rest }: HTMLMotionProps<'div'> & { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
