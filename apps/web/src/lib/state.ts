import { defaultReviewDetail, stateFromScenario, type ReviewChoice, type SimFile, type SimState } from './model';

export type SimAction =
  | { type: 'load'; id: string }
  | { type: 'replace'; state: SimState }
  | { type: 'set'; patch: Partial<SimState> }
  | { type: 'review'; choice: ReviewChoice }
  | { type: 'file-edit'; path: string; content: string }
  | { type: 'file-rename'; path: string; to: string }
  | { type: 'file-add'; files: SimFile[] }
  | { type: 'file-remove'; path: string }
  | { type: 'file-select'; path: string };

export function simReducer(state: SimState, action: SimAction): SimState {
  switch (action.type) {
    case 'load':
      return stateFromScenario(action.id);
    case 'replace':
      return action.state;
    case 'set':
      return { ...state, ...action.patch };
    case 'review':
      return { ...state, review: action.choice, reviewDetail: defaultReviewDetail(action.choice, state.scenarioId) };
    case 'file-edit':
      return { ...state, files: state.files.map((f) => (f.path === action.path ? { ...f, content: action.content } : f)) };
    case 'file-rename':
      return {
        ...state,
        files: state.files.map((f) => (f.path === action.path ? { ...f, path: action.to } : f)),
        activePath: state.activePath === action.path ? action.to : state.activePath,
      };
    case 'file-add': {
      if (!action.files.length) return state;
      const added = new Set(action.files.map((f) => f.path));
      return {
        ...state,
        files: [...state.files.filter((f) => !added.has(f.path)), ...action.files],
        hasChanges: true,
        activePath: action.files[action.files.length - 1].path,
      };
    }
    case 'file-remove': {
      const index = state.files.findIndex((f) => f.path === action.path);
      const files = state.files.filter((f) => f.path !== action.path);
      const activePath = state.activePath === action.path ? (files[Math.min(index, files.length - 1)]?.path ?? null) : state.activePath;
      return { ...state, files, activePath };
    }
    case 'file-select':
      return { ...state, activePath: action.path };
  }
}
