import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import i18n from '@/i18n';
import DocumentErrorBoundary from '../DocumentErrorBoundary';
import PdfViewer from '../PdfViewer';

// The Document react-pdf would render, held open so a test decides when each
// file finishes loading.
const doc = vi.hoisted(() => ({ onLoadSuccess: null as ((pdf: unknown) => void) | null }));
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
  Document: ({ onLoadSuccess, children }: { onLoadSuccess: (pdf: unknown) => void; children: ReactNode }) => {
    doc.onLoadSuccess = onLoadSuccess;
    return <div>{children}</div>;
  },
  Page: () => null,
  Outline: () => null,
}));

function deferred<T>() {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((_resolve, rej) => {
    reject = rej;
  });
  return { promise, reject };
}

describe('PdfViewer', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('does not fail a new file when the replaced one rejects its first page', async () => {
    const firstPage = deferred<never>();
    const replaced = {
      numPages: 3,
      loadingParams: { disableAutoFetch: false },
      loadingTask: { destroyed: false },
      getOutline: () => Promise.resolve(null),
      getPage: () => firstPage.promise,
    };
    const view = (data: Uint8Array) => (
      <DocumentErrorBoundary fallback={<p>failed</p>}>
        <PdfViewer data={data} />
      </DocumentErrorBoundary>
    );
    const { rerender } = render(view(new Uint8Array([1])));
    act(() => doc.onLoadSuccess!(replaced));

    // A refetch hands over new bytes; react-pdf tears the old document down,
    // and the page request it still had out rejects on the way.
    rerender(view(new Uint8Array([2])));
    replaced.loadingTask.destroyed = true;
    await act(async () => {
      firstPage.reject(new Error('Transport destroyed'));
      await Promise.resolve();
    });

    expect(screen.queryByText('failed')).toBeNull();
  });

  it('goes to a referenced page that only the refetched copy has', () => {
    const copy = (numPages: number) => ({
      numPages,
      loadingParams: { disableAutoFetch: false },
      loadingTask: { destroyed: false },
      getOutline: () => Promise.resolve(null),
      getPage: () => new Promise(() => {}),
    });
    const view = (data: Uint8Array) => <PdfViewer data={data} focusPage={6} focusSeq={1} />;
    const { rerender } = render(view(new Uint8Array([1])));

    // The cached copy opens first and has no page 6; the refetched one does.
    act(() => doc.onLoadSuccess!(copy(5)));
    rerender(view(new Uint8Array([2])));
    act(() => doc.onLoadSuccess!(copy(8)));

    expect(screen.getByLabelText('Page number')).toHaveValue('6');
  });
});
