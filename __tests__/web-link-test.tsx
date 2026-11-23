import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { sourceLabel, WebSearchLink } from '@/features/ask/WebLookupUi';

jest.mock('expo-network', () => ({ useNetworkState: () => ({}), getNetworkStateAsync: jest.fn() }));
jest.mock('@/memory/store', () => ({ listSpeakers: jest.fn(async () => []) }));
jest.mock('@/engine/settings', () => ({ getSettings: jest.fn(), onSettingsChange: jest.fn() }));
jest.mock('@/engine/llm', () => ({
  askLlmAside: jest.fn(),
  cancelLlm: jest.fn(),
  ensureLlm: jest.fn(),
}));

describe('Search the web in your browser', () => {
  test('uses the lookup’s words without asking again', async () => {
    const getQuery = jest.fn(async () => 'other');
    const open = jest.fn(async () => {});
    await render(
      <WebSearchLink
        question="What happened at COP31?"
        query="COP31 outcome"
        getQuery={getQuery}
        open={open}
      />,
    );
    await act(async () => fireEvent.press(screen.getByText('Search the web in your browser')));
    expect(getQuery).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('https://duckduckgo.com/?q=COP31%20outcome');
  });

  test('no lookup ran: words are worked out on tap', async () => {
    const getQuery = jest.fn(async () => 'cat purring reasons');
    const open = jest.fn(async () => {});
    await render(
      <WebSearchLink question="Why does Sam's cat purr?" getQuery={getQuery} open={open} />,
    );
    expect(getQuery).not.toHaveBeenCalled(); // nothing computed (or sent) before the tap
    await act(async () => fireEvent.press(screen.getByText('Search the web in your browser')));
    expect(getQuery).toHaveBeenCalledWith("Why does Sam's cat purr?");
    expect(open).toHaveBeenCalledWith('https://duckduckgo.com/?q=cat%20purring%20reasons');
  });

  test('no question: no link', async () => {
    await render(<WebSearchLink question="" />);
    expect(screen.queryByText('Search the web in your browser')).toBeNull();
  });

  test('source label shows site and date', () => {
    expect(
      sourceLabel({
        name: 'GDELT',
        title: 'Talks collapse',
        url: 'https://x.example/a',
        text: 'Talks collapse',
        domain: 'x.example',
        date: '2026-11-23',
      }),
    ).toBe('Source: GDELT — Talks collapse · x.example · 2026-11-23');
  });
});
