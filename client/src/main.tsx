import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 전역 css 를 먼저 불러야 페이지 css 의 같은 우선순위 규칙이 뒤에서 덮어쓴다.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
