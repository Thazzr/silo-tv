import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BASE_URL, systemInfo } from '../../test/apiFixtures';
import { renderApp, testDevice } from '../../test/renderFlow';
import { ServerScreen } from './ServerScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup(initial = '') {
  const onConnected = vi.fn();
  renderApp(<ServerScreen initial={initial} device={testDevice} onConnected={onConnected} />);
  return { onConnected };
}

const answer = (handler: Parameters<typeof http.get>[1]) =>
  server.use(http.get(`${BASE_URL}/api/v2/system/info`, handler));

describe('ServerScreen', () => {
  it('focuses the input and pre-fills it', () => {
    setup('silo.example.test');
    const input = screen.getByLabelText('Server address');
    expect(input).toHaveValue('silo.example.test');
    expect(input).toHaveFocus();
  });

  it('checks the server and reports its normalized origin on success', async () => {
    answer(() => HttpResponse.json(systemInfo));
    const { onConnected } = setup();
    await userEvent.type(screen.getByLabelText('Server address'), 'silo.example.test/some/path');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(BASE_URL));
    expect(screen.queryByTestId('server-error')).not.toBeInTheDocument();
  });

  it('submits when Enter is pressed on the Connect button', async () => {
    answer(() => HttpResponse.json(systemInfo));
    const { onConnected } = setup(BASE_URL);
    // Arrow down from the input to the button, then Enter, as with a remote.
    fireEvent.keyDown(window, { keyCode: 40 });
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveFocus();
    fireEvent.keyDown(window, { keyCode: 13 });
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(BASE_URL));
  });

  it('submits when Enter is pressed in the input', async () => {
    answer(() => HttpResponse.json(systemInfo));
    const { onConnected } = setup(BASE_URL);
    await userEvent.type(screen.getByLabelText('Server address'), '{Enter}');
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
  });

  it('shows a loading cue while the server is checked', async () => {
    let release: () => void = () => undefined;
    answer(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return HttpResponse.json(systemInfo);
    });
    setup(BASE_URL);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Checking server …')).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.queryByText('Checking server …')).not.toBeInTheDocument());
  });

  it.each([
    ['not a URL at all', 'has spaces and ftp://x', 'not a valid server address'],
    ['unreachable', BASE_URL, 'The server does not answer'],
  ])('shows a message for %s', async (_name, input, text) => {
    if (input === BASE_URL) answer(() => HttpResponse.error());
    const { onConnected } = setup(input);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByTestId('server-error')).toHaveTextContent(text);
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('says it is not a Silo server when the answer is not JSON', async () => {
    answer(
      () => new HttpResponse('<html>hello</html>', { headers: { 'Content-Type': 'text/html' } }),
    );
    const { onConnected } = setup(BASE_URL);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByTestId('server-error')).toHaveTextContent(
      'There is no Silo server at this address.',
    );
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('says the API version is unsupported for another api_major', async () => {
    answer(() => HttpResponse.json({ ...systemInfo, api_major: 3 }));
    const { onConnected } = setup(BASE_URL);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByTestId('server-error')).toHaveTextContent(
      'API version the app does not support',
    );
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('clears the error when the next attempt succeeds', async () => {
    answer(() => HttpResponse.error());
    const { onConnected } = setup(BASE_URL);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByTestId('server-error');
    answer(() => HttpResponse.json(systemInfo));
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(BASE_URL));
    expect(screen.queryByTestId('server-error')).not.toBeInTheDocument();
  });
});
