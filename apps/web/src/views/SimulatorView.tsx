import { useEffect, useRef, useState } from 'react';
import { DecisionTabs, Verdict } from '../components/Decision';
import { ExampleList, ExamplePicker, LocalNote } from '../components/Examples';
import { LevelPicker, Settings } from '../components/Settings';
import { StagedChanges } from '../components/StagedChanges';
import { ActionBadge, cx } from '../components/ui';
import type { Evaluation, SimState } from '../lib/model';
import type { SimAction } from '../lib/state';

/** Bottom bar on narrow screens that shows the decision while the decision card is off screen. */
function MobileVerdictBar({ evaluation, hidden }: { evaluation: Evaluation; hidden: boolean }) {
  return (
    <a href="#decision" className={cx('mobile-verdict', `tone-${evaluation.result.action}`, hidden && 'is-hidden')} aria-hidden={hidden} tabIndex={hidden ? -1 : 0}>
      <ActionBadge action={evaluation.result.action} size="sm" />
      <span className="mobile-verdict-text">{evaluation.result.summary}</span>
    </a>
  );
}

export function SimulatorView({
  state,
  dispatch,
  evaluation,
}: {
  state: SimState;
  dispatch: (action: SimAction) => void;
  evaluation: Evaluation;
}) {
  const verdict = useRef<HTMLElement>(null);
  const [verdictVisible, setVerdictVisible] = useState(true);

  useEffect(() => {
    const target = verdict.current;
    if (!target || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setVerdictVisible(entry.isIntersecting), { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const apply = (next: SimState) => {
    dispatch({ type: 'replace', state: next });
    requestAnimationFrame(() => verdict.current?.focus({ preventScroll: false }));
  };

  return (
    <div className="workspace">
      <aside className="examples-col" aria-label="Examples">
        <ExampleList state={state} dispatch={dispatch} />
      </aside>
      <ExamplePicker state={state} dispatch={dispatch} />
      <div className="inputs-col">
        <h1 className="sr-only">Shipgate policy simulator</h1>
        <LevelPicker state={state} dispatch={dispatch} />
        <Settings state={state} dispatch={dispatch} />
        <StagedChanges state={state} dispatch={dispatch} findings={evaluation.input.findings} />
        <div className="mobile-only">
          <LocalNote />
        </div>
      </div>
      <div className="decision-col">
        <Verdict evaluation={evaluation} ref={verdict} />
        <DecisionTabs evaluation={evaluation} state={state} onApply={apply} />
      </div>
      <MobileVerdictBar evaluation={evaluation} hidden={verdictVisible} />
    </div>
  );
}
