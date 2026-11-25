import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { ChoiceRow, DialogHost, showDialog, snap, SwitchRow } from '@/ui';

jest.mock('expo-symbols', () => ({ SymbolView: () => null }));

describe('snap', () => {
  it('rounds to the step without float noise and clamps', () => {
    expect(snap(0.5 + 10 * 0.05, 0.5, 2, 0.05)).toBe(1);
    expect(snap(1.13, 0.5, 2, 0.05)).toBe(1.15);
    expect(snap(9, 0.5, 2, 0.05)).toBe(2);
    expect(snap(-1, 0.5, 2, 0.05)).toBe(0.5);
  });
});

describe('ChoiceRow', () => {
  it('shows the current value and picks from the sheet', async () => {
    const onChange = jest.fn();
    await render(
      <ChoiceRow<number>
        label="Keep video for"
        options={[
          { value: 1, label: '1 hour' },
          { value: 24, label: '1 day' },
        ]}
        value={null}
        recommended={1}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('1 hour (Recommended)')).toBeTruthy();
    await fireEvent.press(screen.getByText('Keep video for'));
    await fireEvent.press(screen.getByText('1 day'));
    expect(onChange).toHaveBeenLastCalledWith(24);
  });
});

describe('SwitchRow', () => {
  it('toggles from the whole row', async () => {
    const onChange = jest.fn();
    await render(<SwitchRow title="Wake word" value={false} onChange={onChange} />);
    await fireEvent.press(screen.getByText('Wake word'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('showDialog', () => {
  it('uses the in-app dialog when the host is mounted', async () => {
    const onDelete = jest.fn();
    await render(<DialogHost />);
    await act(async () =>
      showDialog('Delete this?', 'It cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]),
    );
    expect(screen.getByText('It cannot be undone.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalled();
    expect(screen.queryByText('It cannot be undone.')).toBeNull();
  });

  it('falls back to the system alert without a host', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    showDialog('Hello');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
