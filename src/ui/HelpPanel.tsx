import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import { IconClose } from './icons';

/* ----------------------------------------------------------------- state */

const useHelp = create<{ open: boolean }>(() => ({ open: false }));
const SEEN_KEY = 'bgm-editor:help-seen';

export const useHelpOpen = () => useHelp((s) => s.open);
export const isHelpOpen = () => useHelp.getState().open;
export const openHelp = () => useHelp.setState({ open: true });
export const closeHelp = () => useHelp.setState({ open: false });
export const toggleHelp = () => useHelp.setState((s) => ({ open: !s.open }));

/* --------------------------------------------------------------- content */

// Same as Toolbar's MOD; not imported because Toolbar imports this module.
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';
const ALT = isMac ? '⌥' : 'Alt';
const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

const STEPS: [string, ReactNode][] = [
  ['불러오기', <>위쪽 YouTube 칸에 링크를 붙여넣고 <b>추출</b>을 누르거나, <b>오디오 파일</b>을 고르거나 창에 끌어다 놓으세요. 트랙은 최대 5개.</>],
  ['박자 확인', <>불러오면 BPM과 박을 자동으로 찾아 클립 위에 표시합니다. 클립을 클릭하면 아래에 보정 버튼이 나옵니다. 박이 두 배·절반으로 잡혔으면 <b>×2</b> / <b>÷2</b>, 마디 시작이 어긋났으면 <b>첫 박 +1</b>.</>],
  ['구간 선택', <>클립 본문(파형)을 드래그하면 구간이 선택되고, 박자 그리드에 맞춰 붙습니다. 더 잘게 고르려면 확대하세요 (<K>+</K> 또는 <K>{isMac ? '⌘' : 'Ctrl'}</K> + 휠).</>],
  ['자르기 · 잇기', <><K>⇧⌫</K> <b>잘라내고 잇기</b>는 선택 구간을 지우고 뒤를 당겨 붙이면서 이음 페이드만큼 자연스럽게 겹칩니다. <K>⌫</K>는 지우기만(빈자리 남음), <K>S</K>는 그 위치에서 분할. 실수하면 <K>{MOD}Z</K>.</>],
  ['페이드 · 내보내기', <>클립을 선택하고 상단 모서리의 □ 핸들을 끌어 페이드 인·아웃을 겁니다. 다 됐으면 오른쪽 위 <b>WAV 내보내기</b>.</>],
];

const MOUSE: [string, string][] = [
  ['클립 이동', '클립 상단 바 드래그'],
  ['구간 선택', '클립 본문 · 빈 레인 드래그 (여러 트랙 가능)'],
  ['트림', '클립 좌우 가장자리 드래그'],
  ['페이드', '선택한 클립 상단 모서리 □ 핸들 드래그'],
  ['스냅 일시 해제', `드래그 중 ${ALT} 누르기`],
  ['확대', `${isMac ? '⌘' : 'Ctrl'} + 휠, 트랙패드 핀치`],
  ['스크롤', '휠 · 트랙패드'],
];

const KEYS: [string[], string][] = [
  [['Space'], '재생 / 정지'],
  [['⇧Space'], '멈춘 곳부터 재생'],
  [['S', `${MOD}E`], '분할'],
  [['⌫'], '지우기'],
  [['⇧⌫'], '잘라내고 잇기'],
  [[`${MOD}D`], '복제'],
  [['L', `${MOD}L`], '선택 구간 루프'],
  [[`${MOD}Z`, `${MOD}⇧Z`], '실행 취소 / 다시 실행'],
  [['+', '−'], '확대 / 축소'],
  [['Z'], '선택 구간(없으면 전체)에 맞춤'],
  [[`${MOD}A`], '모든 클립 선택'],
  [['Esc'], '선택 해제'],
  [['Enter'], '처음으로'],
  [['?'], '이 도움말'],
];

const TIPS: ReactNode[] = [
  <>드래그하는 동안 <K>{ALT}</K>를 누르고 있으면 그리드에 붙지 않고 자유롭게 움직입니다.</>,
  <>구간을 고른 뒤 <K>L</K>로 루프를 켜면 이음새를 반복해서 들어볼 수 있습니다.</>,
  <>박 검출은 드럼·비트가 뚜렷한 곡에서 가장 정확합니다. 템포가 흔들리는 곡은 BPM이 여러 구간으로 나뉘거나 그리드가 어긋날 수 있어요.</>,
  <>YouTube 추출이 안 되면 음원 파일을 직접 올려 주세요.</>,
  <>작업 내용은 저장되지 않습니다. 새로고침하거나 창을 닫으면 사라지니, 끝나면 꼭 WAV로 내보내세요.</>,
];

/* ------------------------------------------------------------- component */

export function HelpPanel() {
  const open = useHelpOpen();
  const panel = useRef<HTMLElement>(null);

  // First visit: show the guide once.
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) {
        localStorage.setItem(SEEN_KEY, '1');
        openHelp();
      }
    } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => prev?.focus?.();
  }, [open]);

  if (!open) return null;

  return (
    <div className="help-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeHelp(); }}>
      <section className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1} ref={panel}>
        <header className="help-head">
          <h2 id="help-title">사용법</h2>
          <span className="label">언제든 <kbd>?</kbd> 로 다시 열 수 있어요</span>
          <button className="icon-btn" aria-label="닫기" title="닫기 (Esc)" onClick={closeHelp}><IconClose /></button>
        </header>
        <div className="help-body">
          <section className="help-sec">
            <h3>빠른 시작</h3>
            <ol className="help-steps">
              {STEPS.map(([t, d], i) => (
                <li key={t}>
                  <span className="n">{i + 1}</span>
                  <span className="t">{t}</span>
                  <span className="d">{d}</span>
                </li>
              ))}
            </ol>
          </section>
          <div className="help-cols">
            <section className="help-sec">
              <h3>마우스</h3>
              <table className="help-table">
                <tbody>
                  {MOUSE.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}
                </tbody>
              </table>
            </section>
            <section className="help-sec">
              <h3>단축키</h3>
              <table className="help-table">
                <tbody>
                  {KEYS.map(([ks, v]) => (
                    <tr key={v}>
                      <td>{ks.map((k, i) => <Fragment key={k}>{i > 0 && <span className="muted"> / </span>}<kbd>{k}</kbd></Fragment>)}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <section className="help-sec">
            <h3>알아두면 좋은 점</h3>
            <ul className="help-tips">
              {TIPS.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </section>
        </div>
      </section>
    </div>
  );
}
