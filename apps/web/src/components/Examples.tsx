import * as RadioGroup from '@radix-ui/react-radio-group';
import { DEMO_SCENARIOS, planRun, scenarioInput } from '@shipgate/core/browser';
import { LockKeyhole, RotateCcw } from 'lucide-react';
import { ACTION_LABEL, isModified, type SimState } from '../lib/model';
import type { SimAction } from '../lib/state';
import { ActionIcon, Button, cx, SelectField } from './ui';

const DEFAULT_ACTION = Object.fromEntries(DEMO_SCENARIOS.map((s) => [s.id, planRun(scenarioInput(s)).action]));

export function LocalNote() {
  return (
    <p className="local-note">
      <LockKeyhole size={13} aria-hidden />
      <span>Runs in this browser. Nothing is staged, committed, pushed, or uploaded.</span>
    </p>
  );
}

function ResetButton({ state, dispatch }: { state: SimState; dispatch: (action: SimAction) => void }) {
  if (!isModified(state)) return null;
  return (
    <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'load', id: state.scenarioId })}>
      <RotateCcw size={13} aria-hidden />
      Reset
    </Button>
  );
}

export function ExampleList({ state, dispatch }: { state: SimState; dispatch: (action: SimAction) => void }) {
  const modified = isModified(state);
  return (
    <div className="examples">
      <div className="examples-head">
        <h2 className="eyebrow" id="examples-heading">
          Examples
        </h2>
        <ResetButton state={state} dispatch={dispatch} />
      </div>
      <RadioGroup.Root
        className="example-list"
        aria-labelledby="examples-heading"
        value={state.scenarioId}
        onValueChange={(id) => dispatch({ type: 'load', id })}
        loop
      >
        {DEMO_SCENARIOS.map((scenario) => {
          const selected = scenario.id === state.scenarioId;
          return (
            <RadioGroup.Item key={scenario.id} value={scenario.id} className="example">
              <span className="example-head">
                <span className="example-title">{scenario.title}</span>
                <span className={cx('example-status', `tone-${DEFAULT_ACTION[scenario.id]}`)} title={ACTION_LABEL[DEFAULT_ACTION[scenario.id]]}>
                  <ActionIcon action={DEFAULT_ACTION[scenario.id]} size={12} />
                  <span className="sr-only">{`, ${ACTION_LABEL[DEFAULT_ACTION[scenario.id]]}`}</span>
                </span>
              </span>
              <span className="example-summary">{scenario.summary}</span>
              {selected && modified && <span className="example-modified">Modified</span>}
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
      <LocalNote />
    </div>
  );
}

/** Compact example picker for narrow layouts. */
export function ExamplePicker({ state, dispatch }: { state: SimState; dispatch: (action: SimAction) => void }) {
  return (
    <div className="picker-row">
      <SelectField
        label="Example"
        value={state.scenarioId}
        onChange={(id) => dispatch({ type: 'load', id })}
        options={DEMO_SCENARIOS.map((s) => ({ value: s.id, label: s.title }))}
        hint={isModified(state) ? 'Modified from the example.' : DEMO_SCENARIOS.find((s) => s.id === state.scenarioId)?.summary}
      />
      <ResetButton state={state} dispatch={dispatch} />
    </div>
  );
}
