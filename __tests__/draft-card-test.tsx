import { fireEvent, render, screen } from '@testing-library/react-native';

import { DraftCard } from '@/features/ask/DraftCard';
import { LIGHT } from '@/features/ask/theme';

const mockRun = jest.fn();
const mockCancel = jest.fn();
const draft = {
  id: 'd1',
  kind: 'message',
  title: 'Message to Sam (WhatsApp)',
  fields: { name: 'Sam', to: '+440000', text: "I'm running late", app: 'whatsapp' },
  integration: 'messages',
  status: 'draft',
  at: 0,
};
jest.mock('@/engine/actions', () => ({
  drafts: {
    get: () => draft,
    subscribe: () => () => {},
    update: jest.fn(),
    cancel: (id: string) => mockCancel(id),
  },
  runAction: (id: string) => mockRun(id),
}));

test('a draft is only sent when Send is tapped', async () => {
  await render(<DraftCard id="d1" theme={LIGHT} />);
  expect(screen.getByText("I'm running late")).toBeTruthy();
  expect(mockRun).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Send'));
  expect(mockRun).toHaveBeenCalledWith('d1');
  await fireEvent.press(screen.getByText('Cancel'));
  expect(mockCancel).toHaveBeenCalledWith('d1');
});
