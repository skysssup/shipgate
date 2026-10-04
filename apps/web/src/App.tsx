import * as Tooltip from '@radix-ui/react-tooltip';
import { RULE_SAMPLES } from '@shipgate/core/browser';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import pkg from '../package.json';
import { Header } from './components/Header';
import { ACTION_LABEL, DEFAULT_SCENARIO_ID, evaluate, stateFromScenario } from './lib/model';
import { hasUnsharedEdits, parseHash, stateFromQuery, stateQuery, viewHref, type View } from './lib/route';
import { simReducer } from './lib/state';
import { useTheme } from './lib/theme';
import { RulesView } from './views/RulesView';
import { SimulatorView } from './views/SimulatorView';
import { StartView } from './views/StartView';

const TITLES: Record<View, string> = {
  simulator: 'Shipgate policy simulator',
  rules: 'Credential rules and policy · Shipgate',
  start: 'Get started · Shipgate',
};

export function App() {
  const [view, setView] = useState<View>(() => parseHash(location.hash).view);
  const [state, dispatch] = useReducer(simReducer, undefined, () => stateFromQuery(parseHash(location.hash).params) ?? stateFromScenario(DEFAULT_SCENARIO_ID));
  const [theme, setTheme] = useTheme();
  const evaluation = useMemo(() => evaluate(state), [state]);
  const query = stateQuery(state);
  const current = useRef(query);
  current.current = query;

  useEffect(() => {
    const onHashChange = () => {
      const route = parseHash(location.hash);
      setView(route.view);
      if (route.view !== 'simulator') return;
      const linked = stateFromQuery(route.params);
      if (linked && stateQuery(linked) !== current.current) dispatch({ type: 'replace', state: linked });
    };
    addEventListener('hashchange', onHashChange);
    return () => removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (view !== 'simulator') return;
    const href = viewHref('simulator', query);
    if (location.hash !== href) history.replaceState(history.state, '', href);
  }, [view, query]);

  const firstView = useRef(true);
  useEffect(() => {
    document.title = TITLES[view];
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    window.scrollTo(0, 0);
    document.getElementById(view === 'simulator' ? 'main' : 'page-title')?.focus();
  }, [view]);

  const [announcement, setAnnouncement] = useState('');
  const spoken = `Decision: ${ACTION_LABEL[evaluation.result.action]}. ${evaluation.result.summary}`;
  const lastSpoken = useRef(spoken);
  useEffect(() => {
    if (spoken === lastSpoken.current) return;
    const timer = window.setTimeout(() => {
      lastSpoken.current = spoken;
      setAnnouncement(spoken);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [spoken]);

  const tryRule = (ruleId: string) => {
    const next = simReducer(state, { type: 'file-add', files: [{ ...RULE_SAMPLES[ruleId] }] });
    dispatch({ type: 'replace', state: next });
    current.current = stateQuery(next);
    location.hash = viewHref('simulator', current.current);
  };

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="app" data-view={view}>
        <Header
          view={view}
          simulatorHref={viewHref('simulator', query)}
          theme={theme}
          onTheme={setTheme}
          version={pkg.version}
          unsharedEdits={hasUnsharedEdits(state)}
        />
        <main id="main" tabIndex={-1} className="main">
          {view === 'simulator' && <SimulatorView state={state} dispatch={dispatch} evaluation={evaluation} />}
          {view === 'rules' && <RulesView onTry={tryRule} />}
          {view === 'start' && <StartView version={pkg.version} />}
        </main>
        {view !== 'simulator' && (
          <footer className="footer">
            <span>Shipgate {pkg.version}</span>
            <span aria-hidden>·</span>
            <span>MIT license</span>
            <span aria-hidden>·</span>
            <a href="./third-party-licenses.txt">Third-party licenses</a>
            <span aria-hidden>·</span>
            <span>The simulator runs the CLI&apos;s decision code in this browser. It never touches a repository.</span>
          </footer>
        )}
        <div className="sr-only announcer" aria-live="polite" aria-atomic="true">
          {view === 'simulator' ? announcement : ''}
        </div>
      </div>
    </Tooltip.Provider>
  );
}
