import * as RadioGroup from '@radix-ui/react-radio-group';
import * as Select from '@radix-ui/react-select';
import { DEMO_SCENARIOS, planRun, scenarioInput } from '@shipgate/core/browser';
import { Check, ChevronDown, LockKeyhole, RotateCcw } from 'lucide-react';
import { ACTION_LABEL, isModified, type SimState } from '../lib/model';
import type { SimAction } from '../lib/state';
import { ActionIcon, Button, cx } from './ui';

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
        <h2 className="examples-title" id="examples-heading">
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
          const action = DEFAULT_ACTION[scenario.id];
          return (
            <RadioGroup.Item key={scenario.id} value={scenario.id} className="example">
              <span className={cx('example-status', `tone-${action}`)} title={ACTION_LABEL[action]}>
                <ActionIcon action={action} size={11} />
              </span>
              <span className="example-text">
                <span className="example-title">
                  {scenario.title}
                  <span className="sr-only">{`, ${ACTION_LABEL[action]}`}</span>
                </span>
                <span className="example-summary">{scenario.summary}</span>
                {scenario.id === state.scenarioId && modified && <span className="example-modified">Modified</span>}
              </span>
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
  const modified = isModified(state);
  return (
    <div className="picker-row">
      <div className="picker-head">
        <label className="field-label" htmlFor="example-picker" id="example-picker-label">
          Example
        </label>
        <ResetButton state={state} dispatch={dispatch} />
      </div>
      <Select.Root value={state.scenarioId} onValueChange={(id) => dispatch({ type: 'load', id })}>
        <Select.Trigger id="example-picker" className="select-trigger" aria-labelledby="example-picker-label" aria-describedby="example-picker-hint">
          <Select.Value />
          <ChevronDown size={14} aria-hidden className="select-icon" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12}>
            <Select.Viewport className="select-viewport">
              {DEMO_SCENARIOS.map((s) => (
                <Select.Item key={s.id} value={s.id} className="select-item">
                  <span className={cx('example-status', `tone-${DEFAULT_ACTION[s.id]}`)} aria-hidden>
                    <ActionIcon action={DEFAULT_ACTION[s.id]} size={11} />
                  </span>
                  <span className="select-item-text">
                    <Select.ItemText>{s.title}</Select.ItemText>
                  </span>
                  <Select.ItemIndicator className="select-item-check">
                    <Check size={14} aria-hidden />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      <span className="field-hint" id="example-picker-hint">
        {modified ? 'Modified from the example.' : DEMO_SCENARIOS.find((s) => s.id === state.scenarioId)?.summary}
      </span>
    </div>
  );
}
