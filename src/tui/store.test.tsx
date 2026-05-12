import { describe, it, expect } from 'vitest';
import { tuiReducer, initialState, type TuiState, type TuiAction } from './store.js';

describe('tuiReducer', () => {
  it('should update input value correctly and return new state', () => {
    const action: TuiAction = { type: 'SET_INPUT_VALUE', payload: 'new value' };
    const nextState = tuiReducer(initialState, action);

    expect(nextState.input.value).toBe('new value');
    expect(nextState).not.toBe(initialState);
  });

  it('should return exact same state instance if input value does not change (bailout)', () => {
    const state: TuiState = {
      ...initialState,
      input: { ...initialState.input, value: 'same value' }
    };
    const action: TuiAction = { type: 'SET_INPUT_VALUE', payload: 'same value' };
    const nextState = tuiReducer(state, action);

    expect(nextState).toBe(state);
  });

  it('should correctly set input mode and update props', () => {
    const action: TuiAction = { type: 'SET_INPUT_MODE', payload: { mode: 'effort-select', props: { foo: 'bar' } } };
    const nextState = tuiReducer(initialState, action);

    expect(nextState.input.mode).toBe('effort-select');
    expect(nextState.input.props).toEqual({ foo: 'bar' });
  });

  it('should correctly set token count and bail out if same', () => {
    const action: TuiAction = { type: 'SET_TOKEN_COUNT', payload: 1234 };
    const state1 = tuiReducer(initialState, action);
    expect(state1.tokenCount).toBe(1234);

    const state2 = tuiReducer(state1, action);
    expect(state2).toBe(state1);
  });
});
